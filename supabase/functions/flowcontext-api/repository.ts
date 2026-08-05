import type {
  DailyProjection,
  DeviceWorkspace,
  Handoff,
  HandoffCreate,
  ProjectProjection,
  Session,
  Todo,
  TopicCard,
} from "../../../packages/domain/src/types.ts";
import type { Principal } from "./auth.ts";

/** A device token is looked up by this already-hashed value only. */
export interface DeviceTokenRecord {
  ownerId: string;
  deviceId: string;
  tokenHash: string;
  revokedAt?: string | null;
}

export type TopicCreate = Partial<TopicCard>;
export type SessionCreate = Partial<Session>;
export type ProjectProjectionWrite = Partial<ProjectProjection>;
export type DailyProjectionWrite = Partial<DailyProjection>;
export type DeviceWorkspaceWrite = Partial<DeviceWorkspace>;
export type TodoCreateInput = Pick<Todo, "title" | "plannedDate" | "plannedTime">;

export interface HandoffCreateResult {
  record: Handoff;
  /** False means the idempotency key returned an existing immutable record. */
  created: boolean;
}

/**
 * The Edge Function depends on this boundary, not on table names or SQL.
 * Task 3's database adapter can implement this interface without changing
 * HTTP routing, authentication, or idempotency behavior.
 */
export interface ApiRepository {
  createHandoff(
    input: HandoffCreate,
    principal: Principal,
  ): Promise<HandoffCreateResult>;
  completeTopic(
    topicId: string,
    explicit: boolean,
    principal: Principal,
  ): Promise<TopicCard>;
  createTopic?(input: TopicCreate, principal: Principal): Promise<TopicCard>;
  createSession?(input: SessionCreate, principal: Principal): Promise<Session>;
  createTodo?(input: TodoCreateInput, principal: Principal): Promise<Todo>;
  upsertProjectProjection?(
    id: string,
    input: ProjectProjectionWrite,
    principal: Principal,
  ): Promise<ProjectProjection>;
  upsertDailyProjection?(
    date: string,
    input: DailyProjectionWrite,
    principal: Principal,
  ): Promise<DailyProjection>;
  upsertDeviceWorkspace?(
    deviceId: string,
    projectId: string,
    input: DeviceWorkspaceWrite,
    principal: Principal,
  ): Promise<DeviceWorkspace>;
  /** Auth must query by SHA-256 hash; it must never receive the raw token. */
  findDeviceTokenByHash?(hash: string): Promise<DeviceTokenRecord | null>;
}

export interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export interface SupabaseResponse<T = unknown> {
  data: T | null;
  error: SupabaseErrorLike | null;
}

/** Narrow structural surface used by the adapter and by its recording tests. */
export interface SupabaseQueryLike {
  select(columns?: string): SupabaseQueryLike;
  eq(column: string, value: unknown): SupabaseQueryLike;
  insert(values: unknown): SupabaseQueryLike;
  upsert(values: unknown, options?: { onConflict?: string }): SupabaseQueryLike;
  maybeSingle<T = unknown>(): PromiseLike<SupabaseResponse<T>>;
  single<T = unknown>(): PromiseLike<SupabaseResponse<T>>;
}

export interface SupabaseClientLike {
  from(table: string): SupabaseQueryLike;
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<SupabaseResponse<unknown>>;
}

/**
 * Supabase service-role implementation. Every business read/write carries an
 * explicit owner predicate or owner_id payload because service_role bypasses
 * RLS. No table access is exposed outside this adapter boundary.
 */
export class SupabaseApiRepository implements ApiRepository {
  constructor(private readonly client: SupabaseClientLike) {}

  async findDeviceTokenByHash(hash: string): Promise<DeviceTokenRecord | null> {
    const result = await this.client
      .from("device_tokens")
      .select("owner_id,device_id,token_hash,revoked_at")
      .eq("token_hash", hash)
      .maybeSingle<DeviceTokenRow>();
    const row = unwrapMaybe(result, "device_token_lookup");
    return row ? mapDeviceToken(row) : null;
  }

  async createTopic(
    input: TopicCreate,
    principal: Principal,
  ): Promise<TopicCard> {
    const payload = compactPayload({
      owner_id: principal.ownerId,
      project_id: input.projectId,
      title: input.title,
      // state is intentionally omitted. Only completeTopic can transition it.
      current_state: input.currentState ?? "",
      next_action: input.nextAction ?? "",
      open_questions: input.openQuestions ?? [],
      last_active_at: input.lastActiveAt,
      focus_rank: input.focusRank,
      resurface_at: input.resurfaceAt,
      resurface_condition: input.resurfaceCondition,
    });
    const result = await this.client
      .from("topic_cards")
      .insert(payload)
      .select("*")
      .single<TopicRow>();
    return mapTopic(unwrapSingle(result, "topic_create"));
  }

