import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, rename, rmdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  BUSINESS_TABLES,
  type BusinessTable,
  type MigrationManifest,
  type MigrationRow,
  type QueryResultLike,
} from "./verify.ts";

export interface MigrationClient {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResultLike>;
  release(): void;
}

export interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

const ORDER_BY: Record<BusinessTable, string> = {
  project_projections: "owner_id, id",
  topic_cards: "owner_id, id",
  sessions: "owner_id, id",
  handoffs: "owner_id, id",
  todos: "owner_id, id",
  daily_projections: "owner_id, date",
  device_workspaces: "owner_id, id",
};

export async function exportBusinessData(outputDirectory: string, source: MigrationPool): Promise<void> {
  const output = resolve(outputDirectory);
  await assertOutputAvailable(output);
  await mkdir(dirname(output), { recursive: true });
  const temporary = await mkdtemp(join(dirname(output), ".flowcontext-export-"));
  await chmod(temporary, 0o700);
  const client = await source.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const rows = {} as Record<BusinessTable, MigrationRow[]>;
    const tables = {} as MigrationManifest["tables"];
    for (const table of BUSINESS_TABLES) {
      const result = await client.query(`select * from "${table}" order by ${ORDER_BY[table]}`);
      rows[table] = result.rows;
      const file = `${table}.ndjson`;
      const content = encodeNdjson(result.rows);
      await writePrivateFile(join(temporary, file), content);
      tables[table] = {
        file,
        rowCount: result.rows.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
    }
    const manifest: MigrationManifest = {
      schemaVersion: 1,
      tables,
      samples: selectSamples(rows),
    };
    await writePrivateFile(join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await client.query("COMMIT");
    transactionOpen = false;

    if (await pathExists(output)) {
      await assertOutputAvailable(output);
      await rmdir(output);
    }
    await rename(temporary, output);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    await rm(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    client.release();
  }
}

function selectSamples(rows: Record<BusinessTable, MigrationRow[]>): MigrationManifest["samples"] {
  return {
    sessionIds: spreadSample(rows.sessions).map((row) => requiredString(row.id, "session_id")),
    todoIds: spreadSample(rows.todos).map((row) => requiredString(row.id, "todo_id")),
    dailyProjections: spreadSample(rows.daily_projections).map((row) => ({
      ownerId: requiredString(row.owner_id, "owner_id"),
      date: requiredString(row.date, "date").slice(0, 10),
    })),
  };
}

function spreadSample(rows: readonly MigrationRow[]): MigrationRow[] {
  if (rows.length <= 3) return [...rows];
  return [rows[0]!, rows[Math.floor((rows.length - 1) / 2)]!, rows[rows.length - 1]!];
}

function encodeNdjson(rows: readonly MigrationRow[]): string {
  return rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);
}

async function assertOutputAvailable(path: string): Promise<void> {
  try {
    const details = await stat(path);
    if (!details.isDirectory() || (await readdir(path)).length !== 0) throw new Error("output_directory_not_empty");
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, (error: unknown) => {
    if (isMissing(error)) return false;
    throw error;
  });
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`invalid_${field}`);
  return value;
}
