import type {
  DailyProjection,
  DeviceWorkspace,
  Handoff,
  HandoffCreate,
  HandoffUpdate,
  ProjectProjection,
  Session,
  Todo,
  TodoCreate,
  TodoPatch,
  TopicCard,
} from "@flowcontext/domain";
import type { Pool, PoolClient, QueryResult } from "pg";

import type { Principal } from "./auth.js";
import { PostgresAuthRepository } from "./enrollment.js";
import { ApiError } from "./errors.js";
import { TODO_EVENT_CHANNEL, type TodoEvent, type TodoEventKind } from "./sse.js";

type Queryable = Pick<Pool, "query">;
type FlowPool = Pick<Pool, "query" | "connect">;

export interface TopicContext {
  topic: TopicCard;
  latestSession: Session | null;
  latestHandoff: Handoff | null;
  currentWorkspace: DeviceWorkspace | null;
}

export interface HandoffResult {
  record: Handoff;
  created: boolean;
}

export interface FlowDataRepository {
  listTodos(principal: Principal, date: string): Promise<Todo[]>;
  createTodo(principal: Principal, input: TodoCreate): Promise<Todo>;
  updateTodo(principal: Principal, id: string, patch: TodoPatch): Promise<Todo | null>;
  deleteTodo(principal: Principal, id: string): Promise<Todo | null>;
  rolloverIncompleteTodos(principal: Principal, fromDate: string, toDate: string, timeZone: string): Promise<Todo[]>;
  listSuggestedTopics(principal: Principal, limit: number): Promise<TopicCard[]>;
  getTopicContext(principal: Principal, topicId: string, deviceId?: string): Promise<TopicContext | null>;
  getDailyProjection(principal: Principal, date: string): Promise<DailyProjection | null>;
  createTopic(principal: Principal, input: Partial<TopicCard>): Promise<TopicCard | null>;
  createSession(principal: Principal, input: Partial<Session>): Promise<Session | null>;
  createHandoff(principal: Principal, input: HandoffCreate): Promise<HandoffResult | null>;
  completeTopic(principal: Principal, topicId: string): Promise<TopicCard | null>;
  upsertProjectProjection(principal: Principal, id: string, input: ProjectProjection): Promise<ProjectProjection>;
  upsertDailyProjection(principal: Principal, date: string, input: Omit<DailyProjection, "date">): Promise<DailyProjection>;
  upsertDeviceWorkspace(principal: Principal, deviceId: string, projectId: string, input: Pick<DeviceWorkspace, "platform" | "workspacePath">): Promise<DeviceWorkspace | null>;
}

type Row = Record<string, unknown>;

function stringValue(row: Row, field: string): string {
  const value = row[field];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  throw new ApiError(500, "mapping_error");
}

function nullableString(row: Row, field: string): string | null {
  return row[field] === null || row[field] === undefined ? null : stringValue(row, field);
}

function dateTimeValue(row: Row, field: string): string {
  const value = stringValue(row, field);
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString();
}

function mapTodo(row: Row): Todo {
  return {
    id: stringValue(row, "id"),
    title: stringValue(row, "title"),
    plannedDate: stringValue(row, "planned_date").slice(0, 10),
    plannedTime: nullableString(row, "planned_time")?.slice(0, 5) ?? null,
    isCompleted: row.is_completed === true,
    projectId: nullableString(row, "project_id"),
    topicCardId: nullableString(row, "topic_card_id"),
  };
}

function mapTopic(row: Row): TopicCard {
  const openQuestions = row.open_questions;
  return {
    id: stringValue(row, "id"),
    projectId: stringValue(row, "project_id"),
    title: stringValue(row, "title"),
    state: row.state === "done" ? "done" : "open",
    currentState: stringValue(row, "current_state"),
    nextAction: stringValue(row, "next_action"),
    openQuestions: Array.isArray(openQuestions) ? openQuestions.filter((value): value is string => typeof value === "string") : [],
    latestHandoffId: nullableString(row, "latest_handoff_id"),
    lastActiveAt: dateTimeValue(row, "last_active_at"),
    focusRank: typeof row.focus_rank === "number" ? row.focus_rank : null,
    resurfaceAt: row.resurface_at === null || row.resurface_at === undefined ? null : dateTimeValue(row, "resurface_at"),
    resurfaceCondition: nullableString(row, "resurface_condition"),
  };
}

