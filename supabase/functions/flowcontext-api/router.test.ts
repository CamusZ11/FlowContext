import { handleRequest } from "./index.ts";
import { hashToken, type TokenLookup } from "./auth.ts";
import {
  ApiError,
  type ApiLogger,
  type ApiRepository,
  type DeviceTokenRecord,
} from "./repository.ts";
import { type Principal, route } from "./router.ts";
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

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(
  actual: T,
  expected: T,
  message = "values differ",
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
    );
  }
}

function assertMatch(
  value: string,
  pattern: RegExp,
  message = "pattern did not match",
): void {
  if (!pattern.test(value)) throw new Error(`${message}: ${pattern}`);
}

function assertNotMatch(
  value: string,
  pattern: RegExp,
  message = "pattern unexpectedly matched",
): void {
  if (pattern.test(value)) throw new Error(`${message}: ${pattern}`);
}

const fixedPrincipal: Principal = {
  ownerId: "owner-1",
  deviceId: "device-mac",
};

function responseJson(response: Response): Promise<unknown> {
  return response.json();
}

function jsonRequest(
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://flowcontext.test${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function handoffRequest(
  overrides: Partial<HandoffCreate> = {},
  headers: Record<string, string> = {},
): Request {
  return jsonRequest(
    "POST",
    "/v1/handoffs",
    {
      sessionId: "session-1",
      topicCardId: "topic-1",
      content: "真实 Handoff 正文不应出现在日志中",
      idempotencyKey: "session-1:sha256",
      ...overrides,
    },
    headers,
  );
}

function completeRequest(explicit?: unknown): Request {
  return jsonRequest(
    "POST",
    "/v1/topics/topic-1/complete",
    explicit === undefined ? {} : { explicit },
  );
}

