import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashSecret } from "../src/auth.ts";
import { ApiError } from "../src/errors.ts";
import type { FlowDataRepository } from "../src/repository.ts";
import { buildServer } from "../src/server.ts";

const ownerId = "00000000-0000-0000-0000-000000000001";
const deviceId = "10000000-0000-4000-8000-000000000001";
const unknownTodoId = "20000000-0000-4000-8000-000000000099";

class FakeRepository {
  readonly token = randomBytes(32).toString("base64url");
  readonly calls: string[] = [];
  conflict = false;

  async findEnrollment() { return null; }
  async enrollDevice() { return true; }
  async findActiveDeviceToken(tokenHash: string) {
    return tokenHash === hashSecret(this.token) ? { ownerId, deviceId, revokedAt: null } : null;
  }

  async listTodos(_principal: unknown, date: string) {
    this.calls.push(`listTodos:${date}`);
    return [{ id: unknownTodoId, title: "A", plannedDate: date, plannedTime: null, isCompleted: false, projectId: null, topicCardId: null }];
  }
  async createTodo(_principal: unknown, input: Record<string, unknown>) {
    this.calls.push("createTodo");
    return { id: unknownTodoId, ...input };
  }
  async updateTodo() { this.calls.push("updateTodo"); return null; }
  async deleteTodo() { this.calls.push("deleteTodo"); return null; }
  async rolloverIncompleteTodos() { this.calls.push("rollover"); return []; }
  async listSuggestedTopics() { this.calls.push("topics"); return []; }
  async getTopicContext() { this.calls.push("context"); return null; }
  async getDailyProjection() { this.calls.push("daily"); return null; }
  async createTopic(_principal?: unknown, input: Record<string, unknown> = {}) {
    this.calls.push("createTopic");
    return { id: unknownTodoId, projectId: input.projectId, title: input.title, state: "open", currentState: "", nextAction: "", openQuestions: [], latestHandoffId: null, lastActiveAt: "2026-08-06T00:00:00.000Z", focusRank: null, resurfaceAt: null, resurfaceCondition: null };
  }
  async createSession(_principal?: unknown, input: Record<string, unknown> = {}) {
    this.calls.push("createSession");
    if (this.conflict) throw new ApiError(409, "conflict");
    return { id: "30000000-0000-4000-8000-000000000001", topicCardId: input.topicCardId, codexThreadId: input.codexThreadId, deviceId, workspacePath: input.workspacePath, startedAt: "2026-08-06T00:00:00.000Z", endedAt: null };
  }
  async createHandoff(_principal?: unknown, input: Record<string, unknown> = {}) {
    this.calls.push("createHandoff");
    return { created: true, record: { id: "40000000-0000-4000-8000-000000000001", sessionId: input.sessionId, topicCardId: input.topicCardId, content: input.content, idempotencyKey: input.idempotencyKey } };
  }
  async completeTopic() { this.calls.push("completeTopic"); return { id: unknownTodoId, projectId: unknownTodoId, title: "done", state: "done", currentState: "", nextAction: "", openQuestions: [], lastActiveAt: "2026-08-06T00:00:00.000Z" }; }
  async upsertProjectProjection(_principal?: unknown, id = unknownTodoId, input: Record<string, unknown> = {}) { this.calls.push("project"); return { id, ...input }; }
  async upsertDailyProjection(_principal?: unknown, date = "2026-08-06", input: Record<string, unknown> = {}) { this.calls.push("dailyWrite"); return { date, ...input }; }
  async upsertDeviceWorkspace(_principal?: unknown, suppliedDeviceId = deviceId, projectId = unknownTodoId, input: Record<string, unknown> = {}) { this.calls.push("workspace"); return { deviceId: suppliedDeviceId, projectId, ...input }; }
}

function createApp(repository = new FakeRepository(), todoEvents?: { subscribe: (...args: unknown[]) => Promise<() => void> }) {
  return {
    app: buildServer({
      repository: repository as unknown as FlowDataRepository,
      config: { port: 8080, databaseUrl: "postgres://unused", ownerId, logLevel: "silent" },
      now: () => new Date("2026-08-06T02:00:00.000Z"),
      todoEvents,
    }),
    repository,
  };
}

function auth(repository: FakeRepository) {
  return { authorization: `Bearer ${repository.token}` };
}

