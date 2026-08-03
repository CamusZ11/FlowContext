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
import {
  createHttpTransport,
  HttpError,
  readSseStream,
  type AccessTokenGetter,
  type FetchImplementation,
  type HttpTransport,
} from "./httpTransport.ts";

export interface HttpFlowRepositoryOptions {
  baseUrl: string;
  getAccessToken: AccessTokenGetter;
  fetchImpl?: FetchImplementation;
}

function invalid(code: string): never {
  throw new HttpError(code, 200);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid("invalid_response");
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return invalid("invalid_response");
  return value;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string") return invalid("invalid_response");
  return value;
}

function nullableString(value: unknown, optional = false): string | null {
  if (value === null || (optional && value === undefined)) return null;
  if (typeof value !== "string") return invalid("invalid_response");
  return value;
}

function assertIsoDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new HttpError("invalid_date", 0);
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
    throw new HttpError("invalid_date", 0);
  }
}

function assertTime(value: unknown, code = "invalid_plannedTime"): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(code, 0);
  }
  return value;
}

function validateTodoInput(input: TodoCreate | TodoPatch): void {
  if ("plannedDate" in input && input.plannedDate !== undefined) assertIsoDate(input.plannedDate);
  if ("plannedTime" in input && input.plannedTime !== undefined) assertTime(input.plannedTime);
}

function mapTodo(value: unknown): Todo {
  const row = record(value);
  const plannedDate = stringField(row.plannedDate, "plannedDate");
  assertIsoDate(plannedDate);
  const plannedTime = assertTime(row.plannedTime);
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.isCompleted !== "boolean") {
    return invalid("invalid_response");
  }
  return {
    id: row.id,
    title: row.title,
    plannedDate,
    plannedTime,
    isCompleted: row.isCompleted,
    projectId: nullableString(row.projectId, true),
    topicCardId: nullableString(row.topicCardId, true),
  };
}

function mapTopicCard(value: unknown): TopicCard {
  const row = record(value);
  const state = row.state;
  if (state !== "open" && state !== "done") return invalid("invalid_response");
  if (typeof row.id !== "string" || typeof row.projectId !== "string" || typeof row.title !== "string") {
    return invalid("invalid_response");
  }
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    state,
    currentState: typeof row.currentState === "string" ? row.currentState : "",
    nextAction: typeof row.nextAction === "string" ? row.nextAction : "",
    openQuestions: Array.isArray(row.openQuestions) ? row.openQuestions.map((entry) => String(entry)) : [],
    latestHandoffId: nullableString(row.latestHandoffId, true),
    lastActiveAt: stringField(row.lastActiveAt, "lastActiveAt"),
    focusRank: row.focusRank === undefined || row.focusRank === null ? null : Number(row.focusRank),
    resurfaceAt: nullableString(row.resurfaceAt, true),
    resurfaceCondition: nullableString(row.resurfaceCondition, true),
  };
}

function mapSession(value: unknown): Session {
  const row = record(value);
  return {
    id: stringField(row.id, "id"),
    topicCardId: stringField(row.topicCardId, "topicCardId"),
    codexThreadId: stringField(row.codexThreadId, "codexThreadId"),
    deviceId: stringField(row.deviceId, "deviceId"),
    workspacePath: stringField(row.workspacePath, "workspacePath"),
    startedAt: stringField(row.startedAt, "startedAt"),
    endedAt: nullableString(row.endedAt, true),
  };
}

function mapHandoff(value: unknown): Handoff {
  const row = record(value);
  return {
    id: stringField(row.id, "id"),
    sessionId: stringField(row.sessionId, "sessionId"),
    topicCardId: stringField(row.topicCardId, "topicCardId"),
    content: stringField(row.content, "content"),
    idempotencyKey: stringField(row.idempotencyKey, "idempotencyKey"),
    createdAt: row.createdAt === undefined ? undefined : stringField(row.createdAt, "createdAt"),
    generatedAt: row.generatedAt === undefined ? undefined : stringField(row.generatedAt, "generatedAt"),
  };
}

function mapDeviceWorkspace(value: unknown): DeviceWorkspace {
  const row = record(value);
  const platform = row.platform;
  if (platform !== "macos" && platform !== "windows") return invalid("invalid_response");
  return {
    deviceId: stringField(row.deviceId, "deviceId"),
    platform,
    projectId: stringField(row.projectId, "projectId"),
    workspacePath: stringField(row.workspacePath, "workspacePath"),
  };
}

