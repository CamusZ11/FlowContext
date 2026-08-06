import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { runMigrations } from "../src/migrate.ts";

type Statement = {
  executor: "pool" | "client";
  sql: string;
  values?: readonly unknown[];
};

class RecordingPool {
  readonly statements: Statement[] = [];
  readonly applied = new Set<string>();
  connections = 0;
  released = 0;

  async query(sql: string, values?: readonly unknown[]) {
    return this.execute("pool", sql, values);
  }

  async connect() {
    this.connections += 1;
    return {
      query: (sql: string, values?: readonly unknown[]) => this.execute("client", sql, values),
      release: () => { this.released += 1; },
    };
  }

  private async execute(executor: Statement["executor"], sql: string, values?: readonly unknown[]) {
    this.statements.push({ executor, sql, values });
    const normalized = sql.replaceAll(/\s+/g, " ").trim().toLowerCase();

    if (normalized.startsWith("select filename from schema_migrations")) {
      const filename = String(values?.[0]);
      return this.applied.has(filename)
        ? { rows: [{ filename }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("insert into schema_migrations")) {
      this.applied.add(String(values?.[0]));
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes("migration failure")) throw new Error("migration failure");
    return { rows: [], rowCount: 0 };
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function migrationDirectory(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "flowcontext-api-migrations-"));
  temporaryDirectories.push(directory);
  await Promise.all(Object.entries(files).map(([filename, contents]) => writeFile(join(directory, filename), contents)));
  return directory;
}

function asPool(pool: RecordingPool): Pool {
  return pool as unknown as Pool;
}

describe("runMigrations", () => {
  it("applies forward Session platform migrations including the legacy-null repair", async () => {
    const pool = new RecordingPool();
    const directory = resolve(import.meta.dirname, "../migrations");

    const applied = await runMigrations(asPool(pool), directory);

    expect(applied).toContain("003_session_platform.sql");
    expect(applied).toContain("004_session_platform_nullable.sql");
    const nullableRepair = pool.statements.find(({ sql }) => sql.includes("alter column platform drop not null"));
    expect(nullableRepair?.sql).toContain("alter table sessions");
  });

  it("applies new migrations in filename order under one transaction advisory lock", async () => {
    const pool = new RecordingPool();
    const directory = await migrationDirectory({
      "002_second.sql": "select 'second';",
      "001_first.sql": "select 'first';",
    });

    await expect(runMigrations(asPool(pool), directory)).resolves.toEqual(["001_first.sql", "002_second.sql"]);

    const lockIndex = pool.statements.findIndex((statement) => statement.sql.includes("pg_advisory_xact_lock"));
    const schemaTableIndex = pool.statements.findIndex((statement) => statement.sql.includes("create table if not exists schema_migrations"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(pool.statements[lockIndex]?.executor).toBe("client");
    expect(lockIndex).toBeLessThan(schemaTableIndex);
    expect(pool.connections).toBe(1);
    expect(pool.statements.every((statement) => statement.executor === "client")).toBe(true);
    expect(pool.statements.filter((statement) => statement.sql.startsWith("insert into schema_migrations")).map((statement) => statement.values?.[0]))
      .toEqual(["001_first.sql", "002_second.sql"]);
  });

  it("skips filenames already recorded by an earlier run", async () => {
    const pool = new RecordingPool();
    const directory = await migrationDirectory({ "001_once.sql": "select 'once';" });

    await expect(runMigrations(asPool(pool), directory)).resolves.toEqual(["001_once.sql"]);
    await expect(runMigrations(asPool(pool), directory)).resolves.toEqual([]);

    expect(pool.statements.filter((statement) => statement.sql === "select 'once';")).toHaveLength(1);
  });

  it("rolls back a failed migration without recording its filename", async () => {
    const pool = new RecordingPool();
    const directory = await migrationDirectory({ "001_fail.sql": "select 'migration failure';" });

    await expect(runMigrations(asPool(pool), directory)).rejects.toThrow("migration failure");

    expect(pool.applied).toEqual(new Set());
    expect(pool.statements.some((statement) => statement.sql === "rollback")).toBe(true);
    expect(pool.statements.some((statement) => statement.sql.startsWith("insert into schema_migrations"))).toBe(false);
  });
});
