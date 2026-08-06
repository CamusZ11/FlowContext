import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportBusinessData } from "./export.ts";
import { importBusinessData } from "./import.ts";
import { runCli } from "./index.ts";
import { verifyImport } from "./verify.ts";

type Row = Record<string, unknown>;
type TableName = keyof typeof sourceRows;

const ownerId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const topicId = "30000000-0000-4000-8000-000000000001";
const sessionId = "40000000-0000-4000-8000-000000000001";
const oldHandoffId = "50000000-0000-4000-8000-000000000001";
const latestHandoffId = "50000000-0000-4000-8000-000000000002";
const selectedTodoId = "60000000-0000-4000-8000-000000000001";

const sourceRows = {
  project_projections: [{
    id: projectId,
    owner_id: ownerId,
    project_key: "FlowContext",
    title: "FlowContext",
    lifecycle_status: "active",
    summary: "Self-hosted migration",
    next_action: "Verify import",
    source_path: "03_项目/00_收集箱/FlowContext",
    last_synced_at: "2026-08-06T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-06T00:00:00.000Z",
  }],
  topic_cards: [{
    id: topicId,
    owner_id: ownerId,
    project_id: projectId,
    title: "Self-hosted migration",
    state: "open",
    current_state: "Task 6",
    next_action: "Verify import",
    open_questions: [],
    latest_handoff_id: latestHandoffId,
    last_active_at: "2026-08-06T02:00:00.000Z",
    focus_rank: 1,
    resurface_at: null,
    resurface_condition: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-06T02:00:00.000Z",
  }],
  sessions: [{
    id: sessionId,
    owner_id: ownerId,
    topic_card_id: topicId,
    codex_thread_id: "thread-task-6",
    device_id: "test-device",
    platform: "macos",
    workspace_path: "/workspace/FlowContext",
    started_at: "2026-08-06T00:00:00.000Z",
    ended_at: null,
    created_at: "2026-08-06T00:00:00.000Z",
  }],
  handoffs: [
    {
      id: oldHandoffId,
      owner_id: ownerId,
      session_id: sessionId,
      topic_card_id: topicId,
      content: "Older state",
      idempotency_key: "handoff-old",
      created_at: "2026-08-06T01:00:00.000Z",
      generated_at: "2026-08-06T01:00:00.000Z",
    },
    {
      id: latestHandoffId,
      owner_id: ownerId,
      session_id: sessionId,
      topic_card_id: topicId,
      content: "Latest state",
      idempotency_key: "handoff-latest",
      created_at: "2026-08-06T02:00:00.000Z",
      generated_at: "2026-08-06T02:00:00.000Z",
    },
  ],
  todos: [
    {
      id: selectedTodoId,
      owner_id: ownerId,
      title: "Selected verification todo",
      planned_date: "2026-08-06",
      planned_time: "09:30:00",
      is_completed: false,
      project_id: projectId,
      topic_card_id: topicId,
      created_at: "2026-08-06T00:00:00.000Z",
      updated_at: "2026-08-06T00:00:00.000Z",
    },
    {
      id: "60000000-0000-4000-8000-000000000002",
      owner_id: ownerId,
      title: "Unselected verification todo",
      planned_date: "2026-08-07",
      planned_time: null,
      is_completed: true,
      project_id: projectId,
      topic_card_id: topicId,
      created_at: "2026-08-06T00:00:00.000Z",
      updated_at: "2026-08-06T00:00:00.000Z",
    },
  ],
  daily_projections: [{
    owner_id: ownerId,
    date: "2026-08-06",
    daily_lens: "Finish migration verification",
    projects: [{ id: projectId, title: "FlowContext" }],
    mac_report: "Mac report",
    windows_report: null,
    updated_at: "2026-08-06T00:00:00.000Z",
  }],
  device_workspaces: [{
    id: "70000000-0000-4000-8000-000000000001",
    owner_id: ownerId,
    device_id: "test-device",
    platform: "macos",
    project_id: projectId,
    workspace_path: "/workspace/FlowContext",
    created_at: "2026-08-06T00:00:00.000Z",
    updated_at: "2026-08-06T00:00:00.000Z",
  }],
} satisfies Record<string, Row[]>;

class FixtureTargetPool {
  constructor(readonly rows: Record<TableName, Row[]>) {}

