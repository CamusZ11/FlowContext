import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostgresTodoEventSource, formatTodoEvent, openTodoEventStream } from "../src/sse.ts";

class RawResponse extends PassThrough {
  readonly headers: Record<string, string> = {};
  statusCode = 0;

  writeHead(statusCode: number, headers: Record<string, string>) {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
    return this;
  }
}

describe("to-do SSE", () => {
  afterEach(() => vi.useRealTimers());

  it("writes valid event-stream frames and periodic comments, then cleans up on disconnect", async () => {
    vi.useFakeTimers();
    const raw = new RawResponse();
    let listener: ((event: { ownerId: string; date: string; todoId: string | null; kind: string }) => void) | undefined;
    const cleanup = vi.fn();
    const source = {
      async subscribe(_ownerId: string, _date: string, next: typeof listener) {
        listener = next;
        return cleanup;
      },
    };
    let output = "";
    raw.on("data", (chunk) => { output += String(chunk); });

    await openTodoEventStream(raw, source, "owner-1", "2026-08-06", 10_000);
    listener?.({ ownerId: "owner-1", date: "2026-08-06", todoId: "todo-1", kind: "upsert" });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(raw.statusCode).toBe(200);
    expect(raw.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(output).toContain(": connected\n\n");
    expect(output).toContain("event: todo.changed\n");
    expect(output).toContain("data: {\"date\":\"2026-08-06\",\"todoId\":\"todo-1\",\"kind\":\"upsert\"}\n\n");
    expect(output).toContain(": ping\n\n");

    raw.emit("close");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("LISTENs once, filters notifications by owner and date, and releases on cleanup", async () => {
    const client = new EventEmitter() as EventEmitter & {
      query(sql: string): Promise<unknown>;
      release: ReturnType<typeof vi.fn>;
    };
    const queries: string[] = [];
    client.query = async (sql) => { queries.push(sql); return { rows: [], rowCount: 0 }; };
    client.release = vi.fn();
    const source = new PostgresTodoEventSource({ async connect() { return client; } });
    const received: unknown[] = [];

    const cleanup = await source.subscribe("owner-1", "2026-08-06", (event) => received.push(event));
    client.emit("notification", { channel: "flowcontext_todo_events", payload: JSON.stringify({ ownerId: "owner-2", date: "2026-08-06", todoId: "other", kind: "upsert" }) });
    client.emit("notification", { channel: "flowcontext_todo_events", payload: JSON.stringify({ ownerId: "owner-1", date: "2026-08-05", todoId: "old", kind: "upsert" }) });
    client.emit("notification", { channel: "flowcontext_todo_events", payload: JSON.stringify({ ownerId: "owner-1", date: "2026-08-06", todoId: "todo-1", kind: "delete" }) });
    await cleanup();

    expect(received).toEqual([{ ownerId: "owner-1", date: "2026-08-06", todoId: "todo-1", kind: "delete" }]);
    expect(queries).toEqual(["listen flowcontext_todo_events", "unlisten flowcontext_todo_events"]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("releases a listener when the client disconnects while LISTEN is still starting", async () => {
    const raw = new RawResponse();
    const cleanup = vi.fn();
    let finishSubscribe!: (value: () => void) => void;
    const source = {
      subscribe: () => new Promise<() => void>((resolve) => { finishSubscribe = resolve; }),
    };

    const opening = openTodoEventStream(raw, source, "owner-1", "2026-08-06");
    raw.emit("close");
    finishSubscribe(cleanup);
    await opening;

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("formats no owner identifier into the client-visible frame", () => {
    expect(formatTodoEvent({ ownerId: "owner-secret", date: "2026-08-06", todoId: null, kind: "rollover" })).toBe(
      "event: todo.changed\ndata: {\"date\":\"2026-08-06\",\"todoId\":null,\"kind\":\"rollover\"}\n\n",
    );
  });
});
