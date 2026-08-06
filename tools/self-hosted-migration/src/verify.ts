import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const BUSINESS_TABLES = [
  "project_projections",
  "topic_cards",
  "sessions",
  "handoffs",
  "todos",
  "daily_projections",
  "device_workspaces",
] as const;

export type BusinessTable = (typeof BUSINESS_TABLES)[number];
export type MigrationRow = Record<string, unknown>;

export interface QueryResultLike {
  rows: MigrationRow[];
}

export interface Queryable {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResultLike>;
}

export interface MigrationManifest {
  schemaVersion: 1;
  tables: Record<BusinessTable, {
    file: string;
    rowCount: number;
    sha256: string;
  }>;
  samples: {
    todoIds: string[];
    dailyProjections: Array<{ ownerId: string; date: string }>;
  };
}

export async function verifyImport(inputDirectory: string, target: Queryable): Promise<void> {
  const { manifest, rows } = await readMigrationExport(inputDirectory);

  for (const table of BUSINESS_TABLES) {
    const result = await target.query(`select count(*)::text as row_count from "${table}"`);
    const actual = Number(result.rows[0]?.row_count);
    if (actual !== manifest.tables[table].rowCount) throw new Error(`row_count_mismatch:${table}`);
  }

  const foreignKeys = await target.query(FOREIGN_KEY_CHECK_SQL);
  if (Number(foreignKeys.rows[0]?.violation_count) !== 0) throw new Error("foreign_key_mismatch");

  const expectedLatest = latestHandoffsByTopic(rows.handoffs);
  for (const topic of rows.topic_cards) {
    const topicId = requiredString(topic.topic_card_id ?? topic.id, "topic_card_id");
    const pointer = nullableString(topic.latest_handoff_id);
    if ((expectedLatest.get(topicId) ?? null) !== pointer) throw new Error("latest_handoff_mismatch");
  }
  const actualLatestResult = await target.query(LATEST_HANDOFF_SQL);
  const seenTopics = new Set<string>();
  for (const row of actualLatestResult.rows) {
    const topicId = requiredString(row.topic_card_id, "topic_card_id");
    const expected = expectedLatest.get(topicId) ?? null;
    if (nullableString(row.latest_handoff_id) !== expected || nullableString(row.topic_latest_handoff_id) !== expected) {
      throw new Error("latest_handoff_mismatch");
    }
    seenTopics.add(topicId);
  }
  if (seenTopics.size !== rows.topic_cards.length) throw new Error("latest_handoff_mismatch");

  const expectedTodos = selectedRows(rows.todos, "id", manifest.samples.todoIds);
  const actualTodos = await target.query(TODO_SAMPLE_SQL, [manifest.samples.todoIds]);
  if (!rowSetsEqual(expectedTodos, actualTodos.rows, (row) => requiredString(row.id, "id"))) {
    throw new Error("todo_sample_mismatch");
  }

  const dailyKeys = manifest.samples.dailyProjections.map(({ ownerId, date }) => `${ownerId}:${date}`);
  const expectedDaily = selectedRows(rows.daily_projections, "daily projection", dailyKeys, dailyProjectionKey);
  const actualDaily = await target.query(DAILY_SAMPLE_SQL, [dailyKeys]);
  if (!rowSetsEqual(expectedDaily, actualDaily.rows, dailyProjectionKey)) {
    throw new Error("daily_projection_sample_mismatch");
  }
}

export async function readMigrationExport(inputDirectory: string): Promise<{
  manifest: MigrationManifest;
  rows: Record<BusinessTable, MigrationRow[]>;
}> {
  const manifestValue: unknown = JSON.parse(await readFile(join(inputDirectory, "manifest.json"), "utf8"));
  const manifest = parseManifest(manifestValue);
  const rows = {} as Record<BusinessTable, MigrationRow[]>;
  for (const table of BUSINESS_TABLES) {
    const entry = manifest.tables[table];
    const content = await readFile(join(inputDirectory, entry.file), "utf8");
    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== entry.sha256) throw new Error(`manifest_digest_mismatch:${table}`);
    const parsed = parseNdjson(content, table);
    if (parsed.length !== entry.rowCount) throw new Error(`manifest_row_count_mismatch:${table}`);
    rows[table] = parsed;
  }
  return { manifest, rows };
}

function parseManifest(value: unknown): MigrationManifest {
  const manifest = asRecord(value, "invalid_manifest");
  if (manifest.schemaVersion !== 1) throw new Error("unsupported_manifest_version");
  const tables = asRecord(manifest.tables, "invalid_manifest_tables");
  if (Object.keys(tables).sort().join(",") !== [...BUSINESS_TABLES].sort().join(",")) {
    throw new Error("invalid_manifest_tables");
  }
  const parsedTables = {} as MigrationManifest["tables"];
  for (const table of BUSINESS_TABLES) {
    const entry = asRecord(tables[table], `invalid_manifest_table:${table}`);
    if (entry.file !== `${table}.ndjson`) throw new Error(`invalid_manifest_file:${table}`);
    if (!Number.isSafeInteger(entry.rowCount) || Number(entry.rowCount) < 0) throw new Error(`invalid_manifest_count:${table}`);
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error(`invalid_manifest_digest:${table}`);
    parsedTables[table] = { file: entry.file, rowCount: Number(entry.rowCount), sha256: entry.sha256 };
  }
  const samples = asRecord(manifest.samples, "invalid_manifest_samples");
  if (!Array.isArray(samples.todoIds) || !samples.todoIds.every((id) => typeof id === "string")) {
    throw new Error("invalid_manifest_todo_samples");
  }
  if (!Array.isArray(samples.dailyProjections)) throw new Error("invalid_manifest_daily_samples");
  const dailyProjections = samples.dailyProjections.map((sample) => {
    const row = asRecord(sample, "invalid_manifest_daily_sample");
    return {
      ownerId: requiredString(row.ownerId, "ownerId"),
      date: requiredString(row.date, "date"),
    };
  });
  return {
    schemaVersion: 1,
    tables: parsedTables,
    samples: { todoIds: [...samples.todoIds], dailyProjections },
  };
}