function topicFixture(overrides: Partial<TopicCard> = {}): TopicCard {
  return {
    id: "topic-1",
    projectId: "project-1",
    title: "稳定 API",
    state: "open",
    currentState: "进行中",
    nextAction: "完成 API",
    openQuestions: [],
    latestHandoffId: null,
    lastActiveAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

class FakeRepository implements ApiRepository, TokenLookup {
  readonly handoffs = new Map<string, Handoff>();
  readonly topics = new Map<string, TopicCard>([["topic-1", topicFixture()]]);
  readonly tokenRecords = new Map<string, DeviceTokenRecord>();
  readonly seenTokenHashes: string[] = [];
  lastTopicInput: Record<string, unknown> | null = null;
  lastHandoffInput: HandoffCreate | null = null;
  lastProjectInput: Record<string, unknown> | null = null;
  lastDailyInput: Record<string, unknown> | null = null;
  lastTodoInput: Record<string, unknown> | null = null;
  projectCalls = 0;
  dailyCalls = 0;

  async findDeviceTokenByHash(hash: string): Promise<DeviceTokenRecord | null> {
    this.seenTokenHashes.push(hash);
    return this.tokenRecords.get(hash) ?? null;
  }

  async createHandoff(
    input: HandoffCreate,
    _principal: Principal,
  ): Promise<{ record: Handoff; created: boolean }> {
    this.lastHandoffInput = input;
    const existing = this.handoffs.get(input.idempotencyKey);
    if (existing) return { record: existing, created: false };

    const { topicUpdate: _topicUpdate, ...handoff } = input;
    const record: Handoff = {
      id: `handoff-${this.handoffs.size + 1}`,
      ...handoff,
      createdAt: "2026-08-03T00:00:00.000Z",
      generatedAt: "2026-08-03T00:00:00.000Z",
    };
    this.handoffs.set(input.idempotencyKey, record);
    return { record, created: true };
  }

  async completeTopic(
    topicId: string,
    explicit: boolean,
    _principal: Principal,
  ): Promise<TopicCard> {
    if (!explicit) throw new ApiError(422, "explicit_required");
    const topic = this.topics.get(topicId);
    if (!topic) throw new ApiError(404, "not_found");
    const completed = { ...topic, state: "done" as const };
    this.topics.set(topicId, completed);
    return completed;
  }

  async createTopic(
    input: Partial<TopicCard>,
    _principal: Principal,
  ): Promise<TopicCard> {
    this.lastTopicInput = input as Record<string, unknown>;
    const topic = topicFixture(
      {
        ...input,
        id: input.id ?? `topic-${this.topics.size + 1}`,
      } as TopicCard,
    );
    this.topics.set(topic.id, topic);
    return topic;
  }

  async createSession(
    input: Partial<Session>,
    _principal: Principal,
  ): Promise<Session> {
    return {
      id: input.id ?? "session-new",
      topicCardId: input.topicCardId ?? "topic-1",
      codexThreadId: input.codexThreadId ?? "thread-1",
      deviceId: input.deviceId ?? fixedPrincipal.deviceId,
      platform: input.platform,
      workspacePath: input.workspacePath ?? "/workspace",
      startedAt: input.startedAt ?? "2026-08-03T00:00:00.000Z",
      endedAt: input.endedAt ?? null,
    };
  }

  async createTodo(
    input: Record<string, unknown>,
    _principal: Principal,
  ): Promise<Todo> {
    this.lastTodoInput = input;
    return {
      id: "todo-new",
      title: input.title as string,
      plannedDate: input.plannedDate as string,
      plannedTime: input.plannedTime as string | null,
      isCompleted: false,
      projectId: null,
      topicCardId: null,
    };
  }

  async upsertProjectProjection(
    id: string,
    input: Partial<ProjectProjection>,
    _principal: Principal,
  ): Promise<ProjectProjection> {
    this.projectCalls += 1;
    this.lastProjectInput = input as Record<string, unknown>;
    return {
      id,
      projectKey: input.projectKey ?? "project",
      title: input.title ?? "Project",
      lifecycleStatus: input.lifecycleStatus ?? "active",
      summary: input.summary ?? "",
      nextAction: input.nextAction ?? "",
      sourcePath: input.sourcePath,
      lastSyncedAt: input.lastSyncedAt ?? null,
    };
  }

  async upsertDailyProjection(
    date: string,
    input: Partial<DailyProjection>,
    _principal: Principal,
  ): Promise<DailyProjection> {
    this.dailyCalls += 1;
    this.lastDailyInput = input as Record<string, unknown>;
    return {
      date,
      dailyLens: input.dailyLens ?? "",
      projects: input.projects ?? [],
      macReport: input.macReport ?? null,
      windowsReport: input.windowsReport ?? null,
    };
  }

  async upsertDeviceWorkspace(
    deviceId: string,
    projectId: string,
    input: Partial<DeviceWorkspace>,
    _principal: Principal,
  ): Promise<DeviceWorkspace> {
    return {
      deviceId,
      projectId,
      platform: input.platform ?? "macos",
      workspacePath: input.workspacePath ?? "/workspace",
    };
  }
}

class CapturingLogger implements ApiLogger {
  readonly entries: string[] = [];

  info(event: string, fields: Record<string, string | number>): void {
    this.entries.push(JSON.stringify({ event, ...fields }));
  }
}

Deno.test("handoff retry returns the original record", async () => {
  const repo = new FakeRepository();
  const request = handoffRequest({ idempotencyKey: "session-1:sha256" });
  const first = await route(request, repo, fixedPrincipal);
  const second = await route(
    handoffRequest({ idempotencyKey: "session-1:sha256" }),
    repo,
    fixedPrincipal,
  );

  assertEquals(first.status, 201);
  assertEquals(second.status, 200);
  assertEquals(await responseJson(first), await responseJson(second));
});

Deno.test("handoff accepts only safe Topic continuity updates", async () => {
  const repo = new FakeRepository();
  const response = await route(
    handoffRequest({
      topicUpdate: {
        currentState: "完成数据库绑定",
        nextAction: "验证完整写入",
        openQuestions: ["重试是否保持幂等？"],
      },
    }),
    repo,
    fixedPrincipal,
  );

  assertEquals(response.status, 201);
  assertEquals(repo.lastHandoffInput?.topicUpdate, {
    currentState: "完成数据库绑定",
    nextAction: "验证完整写入",
    openQuestions: ["重试是否保持幂等？"],
  });
  assertEquals(await responseJson(response), {
    id: "handoff-1",
    sessionId: "session-1",
    topicCardId: "topic-1",
    content: "真实 Handoff 正文不应出现在日志中",
    idempotencyKey: "session-1:sha256",
    createdAt: "2026-08-03T00:00:00.000Z",
    generatedAt: "2026-08-03T00:00:00.000Z",
  });
});

Deno.test("completion without explicit flag is rejected", async () => {
  const response = await route(
    completeRequest(false),
    new FakeRepository(),
    fixedPrincipal,
  );
  assertEquals(response.status, 422);
  assertEquals(await responseJson(response), { error: "explicit_required" });
});

Deno.test("completion with a non-boolean explicit flag is rejected", async () => {
  const response = await route(
    completeRequest("true"),
    new FakeRepository(),
    fixedPrincipal,
  );
  assertEquals(response.status, 422);
});

Deno.test("missing device token returns 401", async () => {
  const response = await handleRequest(handoffRequest(), new FakeRepository());
  assertEquals(response.status, 401);
  assertEquals(await responseJson(response), { error: "unauthorized" });
});

Deno.test("revoked device token returns 401", async () => {
  const repo = new FakeRepository();
  repo.tokenRecords.set(await hashToken("revoked-token"), {
    ownerId: fixedPrincipal.ownerId,
    deviceId: fixedPrincipal.deviceId,
    tokenHash: await hashToken("revoked-token"),
    revokedAt: "2026-08-03T00:00:00.000Z",
  });

  const response = await handleRequest(
    handoffRequest({}, { "X-FlowContext-Token": "revoked-token" }),
    repo,
  );
  assertEquals(response.status, 401);
  assertEquals(await responseJson(response), { error: "unauthorized" });
});

Deno.test("raw token is hashed before token lookup", async () => {
  const repo = new FakeRepository();
  const rawToken = "valid-device-token";
  const expectedHash = await hashToken(rawToken);
  repo.tokenRecords.set(expectedHash, {
    ownerId: fixedPrincipal.ownerId,
    deviceId: fixedPrincipal.deviceId,
    tokenHash: expectedHash,
    revokedAt: null,
  });

  const response = await handleRequest(
    handoffRequest({}, { "X-FlowContext-Token": rawToken }),
    repo,
  );

  assertEquals(response.status, 201);
  assertEquals(repo.seenTokenHashes, [expectedHash]);
  assert(!repo.seenTokenHashes.includes(rawToken));
});

Deno.test("device-token hashing uses SHA-256", async () => {
  assertEquals(
    await hashToken("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

Deno.test("unknown route returns 404", async () => {
  const response = await route(
    jsonRequest("GET", "/v1/does-not-exist"),
    new FakeRepository(),
    fixedPrincipal,
  );
  assertEquals(response.status, 404);
  assertEquals(await responseJson(response), { error: "not_found" });
});

Deno.test("handoff logs include only request and device metadata", async () => {
  const repo = new FakeRepository();
  const logger = new CapturingLogger();
  const rawToken = "secret-device-token";
  const handoffBody = "真实 Handoff 正文不应出现在日志中";
  const tokenHash = await hashToken(rawToken);
  repo.tokenRecords.set(tokenHash, {
    ownerId: fixedPrincipal.ownerId,
    deviceId: fixedPrincipal.deviceId,
    tokenHash,
    revokedAt: null,
  });

  const response = await handleRequest(
    handoffRequest({ content: handoffBody }, {
      "X-FlowContext-Token": rawToken,
      "X-Request-Id": "request-123",
    }),
    repo,
    logger,
  );

  assertEquals(response.status, 201);
  const logs = logger.entries.join("\n");
  assertMatch(logs, /device-mac/);
  assertMatch(logs, /request-123/);
  assertNotMatch(logs, new RegExp(rawToken));
  assertNotMatch(logs, new RegExp(handoffBody));
});

Deno.test("route requires an authenticated principal", async () => {
  const response = await route(handoffRequest(), new FakeRepository());
  assertEquals(response.status, 401);
});

Deno.test("topic and session writes use their stable Codex routes", async () => {
  const repo = new FakeRepository();
  const topicResponse = await route(
    jsonRequest("POST", "/v1/topics", {
      projectId: "project-1",
      title: "新主题",
    }),
    repo,
    fixedPrincipal,
  );
  const sessionResponse = await route(
    jsonRequest("POST", "/v1/sessions", {
      topicCardId: "topic-1",
      codexThreadId: "thread-1",
      deviceId: fixedPrincipal.deviceId,
      platform: "macos",
      workspacePath: "/workspace",
    }),
    repo,
    fixedPrincipal,
  );

  assertEquals(topicResponse.status, 201);
  assertEquals(sessionResponse.status, 201);
  assertEquals((await responseJson(sessionResponse) as Session).platform, "macos");
});

Deno.test("session start requires a supported captured platform", async () => {
  const missing = await route(
    jsonRequest("POST", "/v1/sessions", {
      topicCardId: "topic-1",
      codexThreadId: "thread-1",
      deviceId: fixedPrincipal.deviceId,
      workspacePath: "/workspace",
    }),
    new FakeRepository(),
    fixedPrincipal,
  );
  const unsupported = await route(
    jsonRequest("POST", "/v1/sessions", {
      topicCardId: "topic-1",
      codexThreadId: "thread-1",
      deviceId: fixedPrincipal.deviceId,
      platform: "linux",
      workspacePath: "/workspace",
    }),
    new FakeRepository(),
    fixedPrincipal,
  );

  assertEquals(missing.status, 422);
  assertEquals(unsupported.status, 422);
});

Deno.test("Priming can create an uncompleted To-do for the selected day", async () => {
  const repo = new FakeRepository();
  const response = await route(
    jsonRequest("POST", "/v1/todos", {
      title: "验证 macOS 全屏覆盖",
      plannedDate: "2026-08-04",
      plannedTime: "09:30",
      isCompleted: true,
      ownerId: "another-owner",
    }),
    repo,
    fixedPrincipal,
  );

  assertEquals(response.status, 201);
  assertEquals(await responseJson(response), {
    id: "todo-new",
    title: "验证 macOS 全屏覆盖",
    plannedDate: "2026-08-04",
    plannedTime: "09:30",
    isCompleted: false,
    projectId: null,
    topicCardId: null,
  });
  assertEquals(repo.lastTodoInput, {
    title: "验证 macOS 全屏覆盖",
    plannedDate: "2026-08-04",
    plannedTime: "09:30",
  });
});

Deno.test("Supabase function-prefixed paths route to the To-do endpoint", async () => {
  const repo = new FakeRepository();
  const response = await route(
    jsonRequest("POST", "/flowcontext-api/v1/todos", {
      title: "验证 macOS 全屏覆盖",
      plannedDate: "2026-08-04",
      plannedTime: null,
    }),
    repo,
    fixedPrincipal,
  );

  assertEquals(response.status, 201);
  assertEquals(repo.lastTodoInput, {
    title: "验证 macOS 全屏覆盖",
    plannedDate: "2026-08-04",
    plannedTime: null,
  });
});

Deno.test("topic creation rejects state so done requires explicit completion", async () => {
  const response = await route(
    jsonRequest("POST", "/v1/topics", {
      projectId: "project-1",
      title: "不应直接完成",
      state: "done",
    }),
    new FakeRepository(),
    fixedPrincipal,
  );

  assertEquals(response.status, 422);
  assertEquals(await responseJson(response), { error: "state_not_writable" });
});

Deno.test("topic creation strips owner and unknown fields before repository", async () => {
  const repo = new FakeRepository();
  const response = await route(
    jsonRequest("POST", "/v1/topics", {
      projectId: "project-1",
      title: "安全白名单",
      currentState: "当前",
      ownerId: "attacker",
      owner_id: "attacker",
      unknown: "不要传递",
    }),
    repo,
    fixedPrincipal,
  );

  assertEquals(response.status, 201);
  assert(repo.lastTopicInput !== null);
  assertEquals(repo.lastTopicInput?.ownerId, undefined);
  assertEquals(repo.lastTopicInput?.owner_id, undefined);
  assertEquals(repo.lastTopicInput?.unknown, undefined);
  assertEquals(repo.lastTopicInput?.currentState, "当前");
});

Deno.test("projection writes use path identifiers", async () => {
  const repo = new FakeRepository();
  const projectResponse = await route(
    jsonRequest("PUT", "/v1/project-projections/project-1", {
      projectKey: "project-1",
      title: "Project",
      lifecycleStatus: "active",
      summary: "摘要",
      nextAction: "下一步",
    }),
    repo,
    fixedPrincipal,
  );
  const dailyResponse = await route(
    jsonRequest("PUT", "/v1/daily-projections/2026-08-03", {
      dailyLens: "今日",
      projects: [],
    }),
    repo,
    fixedPrincipal,
  );

  assertEquals(projectResponse.status, 200);
  assertEquals(dailyResponse.status, 200);
  assertEquals(
    (await responseJson(dailyResponse) as DailyProjection).date,
    "2026-08-03",
  );
});

Deno.test("daily projection rejects a non-array projects value before repository", async () => {
  const repo = new FakeRepository();
  const response = await route(
    jsonRequest("PUT", "/v1/daily-projections/2026-08-03", {
      dailyLens: "今日",
      projects: { bad: true },
    }),
    repo,
    fixedPrincipal,
  );

  assertEquals(response.status, 422);
  assertEquals(repo.dailyCalls, 0);
});

Deno.test("daily projection rejects malformed nested projects before repository", async () => {
  const cases = [
    {
      projectKey: "project-1",
      title: "Project",
      lifecycleStatus: "unknown",
      summary: "摘要",
      nextAction: "下一步",
    },
    {
      title: "Project",
      lifecycleStatus: "active",
      summary: "摘要",
      nextAction: "下一步",
    },
  ];

  for (const project of cases) {
    const repo = new FakeRepository();
    const response = await route(
      jsonRequest("PUT", "/v1/daily-projections/2026-08-03", {
        dailyLens: "今日",
        projects: [project],
      }),
      repo,
      fixedPrincipal,
    );
    assertEquals(response.status, 422);
    assertEquals(repo.dailyCalls, 0);
  }
});

Deno.test("daily projection validates report field types before repository", async () => {
  const cases = [
    { dailyLens: null, projects: [] },
    { dailyLens: "今日", projects: [], macReport: 123 },
    { dailyLens: "今日", projects: [], windowsReport: { bad: true } },
  ];

  for (const body of cases) {
    const repo = new FakeRepository();
    const response = await route(
      jsonRequest("PUT", "/v1/daily-projections/2026-08-03", body),
      repo,
      fixedPrincipal,
    );
    assertEquals(response.status, 422);
    assertEquals(repo.dailyCalls, 0);
  }
});

Deno.test("daily projection keeps only the nested project whitelist", async () => {
  const repo = new FakeRepository();
  const response = await route(
    jsonRequest("PUT", "/v1/daily-projections/2026-08-03", {
      dailyLens: "今日",
      projects: [{
        id: "project-id",
        projectKey: "project-1",
        title: "Project",
        lifecycleStatus: "active",
        summary: "摘要",
        nextAction: "下一步",
        sourcePath: "03_项目/10_进行中/Project",
        lastSyncedAt: "2026-08-03T08:00:00+08:00",
        ownerId: "attacker",
        owner_id: "attacker",
        unknown: "不要传递",
      }],
      macReport: null,
      windowsReport: "Windows",
      ownerId: "attacker",
    }),
    repo,
    fixedPrincipal,
  );

  assertEquals(response.status, 200);
  assertEquals(repo.lastDailyInput?.ownerId, undefined);
  const projects = repo.lastDailyInput?.projects as Record<string, unknown>[];
  assertEquals(projects.length, 1);
  assertEquals(projects[0].ownerId, undefined);
  assertEquals(projects[0].owner_id, undefined);
  assertEquals(projects[0].unknown, undefined);
  assertEquals(projects[0].projectKey, "project-1");
  assertEquals(projects[0].lastSyncedAt, "2026-08-03T08:00:00+08:00");
});

Deno.test("topic optional fields reject invalid types", async () => {
  const cases = [
    { currentState: 123 },
    { nextAction: { bad: true } },
    { resurfaceCondition: [] },
    { focusRank: 1.5 },
  ];

  for (const fields of cases) {
    const response = await route(
      jsonRequest("POST", "/v1/topics", {
        projectId: "project-1",
        title: "类型校验",
        ...fields,
      }),
      new FakeRepository(),
      fixedPrincipal,
    );
    assertEquals(response.status, 422);
  }
});

Deno.test("project projection text fields reject invalid types", async () => {
  const cases = [
    { sourcePath: 123 },
    { summary: { bad: true } },
    { nextAction: [] },
  ];

  for (const fields of cases) {
    const repo = new FakeRepository();
    const response = await route(
      jsonRequest("PUT", "/v1/project-projections/project-1", {
        projectKey: "project-1",
        title: "Project",
        lifecycleStatus: "active",
        ...fields,
      }),
      repo,
      fixedPrincipal,
    );
    assertEquals(response.status, 422);
    assertEquals(repo.projectCalls, 0);
  }
});

Deno.test("date-time fields require ISO timestamps with an offset", async () => {
  const invalidRequests = [
    jsonRequest("POST", "/v1/topics", {
      projectId: "project-1",
      title: "Topic",
      lastActiveAt: "2026-08-03",
    }),
    jsonRequest("POST", "/v1/topics", {
      projectId: "project-1",
      title: "Topic",
      lastActiveAt: null,
    }),
    jsonRequest("POST", "/v1/sessions", {
      topicCardId: "topic-1",
      codexThreadId: "thread-1",
      deviceId: fixedPrincipal.deviceId,
      platform: "macos",
      workspacePath: "/workspace",
      startedAt: "August 3, 2026",
    }),
    jsonRequest("POST", "/v1/sessions", {
      topicCardId: "topic-1",
      codexThreadId: "thread-1",
      deviceId: fixedPrincipal.deviceId,
      platform: "macos",
      workspacePath: "/workspace",
      startedAt: null,
    }),
    jsonRequest("PUT", "/v1/project-projections/project-1", {
      projectKey: "project-1",
      title: "Project",
      lifecycleStatus: "active",
      lastSyncedAt: "2026-08-03T08:00:00",
    }),
  ];

  for (const request of invalidRequests) {
    const response = await route(request, new FakeRepository(), fixedPrincipal);
    assertEquals(response.status, 422);
  }

  const valid = await route(
    jsonRequest("POST", "/v1/topics", {
      projectId: "project-1",
      title: "Topic",
      lastActiveAt: "2026-08-03T08:00:00+08:00",
    }),
    new FakeRepository(),
    fixedPrincipal,
  );
  assertEquals(valid.status, 201);
});

Deno.test("device workspace writes are scoped to the authenticated device", async () => {
  const repo = new FakeRepository();
  const response = await route(
    jsonRequest("PUT", "/v1/device-workspaces/device-mac/project-1", {
      platform: "macos",
      workspacePath: "/workspace",
    }),
    repo,
    fixedPrincipal,
  );
  const forbidden = await route(
    jsonRequest("PUT", "/v1/device-workspaces/device-windows/project-1", {
      platform: "windows",
      workspacePath: "F:/workspace",
    }),
    repo,
    fixedPrincipal,
  );

  assertEquals(response.status, 200);
  assertEquals(forbidden.status, 403);
});
