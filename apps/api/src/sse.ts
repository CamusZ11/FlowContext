import type { ServerResponse } from "node:http";
import type { Pool, PoolClient, Notification } from "pg";

export const TODO_EVENT_CHANNEL = "flowcontext_todo_events";

export type TodoEventKind = "upsert" | "delete" | "rollover";

export interface TodoEvent {
  ownerId: string;
  date: string;
  todoId: string | null;
  kind: TodoEventKind;
}

export interface TodoEventSource {
  subscribe(ownerId: string, date: string, listener: (event: TodoEvent) => void): Promise<() => void | Promise<void>>;
}

function isTodoEvent(value: unknown): value is TodoEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.ownerId === "string"
    && typeof event.date === "string"
    && (typeof event.todoId === "string" || event.todoId === null)
    && (event.kind === "upsert" || event.kind === "delete" || event.kind === "rollover");
}

export class PostgresTodoEventSource implements TodoEventSource {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async subscribe(ownerId: string, date: string, listener: (event: TodoEvent) => void): Promise<() => Promise<void>> {
    const client = await this.pool.connect() as PoolClient;
    const onNotification = (notification: Notification): void => {
      if (notification.channel !== TODO_EVENT_CHANNEL || !notification.payload) return;
      try {
        const event: unknown = JSON.parse(notification.payload);
        if (isTodoEvent(event) && event.ownerId === ownerId && event.date === date) listener(event);
      } catch {
        // A malformed notification is ignored; the next reconnect performs a full GET.
      }
    };
    client.on("notification", onNotification);
    try {
      await client.query(`listen ${TODO_EVENT_CHANNEL}`);
    } catch (error) {
      client.off("notification", onNotification);
      client.release();
      throw error;
    }
    let closed = false;
    return async () => {
      if (closed) return;
      closed = true;
      client.off("notification", onNotification);
      try {
        await client.query(`unlisten ${TODO_EVENT_CHANNEL}`);
      } finally {
        client.release();
      }
    };
  }
}

export function formatTodoEvent(event: TodoEvent): string {
  return `event: todo.changed\ndata: ${JSON.stringify({ date: event.date, todoId: event.todoId, kind: event.kind })}\n\n`;
}

type StreamResponse = Pick<ServerResponse, "writeHead" | "write" | "once">;

export async function openTodoEventStream(
  response: StreamResponse,
  source: TodoEventSource,
  ownerId: string,
  date: string,
  heartbeatMilliseconds = 15_000,
): Promise<void> {
  let unsubscribe: (() => void | Promise<void>) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let headersEstablished = false;
  const bufferedEvents: TodoEvent[] = [];
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    if (unsubscribe) void Promise.resolve(unsubscribe()).catch(() => undefined);
  };
  response.once("close", close);
  response.once("error", close);

  unsubscribe = await source.subscribe(ownerId, date, (event) => {
    if (closed) return;
    if (!headersEstablished) bufferedEvents.push(event);
    else response.write(formatTodoEvent(event));
  });
  if (closed) {
    await unsubscribe();
    return;
  }
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  headersEstablished = true;
  response.write(": connected\n\n");
  for (const event of bufferedEvents) response.write(formatTodoEvent(event));
  heartbeat = setInterval(() => response.write(": ping\n\n"), heartbeatMilliseconds);
}