function mapSession(row: Row): Session {
  return {
    id: stringValue(row, "id"),
    topicCardId: stringValue(row, "topic_card_id"),
    codexThreadId: stringValue(row, "codex_thread_id"),
    deviceId: stringValue(row, "device_id"),
    workspacePath: stringValue(row, "workspace_path"),
    startedAt: dateTimeValue(row, "started_at"),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : dateTimeValue(row, "ended_at"),
  };
}

function mapHandoff(row: Row): Handoff {
  return {
    id: stringValue(row, "id"),
    sessionId: stringValue(row, "session_id"),
    topicCardId: stringValue(row, "topic_card_id"),
    content: stringValue(row, "content"),
    idempotencyKey: stringValue(row, "idempotency_key"),
    createdAt: dateTimeValue(row, "created_at"),
    generatedAt: dateTimeValue(row, "generated_at"),
  };
}

function mapProject(row: Row): ProjectProjection {
  const lifecycle = row.lifecycle_status;
  if (lifecycle !== "inbox" && lifecycle !== "active" && lifecycle !== "paused" && lifecycle !== "done" && lifecycle !== "archived") {
    throw new ApiError(500, "mapping_error");
  }
  return {
    id: stringValue(row, "id"),
    projectKey: stringValue(row, "project_key"),
    title: stringValue(row, "title"),
    lifecycleStatus: lifecycle,
    summary: stringValue(row, "summary"),
    nextAction: stringValue(row, "next_action"),
    sourcePath: nullableString(row, "source_path") ?? undefined,
    lastSyncedAt: row.last_synced_at === null || row.last_synced_at === undefined ? null : dateTimeValue(row, "last_synced_at"),
  };
}

function mapWorkspace(row: Row): DeviceWorkspace {
  if (row.platform !== "macos" && row.platform !== "windows") throw new ApiError(500, "mapping_error");
  return {
    deviceId: stringValue(row, "device_id"),
    platform: row.platform,
    projectId: stringValue(row, "project_id"),
    workspacePath: stringValue(row, "workspace_path"),
  };
}

function mapDaily(row: Row): DailyProjection {
  const projects = Array.isArray(row.projects) ? row.projects : [];
  return {
    date: stringValue(row, "date").slice(0, 10),
    dailyLens: stringValue(row, "daily_lens"),
    projects: projects as ProjectProjection[],
    macReport: nullableString(row, "mac_report"),
    windowsReport: nullableString(row, "windows_report"),
  };
}

function isPostgresError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string";
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (isPostgresError(error)) {
    if (error.code === "23505") throw new ApiError(409, "conflict");
    if (error.code === "23503") throw new ApiError(404, "not_found");
    if (error.code === "23514" || error.code === "22P02" || error.code === "22007") {
      throw new ApiError(422, "invalid_request");
    }
  }
  throw error;
}

