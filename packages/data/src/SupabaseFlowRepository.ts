import type {
  DailyProjection,
  DeviceWorkspace,
  Handoff,
  ProjectProjection,
  Session,
  Todo,
  TodoCreate,
  TodoPatch,
  TopicCard,
} from "@flowcontext/domain";
import type { FlowRepository, TodoListener, TopicContext } from "./FlowRepository.ts";

type QueryResult = {
  data: unknown;
  error: unknown | null;
};

export interface SupabaseQueryLike extends PromiseLike<QueryResult> {
  select(columns?: string): SupabaseQueryLike;
  insert(values: unknown): SupabaseQueryLike;
  update(values: unknown): SupabaseQueryLike;
  delete(): SupabaseQueryLike;
  eq(column: string, value: unknown): SupabaseQueryLike;
  limit(count: number): SupabaseQueryLike;
}

export interface SupabaseChannelLike {
  on(
    event: string,
    config: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ): SupabaseChannelLike;
  subscribe(callback?: (status: string, error?: unknown) => void): SupabaseChannelLike;
  unsubscribe(): Promise<unknown> | unknown;
}

export interface SupabaseClientLike {
  from(table: string): unknown;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult>;
  channel(name: string): unknown;
  removeChannel?(channel: unknown): Promise<unknown> | unknown;
}

type DatabaseTodoRow = {
  id: string;
  title: string;
  planned_date: string;
  planned_time?: string | null;
  is_completed?: boolean;
  project_id?: string | null;
  topic_card_id?: string | null;
};

type DatabaseProjectProjectionRow = {
  id?: string | null;
  project_key: string;
  title: string;
  lifecycle_status: ProjectProjection["lifecycleStatus"];
  summary: string;
  next_action: string;
  source_path?: string;
  last_synced_at?: string | null;
};

type DatabaseTopicCardRow = {
  id: string;
  project_id: string;
  title: string;
  state: TopicCard["state"];
  current_state?: string;
  next_action?: string;
  open_questions?: unknown;
  latest_handoff_id?: string | null;
  last_active_at: string;
  focus_rank?: number | null;
  resurface_at?: string | null;
  resurface_condition?: string | null;
};

type DatabaseSessionRow = {
  id: string;
  topic_card_id: string;
  codex_thread_id: string;
  device_id: string;
  workspace_path: string;
  started_at: string;
  ended_at?: string | null;
};

type DatabaseHandoffRow = {
  id: string;
  session_id: string;
  topic_card_id: string;
  content: string;
  idempotency_key: string;
  created_at?: string;
  generated_at?: string;
};

type DatabaseDeviceWorkspaceRow = {
  id?: string;
  device_id: string;
  platform: DeviceWorkspace["platform"];
  project_id: string;
  workspace_path: string;
};

type DatabaseDailyProjectionRow = {
  date: string;
  daily_lens?: string;
  projects?: unknown;
  mac_report?: string | null;
  windows_report?: string | null;
};

function assertIsoDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("date must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error("date must be a valid calendar date");
  }
}

function formatLocalIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftCalendarDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(year, month - 1, day, 12);
  shifted.setDate(shifted.getDate() + days);
  return formatLocalIsoDate(shifted);
}

function currentLocalIsoDate(): string {
  return formatLocalIsoDate(new Date());
}

function currentIanaTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function assertIanaTimeZone(timeZone: string): void {
  if (!timeZone.trim()) throw new Error("device timezone must be a valid IANA timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new Error("device timezone must be a valid IANA timezone");
  }
}

function assertNextDay(fromDate: string, toDate: string): void {
  if (toDate !== shiftCalendarDate(fromDate, 1)) {
    throw new Error("toDate must be the calendar day after fromDate");
  }
}

function assertYesterdayToToday(fromDate: string, toDate: string, today: string): void {
  if (fromDate !== shiftCalendarDate(today, -1) || toDate !== today) {
    throw new Error("rolloverIncompleteTodos only supports yesterday to today");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Supabase returned an invalid record");
  }
  return value as Record<string, unknown>;
}

function firstRecord(data: unknown): Record<string, unknown> | null {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) return data.length === 0 ? null : asRecord(data[0]);
  return asRecord(data);
}

function records(data: unknown): unknown[] {
  if (data === null || data === undefined) return [];
  return Array.isArray(data) ? data : [data];
}

function mapPlannedTime(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  return text.length >= 5 ? text.slice(0, 5) : text;
}

function mapTodo(row: unknown): Todo {
  const value = asRecord(row) as unknown as DatabaseTodoRow;
  return {
    id: value.id,
    title: value.title,
    plannedDate: value.planned_date,
    plannedTime: mapPlannedTime(value.planned_time),
    isCompleted: value.is_completed ?? false,
    projectId: value.project_id ?? null,
    topicCardId: value.topic_card_id ?? null,
  };
}

