import type {
  DailyProjection,
  DevicePlatform,
  HandoffCreate,
  ProjectLifecycleStatus,
  ProjectProjection,
  TodoCreate,
  TodoPatch,
} from "@flowcontext/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { Principal } from "./auth.js";
import { ApiError, invalidRequest } from "./errors.js";
import type { FlowDataRepository } from "./repository.js";
import { openTodoEventStream, type TodoEventSource } from "./sse.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const LIFECYCLE = new Set<ProjectLifecycleStatus>(["inbox", "active", "paused", "done", "archived"]);

export interface RouteOptions {
  todoEvents?: TodoEventSource;
  now?: () => Date;
}

function principal(request: FastifyRequest): Principal {
  if (!request.principal) throw new ApiError(401, "device_unauthorized");
  return request.principal;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest();
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) throw invalidRequest();
  return value;
}

function optionalString(value: unknown, allowNull = false): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && allowNull) return null;
  return requiredString(value, true);
}

function uuid(value: unknown): string {
  const text = requiredString(value);
  if (!UUID.test(text)) throw invalidRequest();
  return text;
}

function todoResourceId(value: unknown): string {
  try {
    return uuid(value);
  } catch {
    throw new ApiError(404, "not_found");
  }
}

function isoDate(value: unknown): string {
  const text = requiredString(value);
  const match = DATE.exec(text);
  if (!match) throw invalidRequest();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw invalidRequest();
  }
  return text;
}

function plannedTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !TIME.test(value)) throw invalidRequest();
  return value;
}

function dateTime(value: unknown, nullable = false): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  const text = requiredString(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.exec(text);
  if (!match) throw invalidRequest();
  isoDate(`${match[1]}-${match[2]}-${match[3]}`);
  return text;
}

function timeZone(value: unknown): string {
  const zone = requiredString(value);
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(new Date(0));
  } catch {
    throw invalidRequest();
  }
  return zone;
}