async function queryOne(client: Queryable, sql: string, values: readonly unknown[]): Promise<Row | null> {
  const result = await client.query(sql, values as unknown[]) as unknown as QueryResult<Row>;
  return result.rows[0] ?? null;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export class PostgresFlowRepository extends PostgresAuthRepository implements FlowDataRepository {
  constructor(private readonly flowPool: FlowPool) {
    super(flowPool);
  }

  private async publish(principal: Principal, date: string, todoId: string | null, kind: TodoEventKind): Promise<void> {
    const event: TodoEvent = { ownerId: principal.ownerId, date, todoId, kind };
    await this.flowPool.query("select pg_notify($1, $2)", [TODO_EVENT_CHANNEL, JSON.stringify(event)]);
  }

  async listTodos(principal: Principal, date: string): Promise<Todo[]> {
    const result = await this.flowPool.query<Row>(
      `select id, title, planned_date, planned_time, is_completed, project_id, topic_card_id
       from todos
       where owner_id = $1 and planned_date = $2
       order by planned_time nulls last, created_at, id`,
      [principal.ownerId, date],
    );
    return result.rows.map(mapTodo);
  }

  async createTodo(principal: Principal, input: TodoCreate): Promise<Todo> {
    try {
      const row = await queryOne(
        this.flowPool,
        `insert into todos (owner_id, title, planned_date, planned_time, is_completed, project_id, topic_card_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, title, planned_date, planned_time, is_completed, project_id, topic_card_id`,
        [principal.ownerId, input.title, input.plannedDate, input.plannedTime, input.isCompleted, input.projectId ?? null, input.topicCardId ?? null],
      );
      if (!row) throw new Error("todo_create_failed");
      const todo = mapTodo(row);
      await this.publish(principal, todo.plannedDate, todo.id, "upsert");
      return todo;
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async updateTodo(principal: Principal, id: string, patch: TodoPatch): Promise<Todo | null> {
    const fields: string[] = [];
    const values: unknown[] = [principal.ownerId, id];
    for (const [column, value] of [
      ["title", patch.title],
      ["planned_date", patch.plannedDate],
      ["planned_time", patch.plannedTime],
      ["is_completed", patch.isCompleted],
      ["project_id", patch.projectId],
      ["topic_card_id", patch.topicCardId],
    ] as const) {
      if (value === undefined) continue;
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    }
    if (fields.length === 0) return null;
    try {
      const row = await queryOne(
        this.flowPool,
        `with previous as (
           select planned_date as old_planned_date from todos where owner_id = $1 and id = $2
         ), updated as (
           update todos set ${fields.join(", ")}, updated_at = now()
           where owner_id = $1 and id = $2
           returning id, title, planned_date, planned_time, is_completed, project_id, topic_card_id
         )
         select updated.*, previous.old_planned_date from updated cross join previous`,
        values,
      );
      if (!row) return null;
      const todo = mapTodo(row);
      const oldDate = stringValue(row, "old_planned_date").slice(0, 10);
      await this.publish(principal, oldDate, todo.id, "upsert");
      if (todo.plannedDate !== oldDate) await this.publish(principal, todo.plannedDate, todo.id, "upsert");
      return todo;
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async deleteTodo(principal: Principal, id: string): Promise<Todo | null> {
    const row = await queryOne(
      this.flowPool,
      `delete from todos where owner_id = $1 and id = $2
       returning id, title, planned_date, planned_time, is_completed, project_id, topic_card_id`,
      [principal.ownerId, id],
    );
    if (!row) return null;
    const todo = mapTodo(row);
    await this.publish(principal, todo.plannedDate, todo.id, "delete");
    return todo;
  }

  async rolloverIncompleteTodos(
    principal: Principal,
    fromDate: string,
    toDate: string,
    _timeZone: string,
  ): Promise<Todo[]> {
    const client = await this.flowPool.connect() as PoolClient;
    let todos: Todo[] = [];
    try {
      await client.query("begin");
      const result = await client.query<Row>(
        `update todos
         set planned_date = $3, updated_at = now()
         where owner_id = $1 and planned_date = $2 and is_completed = false
         returning id, title, planned_date, planned_time, is_completed, project_id, topic_card_id`,
        [principal.ownerId, fromDate, toDate],
      );
      todos = result.rows.map(mapTodo);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    for (const todo of todos) {
      await this.publish(principal, fromDate, todo.id, "rollover");
      await this.publish(principal, toDate, todo.id, "rollover");
    }
    return todos;
  }

  async listSuggestedTopics(principal: Principal, limit: number): Promise<TopicCard[]> {
    const result = await this.flowPool.query<Row>(
      `select id, project_id, title, state, current_state, next_action, open_questions,
              latest_handoff_id, last_active_at, focus_rank, resurface_at, resurface_condition
       from topic_cards
       where owner_id = $1 and state = 'open'
       order by focus_rank nulls last, last_active_at desc, id
       limit $2`,
      [principal.ownerId, limit],
    );
    return result.rows.map(mapTopic);
  }

  async getTopicContext(principal: Principal, topicId: string, deviceId = principal.deviceId): Promise<TopicContext | null> {
    const topicRow = await queryOne(
      this.flowPool,
      `select id, project_id, title, state, current_state, next_action, open_questions,
              latest_handoff_id, last_active_at, focus_rank, resurface_at, resurface_condition
       from topic_cards where owner_id = $1 and id = $2`,
      [principal.ownerId, topicId],
    );
    if (!topicRow) return null;
    const sessionRow = await queryOne(
      this.flowPool,
      `select id, topic_card_id, codex_thread_id, device_id, workspace_path, started_at, ended_at
       from sessions where owner_id = $1 and topic_card_id = $2
       order by started_at desc, id desc limit 1`,
      [principal.ownerId, topicId],
    );
    const handoffRow = await queryOne(
      this.flowPool,
      `select id, session_id, topic_card_id, content, idempotency_key, created_at, generated_at
       from handoffs where owner_id = $1 and topic_card_id = $2
       order by generated_at desc, id desc limit 1`,
      [principal.ownerId, topicId],
    );
    const workspaceRow = await queryOne(
      this.flowPool,
      `select device_id, platform, project_id, workspace_path
       from device_workspaces where owner_id = $1 and project_id = $2 and device_id = $3`,
      [principal.ownerId, stringValue(topicRow, "project_id"), deviceId],
    );
    return {
      topic: mapTopic(topicRow),
      latestSession: sessionRow ? mapSession(sessionRow) : null,
      latestHandoff: handoffRow ? mapHandoff(handoffRow) : null,
      currentWorkspace: workspaceRow ? mapWorkspace(workspaceRow) : null,
    };
  }

  async getDailyProjection(principal: Principal, date: string): Promise<DailyProjection | null> {
    const row = await queryOne(
      this.flowPool,
      `select date, daily_lens, projects, mac_report, windows_report
       from daily_projections where owner_id = $1 and date = $2`,
      [principal.ownerId, date],
    );
    return row ? mapDaily(row) : null;
  }

  async createTopic(principal: Principal, input: Partial<TopicCard>): Promise<TopicCard | null> {
    try {
      const row = await queryOne(
        this.flowPool,
        `insert into topic_cards (
           owner_id, project_id, title, current_state, next_action, open_questions,
           last_active_at, focus_rank, resurface_at, resurface_condition
         ) values ($1, $2, $3, $4, $5, $6::jsonb, coalesce($7::timestamptz, now()), $8, $9, $10)
         returning id, project_id, title, state, current_state, next_action, open_questions,
                   latest_handoff_id, last_active_at, focus_rank, resurface_at, resurface_condition`,
        [principal.ownerId, input.projectId, input.title, input.currentState ?? "", input.nextAction ?? "", JSON.stringify(input.openQuestions ?? []), input.lastActiveAt ?? null, input.focusRank ?? null, input.resurfaceAt ?? null, input.resurfaceCondition ?? null],
      );
      return row ? mapTopic(row) : null;
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async createSession(principal: Principal, input: Partial<Session>): Promise<Session | null> {
    try {
      const row = await queryOne(
        this.flowPool,
        `insert into sessions (owner_id, topic_card_id, codex_thread_id, device_id, workspace_path, started_at, ended_at)
         values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7)
         returning id, topic_card_id, codex_thread_id, device_id, workspace_path, started_at, ended_at`,
        [principal.ownerId, input.topicCardId, input.codexThreadId, principal.deviceId, input.workspacePath, input.startedAt ?? null, input.endedAt ?? null],
      );
      return row ? mapSession(row) : null;
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async createHandoff(principal: Principal, input: HandoffCreate): Promise<HandoffResult | null> {
    const client = await this.flowPool.connect() as PoolClient;
    try {
      await client.query("begin");
      const existing = await queryOne(
        client,
        `select id, session_id, topic_card_id, content, idempotency_key, created_at, generated_at
         from handoffs where owner_id = $1 and idempotency_key = $2`,
        [principal.ownerId, input.idempotencyKey],
      );
      if (existing) {
        await client.query("commit");
        return { record: mapHandoff(existing), created: false };
      }
      const session = await queryOne(
        client,
        `select id from sessions
         where owner_id = $1 and id = $2 and topic_card_id = $3
         for update`,
        [principal.ownerId, input.sessionId, input.topicCardId],
      );
      if (!session) {
        await client.query("rollback");
        return null;
      }
      const inserted = await queryOne(
        client,
        `insert into handoffs (owner_id, session_id, topic_card_id, content, idempotency_key)
         values ($1, $2, $3, $4, $5)
         returning id, session_id, topic_card_id, content, idempotency_key, created_at, generated_at`,
        [principal.ownerId, input.sessionId, input.topicCardId, input.content, input.idempotencyKey],
      );
      if (!inserted) throw new Error("handoff_create_failed");
      const update: HandoffUpdate = input.topicUpdate ?? {};
      await client.query(
        `update topic_cards
         set current_state = coalesce($3, current_state),
             next_action = coalesce($4, next_action),
             open_questions = coalesce($5::jsonb, open_questions),
             latest_handoff_id = $6,
             last_active_at = now(),
             updated_at = now()
         where owner_id = $1 and id = $2`,
        [principal.ownerId, input.topicCardId, update.currentState ?? null, update.nextAction ?? null, update.openQuestions === undefined ? null : JSON.stringify(update.openQuestions), stringValue(inserted, "id")],
      );
      await client.query("commit");
      return { record: mapHandoff(inserted), created: true };
    } catch (error) {
      await client.query("rollback");
      if (isPostgresError(error) && error.code === "23505") {
        const existing = await queryOne(
          this.flowPool,
          `select id, session_id, topic_card_id, content, idempotency_key, created_at, generated_at
           from handoffs where owner_id = $1 and idempotency_key = $2`,
          [principal.ownerId, input.idempotencyKey],
        );
        if (existing) return { record: mapHandoff(existing), created: false };
      }
      translateDatabaseError(error);
    } finally {
      client.release();
    }
  }

  async completeTopic(principal: Principal, topicId: string): Promise<TopicCard | null> {
    const row = await queryOne(
      this.flowPool,
      `update topic_cards set state = 'done', updated_at = now()
       where owner_id = $1 and id = $2
       returning id, project_id, title, state, current_state, next_action, open_questions,
                 latest_handoff_id, last_active_at, focus_rank, resurface_at, resurface_condition`,
      [principal.ownerId, topicId],
    );
    return row ? mapTopic(row) : null;
  }

  async upsertProjectProjection(principal: Principal, id: string, input: ProjectProjection): Promise<ProjectProjection> {
    try {
      const row = await queryOne(
        this.flowPool,
        `insert into project_projections (
           id, owner_id, project_key, title, lifecycle_status, summary, next_action, source_path, last_synced_at
         ) values ($2, $1, $3, $4, $5, $6, $7, $8, $9)
         on conflict (owner_id, id) do update set
           project_key = excluded.project_key, title = excluded.title,
           lifecycle_status = excluded.lifecycle_status, summary = excluded.summary,
           next_action = excluded.next_action, source_path = excluded.source_path,
           last_synced_at = excluded.last_synced_at, updated_at = now()
         returning id, project_key, title, lifecycle_status, summary, next_action, source_path, last_synced_at`,
        [principal.ownerId, id, input.projectKey, input.title, input.lifecycleStatus, input.summary, input.nextAction, input.sourcePath ?? null, input.lastSyncedAt ?? null],
      );
      if (!row) throw new Error("project_upsert_failed");
      return mapProject(row);
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async upsertDailyProjection(principal: Principal, date: string, input: Omit<DailyProjection, "date">): Promise<DailyProjection> {
    const row = await queryOne(
      this.flowPool,
      `insert into daily_projections (owner_id, date, daily_lens, projects, mac_report, windows_report)
       values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict (owner_id, date) do update set
         daily_lens = excluded.daily_lens, projects = excluded.projects,
         mac_report = excluded.mac_report, windows_report = excluded.windows_report, updated_at = now()
       returning date, daily_lens, projects, mac_report, windows_report`,
      [principal.ownerId, date, input.dailyLens, JSON.stringify(input.projects), input.macReport ?? null, input.windowsReport ?? null],
    );
    if (!row) throw new Error("daily_projection_upsert_failed");
    return mapDaily(row);
  }

  async upsertDeviceWorkspace(
    principal: Principal,
    deviceId: string,
    projectId: string,
    input: Pick<DeviceWorkspace, "platform" | "workspacePath">,
  ): Promise<DeviceWorkspace | null> {
    if (deviceId !== principal.deviceId) throw new ApiError(403, "device_forbidden");
    try {
      const row = await queryOne(
        this.flowPool,
        `insert into device_workspaces (owner_id, device_id, platform, project_id, workspace_path)
         values ($1, $2, $3, $4, $5)
         on conflict (owner_id, device_id, project_id) do update set
           platform = excluded.platform, workspace_path = excluded.workspace_path, updated_at = now()
         returning device_id, platform, project_id, workspace_path`,
        [principal.ownerId, deviceId, input.platform, projectId, input.workspacePath],
      );
      return row ? mapWorkspace(row) : null;
    } catch (error) {
      translateDatabaseError(error);
    }
  }
}
