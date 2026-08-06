#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Pool, type PoolClient, type QueryResult } from "pg";

import { exportBusinessData, type MigrationClient, type MigrationPool } from "./export.ts";
import { importBusinessData } from "./import.ts";
import { verifyImport, type Queryable, type QueryResultLike } from "./verify.ts";

interface Closable {
  end?: () => Promise<void>;
}

export interface CliDependencies {
  createPool?: (databaseUrl: string) => unknown;
  writeOutput?: (message: string) => void;
}

interface CliOptions {
  envFile: string;
  input?: string;
  output?: string;
  replaceEmptyTarget: boolean;
}

export async function runCli(argv: readonly string[], dependencies: CliDependencies = {}): Promise<void> {
  const [command, ...rest] = argv;
  if (command !== "export" && command !== "import" && command !== "verify") throw new Error(usage());
  const options = parseOptions(rest);
  const environment = await loadLocalEnvironment(options.envFile);
  const key = command === "export" ? "FLOWCONTEXT_SOURCE_DATABASE_URL" : "FLOWCONTEXT_TARGET_DATABASE_URL";
  const databaseUrl = environment[key]?.trim();
  if (!databaseUrl) throw new Error(`${key} is required in --env-file`);
  const secrets = Object.values(environment).filter((value) => value !== "");
  let pool: unknown;
  try {
    pool = (dependencies.createPool ?? createPostgresPool)(databaseUrl);
    if (command === "export") {
      if (!options.output) throw new Error("export requires --output <directory>");
      await exportBusinessData(options.output, requireMigrationPool(pool));
      (dependencies.writeOutput ?? defaultOutput)(`exported: ${options.output}`);
      return;
    }
    if (!options.input) throw new Error(`${command} requires --input <directory>`);
    if (command === "import") {
      await importBusinessData(options.input, requireMigrationPool(pool), {
        replaceEmptyTarget: options.replaceEmptyTarget,
      });
      (dependencies.writeOutput ?? defaultOutput)(`imported: ${options.input}`);
      return;
    }
    await verifyImport(options.input, requireQueryable(pool));
    (dependencies.writeOutput ?? defaultOutput)(`verified: ${options.input}`);
  } catch (error) {
    throw redactError(error, secrets);
  } finally {
    if (pool && typeof pool === "object" && "end" in pool && typeof (pool as Closable).end === "function") {
      await (pool as Closable).end?.().catch(() => undefined);
    }
  }
}

function parseOptions(argv: readonly string[]): CliOptions {
  const options: Partial<CliOptions> = { replaceEmptyTarget: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--replace-empty-target") {
      options.replaceEmptyTarget = true;
      continue;
    }
    if (token !== "--env-file" && token !== "--input" && token !== "--output") throw new Error(`unknown argument: ${token}\n${usage()}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${token}\n${usage()}`);
    if (token === "--env-file") options.envFile = value;
    if (token === "--input") options.input = value;
    if (token === "--output") options.output = value;
  }
  if (!options.envFile) throw new Error(`--env-file <local-untracked-file> is required\n${usage()}`);
  return options as CliOptions;
}

async function loadLocalEnvironment(path: string): Promise<Record<string, string>> {
  const candidate = resolve(path);
  assertUntrackedIfInsideRepository(candidate);
  const content = await readFile(candidate, "utf8");
  const environment: Record<string, string> = {};
  for (const [index, sourceLine] of content.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`invalid env file line ${index + 1}`);
    environment[match[1]!] = unquote(match[2]!.trim());
  }
  return environment;
}

function assertUntrackedIfInsideRepository(path: string): void {
  const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8" });
  if (rootResult.status !== 0) return;
  const root = rootResult.stdout.trim();
  const pathFromRoot = relative(root, path);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..")) return;
  const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", path], { cwd: root });
  if (ignored.status !== 0) throw new Error("env_file_must_be_untracked");
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function redactError(error: unknown, secrets: readonly string[]): Error {
  let message = error instanceof Error ? error.message : "migration_failed";
  for (const secret of [...secrets].sort((left, right) => right.length - left.length)) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  message = message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED]");
  return new Error(message);
}

function requireMigrationPool(value: unknown): MigrationPool {
  if (!value || typeof value !== "object" || !("connect" in value) || typeof (value as MigrationPool).connect !== "function") {
    throw new Error("invalid_database_pool");
  }
  return value as MigrationPool;
}

function requireQueryable(value: unknown): Queryable {
  if (!value || typeof value !== "object" || !("query" in value) || typeof (value as Queryable).query !== "function") {
    throw new Error("invalid_database_pool");
  }
  return value as Queryable;
}

function createPostgresPool(databaseUrl: string): MigrationPool & Queryable & Closable {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    connect: async () => new PgClientAdapter(await pool.connect()),
    query: async (sql, values) => adaptResult(await pool.query(sql, values ? [...values] : undefined)),
    end: () => pool.end(),
  };
}

class PgClientAdapter implements MigrationClient {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async query(sql: string, values?: readonly unknown[]): Promise<QueryResultLike> {
    return adaptResult(await this.client.query(sql, values ? [...values] : undefined));
  }

  release(): void {
    this.client.release();
  }
}

function adaptResult(result: QueryResult): QueryResultLike {
  return { rows: result.rows as Record<string, unknown>[] };
}

function defaultOutput(message: string): void {
  process.stdout.write(`${message}\n`);
}

function usage(): string {
  return "usage: flowcontext-migrate <export --output DIR|import --input DIR|verify --input DIR> --env-file FILE [--replace-empty-target]";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "migration_failed"}\n`);
    process.exitCode = 1;
  });
}

export { exportBusinessData } from "./export.ts";
export { importBusinessData } from "./import.ts";
export { verifyImport } from "./verify.ts";