function mapProjectProjection(row: unknown): ProjectProjection {
  const value = asRecord(row) as unknown as DatabaseProjectProjectionRow;
  return {
    id: value.id ?? null,
    projectKey: value.project_key,
    title: value.title,
    lifecycleStatus: value.lifecycle_status,
    summary: value.summary,
    nextAction: value.next_action,
    sourcePath: value.source_path,
    lastSyncedAt: value.last_synced_at ?? null,
  };
}

function mapTopicCard(row: unknown): TopicCard {
  const value = asRecord(row) as unknown as DatabaseTopicCardRow;
  const openQuestions = Array.isArray(value.open_questions)
    ? value.open_questions.map((question) => String(question))
    : [];

  return {
    id: value.id,
    projectId: value.project_id,
    title: value.title,
    state: value.state,
    currentState: value.current_state ?? "",
    nextAction: value.next_action ?? "",
    openQuestions,
    latestHandoffId: value.latest_handoff_id ?? null,
    lastActiveAt: value.last_active_at,
    focusRank: value.focus_rank ?? null,
    resurfaceAt: value.resurface_at ?? null,
    resurfaceCondition: value.resurface_condition ?? null,
  };
}

function mapSession(row: unknown): Session {
  const value = asRecord(row) as unknown as DatabaseSessionRow;
  return {
    id: value.id,
    topicCardId: value.topic_card_id,
    codexThreadId: value.codex_thread_id,
    deviceId: value.device_id,
    workspacePath: value.workspace_path,
    startedAt: value.started_at,
    endedAt: value.ended_at ?? null,
  };
}

function mapHandoff(row: unknown): Handoff {
  const value = asRecord(row) as unknown as DatabaseHandoffRow;
  return {
    id: value.id,
    sessionId: value.session_id,
    topicCardId: value.topic_card_id,
    content: value.content,
    idempotencyKey: value.idempotency_key,
    createdAt: value.created_at,
    generatedAt: value.generated_at,
  };
}

function mapDeviceWorkspace(row: unknown): DeviceWorkspace {
  const value = asRecord(row) as unknown as DatabaseDeviceWorkspaceRow;
  return {
    deviceId: value.device_id,
    platform: value.platform,
    projectId: value.project_id,
    workspacePath: value.workspace_path,
  };
}

function mapDailyProjection(row: unknown): DailyProjection {
  const value = asRecord(row) as unknown as DatabaseDailyProjectionRow;
  const projects = Array.isArray(value.projects)
    ? value.projects.map((project) => mapProjectProjection(project))
    : [];

  return {
    date: value.date,
    dailyLens: value.daily_lens ?? "",
    projects,
    macReport: value.mac_report ?? null,
    windowsReport: value.windows_report ?? null,
  };
}

function toTodoRow(input: TodoCreate): Record<string, unknown> {
  return {
    title: input.title,
    planned_date: input.plannedDate,
    planned_time: input.plannedTime,
    is_completed: input.isCompleted,
    project_id: input.projectId ?? null,
    topic_card_id: input.topicCardId ?? null,
  };
}

function toTodoPatch(patch: TodoPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.plannedDate !== undefined) row.planned_date = patch.plannedDate;
  if (patch.plannedTime !== undefined) row.planned_time = patch.plannedTime;
  if (patch.isCompleted !== undefined) row.is_completed = patch.isCompleted;
  if (patch.projectId !== undefined) row.project_id = patch.projectId;
  if (patch.topicCardId !== undefined) row.topic_card_id = patch.topicCardId;
  return row;
}

async function execute(query: PromiseLike<QueryResult>): Promise<unknown> {
  const result = await query;
  if (result.error !== null && result.error !== undefined) throw result.error;
  return result.data;
}

export class SupabaseFlowRepository implements FlowRepository {
  readonly capabilities = { todoRollover: true } as const;
  private readonly client: SupabaseClientLike;
  private readonly currentLocalDate: () => string;
  private readonly currentTimeZone: () => string;

  constructor(
    client: unknown,
    currentLocalDate: () => string = currentLocalIsoDate,
    currentTimeZone: () => string = currentIanaTimeZone,
  ) {
    this.client = client as SupabaseClientLike;
    this.currentLocalDate = currentLocalDate;
    this.currentTimeZone = currentTimeZone;
  }

  async listTodos(date: string): Promise<Todo[]> {
    assertIsoDate(date);
    const data = await execute(
      (this.client.from("todos") as SupabaseQueryLike)
        .select("*")
        .eq("planned_date", date),
    );
    return records(data).map(mapTodo).filter((todo) => todo.plannedDate === date);
  }