  async query(sql: string, values: readonly unknown[] = []): Promise<{ rows: Row[] }> {
    if (sql.includes("/* flowcontext-verify:foreign-keys */")) {
      return { rows: [{ violation_count: String(this.foreignKeyViolations()) }] };
    }
    if (sql.includes("/* flowcontext-verify:latest-handoffs */")) {
      const latest = new Map<string, Row>();
      for (const handoff of this.rows.handoffs) {
        const topic = String(handoff.topic_card_id);
        const previous = latest.get(topic);
        if (!previous || this.handoffOrder(handoff) > this.handoffOrder(previous)) latest.set(topic, handoff);
      }
      return {
        rows: this.rows.topic_cards.map((topic) => ({
          topic_card_id: topic.id,
          latest_handoff_id: latest.get(String(topic.id))?.id ?? null,
          topic_latest_handoff_id: topic.latest_handoff_id,
        })),
      };
    }
    if (sql.includes("/* flowcontext-verify:todo-samples */")) {
      const ids = values[0] as readonly string[];
      return { rows: this.rows.todos.filter((row) => ids.includes(String(row.id))) };
    }
    if (sql.includes("/* flowcontext-verify:session-samples */")) {
      const ids = values[0] as readonly string[];
      return { rows: this.rows.sessions.filter((row) => ids.includes(String(row.id))) };
    }
    if (sql.includes("/* flowcontext-verify:daily-samples */")) {
      const keys = values[0] as readonly string[];
      return {
        rows: this.rows.daily_projections.filter((row) => keys.includes(`${String(row.owner_id)}:${String(row.date)}`)),
      };
    }
    const table = /from\s+"([a-z_]+)"/i.exec(sql)?.[1] as TableName | undefined;
    if (table && sql.toLowerCase().includes("count(*)")) {
      return { rows: [{ row_count: String(this.rows[table].length) }] };
    }
    throw new Error(`unexpected fixture query: ${sql}`);
  }

  private handoffOrder(row: Row): string {
    return `${String(row.generated_at)}:${String(row.created_at)}:${String(row.id)}`;
  }

  private foreignKeyViolations(): number {
    const has = (table: TableName, id: unknown) => this.rows[table].some((row) => row.id === id);
    let count = 0;
    for (const topic of this.rows.topic_cards) {
      if (!has("project_projections", topic.project_id)) count += 1;
      if (topic.latest_handoff_id !== null && !has("handoffs", topic.latest_handoff_id)) count += 1;
    }
    for (const session of this.rows.sessions) if (!has("topic_cards", session.topic_card_id)) count += 1;
    for (const handoff of this.rows.handoffs) {
      if (!has("sessions", handoff.session_id) || !has("topic_cards", handoff.topic_card_id)) count += 1;
    }
    for (const todo of this.rows.todos) {
      if (todo.project_id !== null && !has("project_projections", todo.project_id)) count += 1;
      if (todo.topic_card_id !== null && !has("topic_cards", todo.topic_card_id)) count += 1;
    }
    for (const workspace of this.rows.device_workspaces) if (!has("project_projections", workspace.project_id)) count += 1;
    return count;
  }
}

const temporaryDirectories: string[] = [];
let fixtureDirectory: string;

beforeEach(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "flowcontext-migration-fixture-"));
  temporaryDirectories.push(fixtureDirectory);
  await writeFixture(fixtureDirectory, sourceRows);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("verifyImport", () => {
  it("accepts matching counts, references, latest Handoffs and named samples", async () => {
    await expect(verifyImport(fixtureDirectory, targetWith())).resolves.toBeUndefined();
  });

  it("rejects a changed export file whose manifest digest no longer matches", async () => {
    await writeFile(join(fixtureDirectory, "todos.ndjson"), `${JSON.stringify(sourceRows.todos[0])}\n`, "utf8");
    await expect(verifyImport(fixtureDirectory, targetWith())).rejects.toThrow("manifest_digest_mismatch:todos");
  });

  it("rejects a target whose row count differs", async () => {
    const pool = targetWith((rows) => rows.device_workspaces.pop());
    await expect(verifyImport(fixtureDirectory, pool)).rejects.toThrow("row_count_mismatch:device_workspaces");
  });

  it("rejects imported rows with broken foreign-key references", async () => {
    const pool = targetWith((rows) => {
      rows.todos[1]!.topic_card_id = "30000000-0000-4000-8000-ffffffffffff";
    });
    await expect(verifyImport(fixtureDirectory, pool)).rejects.toThrow("foreign_key_mismatch");
  });

  it("rejects an import whose Handoff count matches but newest Topic Handoff differs", async () => {
    const pool = targetWith((rows) => {
      rows.handoffs[0]!.generated_at = "2026-08-06T03:00:00.000Z";
    });
    await expect(verifyImport(fixtureDirectory, pool)).rejects.toThrow("latest_handoff_mismatch");
  });

  it("rejects a Topic whose latest Handoff pointer differs from its newest imported Handoff", async () => {
    const pool = targetWith((rows) => {
      rows.topic_cards[0]!.latest_handoff_id = oldHandoffId;
    });
    await expect(verifyImport(fixtureDirectory, pool)).rejects.toThrow("latest_handoff_mismatch");
  });

  it("rejects a changed named To-do sample", async () => {
    const pool = targetWith((rows) => {
      rows.todos[0]!.title = "Wrong title";
    });
    await expect(verifyImport(fixtureDirectory, pool)).rejects.toThrow("todo_sample_mismatch");
  });

  it("rejects a Session whose imported platform differs from the export", async () => {
    const pool = targetWith((rows) => {
      rows.sessions[0]!.platform = "windows";
    });
    await expect(verifyImport(fixtureDirectory, pool)).rejects.toThrow("session_sample_mismatch");
  });

  it("rejects a changed Daily Projection sample", async () => {
    const pool = targetWith((rows) => {
      rows.daily_projections[0]!.daily_lens = "Wrong lens";
    });
    await expect(verifyImport(fixtureDirectory, pool)).rejects.toThrow("daily_projection_sample_mismatch");
  });
});

