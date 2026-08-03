import type {
  DailyProjection,
  DeviceWorkspace,
  Handoff,
  HandoffCreate,
  ProjectProjection,
  Session,
  TopicCard,
} from "../../../packages/domain/src/types.ts";
import { type Principal } from "./auth.ts";
import { ApiError, type ApiRepository } from "./repository.ts";

export type { Principal } from "./auth.ts";

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ error: error.code }, error.status);
  }
  return jsonResponse({ error: "internal_error" }, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    if (!isRecord(value)) throw new ApiError(422, "invalid_payload");
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json");
  }
}

function requiredString(
  body: Record<string, unknown>,
  field: string,
  allowEmpty = false,
): string {
  const value = body[field];
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new ApiError(422, `invalid_${field}`);
  }
  return value;
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ApiError(422, `invalid_${field}`);
  return value;
}

function optionalNonEmptyString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = optionalString(body, field);
  if (value !== undefined && value.trim().length === 0) {
    throw new ApiError(422, `invalid_${field}`);
  }
  return value;
}

function optionalNullableString(
  body: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = body[field];
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") throw new ApiError(422, `invalid_${field}`);
  return value;
}

function optionalIntegerOrNull(
  body: Record<string, unknown>,
  field: string,
): number | null | undefined {
  const value = body[field];
  if (value === undefined || value === null) return value;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ApiError(422, `invalid_${field}`);
  }
  return value;
}

function requiredEnum(
  body: Record<string, unknown>,
  field: string,
  values: readonly string[],
): string {
  const value = requiredString(body, field);
  if (!values.includes(value)) throw new ApiError(422, `invalid_${field}`);
  return value;
}

function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
): void {
  const value = body[field];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ApiError(422, `invalid_${field}`);
  }
}

function isValidIsoDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/
      .exec(
        value,
      );
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;

  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return false;
  }

  const offset = match[8];
  if (offset === "Z") return true;
  const offsetParts = offset.slice(1).split(":");
  const offsetHour = Number(offsetParts[0].slice(0, 2));
  const offsetMinute = Number(
    offsetParts.length === 2 ? offsetParts[1] : offsetParts[0].slice(2),
  );
  return offsetHour <= 23 && offsetMinute <= 59;
}

function optionalDateTime(body: Record<string, unknown>, field: string): void {
  const value = body[field];
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !isValidIsoDateTime(value)) {
    throw new ApiError(422, `invalid_${field}`);
  }
}

function optionalNonNullDateTime(
  body: Record<string, unknown>,
  field: string,
): void {
  if (body[field] === null) throw new ApiError(422, `invalid_${field}`);
  optionalDateTime(body, field);
}

function pickFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of allowed) {
    if (field in body) picked[field] = body[field];
  }
  return picked;
}

function pathPart(
  pathname: string,
  pattern: RegExp,
  field: string,
): string | null {
  const match = pattern.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new ApiError(422, `invalid_${field}`);
  }
}

function decodePathPart(raw: string, field: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new ApiError(422, `invalid_${field}`);
  }
}

function requireMethod<T extends (...args: any[]) => Promise<any>>(
  owner: object,
  method: T | undefined,
): T {
  if (!method) throw new ApiError(501, "not_implemented");
  return method.bind(owner) as T;
}

function requireDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(422, "invalid_date");
  }
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new ApiError(422, "invalid_date");
  }
  return value;
}

function parseHandoff(body: Record<string, unknown>): HandoffCreate {
  return {
    sessionId: requiredString(body, "sessionId"),
    topicCardId: requiredString(body, "topicCardId"),
    content: requiredString(body, "content", true),
    idempotencyKey: requiredString(body, "idempotencyKey"),
  };
}

function assertDevicePrincipal(
  body: Record<string, unknown>,
  principal: Principal,
): void {
  const deviceId = optionalString(body, "deviceId");
  if (deviceId !== undefined && deviceId !== principal.deviceId) {
    throw new ApiError(403, "device_forbidden");
  }
}

