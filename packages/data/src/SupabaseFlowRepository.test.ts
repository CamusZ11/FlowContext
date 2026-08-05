import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { sortTodosForDate } from "@flowcontext/domain";
import type { DailyProjection, Todo } from "@flowcontext/domain";
import { SupabaseFlowRepository as ExportedSupabaseFlowRepository } from "@flowcontext/data";
import type { FlowRepository } from "./FlowRepository.ts";
import { SupabaseFlowRepository } from "./SupabaseFlowRepository.ts";
import { createSupabaseClient, mergeRuntimeEnv } from "./createSupabaseClient.ts";

type QueryResponse = { data: unknown; error: Error | null };
type QueryOperation = {
  select?: string;
  eq?: [string, unknown];
  insert?: unknown;
  update?: unknown;
  delete?: true;
  limit?: number;
};

/**
 * The fake is intentionally complete and local to this test file. It records
 * the same query/channel calls that the adapter makes without contacting a
 * Supabase project.
 */
class RecordingQueryBuilder implements PromiseLike<QueryResponse> {
  readonly operation: QueryOperation = {};

  constructor(
    private readonly client: RecordingSupabaseClient,
    readonly table: string,
    private readonly response: QueryResponse,
  ) {}

  select(columns = "*"): this {
    this.operation.select = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.operation.eq = [column, value];
    this.client.lastQuery = { table: this.table, eq: [column, value] };
    return this;
  }

  insert(values: unknown): this {
    this.operation.insert = values;
    return this;
  }

  update(values: unknown): this {
    this.operation.update = values;
    return this;
  }

  delete(): this {
    this.operation.delete = true;
    return this;
  }

  limit(value: number): this {
    this.operation.limit = value;
    return this;
  }