  async createTodo(input: TodoCreate): Promise<Todo> {
    assertIsoDate(input.plannedDate);
    const data = await execute(
      (this.client.from("todos") as SupabaseQueryLike)
        .insert(toTodoRow(input))
        .select("*"),
    );
    const row = firstRecord(data);
    if (row === null) throw new Error("Supabase did not return the created todo");
    return mapTodo(row);
  }

  async updateTodo(id: string, patch: TodoPatch): Promise<Todo> {
    if (patch.plannedDate !== undefined) assertIsoDate(patch.plannedDate);
    const data = await execute(
      (this.client.from("todos") as SupabaseQueryLike)
        .update(toTodoPatch(patch))
        .eq("id", id)
        .select("*"),
    );
    const row = firstRecord(data);
    if (row === null) throw new Error("Supabase did not return the updated todo");
    return mapTodo(row);
  }

  async deleteTodo(id: string): Promise<void> {
    await execute((this.client.from("todos") as SupabaseQueryLike).delete().eq("id", id));
  }

  async rolloverIncompleteTodos(fromDate: string, toDate: string): Promise<Todo[]> {
    assertIsoDate(fromDate);
    assertIsoDate(toDate);
    assertNextDay(fromDate, toDate);
    const today = this.currentLocalDate();
    assertIsoDate(today);
    assertYesterdayToToday(fromDate, toDate, today);
    const timeZone = this.currentTimeZone();
    assertIanaTimeZone(timeZone);
    const data = await execute(this.client.rpc("rollover_incomplete_todos", {
      p_from_date: fromDate,
      p_to_date: toDate,
      p_timezone: timeZone,
    }));
    return records(data).map(mapTodo);
  }

  subscribeTodos(date: string, listener: TodoListener): () => void {
    assertIsoDate(date);
    const channel = (this.client.channel(`flowcontext-todos-${date}`) as SupabaseChannelLike)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "todos",
        },
        () => {
          void this.listTodos(date).then(listener).catch(() => undefined);
        },
      )
      .subscribe();
    let cleaned = false;
    return () => {
      if (cleaned) return;
      cleaned = true;
      if (this.client.removeChannel) {
        void this.client.removeChannel(channel);
      } else {
        void channel.unsubscribe();
      }
    };
  }

  async listSuggestedTopics(limit: number): Promise<TopicCard[]> {
    if (!Number.isInteger(limit) || limit < 0) throw new RangeError("limit must be a non-negative integer");
    const data = await execute(
      (this.client.from("topic_cards") as SupabaseQueryLike)
        .select("*")
        .eq("state", "open")
        .limit(limit),
    );
    return records(data).map(mapTopicCard);
  }

  async getTopicContext(topicId: string, deviceId?: string): Promise<TopicContext | null> {
    if (!topicId.trim()) throw new Error("topicId is required");
    const configuredDeviceId = deviceId?.trim() || undefined;

    const topicData = await execute(
      (this.client.from("topic_cards") as SupabaseQueryLike)
        .select("*")
        .eq("id", topicId),
    );
    const topicRow = firstRecord(topicData);
    if (topicRow === null) return null;
    const topic = mapTopicCard(topicRow);

    const [sessionData, handoffData, workspaceData] = await Promise.all([
      execute(
        (this.client.from("sessions") as SupabaseQueryLike)
          .select("*")
          .eq("topic_card_id", topic.id),
      ),
      execute(
        (this.client.from("handoffs") as SupabaseQueryLike)
          .select("*")
          .eq("topic_card_id", topic.id),
      ),
      configuredDeviceId
        ? execute(
            (this.client.from("device_workspaces") as SupabaseQueryLike)
              .select("*")
              .eq("device_id", configuredDeviceId)
              .eq("project_id", topic.projectId),
          )
        : Promise.resolve(null),
    ]);

    const latestSession = records(sessionData)
      .map(mapSession)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0] ?? null;
    const latestHandoff = records(handoffData)
      .map(mapHandoff)
      .sort((left, right) => Date.parse(right.generatedAt ?? right.createdAt ?? "") - Date.parse(left.generatedAt ?? left.createdAt ?? ""))[0] ?? null;
    const currentWorkspace = workspaceData === null
      ? null
      : records(workspaceData).map(mapDeviceWorkspace)[0] ?? null;

    return { topic, latestSession, latestHandoff, currentWorkspace };
  }

  async getDailyProjection(date: string): Promise<DailyProjection | null> {
    assertIsoDate(date);
    const data = await execute(
      (this.client.from("daily_projections") as SupabaseQueryLike)
        .select("*")
        .eq("date", date),
    );
    const row = firstRecord(data);
    return row === null ? null : mapDailyProjection(row);
  }
}
