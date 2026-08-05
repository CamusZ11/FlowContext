import type {
  DailyProjection,
  DeviceWorkspace,
  HandoffCreate,
  ProjectProjection,
  Session,
  TopicCard,
} from "../../../packages/domain/src/types.ts";
import {
  ApiError,
  createSupabaseRepository,
  type SupabaseClientLike,
} from "./repository.ts";
import type { Principal } from "./router.ts";

type SupabaseError = { code?: string; message?: string };
type SupabaseResponse<T = unknown> = {
  data: T | null;
  error: SupabaseError | null;
};
type ResponseKind = "maybeSingle" | "single" | "rpc";

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

function assertRejects<T extends Error>(
  promise: Promise<unknown>,
  predicate: (error: T) => boolean,
): Promise<void> {
  return promise.then(
    () => {
      throw new Error("expected promise to reject");
    },
    (error: unknown) => {
      if (!(error instanceof Error) || !predicate(error as T)) throw error;
    },
  );
}

type Call =
  | { kind: "from"; table: string }
  | { kind: "select"; table: string; columns: string }
  | { kind: "eq"; table: string; column: string; value: unknown }
  | { kind: "insert"; table: string; values: unknown }
  | { kind: "upsert"; table: string; values: unknown; options: unknown }
  | { kind: "maybeSingle"; table: string }
  | { kind: "single"; table: string }
  | { kind: "rpc"; functionName: string; args: Record<string, unknown> };

class RecordingQuery {
  constructor(
    private readonly client: RecordingClient,
    private readonly table: string,
  ) {}

  select(columns = "*"): this {
    this.client.calls.push({ kind: "select", table: this.table, columns });
    return this;
  }

  eq(column: string, value: unknown): this {
    this.client.calls.push({ kind: "eq", table: this.table, column, value });
    return this;
  }

  insert(values: unknown): this {
    this.client.calls.push({ kind: "insert", table: this.table, values });
    return this;
  }

  upsert(values: unknown, options: unknown): this {
    this.client.calls.push({
      kind: "upsert",
      table: this.table,
      values,
      options,
    });
    return this;
  }

  maybeSingle<T = unknown>(): Promise<SupabaseResponse<T>> {
    this.client.calls.push({ kind: "maybeSingle", table: this.table });
    return Promise.resolve(
      this.client.next("maybeSingle") as SupabaseResponse<T>,
    );
  }

  single<T = unknown>(): Promise<SupabaseResponse<T>> {
    this.client.calls.push({ kind: "single", table: this.table });
    return Promise.resolve(this.client.next("single") as SupabaseResponse<T>);
  }
}

class RecordingClient implements SupabaseClientLike {
  readonly calls: Call[] = [];
  private readonly responses: Record<ResponseKind, SupabaseResponse[]> = {
    maybeSingle: [],
    single: [],
    rpc: [],
  };

  from(table: string): RecordingQuery {
    this.calls.push({ kind: "from", table });
    return new RecordingQuery(this, table);
  }

  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<SupabaseResponse> {
    this.calls.push({ kind: "rpc", functionName, args });
    return Promise.resolve(this.next("rpc"));
  }

  enqueue(kind: ResponseKind, response: SupabaseResponse): void {
    this.responses[kind].push(response);
  }

  next(kind: ResponseKind): SupabaseResponse {
    return this.responses[kind].shift() ?? { data: null, error: null };
  }

  callsFor(table: string): Call[] {
    return this.calls.filter((call) => "table" in call && call.table === table);
  }
}

const fixedPrincipal: Principal = {
  ownerId: "owner-1",
  deviceId: "device-mac",
};

const handoffRow = {
  id: "handoff-1",
  owner_id: fixedPrincipal.ownerId,
  session_id: "session-1",
  topic_card_id: "topic-1",
  content: "handoff body",
  idempotency_key: "session-1:sha256",
  created_at: "2026-08-03T00:00:00.000Z",
  generated_at: "2026-08-03T00:00:00.000Z",
};

const topicRow = {
  id: "topic-1",
  owner_id: fixedPrincipal.ownerId,
  project_id: "project-1",
  title: "Topic",
  state: "open",
  current_state: "当前",
  next_action: "下一步",
  open_questions: [],
  latest_handoff_id: null,
  last_active_at: "2026-08-03T00:00:00.000Z",
  focus_rank: null,
  resurface_at: null,
  resurface_condition: null,
};

const todoRow = {
  id: "todo-1",
  owner_id: fixedPrincipal.ownerId,
  title: "验证 macOS 全屏覆盖",
  planned_date: "2026-08-04",
  planned_time: "09:30",
  is_completed: false,
  project_id: null,
  topic_card_id: null,
};