  then<TResult1 = QueryResponse, TResult2 = never>(
    onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

class RecordingChannel {
  readonly subscriptions: Array<{
    event: string;
    config: Record<string, unknown>;
    listener: (payload: unknown) => void;
  }> = [];
  subscribed = false;
  unsubscribed = false;

  on(
    event: string,
    config: Record<string, unknown>,
    listener: (payload: unknown) => void,
  ): this {
    this.subscriptions.push({ event, config, listener });
    return this;
  }

  subscribe(): this {
    this.subscribed = true;
    return this;
  }

  unsubscribe(): Promise<"ok"> {
    this.unsubscribed = true;
    return Promise.resolve("ok");
  }

  emit(payload: unknown): void {
    for (const subscription of this.subscriptions) subscription.listener(payload);
  }
}

class RecordingSupabaseClient {
  readonly rows: unknown[];
  readonly channels: RecordingChannel[] = [];
  readonly removedChannels: RecordingChannel[] = [];
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
  fromCalls = 0;
  lastQuery: { table: string; eq: [string, unknown] } | undefined;
  response: QueryResponse;
  rpcResponse: QueryResponse;

  constructor(
    rows: unknown[],
    response?: QueryResponse,
    private readonly tableResponses: Record<string, QueryResponse> = {},
    rpcResponse?: QueryResponse,
  ) {
    this.rows = rows;
    this.response = response ?? { data: rows, error: null };
    this.rpcResponse = rpcResponse ?? this.response;
  }

  from(table: string): RecordingQueryBuilder {
    this.fromCalls += 1;
    return new RecordingQueryBuilder(this, table, this.tableResponses[table] ?? this.response);
  }

  channel(_name: string): RecordingChannel {
    const channel = new RecordingChannel();
    this.channels.push(channel);
    return channel;
  }

  removeChannel(channel: RecordingChannel): Promise<"ok"> {
    this.removedChannels.push(channel);
    return Promise.resolve("ok");
  }

  rpc(name: string, args?: Record<string, unknown>): Promise<QueryResponse> {
    this.rpcCalls.push({ name, args });
    return Promise.resolve(this.rpcResponse);
  }
}

const todoRow = {
  id: "todo-1",
  title: "Read the brief",
  planned_date: "2026-08-02",
  planned_time: "09:30:00",
  is_completed: false,
  project_id: "project-1",
  topic_card_id: "topic-1",
};

describe("SupabaseFlowRepository", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("filters todos by exact planned date", async () => {
    const client = new RecordingSupabaseClient([{ id: "1", planned_date: "2026-08-02" }]);
    const repo = new SupabaseFlowRepository(client);

    await repo.listTodos("2026-08-02");

    expect(client.lastQuery).toEqual({ table: "todos", eq: ["planned_date", "2026-08-02"] });
  });

  it("loads the domain runtime through the workspace package export", () => {
    expect(sortTodosForDate([
      {
        id: "todo-1",
        plannedDate: "2026-08-02",
        plannedTime: null,
        isCompleted: false,
      },
    ], "2026-08-02")).toHaveLength(1);
  });

  it("loads the data runtime through the workspace package export", () => {
    expect(typeof ExportedSupabaseFlowRepository).toBe("function");
  });

  it("maps todo rows in both directions for create and update", async () => {
    const client = new RecordingSupabaseClient([], { data: [todoRow], error: null });
    const repo = new SupabaseFlowRepository(client);
    const input: Omit<Todo, "id"> = {
      title: "Read the brief",
      plannedDate: "2026-08-02",
      plannedTime: "09:30",
      isCompleted: false,
      projectId: "project-1",
      topicCardId: "topic-1",
    };

    await expect(repo.createTodo(input)).resolves.toMatchObject({
      id: "todo-1",
      plannedDate: "2026-08-02",
      plannedTime: "09:30",
      projectId: "project-1",
      topicCardId: "topic-1",
    });

    client.response = { data: [{ ...todoRow, is_completed: true }], error: null };
    await expect(repo.updateTodo("todo-1", { isCompleted: true })).resolves.toMatchObject({
      id: "todo-1",
      isCompleted: true,
    });
  });

  it("deletes a todo through the id filter", async () => {
    const client = new RecordingSupabaseClient([], { data: null, error: null });
    const repo = new SupabaseFlowRepository(client);

    await expect(repo.deleteTodo("todo-1")).resolves.toBeUndefined();

    expect(client.lastQuery).toEqual({ table: "todos", eq: ["id", "todo-1"] });
  });

  it("rolls incomplete todos into the next calendar date through the atomic RPC", async () => {
    const client = new RecordingSupabaseClient([], undefined, {}, {
      data: [{ ...todoRow, planned_date: "2026-08-05", planned_time: null }],
      error: null,
    });
    const repo = new SupabaseFlowRepository(
      client,
      () => "2026-08-05",
      () => "Asia/Shanghai",
    );

    expect(repo.capabilities).toEqual({ todoRollover: true });

    await expect(repo.rolloverIncompleteTodos("2026-08-04", "2026-08-05")).resolves.toEqual([{
      id: "todo-1",
      title: "Read the brief",
      plannedDate: "2026-08-05",
      plannedTime: null,
      isCompleted: false,
      projectId: "project-1",
      topicCardId: "topic-1",
    }]);

    expect(client.rpcCalls).toEqual([{
      name: "rollover_incomplete_todos",
      args: {
        p_from_date: "2026-08-04",
        p_to_date: "2026-08-05",
        p_timezone: "Asia/Shanghai",
      },
    }]);
  });

  it("rejects an invalid device IANA timezone before the rollover RPC call", async () => {
    const client = new RecordingSupabaseClient([]);
    const repo = new SupabaseFlowRepository(
      client,
      () => "2026-08-05",
      () => "Mars/Olympus_Mons",
    );

    await expect(repo.rolloverIncompleteTodos("2026-08-04", "2026-08-05"))
      .rejects.toThrow("device timezone must be a valid IANA timezone");

    expect(client.rpcCalls).toEqual([]);
  });

  it.each(["2026-02-30", "August 4, 2026"])("rejects an invalid rollover source date before the RPC call", async (fromDate) => {
    const client = new RecordingSupabaseClient([]);
    const repo = new SupabaseFlowRepository(client);

    await expect(repo.rolloverIncompleteTodos(fromDate, "2026-08-05")).rejects.toThrow();

    expect(client.rpcCalls).toEqual([]);
  });

  it.each([
    ["2026-08-04", "2026-08-04"],
    ["2026-08-04", "2026-08-06"],
  ])("rejects a rollover target that is not the next day before the RPC call", async (fromDate, toDate) => {
    const client = new RecordingSupabaseClient([]);
    const repo = new SupabaseFlowRepository(client);

    await expect(repo.rolloverIncompleteTodos(fromDate, toDate)).rejects.toThrow();

    expect(client.rpcCalls).toEqual([]);
  });

  it("rejects a historical adjacent date pair before the RPC call", async () => {
    const client = new RecordingSupabaseClient([]);
    const repo = new SupabaseFlowRepository(client, () => "2026-08-05");

    await expect(repo.rolloverIncompleteTodos("2026-08-03", "2026-08-04")).rejects.toThrow();

    expect(client.rpcCalls).toEqual([]);
  });

  it("rejects a future adjacent date pair before the RPC call", async () => {
    const client = new RecordingSupabaseClient([]);
    const repo = new SupabaseFlowRepository(client, () => "2026-08-05");

    await expect(repo.rolloverIncompleteTodos("2026-08-05", "2026-08-06")).rejects.toThrow();

    expect(client.rpcCalls).toEqual([]);
  });

  it("propagates an atomic rollover RPC error unchanged", async () => {
    const error = new Error("database denied rollover");
    const client = new RecordingSupabaseClient([], undefined, {}, { data: null, error });
    const repo = new SupabaseFlowRepository(client, () => "2026-08-05");

    await expect(repo.rolloverIncompleteTodos("2026-08-04", "2026-08-05")).rejects.toBe(error);
  });

  it("maps daily projections and suggested topics as reads", async () => {
    const projection: DailyProjection = {
      date: "2026-08-02",
      dailyLens: "Focus",
      projects: [],
      macReport: null,
      windowsReport: "Windows report",
    };
    const client = new RecordingSupabaseClient([], { data: [{
      date: projection.date,
      daily_lens: projection.dailyLens,
      projects: [],
      mac_report: projection.macReport,
      windows_report: projection.windowsReport,
    }], error: null });
    const repo = new SupabaseFlowRepository(client);

    await expect(repo.getDailyProjection("2026-08-02")).resolves.toEqual(projection);

    client.response = { data: [{
      id: "topic-1",
      project_id: "project-1",
      title: "Continue",
      state: "open",
      current_state: "Ready",
      next_action: "Ship",
      open_questions: [],
      latest_handoff_id: null,
      last_active_at: "2026-08-02T08:00:00.000Z",
      focus_rank: 1,
      resurface_at: null,
      resurface_condition: null,
    }], error: null };
    await expect(repo.listSuggestedTopics(3)).resolves.toHaveLength(1);
  });

  it("loads the latest session, handoff, and current device workspace for a topic", async () => {
    const topic = {
      id: "topic-1",
      project_id: "project-1",
      title: "Continue",
      state: "open",
      current_state: "Ready",
      next_action: "Ship",
      open_questions: [],
      latest_handoff_id: "handoff-2",
      last_active_at: "2026-08-02T08:00:00.000Z",
      focus_rank: 1,
      resurface_at: null,
      resurface_condition: null,
    };
    const client = new RecordingSupabaseClient([], undefined, {
      topic_cards: { data: [topic], error: null },
      sessions: {
        data: [
          { id: "session-old", topic_card_id: "topic-1", codex_thread_id: "thread-old", device_id: "mac-1", workspace_path: "/old", started_at: "2026-08-01T08:00:00.000Z", ended_at: null },
          { id: "session-new", topic_card_id: "topic-1", codex_thread_id: "thread-new", device_id: "mac-1", workspace_path: "/new", started_at: "2026-08-02T08:00:00.000Z", ended_at: null },
        ],
        error: null,
      },
      handoffs: {
        data: [
          { id: "handoff-1", session_id: "session-old", topic_card_id: "topic-1", content: "old", idempotency_key: "idem-1", generated_at: "2026-08-01T09:00:00.000Z" },
          { id: "handoff-2", session_id: "session-new", topic_card_id: "topic-1", content: "new", idempotency_key: "idem-2", generated_at: "2026-08-02T09:00:00.000Z" },
        ],
        error: null,
      },
      device_workspaces: {
        data: [{ id: "workspace-1", device_id: "mac-1", platform: "macos", project_id: "project-1", workspace_path: "/Users/camus/项目/Alpha" }],
        error: null,
      },
    });
    const repo = new SupabaseFlowRepository(client);

    await expect(repo.getTopicContext("topic-1", "mac-1")).resolves.toMatchObject({
      topic: { id: "topic-1" },
      latestSession: { id: "session-new", codexThreadId: "thread-new" },
      latestHandoff: { id: "handoff-2", content: "new" },
      currentWorkspace: { deviceId: "mac-1", workspacePath: "/Users/camus/项目/Alpha" },
    });
  });

  it("returns an unsubscribe cleanup that removes the realtime channel", () => {
    const client = new RecordingSupabaseClient([]);
    const repo = new SupabaseFlowRepository(client);
    const cleanup = repo.subscribeTodos("2026-08-02", () => undefined);

    cleanup();

    expect(client.removedChannels).toHaveLength(1);
    expect(client.channels[0]?.subscriptions[0]?.config).toEqual({
      event: "*",
      schema: "public",
      table: "todos",
    });
  });

  it("refreshes the requested date when a realtime DELETE event arrives", async () => {
    const client = new RecordingSupabaseClient([todoRow]);
    const listener = vi.fn();
    const repo = new SupabaseFlowRepository(client);
    repo.subscribeTodos("2026-08-02", listener);
    const queryCountBeforeDelete = client.fromCalls;

    client.channels[0]?.emit({
      eventType: "DELETE",
      old: { id: "todo-1", planned_date: "2026-08-02" },
    });

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({ id: "todo-1", plannedDate: "2026-08-02" }),
    ]));
    expect(client.fromCalls).toBe(queryCountBeforeDelete + 1);
  });

  it("propagates Supabase errors unchanged", async () => {
    const error = new Error("network down");
    const client = new RecordingSupabaseClient([], { data: null, error });
    const repo = new SupabaseFlowRepository(client);

    await expect(repo.listTodos("2026-08-02")).rejects.toBe(error);
  });

  it("reads the browser-facing Vite public environment variables", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-key");

    expect(createSupabaseClient()).toBeDefined();
  });

  it("prefers Vite environment values over conflicting Node fallback values", () => {
    expect(mergeRuntimeEnv(
      {
        VITE_SUPABASE_URL: "https://vite.example.supabase.co",
        VITE_SUPABASE_ANON_KEY: "vite-public-key",
      },
      {
        VITE_SUPABASE_URL: "https://node.example.supabase.co",
        VITE_SUPABASE_ANON_KEY: "node-fallback-key",
      },
    )).toEqual({
      VITE_SUPABASE_URL: "https://vite.example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "vite-public-key",
    });
  });

  expectTypeOf<FlowRepository>().not.toHaveProperty("updateTopic");
  expectTypeOf<FlowRepository>().toHaveProperty("createTodo");
  expectTypeOf<FlowRepository>().toHaveProperty("listSuggestedTopics");
});