  async createSession(
    input: SessionCreate,
    principal: Principal,
  ): Promise<Session> {
    if (input.deviceId !== undefined && input.deviceId !== principal.deviceId) {
      throw new ApiError(403, "device_forbidden");
    }
    const payload = compactPayload({
      owner_id: principal.ownerId,
      topic_card_id: input.topicCardId,
      codex_thread_id: input.codexThreadId,
      device_id: input.deviceId,
      platform: input.platform,
      workspace_path: input.workspacePath,
      started_at: input.startedAt,
      ended_at: input.endedAt,
    });
    const result = await this.client
      .from("sessions")
      .insert(payload)
      .select("*")
      .single<SessionRow>();
    return mapSession(unwrapSingle(result, "session_create"));
  }

  async createTodo(
    input: TodoCreateInput,
    principal: Principal,
  ): Promise<Todo> {
    const payload = {
      owner_id: principal.ownerId,
      title: input.title,
      planned_date: input.plannedDate,
      planned_time: input.plannedTime,
      is_completed: false,
    };
    const result = await this.client
      .from("todos")
      .insert(payload)
      .select("*")
      .single<TodoRow>();
    return mapTodo(unwrapSingle(result, "todo_create"));
  }

  async createHandoff(
    input: HandoffCreate,
    principal: Principal,
  ): Promise<HandoffCreateResult> {
    const result = await this.client.rpc("create_handoff_and_update_topic", {
      p_owner_id: principal.ownerId,
      p_session_id: input.sessionId,
      p_topic_card_id: input.topicCardId,
      p_content: input.content,
      p_idempotency_key: input.idempotencyKey,
      p_current_state: input.topicUpdate?.currentState ?? null,
      p_next_action: input.topicUpdate?.nextAction ?? null,
      p_open_questions: input.topicUpdate?.openQuestions ?? null,
    });
    if (result.error) throw mapRepositoryError(result.error, "handoff_create");
    const payload = unwrapRpc(result.data, "handoff_create");
    if (typeof payload.created !== "boolean") {
      throw new ApiError(502, "handoff_create");
    }
    return {
      record: mapHandoff(unwrapData(payload.handoff, "handoff_create")),
      created: payload.created,
    };
  }

  async completeTopic(
    topicId: string,
    explicit: boolean,
    principal: Principal,
  ): Promise<TopicCard> {
    if (!explicit) throw new ApiError(422, "explicit_required");

    // Service-role RPC bypasses RLS; this owner check is therefore mandatory.
    const owned = await this.client
      .from("topic_cards")
      .select("*")
      .eq("owner_id", principal.ownerId)
      .eq("id", topicId)
      .maybeSingle<TopicRow>();
    if (owned.error) throw mapRepositoryError(owned.error, "topic_lookup");
    if (!owned.data) throw new ApiError(404, "not_found");

    const result = await this.client.rpc("complete_topic_explicitly", {
      p_topic_id: topicId,
      p_explicit: true,
    });
    if (result.error) throw mapRepositoryError(result.error, "topic_complete");
    return mapTopic(unwrapRpc(result.data, "topic_complete"));
  }

  async upsertProjectProjection(
    id: string,
    input: ProjectProjectionWrite,
    principal: Principal,
  ): Promise<ProjectProjection> {
    const payload = compactPayload({
      owner_id: principal.ownerId,
      id,
      project_key: input.projectKey,
      title: input.title,
      lifecycle_status: input.lifecycleStatus,
      summary: input.summary ?? "",
      next_action: input.nextAction ?? "",
      source_path: input.sourcePath,
      last_synced_at: input.lastSyncedAt,
    });
    const result = await this.client
      .from("project_projections")
      .upsert(payload, { onConflict: "owner_id,id" })
      .select("*")
      .single<ProjectProjectionRow>();
    return mapProject(unwrapSingle(result, "project_projection_upsert"));
  }

  async upsertDailyProjection(
    date: string,
    input: DailyProjectionWrite,
    principal: Principal,
  ): Promise<DailyProjection> {
    const payload = compactPayload({
      owner_id: principal.ownerId,
      date,
      daily_lens: input.dailyLens ?? "",
      projects: input.projects ?? [],
      mac_report: input.macReport,
      windows_report: input.windowsReport,
    });
    const result = await this.client
      .from("daily_projections")
      .upsert(payload, { onConflict: "owner_id,date" })
      .select("*")
      .single<DailyProjectionRow>();
    return mapDaily(unwrapSingle(result, "daily_projection_upsert"));
  }