function parseNdjson(content: string, table: BusinessTable): MigrationRow[] {
  if (content === "") return [];
  if (!content.endsWith("\n")) throw new Error(`invalid_ndjson_terminator:${table}`);
  return content.slice(0, -1).split("\n").map((line, index) => {
    try {
      return asRecord(JSON.parse(line) as unknown, `invalid_ndjson_row:${table}:${index + 1}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("invalid_ndjson_row:")) throw error;
      throw new Error(`invalid_ndjson_row:${table}:${index + 1}`, { cause: error });
    }
  });
}

function latestHandoffsByTopic(handoffs: readonly MigrationRow[]): Map<string, string> {
  const latest = new Map<string, MigrationRow>();
  for (const handoff of handoffs) {
    const topicId = requiredString(handoff.topic_card_id, "topic_card_id");
    const previous = latest.get(topicId);
    if (!previous || handoffOrder(handoff) > handoffOrder(previous)) latest.set(topicId, handoff);
  }
  return new Map([...latest].map(([topicId, row]) => [topicId, requiredString(row.id, "handoff_id")]));
}

function handoffOrder(row: MigrationRow): string {
  return `${requiredString(row.generated_at, "generated_at")}:${requiredString(row.created_at, "created_at")}:${requiredString(row.id, "handoff_id")}`;
}

function selectedRows(
  rows: readonly MigrationRow[],
  field: string,
  keys: readonly string[],
  key: (row: MigrationRow) => string = (row) => requiredString(row[field], field),
): MigrationRow[] {
  const selected = new Map(rows.map((row) => [key(row), row]));
  return keys.map((value) => {
    const row = selected.get(value);
    if (!row) throw new Error(`manifest_sample_missing:${field}`);
    return row;
  });
}

function dailyProjectionKey(row: MigrationRow): string {
  return `${requiredString(row.owner_id, "owner_id")}:${requiredString(row.date, "date").slice(0, 10)}`;
}

function rowSetsEqual(
  expected: readonly MigrationRow[],
  actual: readonly MigrationRow[],
  key: (row: MigrationRow) => string,
): boolean {
  if (expected.length !== actual.length) return false;
  const actualRows = new Map(actual.map((row) => [key(row), canonicalJson(row)]));
  return expected.every((row) => actualRows.get(key(row)) === canonicalJson(row));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as MigrationRow)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]));
  }
  return value;
}

function asRecord(value: unknown, code: string): MigrationRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as MigrationRow;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`invalid_${field}`);
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value, "nullable_string");
}

const FOREIGN_KEY_CHECK_SQL = `
/* flowcontext-verify:foreign-keys */
select count(*)::text as violation_count
from (
  select p.owner_id from project_projections p left join owners o on o.id = p.owner_id where o.id is null
  union all select t.owner_id from topic_cards t left join owners o on o.id = t.owner_id where o.id is null
  union all select t.owner_id from topic_cards t left join project_projections p on (p.owner_id, p.id) = (t.owner_id, t.project_id) where p.id is null
  union all select t.owner_id from topic_cards t left join handoffs h on (h.owner_id, h.id) = (t.owner_id, t.latest_handoff_id) where t.latest_handoff_id is not null and h.id is null
  union all select s.owner_id from sessions s left join topic_cards t on (t.owner_id, t.id) = (s.owner_id, s.topic_card_id) where t.id is null
  union all select h.owner_id from handoffs h left join sessions s on (s.owner_id, s.id, s.topic_card_id) = (h.owner_id, h.session_id, h.topic_card_id) where s.id is null
  union all select h.owner_id from handoffs h left join topic_cards t on (t.owner_id, t.id) = (h.owner_id, h.topic_card_id) where t.id is null
  union all select t.owner_id from todos t left join project_projections p on (p.owner_id, p.id) = (t.owner_id, t.project_id) where t.project_id is not null and p.id is null
  union all select t.owner_id from todos t left join topic_cards c on (c.owner_id, c.id) = (t.owner_id, t.topic_card_id) where t.topic_card_id is not null and c.id is null
  union all select d.owner_id from daily_projections d left join owners o on o.id = d.owner_id where o.id is null
  union all select w.owner_id from device_workspaces w left join project_projections p on (p.owner_id, p.id) = (w.owner_id, w.project_id) where p.id is null
) violations`;

const LATEST_HANDOFF_SQL = `
/* flowcontext-verify:latest-handoffs */
select t.id as topic_card_id,
       latest.id as latest_handoff_id,
       t.latest_handoff_id as topic_latest_handoff_id
from topic_cards t
left join lateral (
  select h.id
  from handoffs h
  where h.owner_id = t.owner_id and h.topic_card_id = t.id
  order by h.generated_at desc, h.created_at desc, h.id desc
  limit 1
) latest on true
order by t.id`;

const TODO_SAMPLE_SQL = `
/* flowcontext-verify:todo-samples */
select * from todos where id = any($1::uuid[]) order by id`;

const DAILY_SAMPLE_SQL = `
/* flowcontext-verify:daily-samples */
select * from daily_projections
where concat(owner_id::text, ':', date::text) = any($1::text[])
order by owner_id, date`;