describe("exportBusinessData", () => {
  it("exports only the seven business tables from one read-only snapshot with private file modes", async () => {
    const output = join(fixtureDirectory, "export");
    const pool = new ExportFixturePool(sourceRows);

    await exportBusinessData(output, pool);

    expect(pool.client.finished).toBe("commit");
    expect(pool.client.tablesRead).toEqual(Object.keys(sourceRows));
    expect((await readdir(output)).sort()).toEqual([
      "daily_projections.ndjson",
      "device_workspaces.ndjson",
      "handoffs.ndjson",
      "manifest.json",
      "project_projections.ndjson",
      "sessions.ndjson",
      "todos.ndjson",
      "topic_cards.ndjson",
    ]);
    for (const file of await readdir(output)) {
      expect((await stat(join(output, file))).mode & 0o777).toBe(0o600);
    }
    const serialized = (await Promise.all((await readdir(output)).map((file) => readFile(join(output, file), "utf8")))).join("\n");
    expect(serialized).not.toMatch(/device_tokens|token_hash|auth\.users/i);
    await expect(verifyImport(output, targetWith())).resolves.toBeUndefined();
  });

  it("rolls back the source snapshot and removes partial output when a table read fails", async () => {
    const output = join(fixtureDirectory, "failed-export");
    const pool = new ExportFixturePool(sourceRows, "handoffs");

    await expect(exportBusinessData(output, pool)).rejects.toThrow("fixture export failure");

    expect(pool.client.finished).toBe("rollback");
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("importBusinessData", () => {
  it("imports owners and all business rows transactionally in foreign-key order", async () => {
    const target = new ImportFixturePool(emptyRows());

    await importBusinessData(fixtureDirectory, target);

    expect(target.client.finished).toBe("commit");
    expect(target.client.owners).toEqual([ownerId]);
    expect(target.client.rows).toEqual(sourceRows);
    expect(target.client.insertOrder).toEqual(Object.keys(sourceRows));
  });

  it("refuses a nonempty target before changing any rows", async () => {
    const target = new ImportFixturePool(targetWith().rows);

    await expect(importBusinessData(fixtureDirectory, target)).rejects.toThrow("target_not_empty");

    expect(target.client.finished).toBe("rollback");
    expect(target.client.rows).toEqual(sourceRows);
  });

  it("refuses replacement when the database is not explicitly marked disposable", async () => {
    const target = new ImportFixturePool(targetWith().rows, false);

    await expect(importBusinessData(fixtureDirectory, target, { replaceEmptyTarget: true })).rejects.toThrow("target_not_disposable");

    expect(target.client.finished).toBe("rollback");
    expect(target.client.rows).toEqual(sourceRows);
  });

  it("replaces business rows only after both the flag and database disposable marker are present", async () => {
    const stale = targetWith((rows) => {
      rows.todos[0]!.title = "Stale target row";
    }).rows;
    const target = new ImportFixturePool(stale, true, [ownerId]);

    await importBusinessData(fixtureDirectory, target, { replaceEmptyTarget: true });

    expect(target.client.finished).toBe("commit");
    expect(target.client.rows).toEqual(sourceRows);
  });

  it("rolls back every inserted row when a later table insert fails", async () => {
    const target = new ImportFixturePool(emptyRows(), false, [], "handoffs");

    await expect(importBusinessData(fixtureDirectory, target)).rejects.toThrow("fixture import failure");

    expect(target.client.finished).toBe("rollback");
    expect(target.client.rows).toEqual(emptyRows());
    expect(target.client.owners).toEqual([]);
  });
});

describe("flowcontext-migrate CLI", () => {
  it("starts under the repository's supported Node runtime without a TypeScript syntax crash", async () => {
    const execute = promisify(execFile);
    const result = await execute(process.execPath, [join(import.meta.dirname, "index.ts")])
      .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
      .catch((error: unknown) => {
        const failure = error as { code?: number; stdout?: string; stderr?: string };
        return { code: failure.code ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
      });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("usage: flowcontext-migrate");
    expect(result.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  });

  it("loads source credentials only from a user-provided local env file", async () => {
    const envFile = join(fixtureDirectory, "migration.env");
    const output = join(fixtureDirectory, "cli-export");
    const url = "postgres://fixture-user:fixture-password@localhost/source";
    await writeFile(envFile, `FLOWCONTEXT_SOURCE_DATABASE_URL=${url}\n`, { encoding: "utf8", mode: 0o600 });
    let receivedUrl: string | null = null;
    const messages: string[] = [];

    await runCli(["export", "--env-file", envFile, "--output", output], {
      createPool: (databaseUrl) => {
        receivedUrl = databaseUrl;
        return new ExportFixturePool(sourceRows);
      },
      writeOutput: (message) => messages.push(message),
    });

    expect(receivedUrl).toBe(url);
    expect(messages).toEqual([`exported: ${output}`]);
    expect(await readdir(output)).toContain("manifest.json");
  });

  it("never falls back to process environment credentials", async () => {
    vi.stubEnv("FLOWCONTEXT_SOURCE_DATABASE_URL", "postgres://process:secret@localhost/source");

    await expect(runCli(["export", "--output", join(fixtureDirectory, "output")], {
      createPool: () => { throw new Error("pool factory must not run"); },
      writeOutput: () => undefined,
    })).rejects.toThrow("--env-file");
  });

  it("redacts the full connection value from database errors", async () => {
    const envFile = join(fixtureDirectory, "migration.env.local");
    const secretUrl = "postgres://fixture-user:do-not-print@localhost/source";
    await writeFile(envFile, `FLOWCONTEXT_SOURCE_DATABASE_URL=${secretUrl}\n`, { encoding: "utf8", mode: 0o600 });

    const promise = runCli(["export", "--env-file", envFile, "--output", join(fixtureDirectory, "output")], {
      createPool: (databaseUrl) => { throw new Error(`connection failed: ${databaseUrl}`); },
      writeOutput: () => undefined,
    });

    await expect(promise).rejects.toThrow("connection failed: [REDACTED]");
    await expect(promise).rejects.not.toThrow("do-not-print");
  });
});

function targetWith(change?: (rows: Record<TableName, Row[]>) => void): FixtureTargetPool {
  const rows = structuredClone(sourceRows) as Record<TableName, Row[]>;
  change?.(rows);
  return new FixtureTargetPool(rows);
}

async function writeFixture(directory: string, rows: Record<TableName, Row[]>): Promise<void> {
  await mkdir(directory, { recursive: true });
  const tables: Record<string, { file: string; rowCount: number; sha256: string }> = {};
  for (const [table, values] of Object.entries(rows)) {
    const file = `${table}.ndjson`;
    const content = values.length === 0 ? "" : `${values.map((row) => JSON.stringify(row)).join("\n")}\n`;
    await writeFile(join(directory, file), content, "utf8");
    tables[table] = {
      file,
      rowCount: values.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    tables,
    samples: {
      sessionIds: [sessionId],
      todoIds: [selectedTodoId],
      dailyProjections: [{ ownerId, date: "2026-08-06" }],
    },
  }, null, 2)}\n`, "utf8");
}

class ExportFixturePool {
  readonly client: ExportFixtureClient;

  constructor(rows: Record<TableName, Row[]>, failTable?: TableName) {
    this.client = new ExportFixtureClient(rows, failTable);
  }

  async connect(): Promise<ExportFixtureClient> {
    return this.client;
  }
}

class ExportFixtureClient {
  readonly tablesRead: string[] = [];
  finished: "commit" | "rollback" | null = null;
  private readOnlySnapshot = false;

  constructor(
    private readonly rows: Record<TableName, Row[]>,
    private readonly failTable?: TableName,
  ) {}

  async query(sql: string): Promise<{ rows: Row[] }> {
    const normalized = sql.trim().toLowerCase();
    if (normalized === "begin isolation level repeatable read read only") {
      this.readOnlySnapshot = true;
      return { rows: [] };
    }
    if (normalized === "commit") {
      this.finished = "commit";
      return { rows: [] };
    }
    if (normalized === "rollback") {
      this.finished = "rollback";
      return { rows: [] };
    }
    const table = /from\s+"([a-z_]+)"/i.exec(sql)?.[1] as TableName | undefined;
    if (!this.readOnlySnapshot || !table || !(table in this.rows)) throw new Error(`unexpected export query: ${sql}`);
    if (table === this.failTable) throw new Error("fixture export failure");
    this.tablesRead.push(table);
    return { rows: structuredClone(this.rows[table]) };
  }

  release(): void {}
}

class ImportFixturePool {
  readonly client: ImportFixtureClient;

  constructor(
    rows: Record<TableName, Row[]>,
    disposable = false,
    owners: string[] = [],
    failTable?: TableName,
  ) {
    this.client = new ImportFixtureClient(rows, disposable, owners, failTable);
  }

  async connect(): Promise<ImportFixtureClient> {
    return this.client;
  }
}

class ImportFixtureClient {
  readonly insertOrder: string[] = [];
  finished: "commit" | "rollback" | null = null;
  rows: Record<TableName, Row[]>;
  owners: string[];
  private snapshot: { rows: Record<TableName, Row[]>; owners: string[] } | null = null;

  constructor(
    rows: Record<TableName, Row[]>,
    private readonly disposable: boolean,
    owners: string[],
    private readonly failTable?: TableName,
  ) {
    this.rows = structuredClone(rows);
    this.owners = [...owners];
  }

  async query(sql: string, values: readonly unknown[] = []): Promise<{ rows: Row[] }> {
    const normalized = sql.trim().replace(/\s+/g, " ").toLowerCase();
    if (normalized === "begin") {
      this.snapshot = { rows: structuredClone(this.rows), owners: [...this.owners] };
      return { rows: [] };
    }
    if (normalized === "commit") {
      this.finished = "commit";
      this.snapshot = null;
      return { rows: [] };
    }
    if (normalized === "rollback") {
      this.finished = "rollback";
      if (this.snapshot) {
        this.rows = this.snapshot.rows;
        this.owners = this.snapshot.owners;
      }
      this.snapshot = null;
      return { rows: [] };
    }
    if (normalized.startsWith("lock table")) return { rows: [] };
    if (normalized.includes("current_setting('flowcontext.disposable_target'")) {
      return { rows: [{ disposable_target: this.disposable ? "true" : null }] };
    }
    if (normalized === "select id::text as id from owners order by id") {
      return { rows: this.owners.map((id) => ({ id })) };
    }
    if (normalized.startsWith("insert into owners")) {
      const id = String(values[0]);
      if (!this.owners.includes(id)) this.owners.push(id);
      return { rows: [] };
    }
    const countTable = /select count\(\*\)::text as row_count from "([a-z_]+)"/i.exec(sql)?.[1] as TableName | undefined;
    if (countTable) return { rows: [{ row_count: String(this.rows[countTable].length) }] };
    const deleteTable = /delete from "([a-z_]+)"/i.exec(sql)?.[1] as TableName | undefined;
    if (deleteTable) {
      this.rows[deleteTable] = [];
      return { rows: [] };
    }
    const insert = /insert into "([a-z_]+)" \(([^)]+)\) values/i.exec(sql);
    if (insert) {
      const table = insert[1] as TableName;
      if (table === this.failTable) throw new Error("fixture import failure");
      const columns = insert[2]!.split(",").map((column) => column.trim().replaceAll('"', ""));
      const row = Object.fromEntries(columns.map((column, index) => [column, structuredClone(values[index])])) as Row;
      if (!this.insertOrder.includes(table)) this.insertOrder.push(table);
      this.rows[table].push(row);
      return { rows: [] };
    }
    if (normalized.startsWith("update topic_cards set latest_handoff_id")) {
      const row = this.rows.topic_cards.find((topic) => topic.owner_id === values[1] && topic.id === values[2]);
      if (row) row.latest_handoff_id = values[0];
      return { rows: [] };
    }
    throw new Error(`unexpected import query: ${sql}`);
  }

  release(): void {}
}

function emptyRows(): Record<TableName, Row[]> {
  return Object.fromEntries(Object.keys(sourceRows).map((table) => [table, []])) as unknown as Record<TableName, Row[]>;
}
