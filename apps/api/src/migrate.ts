import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

import { loadConfig } from "./config.js";
import { createDatabasePool } from "./db.js";

export async function runMigrations(pool: Pool, directory: string): Promise<string[]> {
  await pool.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(directory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const applied: string[] = [];

  for (const filename of files) {
    const existing = await pool.query<{ filename: string }>(
      "select filename from schema_migrations where filename = $1",
      [filename],
    );
    if (existing.rowCount) continue;

    const sql = await readFile(join(directory, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [filename]);
      await client.query("commit");
      applied.push(filename);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return applied;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = createDatabasePool(config.databaseUrl);
  try {
    const directory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const applied = await runMigrations(pool, directory);
    console.log(applied.length === 0 ? "No migrations to apply." : `Applied: ${applied.join(", ")}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