function mapProjectProjection(value: unknown): ProjectProjection {
  const row = record(value);
  const lifecycleStatus = row.lifecycleStatus;
  if (
    lifecycleStatus !== "inbox" &&
    lifecycleStatus !== "active" &&
    lifecycleStatus !== "paused" &&
    lifecycleStatus !== "done" &&
    lifecycleStatus !== "archived"
  ) return invalid("invalid_response");
  return {
    id: nullableString(row.id, true),
    projectKey: stringField(row.projectKey, "projectKey"),
    title: stringField(row.title, "title"),
    lifecycleStatus,
    summary: stringField(row.summary, "summary"),
    nextAction: stringField(row.nextAction, "nextAction"),
    sourcePath: row.sourcePath === undefined ? undefined : stringField(row.sourcePath, "sourcePath"),
    lastSyncedAt: nullableString(row.lastSyncedAt, true),
  };
}

function mapDailyProjection(value: unknown): DailyProjection {
  const row = record(value);
  const date = stringField(row.date, "date");
  assertIsoDate(date);
  return {
    date,
    dailyLens: stringField(row.dailyLens, "dailyLens"),
    projects: array(row.projects).map(mapProjectProjection),
    macReport: nullableString(row.macReport, true),
    windowsReport: nullableString(row.windowsReport, true),
  };
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof HttpError && error.status === 401;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function topicPath(topicId: string): string {
  return `/v1/topics/${encodeURIComponent(topicId)}/context`;
}

function todoPath(date: string): string {
  return `/v1/todos?date=${encodeURIComponent(date)}`;
}

function startTodoSubscription(
  transport: HttpTransport,
  date: string,
  listener: TodoListener,
): () => void {
  let closed = false;
  let generation = 1;
  let currentController: AbortController | null = null;
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  const refreshChains = new Map<number, Promise<void>>();
  const pendingRefreshes = new Set<number>();
  const inFlightRefreshes = new Set<number>();
  const dirtyRefreshes = new Set<number>();

  const active = (currentGeneration: number): boolean => !closed && generation === currentGeneration;

  const abortCurrent = (): void => {
    const reader = currentReader;
    currentReader = null;
    if (reader !== null) void reader.cancel().catch(() => undefined);
    const controller = currentController;
    currentController = null;
    controller?.abort();
  };

  const terminate = (): void => {
    if (closed) return;
    closed = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    generation += 1;
    abortCurrent();
  };

  const scheduleRetry = (): void => {
    if (closed || retryTimer !== null) return;
    abortCurrent();
    const nextGeneration = generation + 1;
    generation = nextGeneration;
    const delay = [1000, 2000, 4000, 8000][retryAttempt] ?? 8000;
    retryAttempt = Math.min(retryAttempt + 1, 3);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (active(nextGeneration)) launch(nextGeneration);
    }, delay);
  };

  const fail = (error: unknown, currentGeneration: number): void => {
    if (!active(currentGeneration) || isAbortError(error)) return;
    if (isUnauthorized(error)) terminate();
    else scheduleRetry();
  };

  const enqueueRefresh = (currentGeneration: number, signal: AbortSignal): Promise<void> => {
    const previous = refreshChains.get(currentGeneration) ?? Promise.resolve();
    const operation = previous.then(async () => {
      if (!active(currentGeneration)) return;
      const payload = await transport.request<unknown>(todoPath(date), { signal });
      const todos = array(payload).map(mapTodo);
      if (!active(currentGeneration)) return;
      listener(todos);
    });
    const settled = operation.catch(() => undefined);
    refreshChains.set(currentGeneration, settled);
    return operation;
  };

  const queueEventRefresh = (currentGeneration: number, signal: AbortSignal): void => {
    if (pendingRefreshes.has(currentGeneration)) {
      if (inFlightRefreshes.has(currentGeneration)) dirtyRefreshes.add(currentGeneration);
      return;
    }
    pendingRefreshes.add(currentGeneration);
    queueMicrotask(() => {
      if (!active(currentGeneration)) {
        pendingRefreshes.delete(currentGeneration);
        dirtyRefreshes.delete(currentGeneration);
        return;
      }
      inFlightRefreshes.add(currentGeneration);
      void enqueueRefresh(currentGeneration, signal)
        .catch((error: unknown) => {
          fail(error, currentGeneration);
        })
        .finally(() => {
          inFlightRefreshes.delete(currentGeneration);
          pendingRefreshes.delete(currentGeneration);
          if (dirtyRefreshes.delete(currentGeneration) && active(currentGeneration)) {
            queueEventRefresh(currentGeneration, signal);
          }
        });
    });
  };

  const launch = (currentGeneration: number): void => {
    if (!active(currentGeneration)) return;
    const controller = new AbortController();
    currentController = controller;
    void (async () => {
      try {
        const initialPayload = await transport.request<unknown>(todoPath(date), { signal: controller.signal });
        const initialTodos = array(initialPayload).map(mapTodo);
        if (!active(currentGeneration)) return;
        listener(initialTodos);

        const response = await transport.stream(`/v1/todos/stream?date=${encodeURIComponent(date)}`, {
          signal: controller.signal,
        });
        if (!active(currentGeneration)) return;
        await readSseStream(
          response,
          async (frame) => {
            if (!active(currentGeneration) || frame.event !== "todo.changed") return;
            let payload: unknown;
            try {
              payload = JSON.parse(frame.data) as unknown;
            } catch {
              return;
            }
            if (
              payload === null ||
              typeof payload !== "object" ||
              Array.isArray(payload) ||
              (payload as Record<string, unknown>).date !== date
            ) return;
            queueEventRefresh(currentGeneration, controller.signal);
          },
          (reader) => {
            if (active(currentGeneration)) {
              currentReader = reader;
              retryAttempt = 0;
            }
            else void reader.cancel().catch(() => undefined);
          },
        );
        if (active(currentGeneration)) scheduleRetry();
      } catch (error) {
        fail(error, currentGeneration);
      }
    })();
  };

  launch(generation);
  return () => {
    if (closed) return;
    terminate();
  };
}