Deno.test("repository looks up device tokens by hash only", async () => {
  const client = new RecordingClient();
  const tokenHash = "a".repeat(64);
  client.enqueue("maybeSingle", {
    data: {
      owner_id: fixedPrincipal.ownerId,
      device_id: fixedPrincipal.deviceId,
      token_hash: tokenHash,
      revoked_at: null,
    },
    error: null,
  });
  const repo = createSupabaseRepository(client);
  const record = await repo.findDeviceTokenByHash?.(tokenHash);
  const eqCalls = client.calls.filter((call) => call.kind === "eq");

  assertEquals(record?.tokenHash, tokenHash);
  assertEquals(eqCalls, [{
    kind: "eq",
    table: "device_tokens",
    column: "token_hash",
    value: tokenHash,
  }]);
});

Deno.test("topic writes force owner and never persist state or unknown owner fields", async () => {
  const client = new RecordingClient();
  client.enqueue("single", { data: topicRow, error: null });
  const repo = createSupabaseRepository(client);
  const input = {
    projectId: "project-1",
    title: "Topic",
    state: "done",
    ownerId: "attacker",
    owner_id: "attacker",
    currentState: "当前",
    nextAction: "下一步",
    openQuestions: [],
  } as unknown as Partial<TopicCard> & Record<string, unknown>;

  await repo.createTopic?.(input, fixedPrincipal);
  const insert = client.calls.find((call) =>
    call.kind === "insert" && call.table === "topic_cards"
  );
  assert(insert?.kind === "insert");
  assertEquals(insert.values, {
    owner_id: fixedPrincipal.ownerId,
    project_id: "project-1",
    title: "Topic",
    current_state: "当前",
    next_action: "下一步",
    open_questions: [],
    last_active_at: undefined,
    focus_rank: undefined,
    resurface_at: undefined,
    resurface_condition: undefined,
  });
});

Deno.test("todo writes are owner-scoped and always start uncompleted", async () => {
  const client = new RecordingClient();
  client.enqueue("single", { data: todoRow, error: null });
  const repo = createSupabaseRepository(client);

  const todo = await repo.createTodo?.({
    title: "验证 macOS 全屏覆盖",
    plannedDate: "2026-08-04",
    plannedTime: "09:30",
  }, fixedPrincipal);
  const insert = client.calls.find((call) =>
    call.kind === "insert" && call.table === "todos"
  );

  assertEquals(todo?.isCompleted, false);
  assert(insert?.kind === "insert");
  if (insert?.kind === "insert") {
    assertEquals(insert.values, {
      owner_id: fixedPrincipal.ownerId,
      title: "验证 macOS 全屏覆盖",
      planned_date: "2026-08-04",
      planned_time: "09:30",
      is_completed: false,
    });
  }
});

Deno.test("handoff idempotency retry returns the original record without a second topic update", async () => {
  const client = new RecordingClient();
  client.enqueue("rpc", {
    data: { handoff: handoffRow, created: false },
    error: null,
  });
  const repo = createSupabaseRepository(client);
  const input: HandoffCreate = {
    sessionId: "session-1",
    topicCardId: "topic-1",
    content: "handoff body",
    idempotencyKey: "session-1:sha256",
  };

  const result = await repo.createHandoff(input, fixedPrincipal);
  assertEquals(result.created, false);
  assertEquals(result.record.id, handoffRow.id);
  assertEquals(client.calls.filter((call) => call.kind === "rpc").length, 1);
  assertEquals(client.calls.some((call) => call.kind === "insert"), false);
});

Deno.test("handoff creates through the atomic session-topic RPC", async () => {
  const client = new RecordingClient();
  client.enqueue("rpc", {
    data: { handoff: handoffRow, created: true },
    error: null,
  });
  const repo = createSupabaseRepository(client);
  const input = {
    sessionId: "session-1",
    topicCardId: "topic-1",
    content: "handoff body",
    idempotencyKey: "session-1:sha256",
    topicUpdate: {
      currentState: "已完成原生窗口改动",
      nextAction: "实机验证全屏覆盖",
      openQuestions: ["Safari 全屏是否保持 overlay？"],
    },
  } as HandoffCreate & {
    topicUpdate: {
      currentState: string;
      nextAction: string;
      openQuestions: string[];
    };
  };

  const result = await repo.createHandoff(input, fixedPrincipal);
  const rpc = client.calls.find((call) => call.kind === "rpc");

  assertEquals(result.created, true);
  assertEquals(result.record.id, handoffRow.id);
  assert(rpc?.kind === "rpc");
  assertEquals(rpc.functionName, "create_handoff_and_update_topic");
  assertEquals(rpc.args, {
    p_owner_id: fixedPrincipal.ownerId,
    p_session_id: "session-1",
    p_topic_card_id: "topic-1",
    p_content: "handoff body",
    p_idempotency_key: "session-1:sha256",
    p_current_state: "已完成原生窗口改动",
    p_next_action: "实机验证全屏覆盖",
    p_open_questions: ["Safari 全屏是否保持 overlay？"],
  });
  assertEquals(client.calls.some((call) => call.kind === "insert"), false);
});