function parseProjectProjection(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ApiError(422, "invalid_projects");
  const input = pickFields(value, [
    "id",
    "projectKey",
    "title",
    "lifecycleStatus",
    "summary",
    "nextAction",
    "sourcePath",
    "lastSyncedAt",
  ]);
  if ("id" in input && input.id !== null) requiredString(input, "id");
  requiredString(input, "projectKey");
  requiredString(input, "title");
  requiredEnum(input, "lifecycleStatus", [
    "inbox",
    "active",
    "paused",
    "done",
    "archived",
  ]);
  requiredString(input, "summary", true);
  requiredString(input, "nextAction", true);
  optionalNonEmptyString(input, "sourcePath");
  optionalDateTime(input, "lastSyncedAt");
  return input;
}

async function createHandoff(
  request: Request,
  repo: ApiRepository,
  principal: Principal,
): Promise<Response> {
  const input = parseHandoff(await readJson(request));
  const create = requireMethod(repo, repo.createHandoff);
  const result = await create(input, principal) as {
    record: Handoff;
    created: boolean;
  };
  return jsonResponse(result.record, result.created ? 201 : 200);
}

async function completeTopic(
  request: Request,
  repo: ApiRepository,
  principal: Principal,
  topicId: string,
): Promise<Response> {
  const body = await readJson(request);
  if (body.explicit !== true) throw new ApiError(422, "explicit_required");
  const complete = requireMethod(repo, repo.completeTopic);
  const record = await complete(topicId, true, principal) as TopicCard;
  return jsonResponse(record, 200);
}

async function createTopic(
  request: Request,
  repo: ApiRepository,
  principal: Principal,
): Promise<Response> {
  const body = await readJson(request);
  if ("state" in body) throw new ApiError(422, "state_not_writable");
  const input = pickFields(body, [
    "projectId",
    "title",
    "currentState",
    "nextAction",
    "openQuestions",
    "lastActiveAt",
    "focusRank",
    "resurfaceAt",
    "resurfaceCondition",
  ]);
  requiredString(input, "projectId");
  requiredString(input, "title");
  optionalNullableString(input, "currentState");
  optionalNullableString(input, "nextAction");
  optionalStringArray(input, "openQuestions");
  optionalNonNullDateTime(input, "lastActiveAt");
  optionalIntegerOrNull(input, "focusRank");
  optionalDateTime(input, "resurfaceAt");
  optionalNullableString(input, "resurfaceCondition");
  const create = requireMethod(repo, repo.createTopic);
  const record = await create(input, principal) as TopicCard;
  return jsonResponse(record, 201);
}

async function createSession(
  request: Request,
  repo: ApiRepository,
  principal: Principal,
): Promise<Response> {
  const body = await readJson(request);
  const input = pickFields(body, [
    "topicCardId",
    "codexThreadId",
    "deviceId",
    "workspacePath",
    "startedAt",
    "endedAt",
  ]);
  requiredString(input, "topicCardId");
  requiredString(input, "codexThreadId");
  requiredString(input, "deviceId");
  requiredString(input, "workspacePath");
  assertDevicePrincipal(input, principal);
  optionalNonNullDateTime(input, "startedAt");
  optionalDateTime(input, "endedAt");
  const create = requireMethod(repo, repo.createSession);
  const record = await create(input, principal) as Session;
  return jsonResponse(record, 201);
}

