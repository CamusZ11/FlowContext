import { afterEach, describe, expect, it, vi } from "vitest";
import type { Todo, TodoCreate } from "@flowcontext/domain";
import { HttpFlowRepository } from "./HttpFlowRepository.ts";
import { HttpError } from "./httpTransport.ts";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function controlledStream(): {
  response: Response;
  push(chunk: string): void;
  close(): void;
} {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    cancel() {
      streamController = undefined;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    push(chunk) {
      streamController?.enqueue(encoder.encode(chunk));
    },
    close() {
      streamController?.close();
      streamController = undefined;
    },
  };
}

const todo: Todo = {
  id: "todo-1",
  title: "任务",
  plannedDate: "2026-08-03",
  plannedTime: null,
  isCompleted: false,
  projectId: null,
  topicCardId: null,
};

describe("HttpFlowRepository", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses camelCase JSON, Bearer and preserves HH:mm/null", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([todo]))
      .mockResolvedValueOnce(jsonResponse({ ...todo, plannedTime: "09:30" }));
    const repo = new HttpFlowRepository({
      baseUrl: "https://flowcontext.example.com/",
      getAccessToken: async () => "session-token",
      fetchImpl,
    });

    await expect(repo.listTodos("2026-08-03")).resolves.toEqual([
      expect.objectContaining({ plannedTime: null }),
    ]);
    await repo.updateTodo("todo-1", { plannedTime: "09:30" });

    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({
        Authorization: "Bearer session-token",
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ plannedTime: "09:30" }),
    }));
  });

  it("rejects rollover because the self-hosted provider has no atomic rollover endpoint", async () => {
    const fetchImpl = vi.fn();
    const repo = new HttpFlowRepository({
      baseUrl: "https://flowcontext.example.com",
      getAccessToken: () => "session-token",
      fetchImpl,
    });

    await expect(repo.rolloverIncompleteTodos("2026-08-04", "2026-08-05")).rejects.toThrow(
      "rolloverIncompleteTodos is not supported by the self-hosted provider",
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps every FlowRepository route and omits undefined patch fields", async () => {
    const topic = {
      id: "topic-1",
      projectId: "project-1",
      title: "继续",
      state: "open",
      currentState: "就绪",
      nextAction: "执行",
      openQuestions: [],
      latestHandoffId: null,
      lastActiveAt: "2026-08-03T08:00:00.000Z",
      focusRank: null,
      resurfaceAt: null,
      resurfaceCondition: null,
    };
    const context = {
      topic,
      latestSession: null,
      latestHandoff: null,
      currentWorkspace: null,
    };
    const projection = {
      date: "2026-08-03",
      dailyLens: "专注",
      projects: [],
      macReport: null,
      windowsReport: null,
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ...todo, id: "created" }, 201))
      .mockResolvedValueOnce(jsonResponse({ ...todo, title: "更新" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([topic]))
      .mockResolvedValueOnce(jsonResponse(context))
      .mockResolvedValueOnce(jsonResponse(projection));
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "t", fetchImpl });

    const createInput: TodoCreate = {
      title: todo.title,
      plannedDate: todo.plannedDate,
      plannedTime: todo.plannedTime,
      isCompleted: todo.isCompleted,
      projectId: todo.projectId,
      topicCardId: todo.topicCardId,
    };
    await repo.createTodo(createInput);
    await repo.updateTodo("todo-1", { title: "更新", plannedTime: null, projectId: undefined });
    await repo.deleteTodo("todo-1");
    await repo.listSuggestedTopics(12);
    await repo.getTopicContext("topic-1");
    await repo.getDailyProjection("2026-08-03");

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://flowcontext.example.com/v1/todos");
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "POST", body: JSON.stringify({
      title: "任务",
      plannedDate: "2026-08-03",
      plannedTime: null,
      isCompleted: false,
      projectId: null,
      topicCardId: null,
    }) }));
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe("https://flowcontext.example.com/v1/todos/todo-1");
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ body: JSON.stringify({ title: "更新", plannedTime: null }) }));
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe("https://flowcontext.example.com/v1/todos/todo-1");
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe("https://flowcontext.example.com/v1/topics?limit=12");
    expect(String(fetchImpl.mock.calls[4]?.[0])).toBe("https://flowcontext.example.com/v1/topics/topic-1/context");
    expect(String(fetchImpl.mock.calls[5]?.[0])).toBe("https://flowcontext.example.com/v1/daily-projections/2026-08-03");
  });

  it("omits missing deviceId and URL-encodes a supplied deviceId", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(null)));
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "t", fetchImpl });

    await repo.getTopicContext("topic/1");
    await repo.getTopicContext("topic/1", "mac/device 一&二");

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://flowcontext.example.com/v1/topics/topic%2F1/context");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("deviceId=mac%2Fdevice+%E4%B8%80%26%E4%BA%8C");
  });

  it("rejects invalid response dates and non-HH:mm times without truncating", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ ...todo, plannedDate: "2026-02-30" }]))
      .mockResolvedValueOnce(jsonResponse([{ ...todo, plannedTime: "09:30:00" }]));
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => null, fetchImpl });

    await expect(repo.listTodos("2026-08-03")).rejects.toMatchObject({ code: "invalid_date" });
    await expect(repo.listTodos("2026-08-03")).rejects.toMatchObject({ code: "invalid_plannedTime" });
  });

  it("maps non-2xx error codes without leaking response bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_credentials", secret: "do-not-leak" }), { status: 401 }));
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "opaque", fetchImpl });

    await expect(repo.listTodos("2026-08-03")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ code: "invalid_credentials", status: 401 });
      expect(String(error)).not.toContain("do-not-leak");
      expect(String(error)).not.toContain("opaque");
      return true;
    });
  });

  it("parses arbitrary chunks, CRLF, comments and multiple frames", async () => {
    vi.useFakeTimers();
    const controlled = controlledStream();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([todo]))
      .mockResolvedValueOnce(controlled.response)
      .mockResolvedValue(jsonResponse([todo]));
    const listener = vi.fn();
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "t", fetchImpl });
    const cleanup = repo.subscribeTodos("2026-08-03", listener);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(listener).toHaveBeenCalledTimes(1);

    controlled.push("event: todo.ch");
    controlled.push("anged\r\nid: 1\r\ndata: {\"date\":\"2026-08-03\",\r\n");
    controlled.push("data: \"todoId\":\"todo-1\",\"kind\":\"upsert\"}\r\n\r\n: ping\r\n\r\n");
    controlled.push("event: todo.changed\n\ndata: {\"date\":\"2026-08-03\",\"todoId\":\"todo-1\",\"kind\":\"delete\"}\n\n");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ Accept: "application/json" }),
    }));
    cleanup();
  });

  it("refreshes again when another event arrives during an in-flight refresh", async () => {
    const firstStream = controlledStream();
    const firstRefresh = deferred<Response>();
    const secondRefresh = deferred<Response>();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([todo]))
      .mockResolvedValueOnce(firstStream.response)
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise);
    const listener = vi.fn();
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "t", fetchImpl });
    const cleanup = repo.subscribeTodos("2026-08-03", listener);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    firstStream.push("event: todo.changed\ndata: {\"date\":\"2026-08-03\",\"todoId\":\"todo-1\",\"kind\":\"upsert\"}\n\n");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    firstStream.push("event: todo.changed\ndata: {\"date\":\"2026-08-03\",\"todoId\":\"todo-1\",\"kind\":\"upsert\"}\n\n");
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    firstRefresh.resolve(jsonResponse([{ ...todo, title: "旧快照" }]));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
    secondRefresh.resolve(jsonResponse([{ ...todo, title: "新快照" }]));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(3));
    expect(listener.mock.calls.at(-1)?.[0]).toEqual([expect.objectContaining({ title: "新快照" })]);
    cleanup();
  });

  it("retries a closed SSE after full GET with 1/2/4/8 second backoff", async () => {
    vi.useFakeTimers();
    const first = controlledStream();
    const second = controlledStream();
    const third = controlledStream();
    const fourth = controlledStream();
    const fifth = controlledStream();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([todo]))
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(jsonResponse([{ ...todo, title: "retry-1" }]))
      .mockResolvedValueOnce(second.response)
      .mockResolvedValueOnce(jsonResponse([{ ...todo, title: "retry-2" }]))
      .mockResolvedValueOnce(third.response)
      .mockResolvedValueOnce(jsonResponse([{ ...todo, title: "retry-3" }]))
      .mockResolvedValueOnce(fourth.response)
      .mockResolvedValueOnce(jsonResponse([{ ...todo, title: "retry-4" }]))
      .mockResolvedValueOnce(fifth.response);
    const listener = vi.fn();
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "t", fetchImpl });
    const cleanup = repo.subscribeTodos("2026-08-03", listener);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    first.close();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
    second.close();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(6));
    third.close();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(8));
    fourth.close();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(10));
    expect(listener).toHaveBeenCalledTimes(5);
    cleanup();
  });

  it("retries non-401 full GET, SSE and invalid JSON failures without notifying", async () => {
    vi.useFakeTimers();
    const stream = controlledStream();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "server_busy" }), { status: 503 }))
      .mockResolvedValueOnce(jsonResponse([todo]))
      .mockRejectedValueOnce(new Error("sse-offline"))
      .mockResolvedValueOnce(jsonResponse([todo]))
      .mockResolvedValueOnce(stream.response);
    const listener = vi.fn();
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "t", fetchImpl });
    const cleanup = repo.subscribeTodos("2026-08-03", listener);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(listener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(listener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(5));
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8000);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(7));
    expect(listener).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("stops immediately on 401 from full GET or SSE", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }));
    const listener = vi.fn();
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "expired", fetchImpl });
    const cleanup = repo.subscribeTodos("2026-08-03", listener);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    cleanup();
  });

  it("stops immediately on an SSE 401 response", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([todo]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }));
    const listener = vi.fn();
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "expired", fetchImpl });
    const cleanup = repo.subscribeTodos("2026-08-03", listener);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("serializes refreshes and ignores stale generations", async () => {
    vi.useFakeTimers();
    const staleEventGet = deferred<Response>();
    const firstStream = controlledStream();
    const secondStream = controlledStream();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ ...todo, title: "initial" }]))
      .mockResolvedValueOnce(firstStream.response)
      .mockReturnValueOnce(staleEventGet.promise)
      .mockResolvedValueOnce(jsonResponse([{ ...todo, title: "new" }]))
      .mockResolvedValueOnce(secondStream.response);
    const listener = vi.fn();
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "t", fetchImpl });
    const cleanup = repo.subscribeTodos("2026-08-03", listener);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    firstStream.push("event: todo.changed\ndata: {\"date\":\"2026-08-03\",\"todoId\":\"todo-1\",\"kind\":\"upsert\"}\n\n");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    firstStream.close();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(5));
    staleEventGet.resolve(jsonResponse([{ ...todo, title: "stale" }]));
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.at(-1)?.[0]).toEqual([expect.objectContaining({ title: "new" })]);
    cleanup();
  });

  it("makes cleanup idempotent and aborts the current request only once", async () => {
    const originalAbort = AbortController.prototype.abort;
    const abort = vi.spyOn(AbortController.prototype, "abort");
    const pending = deferred<Response>();
    const fetchImpl = vi.fn().mockReturnValue(pending.promise);
    const repo = new HttpFlowRepository({ baseUrl: "https://flowcontext.example.com", getAccessToken: () => "t", fetchImpl });
    const cleanup = repo.subscribeTodos("2026-08-03", () => undefined);
    cleanup();
    cleanup();
    expect(abort).toHaveBeenCalledTimes(1);
    abort.mockRestore();
    AbortController.prototype.abort = originalAbort;
    pending.reject(new DOMException("aborted", "AbortError"));
  });
});