function localDate(now: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function previousDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function optionalUuid(value: unknown, nullable = true): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  return uuid(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw invalidRequest();
  return value;
}

function paginationLimit(value: unknown): number {
  if (value === undefined) return 10;
  const text = typeof value === "string" ? value : "";
  if (!/^\d+$/.test(text)) throw invalidRequest();
  const limit = Number(text);
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw invalidRequest();
  return limit;
}

function queryRecord(request: FastifyRequest): Record<string, unknown> {
  return record(request.query ?? {});
}

function pathParameters(request: FastifyRequest): Record<string, unknown> {
  return record(request.params ?? {});
}

function parseTodoCreate(value: unknown): TodoCreate {
  const body = record(value);
  return {
    title: requiredString(body.title),
    plannedDate: isoDate(body.plannedDate),
    plannedTime: plannedTime(body.plannedTime),
    isCompleted: body.isCompleted === undefined ? false : boolean(body.isCompleted),
    projectId: optionalUuid(body.projectId) ?? null,
    topicCardId: optionalUuid(body.topicCardId) ?? null,
  };
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidRequest();
  return value;
}

function parseTodoPatch(value: unknown): TodoPatch {
  const body = record(value);
  const patch: TodoPatch = {};
  if ("title" in body) patch.title = requiredString(body.title);
  if ("plannedDate" in body) patch.plannedDate = isoDate(body.plannedDate);
  if ("plannedTime" in body) patch.plannedTime = plannedTime(body.plannedTime);
  if ("isCompleted" in body) patch.isCompleted = boolean(body.isCompleted);
  if ("projectId" in body) patch.projectId = optionalUuid(body.projectId) ?? null;
  if ("topicCardId" in body) patch.topicCardId = optionalUuid(body.topicCardId) ?? null;
  if (Object.keys(patch).length === 0) throw invalidRequest();
  return patch;
}

function parseProject(value: unknown): ProjectProjection {
  const body = record(value);
  const lifecycle = requiredString(body.lifecycleStatus) as ProjectLifecycleStatus;
  if (!LIFECYCLE.has(lifecycle)) throw invalidRequest();
  const sourcePath = optionalString(body.sourcePath);
  return {
    id: optionalUuid(body.id),
    projectKey: requiredString(body.projectKey),
    title: requiredString(body.title),
    lifecycleStatus: lifecycle,
    summary: requiredString(body.summary, true),
    nextAction: requiredString(body.nextAction, true),
    ...(sourcePath === undefined || sourcePath === null ? {} : { sourcePath: requiredString(sourcePath) }),
    lastSyncedAt: dateTime(body.lastSyncedAt, true),
  };
}

function parseTopic(value: unknown): Record<string, unknown> {
  const body = record(value);
  if ("state" in body) throw new ApiError(422, "state_not_writable");
  const result: Record<string, unknown> = {
    projectId: uuid(body.projectId),
    title: requiredString(body.title),
  };
  if ("currentState" in body) result.currentState = requiredString(body.currentState, true);
  if ("nextAction" in body) result.nextAction = requiredString(body.nextAction, true);
  if ("openQuestions" in body) result.openQuestions = stringArray(body.openQuestions);
  if ("lastActiveAt" in body) result.lastActiveAt = dateTime(body.lastActiveAt);
  if ("focusRank" in body) {
    if (body.focusRank !== null && (!Number.isInteger(body.focusRank) || typeof body.focusRank !== "number")) throw invalidRequest();
    result.focusRank = body.focusRank;
  }
  if ("resurfaceAt" in body) result.resurfaceAt = dateTime(body.resurfaceAt, true);
  if ("resurfaceCondition" in body) result.resurfaceCondition = optionalString(body.resurfaceCondition, true);
  return result;
}

function parseSession(value: unknown, authenticated: Principal): Record<string, unknown> {
  const body = record(value);
  const bodyDeviceId = uuid(body.deviceId);
  if (bodyDeviceId !== authenticated.deviceId) throw new ApiError(403, "device_forbidden");
  return {
    topicCardId: uuid(body.topicCardId),
    codexThreadId: requiredString(body.codexThreadId),
    deviceId: bodyDeviceId,
    workspacePath: requiredString(body.workspacePath),
    startedAt: dateTime(body.startedAt),
    endedAt: dateTime(body.endedAt, true),
  };
}

function parseHandoff(value: unknown): HandoffCreate {
  const body = record(value);
  const update = body.topicUpdate === undefined ? undefined : record(body.topicUpdate);
  return {
    sessionId: uuid(body.sessionId),
    topicCardId: uuid(body.topicCardId),
    content: requiredString(body.content, true),
    idempotencyKey: requiredString(body.idempotencyKey),
    topicUpdate: update ? {
      ...(update.currentState === undefined ? {} : { currentState: requiredString(update.currentState, true) }),
      ...(update.nextAction === undefined ? {} : { nextAction: requiredString(update.nextAction, true) }),
      ...(update.openQuestions === undefined ? {} : { openQuestions: stringArray(update.openQuestions) }),
    } : undefined,
  };
}

function found<T>(value: T | null): T {
  if (value === null) throw new ApiError(404, "not_found");
  return value;
}

function registerReadRoutes(app: FastifyInstance, repository: FlowDataRepository): void {
  app.get("/v1/todos", async (request) => {
    const date = isoDate(queryRecord(request).date);
    return repository.listTodos(principal(request), date);
  });

  app.get("/v1/topics", async (request) => {
    const limit = paginationLimit(queryRecord(request).limit);
    return repository.listSuggestedTopics(principal(request), limit);
  });

  app.get("/v1/topics/:id/context", async (request) => {
    const id = uuid(pathParameters(request).id);
    const device = optionalUuid(queryRecord(request).deviceId, false);
    return repository.getTopicContext(principal(request), id, device ?? undefined);
  });

  app.get("/v1/daily-projections/:date", async (request) => {
    const date = isoDate(pathParameters(request).date);
    return repository.getDailyProjection(principal(request), date);
  });
}

function registerTodoRoutes(app: FastifyInstance, repository: FlowDataRepository, now: () => Date): void {
  app.post("/v1/todos", async (request, reply) => {
    const todo = await repository.createTodo(principal(request), parseTodoCreate(request.body));
    return reply.status(201).send(todo);
  });

  app.patch("/v1/todos/:id", async (request) => {
    const id = todoResourceId(pathParameters(request).id);
    return found(await repository.updateTodo(principal(request), id, parseTodoPatch(request.body)));
  });

  app.delete("/v1/todos/:id", async (request, reply) => {
    const id = todoResourceId(pathParameters(request).id);
    found(await repository.deleteTodo(principal(request), id));
    return reply.status(204).send();
  });

  app.post("/v1/todos/rollover", async (request) => {
    const body = record(request.body);
    const fromDate = isoDate(body.fromDate);
    const toDate = isoDate(body.toDate);
    const zone = timeZone(body.timezone);
    if (toDate !== localDate(now(), zone) || fromDate !== previousDate(toDate)) throw invalidRequest();
    return repository.rolloverIncompleteTodos(principal(request), fromDate, toDate, zone);
  });
}

function registerContinuityWrites(app: FastifyInstance, repository: FlowDataRepository): void {
  app.post("/v1/topics", async (request, reply) => {
    return reply.status(201).send(found(await repository.createTopic(principal(request), parseTopic(request.body))));
  });

  app.post("/v1/sessions", async (request, reply) => {
    const authenticated = principal(request);
    return reply.status(201).send(found(await repository.createSession(authenticated, parseSession(request.body, authenticated))));
  });

  app.post("/v1/handoffs", async (request, reply) => {
    const result = found(await repository.createHandoff(principal(request), parseHandoff(request.body)));
    return reply.status(result.created ? 201 : 200).send(result.record);
  });

  app.post("/v1/topics/:id/complete", async (request) => {
    if (record(request.body).explicit !== true) throw new ApiError(422, "explicit_required");
    return found(await repository.completeTopic(principal(request), uuid(pathParameters(request).id)));
  });

  app.put("/v1/project-projections/:id", async (request) => {
    return repository.upsertProjectProjection(principal(request), uuid(pathParameters(request).id), parseProject(request.body));
  });

  app.put("/v1/daily-projections/:date", async (request) => {
    const body = record(request.body);
    if (!Array.isArray(body.projects)) throw invalidRequest();
    const projects = body.projects.map(parseProject);
    const input: Omit<DailyProjection, "date"> = {
      dailyLens: requiredString(body.dailyLens, true),
      projects,
      macReport: optionalString(body.macReport, true) ?? null,
      windowsReport: optionalString(body.windowsReport, true) ?? null,
    };
    return repository.upsertDailyProjection(principal(request), isoDate(pathParameters(request).date), input);
  });

  app.put("/v1/device-workspaces/:deviceId/:projectId", async (request) => {
    const authenticated = principal(request);
    const params = pathParameters(request);
    const body = record(request.body);
    const deviceId = uuid(params.deviceId);
    if (deviceId !== authenticated.deviceId) throw new ApiError(403, "device_forbidden");
    const platform = requiredString(body.platform) as DevicePlatform;
    if (platform !== "macos" && platform !== "windows") throw invalidRequest();
    return found(await repository.upsertDeviceWorkspace(authenticated, deviceId, uuid(params.projectId), {
      platform,
      workspacePath: requiredString(body.workspacePath),
    }));
  });
}

export function registerFlowRoutes(
  app: FastifyInstance,
  repository: FlowDataRepository,
  { todoEvents, now = () => new Date() }: RouteOptions = {},
): void {
  registerReadRoutes(app, repository);
  registerTodoRoutes(app, repository, now);
  registerContinuityWrites(app, repository);

  app.get("/v1/todos/stream", async (request, reply) => {
    const date = isoDate(queryRecord(request).date);
    if (!todoEvents) throw new ApiError(503, "stream_unavailable");
    const authenticated = principal(request);
    try {
      await openTodoEventStream(reply.raw, todoEvents, authenticated.ownerId, date);
      reply.hijack();
    } catch {
      throw new ApiError(503, "stream_unavailable");
    }
  });
}