async function upsertProjectProjection(
  request: Request,
  repo: ApiRepository,
  principal: Principal,
  id: string,
): Promise<Response> {
  const body = await readJson(request);
  const input = pickFields(body, [
    "projectKey",
    "title",
    "lifecycleStatus",
    "summary",
    "nextAction",
    "sourcePath",
    "lastSyncedAt",
  ]);
  requiredString(input, "projectKey");
  requiredString(input, "title");
  requiredEnum(input, "lifecycleStatus", [
    "inbox",
    "active",
    "paused",
    "done",
    "archived",
  ]);
  optionalString(input, "summary");
  optionalString(input, "nextAction");
  optionalNonEmptyString(input, "sourcePath");
  optionalDateTime(input, "lastSyncedAt");
  const update = requireMethod(repo, repo.upsertProjectProjection);
  const record = await update(id, input, principal) as ProjectProjection;
  return jsonResponse(record, 200);
}

async function upsertDailyProjection(
  request: Request,
  repo: ApiRepository,
  principal: Principal,
  date: string,
): Promise<Response> {
  const body = await readJson(request);
  const input = pickFields(body, [
    "dailyLens",
    "projects",
    "macReport",
    "windowsReport",
  ]);
  requiredString(input, "dailyLens", true);
  if (!Array.isArray(input.projects)) {
    throw new ApiError(422, "invalid_projects");
  }
  input.projects = input.projects.map(parseProjectProjection);
  optionalNullableString(input, "macReport");
  optionalNullableString(input, "windowsReport");
  const update = requireMethod(repo, repo.upsertDailyProjection);
  const record = await update(date, input, principal) as DailyProjection;
  return jsonResponse(record, 200);
}

async function upsertDeviceWorkspace(
  request: Request,
  repo: ApiRepository,
  principal: Principal,
  deviceId: string,
  projectId: string,
): Promise<Response> {
  if (deviceId !== principal.deviceId) {
    throw new ApiError(403, "device_forbidden");
  }
  const body = await readJson(request);
  const input = pickFields(body, ["platform", "workspacePath"]);
  requiredString(input, "workspacePath");
  requiredEnum(input, "platform", ["macos", "windows"]);
  const update = requireMethod(repo, repo.upsertDeviceWorkspace);
  const record = await update(
    deviceId,
    projectId,
    input,
    principal,
  ) as DeviceWorkspace;
  return jsonResponse(record, 200);
}

/** Route a request after authentication has injected the principal. */
export async function route(
  request: Request,
  repo: ApiRepository,
  principal?: Principal,
): Promise<Response> {
  if (!principal) return jsonResponse({ error: "unauthorized" }, 401);

  try {
    const { method } = request;
    const pathname = new URL(request.url).pathname;

    if (method === "POST" && pathname === "/v1/topics") {
      return await createTopic(request, repo, principal);
    }
    if (method === "POST" && pathname === "/v1/sessions") {
      return await createSession(request, repo, principal);
    }
    if (method === "POST" && pathname === "/v1/handoffs") {
      return await createHandoff(request, repo, principal);
    }

    const completeId = pathPart(
      pathname,
      /^\/v1\/topics\/([^/]+)\/complete$/,
      "topicId",
    );
    if (method === "POST" && completeId !== null) {
      return await completeTopic(request, repo, principal, completeId);
    }

    const projectId = pathPart(
      pathname,
      /^\/v1\/project-projections\/([^/]+)$/,
      "projectId",
    );
    if (method === "PUT" && projectId !== null) {
      return await upsertProjectProjection(request, repo, principal, projectId);
    }

    const dailyDate = pathPart(
      pathname,
      /^\/v1\/daily-projections\/([^/]+)$/,
      "date",
    );
    if (method === "PUT" && dailyDate !== null) {
      return await upsertDailyProjection(
        request,
        repo,
        principal,
        requireDate(dailyDate),
      );
    }

    const workspace = pathname.match(
      /^\/v1\/device-workspaces\/([^/]+)\/([^/]+)$/,
    );
    if (method === "PUT" && workspace) {
      const deviceId = decodePathPart(workspace[1], "deviceId");
      const projectId = decodePathPart(workspace[2], "projectId");
      return await upsertDeviceWorkspace(
        request,
        repo,
        principal,
        deviceId,
        projectId,
      );
    }

    return jsonResponse({ error: "not_found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