  async upsertDeviceWorkspace(
    deviceId: string,
    projectId: string,
    input: DeviceWorkspaceWrite,
    principal: Principal,
  ): Promise<DeviceWorkspace> {
    if (deviceId !== principal.deviceId) {
      throw new ApiError(403, "device_forbidden");
    }
    const payload = compactPayload({
      owner_id: principal.ownerId,
      device_id: deviceId,
      platform: input.platform,
      project_id: projectId,
      workspace_path: input.workspacePath,
    });
    const result = await this.client
      .from("device_workspaces")
      .upsert(payload, { onConflict: "owner_id,device_id,project_id" })
      .select("*")
      .single<DeviceWorkspaceRow>();
    return mapWorkspace(unwrapSingle(result, "device_workspace_upsert"));
  }

}

export function createSupabaseRepository(
  client: SupabaseClientLike,
): SupabaseApiRepository {
  return new SupabaseApiRepository(client);
}

type Row = Record<string, unknown>;
type DeviceTokenRow = Row;
type TopicRow = Row;
type SessionRow = Row;
type HandoffRow = Row;
type ProjectProjectionRow = Row;
type DailyProjectionRow = Row;
type DeviceWorkspaceRow = Row;
type TodoRow = Row;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactPayload(payload: Row): Row {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

function mapRepositoryError(
  error: SupabaseErrorLike,
  operation: string,
): ApiError {
  if (error.code === "23505") return new ApiError(409, "conflict");
  if (error.code === "PGRST116") return new ApiError(404, "not_found");
  return new ApiError(502, operation);
}

function unwrapData<T = Row>(data: unknown, operation: string): T {
  if (!isRecord(data)) throw new ApiError(502, operation);
  return data as T;
}

function unwrapSingle<T = Row>(
  result: SupabaseResponse<T>,
  operation: string,
): T {
  if (result.error) throw mapRepositoryError(result.error, operation);
  return unwrapData(result.data, operation);
}

function unwrapMaybe<T = Row>(
  result: SupabaseResponse<T>,
  operation: string,
): T | null {
  if (result.error) throw mapRepositoryError(result.error, operation);
  if (result.data === null || result.data === undefined) return null;
  return unwrapData(result.data, operation);
}

function unwrapRpc(data: unknown, operation: string): Row {
  if (Array.isArray(data)) {
    if (data.length === 0) throw new ApiError(404, "not_found");
    return unwrapData(data[0], operation);
  }
  return unwrapData(data, operation);
}

function requiredString(row: Row, key: string, operation: string): string {
  if (typeof row[key] !== "string") throw new ApiError(502, operation);
  return row[key] as string;
}

function nullableString(
  row: Row,
  key: string,
  operation: string,
): string | null {
  if (row[key] === null || row[key] === undefined) return null;
  return requiredString(row, key, operation);
}

function mapDeviceToken(row: DeviceTokenRow): DeviceTokenRecord {
  return {
    ownerId: requiredString(row, "owner_id", "device_token_lookup"),
    deviceId: requiredString(row, "device_id", "device_token_lookup"),
    tokenHash: requiredString(row, "token_hash", "device_token_lookup"),
    revokedAt: nullableString(row, "revoked_at", "device_token_lookup"),
  };
}

function mapTopic(row: TopicRow): TopicCard {
  const state = row.state;
  if (state !== "open" && state !== "done") {
    throw new ApiError(502, "topic_mapping");
  }
  if (!Array.isArray(row.open_questions)) {
    throw new ApiError(502, "topic_mapping");
  }
  return {
    id: requiredString(row, "id", "topic_mapping"),
    projectId: requiredString(row, "project_id", "topic_mapping"),
    title: requiredString(row, "title", "topic_mapping"),
    state,
    currentState: requiredString(row, "current_state", "topic_mapping"),
    nextAction: requiredString(row, "next_action", "topic_mapping"),
    openQuestions: row.open_questions.filter((item): item is string =>
      typeof item === "string"
    ),
    latestHandoffId: nullableString(row, "latest_handoff_id", "topic_mapping"),
    lastActiveAt: requiredString(row, "last_active_at", "topic_mapping"),
    focusRank: typeof row.focus_rank === "number" ? row.focus_rank : null,
    resurfaceAt: nullableString(row, "resurface_at", "topic_mapping"),
    resurfaceCondition: nullableString(
      row,
      "resurface_condition",
      "topic_mapping",
    ),
  };
}

function mapSession(row: SessionRow): Session {
  const platform = row.platform;
  if (platform !== undefined && platform !== null && platform !== "macos" && platform !== "windows") {
    throw new ApiError(502, "session_mapping");
  }
  return {
    id: requiredString(row, "id", "session_mapping"),
    topicCardId: requiredString(row, "topic_card_id", "session_mapping"),
    codexThreadId: requiredString(row, "codex_thread_id", "session_mapping"),
    deviceId: requiredString(row, "device_id", "session_mapping"),
    platform: platform ?? null,
    workspacePath: requiredString(row, "workspace_path", "session_mapping"),
    startedAt: requiredString(row, "started_at", "session_mapping"),
    endedAt: nullableString(row, "ended_at", "session_mapping"),
  };
}

function mapHandoff(row: HandoffRow): Handoff {
  return {
    id: requiredString(row, "id", "handoff_mapping"),
    sessionId: requiredString(row, "session_id", "handoff_mapping"),
    topicCardId: requiredString(row, "topic_card_id", "handoff_mapping"),
    content: requiredString(row, "content", "handoff_mapping"),
    idempotencyKey: requiredString(row, "idempotency_key", "handoff_mapping"),
    createdAt: nullableString(row, "created_at", "handoff_mapping") ??
      undefined,
    generatedAt: nullableString(row, "generated_at", "handoff_mapping") ??
      undefined,
  };
}

function mapProject(row: ProjectProjectionRow): ProjectProjection {
  const lifecycleStatus = row.lifecycle_status;
  if (!isLifecycleStatus(lifecycleStatus)) {
    throw new ApiError(502, "project_mapping");
  }
  return {
    id: nullableString(row, "id", "project_mapping"),
    projectKey: requiredString(row, "project_key", "project_mapping"),
    title: requiredString(row, "title", "project_mapping"),
    lifecycleStatus,
    summary: requiredString(row, "summary", "project_mapping"),
    nextAction: requiredString(row, "next_action", "project_mapping"),
    sourcePath: nullableString(row, "source_path", "project_mapping") ??
      undefined,
    lastSyncedAt: nullableString(row, "last_synced_at", "project_mapping"),
  };
}

function mapDaily(row: DailyProjectionRow): DailyProjection {
  if (!Array.isArray(row.projects)) {
    throw new ApiError(502, "daily_projection_mapping");
  }
  return {
    date: requiredString(row, "date", "daily_projection_mapping"),
    dailyLens: requiredString(row, "daily_lens", "daily_projection_mapping"),
    projects: row.projects.filter(isRecord).map(mapProject),
    macReport: nullableString(row, "mac_report", "daily_projection_mapping"),
    windowsReport: nullableString(
      row,
      "windows_report",
      "daily_projection_mapping",
    ),
  };
}

function mapWorkspace(row: DeviceWorkspaceRow): DeviceWorkspace {
  const platform = row.platform;
  if (platform !== "macos" && platform !== "windows") {
    throw new ApiError(502, "device_workspace_mapping");
  }
  return {
    deviceId: requiredString(row, "device_id", "device_workspace_mapping"),
    platform,
    projectId: requiredString(row, "project_id", "device_workspace_mapping"),
    workspacePath: requiredString(
      row,
      "workspace_path",
      "device_workspace_mapping",
    ),
  };
}

function mapTodo(row: TodoRow): Todo {
  if (typeof row.is_completed !== "boolean") {
    throw new ApiError(502, "todo_mapping");
  }
  return {
    id: requiredString(row, "id", "todo_mapping"),
    title: requiredString(row, "title", "todo_mapping"),
    plannedDate: requiredString(row, "planned_date", "todo_mapping"),
    plannedTime: nullableString(row, "planned_time", "todo_mapping"),
    isCompleted: row.is_completed,
    projectId: nullableString(row, "project_id", "todo_mapping"),
    topicCardId: nullableString(row, "topic_card_id", "todo_mapping"),
  };
}

function isLifecycleStatus(
  value: unknown,
): value is ProjectProjection["lifecycleStatus"] {
  return value === "inbox" || value === "active" || value === "paused" ||
    value === "done" || value === "archived";
}

export interface ApiLogger {
  info(event: string, fields: Record<string, string | number>): void;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class RepositoryNotConfiguredError extends ApiError {
  constructor() {
    super(503, "repository_not_configured");
  }
}

/**
 * Safe local default until the Task 3 Supabase adapter is wired in. It fails
 * closed rather than silently storing business data in process memory.
 */
export function createUnconfiguredRepository(): ApiRepository {
  const unavailable = async <T>(): Promise<T> => {
    throw new RepositoryNotConfiguredError();
  };

  return {
    createHandoff: unavailable,
    completeTopic: unavailable,
    createTopic: unavailable,
    createSession: unavailable,
    createTodo: unavailable,
    upsertProjectProjection: unavailable,
    upsertDailyProjection: unavailable,
    upsertDeviceWorkspace: unavailable,
    findDeviceTokenByHash: async () => null,
  };
}