describe("FlowContext REST API", () => {
  it("returns 404 rather than 422 when PATCH targets an unknown owner-scoped todo", async () => {
    const { app, repository } = createApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/todos/missing",
      headers: auth(repository),
      payload: { title: "x" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
    expect(repository.calls).toEqual([]);
    await app.close();
  });

  it("validates dates, time zones, UUID resources and pagination before repository access", async () => {
    const { app, repository } = createApp();
    const requests = [
      { method: "GET", url: "/v1/todos?date=2026-02-30" },
      { method: "GET", url: "/v1/topics?limit=101" },
      { method: "POST", url: "/v1/todos/rollover", payload: { fromDate: "2026-08-05", toDate: "2026-08-06", timeZone: "Mars/Olympus" } },
      { method: "GET", url: "/v1/topics/not-a-uuid/context" },
      { method: "POST", url: "/v1/sessions", payload: { topicCardId: "not-a-uuid", codexThreadId: "thread", deviceId, workspacePath: "/tmp" } },
    ];

    for (const request of requests) {
      const response = await app.inject({ ...request, headers: auth(repository) });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: "invalid_request" });
    }
    expect(repository.calls).toEqual([]);
    await app.close();
  });

  it("serves camelCase reads and accepts the atomic rollover window", async () => {
    const { app, repository } = createApp();
    const list = await app.inject({ method: "GET", url: "/v1/todos?date=2026-08-06", headers: auth(repository) });
    const topics = await app.inject({ method: "GET", url: "/v1/topics?limit=10", headers: auth(repository) });
    const context = await app.inject({ method: "GET", url: `/v1/topics/${unknownTodoId}/context`, headers: auth(repository) });
    const daily = await app.inject({ method: "GET", url: "/v1/daily-projections/2026-08-06", headers: auth(repository) });
    const rollover = await app.inject({
      method: "POST",
      url: "/v1/todos/rollover",
      headers: auth(repository),
      payload: { fromDate: "2026-08-05", toDate: "2026-08-06", timeZone: "Asia/Shanghai" },
    });

    expect(list.json()).toEqual([expect.objectContaining({ plannedDate: "2026-08-06", isCompleted: false })]);
    expect(topics.statusCode).toBe(200);
    expect(context.statusCode).toBe(200);
    expect(context.json()).toBeNull();
    expect(daily.json()).toBeNull();
    expect(rollover.statusCode).toBe(200);
    expect(repository.calls).toEqual(["listTodos:2026-08-06", "topics", "context", "daily", "rollover"]);
    await app.close();
  });

  it("maps repository conflicts to a stable JSON error", async () => {
    const { app, repository } = createApp();
    repository.conflict = true;
    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: auth(repository),
      payload: { topicCardId: unknownTodoId, codexThreadId: "thread", deviceId, workspacePath: "/tmp" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "conflict" });
    await app.close();
  });

  it("keeps enrollment public when the request has a query string", async () => {
    const { app } = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/devices/enroll?source=admin",
      payload: { enrollmentCode: "x", deviceId, platform: "macos" },
    });

    expect(response.statusCode).not.toBe(401);
    await app.close();
  });

  it("keeps Project, Topic, Session, Handoff, projection and workspace writes on their stable routes", async () => {
    const { app, repository } = createApp();
    const headers = auth(repository);
    const sessionId = "30000000-0000-4000-8000-000000000001";
    const requests = [
      { method: "POST", url: "/v1/topics", payload: { projectId: unknownTodoId, title: "Topic" }, status: 201 },
      { method: "POST", url: "/v1/sessions", payload: { topicCardId: unknownTodoId, codexThreadId: "thread", deviceId, workspacePath: "/tmp" }, status: 201 },
      { method: "POST", url: "/v1/handoffs", payload: { sessionId, topicCardId: unknownTodoId, content: "handoff", idempotencyKey: "key" }, status: 201 },
      { method: "POST", url: `/v1/topics/${unknownTodoId}/complete`, payload: { explicit: true }, status: 200 },
      { method: "PUT", url: `/v1/project-projections/${unknownTodoId}`, payload: { projectKey: "project", title: "Project", lifecycleStatus: "active", summary: "", nextAction: "" }, status: 200 },
      { method: "PUT", url: "/v1/daily-projections/2026-08-06", payload: { dailyLens: "", projects: [] }, status: 200 },
      { method: "PUT", url: `/v1/device-workspaces/${deviceId}/${unknownTodoId}`, payload: { platform: "macos", workspacePath: "/tmp" }, status: 200 },
    ];

    for (const request of requests) {
      const response = await app.inject({ ...request, headers });
      expect(response.statusCode).toBe(request.status);
      expect(response.json()).not.toHaveProperty("owner_id");
    }
    expect(repository.calls).toEqual(["createTopic", "createSession", "createHandoff", "completeTopic", "project", "dailyWrite", "workspace"]);
    await app.close();
  });

  it("authenticates an SSE request before opening a PostgreSQL listener", async () => {
    const subscribe = async () => {
      throw new Error("must not subscribe");
    };
    const { app } = createApp(new FakeRepository(), { subscribe });
    const response = await app.inject({ method: "GET", url: "/v1/todos/stream?date=2026-08-06" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "device_unauthorized" });
    await app.close();
  });
});