Deno.test("complete topic checks owner before calling explicit RPC", async () => {
  const client = new RecordingClient();
  client.enqueue("maybeSingle", { data: topicRow, error: null });
  client.enqueue("rpc", { data: [topicRow], error: null });
  const repo = createSupabaseRepository(client);

  const completed = await repo.completeTopic("topic-1", true, fixedPrincipal);
  const rpcIndex = client.calls.findIndex((call) => call.kind === "rpc");
  const ownerSelectIndex = client.calls.findIndex(
    (call) =>
      call.kind === "eq" && call.table === "topic_cards" &&
      call.column === "owner_id",
  );
  const rpc = client.calls.find((call) => call.kind === "rpc");

  assert(rpcIndex > ownerSelectIndex);
  assertEquals(completed.id, "topic-1");
  assert(rpc?.kind === "rpc");
  assertEquals(rpc.args, { p_topic_id: "topic-1", p_explicit: true });
});

Deno.test("complete topic does not call RPC when owner-scoped topic is missing", async () => {
  const client = new RecordingClient();
  client.enqueue("maybeSingle", { data: null, error: null });
  const repo = createSupabaseRepository(client);

  await assertRejects<ApiError>(
    repo.completeTopic("topic-1", true, fixedPrincipal),
    (error) => error instanceof ApiError && error.status === 404,
  );
  assertEquals(client.calls.some((call) => call.kind === "rpc"), false);
});

Deno.test("every write payload is owner-scoped and strips caller owner fields", async () => {
  const client = new RecordingClient();
  client.enqueue("single", {
    data: {
      id: "session-1",
      owner_id: fixedPrincipal.ownerId,
      topic_card_id: "topic-1",
      codex_thread_id: "thread-1",
      device_id: fixedPrincipal.deviceId,
      platform: "macos",
      workspace_path: "/workspace",
      started_at: "2026-08-03T00:00:00.000Z",
      ended_at: null,
    },
    error: null,
  });
  client.enqueue("single", {
    data: {
      id: "project-1",
      owner_id: fixedPrincipal.ownerId,
      project_key: "project-1",
      title: "Project",
      lifecycle_status: "active",
      summary: "",
      next_action: "",
      source_path: null,
      last_synced_at: null,
    },
    error: null,
  });
  client.enqueue("single", {
    data: {
      owner_id: fixedPrincipal.ownerId,
      date: "2026-08-03",
      daily_lens: "",
      projects: [],
      mac_report: null,
      windows_report: null,
    },
    error: null,
  });
  client.enqueue("single", {
    data: {
      id: "workspace-1",
      owner_id: fixedPrincipal.ownerId,
      device_id: fixedPrincipal.deviceId,
      platform: "macos",
      project_id: "project-1",
      workspace_path: "/workspace",
    },
    error: null,
  });
  const repo = createSupabaseRepository(client);

  const createdSession = await repo.createSession?.({
    topicCardId: "topic-1",
    codexThreadId: "thread-1",
    deviceId: fixedPrincipal.deviceId,
    platform: "macos",
    workspacePath: "/workspace",
    ownerId: "attacker",
  } as unknown as Partial<Session>, fixedPrincipal);
  assertEquals(createdSession?.platform, "macos");
  await repo.upsertProjectProjection?.("project-1", {
    projectKey: "project-1",
    title: "Project",
    lifecycleStatus: "active",
    ownerId: "attacker",
  } as unknown as Partial<ProjectProjection>, fixedPrincipal);
  await repo.upsertDailyProjection?.("2026-08-03", {
    dailyLens: "",
    projects: [],
    ownerId: "attacker",
  } as unknown as Partial<DailyProjection>, fixedPrincipal);
  await repo.upsertDeviceWorkspace?.(fixedPrincipal.deviceId, "project-1", {
    platform: "macos",
    workspacePath: "/workspace",
    ownerId: "attacker",
  } as unknown as Partial<DeviceWorkspace>, fixedPrincipal);

  const writes = client.calls.filter((call) =>
    call.kind === "insert" || call.kind === "upsert"
  );
  assertEquals(writes.length, 4);
  for (const write of writes) {
    assert(write.kind === "insert" || write.kind === "upsert");
    const payload = write.values as Record<string, unknown>;
    assertEquals(payload.owner_id, fixedPrincipal.ownerId);
    assertEquals(payload.ownerId, undefined);
  }
  assertEquals((writes[0].values as Record<string, unknown>).platform, "macos");
});