export class HttpFlowRepository implements FlowRepository {
  private readonly transport: HttpTransport;

  constructor(options: HttpFlowRepositoryOptions) {
    this.transport = createHttpTransport(options);
  }

  async listTodos(date: string): Promise<Todo[]> {
    assertIsoDate(date);
    const payload = await this.transport.request<unknown>(todoPath(date));
    return array(payload).map(mapTodo);
  }

  async createTodo(input: TodoCreate): Promise<Todo> {
    validateTodoInput(input);
    const body: Record<string, unknown> = {
      title: input.title,
      plannedDate: input.plannedDate,
      plannedTime: input.plannedTime,
      isCompleted: input.isCompleted,
    };
    if (input.projectId !== undefined) body.projectId = input.projectId;
    if (input.topicCardId !== undefined) body.topicCardId = input.topicCardId;
    const payload = await this.transport.request<unknown>("/v1/todos", { method: "POST", body });
    return mapTodo(payload);
  }

  async updateTodo(id: string, patch: TodoPatch): Promise<Todo> {
    validateTodoInput(patch);
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.plannedDate !== undefined) body.plannedDate = patch.plannedDate;
    if (patch.plannedTime !== undefined) body.plannedTime = patch.plannedTime;
    if (patch.isCompleted !== undefined) body.isCompleted = patch.isCompleted;
    if (patch.projectId !== undefined) body.projectId = patch.projectId;
    if (patch.topicCardId !== undefined) body.topicCardId = patch.topicCardId;
    const payload = await this.transport.request<unknown>(`/v1/todos/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    });
    return mapTodo(payload);
  }

  async deleteTodo(id: string): Promise<void> {
    await this.transport.request<unknown>(`/v1/todos/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  subscribeTodos(date: string, listener: TodoListener): () => void {
    assertIsoDate(date);
    return startTodoSubscription(this.transport, date, listener);
  }

  async listSuggestedTopics(limit: number): Promise<TopicCard[]> {
    if (!Number.isInteger(limit) || limit < 0) throw new HttpError("invalid_limit", 0);
    const payload = await this.transport.request<unknown>(`/v1/topics?limit=${limit}`);
    return array(payload).map(mapTopicCard).filter((topic) => topic.state === "open");
  }

  async getTopicContext(topicId: string, deviceId?: string): Promise<TopicContext | null> {
    const configuredDeviceId = deviceId?.trim() || undefined;
    let path = topicPath(topicId);
    if (configuredDeviceId !== undefined) {
      const query = new URLSearchParams({ deviceId: configuredDeviceId });
      path += `?${query.toString()}`;
    }
    const payload = await this.transport.request<unknown>(path);
    if (payload === null) return null;
    const value = record(payload);
    return {
      topic: mapTopicCard(value.topic),
      latestSession: value.latestSession === null || value.latestSession === undefined ? null : mapSession(value.latestSession),
      latestHandoff: value.latestHandoff === null || value.latestHandoff === undefined ? null : mapHandoff(value.latestHandoff),
      currentWorkspace: value.currentWorkspace === null || value.currentWorkspace === undefined ? null : mapDeviceWorkspace(value.currentWorkspace),
    };
  }

  async getDailyProjection(date: string): Promise<DailyProjection | null> {
    assertIsoDate(date);
    const payload = await this.transport.request<unknown>(`/v1/daily-projections/${encodeURIComponent(date)}`);
    return payload === null ? null : mapDailyProjection(payload);
  }
}
