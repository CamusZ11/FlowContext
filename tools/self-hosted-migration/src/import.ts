import {
  BUSINESS_TABLES,
  readMigrationExport,
  type BusinessTable,
  type MigrationRow,
} from "./verify.ts";
import type { MigrationPool } from "./export.ts";

export interface ImportOptions {
  replaceEmptyTarget?: boolean;
}

const TABLE_COLUMNS: Record<BusinessTable, readonly string[]> = {
  project_projections: ["id", "owner_id", "project_key", "title", "lifecycle_status", "summary", "next_action", "source_path", "last_synced_at", "created_at", "updated_at"],
  topic_cards: ["id", "owner_id", "project_id", "title", "state", "current_state", "next_action", "open_questions", "latest_handoff_id", "last_active_at", "focus_rank", "resurface_at", "resurface_condition", "created_at", "updated_at"],
  sessions: ["id", "owner_id", "topic_card_id", "codex_thread_id", "device_id", "platform", "workspace_path", "started_at", "ended_at", "created_at"],
  handoffs: ["id", "owner_id", "session_id", "topic_card_id", "content", "idempotency_key", "created_at", "generated_at"],
  todos: ["id", "owner_id", "title", "planned_date", "planned_time", "is_completed", "project_id", "topic_card_id", "created_at", "updated_at"],
  daily_projections: ["owner_id", "date", "daily_lens", "projects", "mac_report", "windows_report", "updated_at"],
  device_workspaces: ["id", "owner_id", "device_id", "platform", "project_id", "workspace_path", "created_at", "updated_at"],
};

const DELETE_ORDER: readonly BusinessTable[] = [
  "device_workspaces",
  "daily_projections",
  "todos",
  "handoffs",
  "sessions",
  "topic_cards",
  "project_projections",
];

export async function importBusinessData(
  inputDirectory: string,
  target: MigrationPool,
  options: ImportOptions = {},
): Promise<void> {
  const { rows } = await readMigrationExport(inputDirectory);
  const sourceOwnerIds = collectOwnerIds(rows);
  const client = await target.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(`LOCK TABLE ${BUSINESS_TABLES.map((table) => `"${table}"`).join(", ")} IN ACCESS EXCLUSIVE MODE`);
    const nonempty = await nonemptyTables(client);
    if (nonempty.length > 0) {
      if (!options.replaceEmptyTarget) throw new Error(`target_not_empty:${nonempty.join(",")}`);
      const marker = await client.query("select current_setting('flowcontext.disposable_target', true) as disposable_target");
      if (marker.rows[0]?.disposable_target !== "true") throw new Error("target_not_disposable");
      for (const table of DELETE_ORDER) await client.query(`delete from "${table}"`);
    }

    const owners = await client.query("select id::text as id from owners order by id");
    const targetOwnerIds = owners.rows.map((row) => requiredString(row.id, "owner_id"));
    if (targetOwnerIds.some((id) => !sourceOwnerIds.has(id)) || (targetOwnerIds.length > 0 && sourceOwnerIds.size === 0)) {
      throw new Error("target_owner_mismatch");
    }
    for (const ownerId of sourceOwnerIds) {
      await client.query("insert into owners (id) values ($1) on conflict (id) do nothing", [ownerId]);
    }

    for (const table of BUSINESS_TABLES) {
      for (const original of rows[table]) {
        const row = table === "topic_cards" ? { ...original, latest_handoff_id: null } : original;
        await insertRow(client, table, row);
      }
    }
    for (const topic of rows.topic_cards) {
      if (topic.latest_handoff_id === null || topic.latest_handoff_id === undefined) continue;
      await client.query(
        "update topic_cards set latest_handoff_id = $1 where owner_id = $2 and id = $3",
        [topic.latest_handoff_id, topic.owner_id, topic.id],
      );
    }
    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function nonemptyTables(
  client: Awaited<ReturnType<MigrationPool["connect"]>>,
): Promise<BusinessTable[]> {
  const nonempty: BusinessTable[] = [];
  for (const table of BUSINESS_TABLES) {
    const result = await client.query(`select count(*)::text as row_count from "${table}"`);
    if (Number(result.rows[0]?.row_count) !== 0) nonempty.push(table);
  }
  return nonempty;
}

async function insertRow(
  client: Awaited<ReturnType<MigrationPool["connect"]>>,
  table: BusinessTable,
  row: MigrationRow,
): Promise<void> {
  const allowed = TABLE_COLUMNS[table];
  const unknown = Object.keys(row).filter((column) => !allowed.includes(column));
  if (unknown.length > 0) throw new Error(`unsupported_columns:${table}:${unknown.join(",")}`);
  const columns = allowed.filter((column) => Object.hasOwn(row, column));
  if (columns.length === 0) throw new Error(`empty_row:${table}`);
  const parameters = columns.map((_, index) => `$${index + 1}`).join(", ");
  const names = columns.map((column) => `"${column}"`).join(", ");
  await client.query(
    `insert into "${table}" (${names}) values (${parameters})`,
    columns.map((column) => row[column]),
  );
}

function collectOwnerIds(rows: Record<BusinessTable, MigrationRow[]>): Set<string> {
  const owners = new Set<string>();
  for (const table of BUSINESS_TABLES) {
    for (const row of rows[table]) owners.add(requiredString(row.owner_id, "owner_id"));
  }
  if (owners.size > 1) throw new Error("source_owner_count_mismatch");
  return owners;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`invalid_${field}`);
  return value;
}
