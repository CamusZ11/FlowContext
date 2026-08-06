import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type { Principal } from "../src/auth.ts";
import { ApiError } from "../src/errors.ts";
import { runMigrations } from "../src/migrate.ts";
import { PostgresFlowRepository } from "../src/repository.ts";
import { PostgresTodoEventSource, type TodoEvent } from "../src/sse.ts";

const enabled = process.env.FLOWCONTEXT_RUN_POSTGRES_TESTS === "1";

function disposableDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for the disposable PostgreSQL test");
  const url = new URL(raw);
  if (!(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "55432" && url.pathname === "/flowcontext_test")) {
    throw new Error("refusing non-disposable DATABASE_URL; expected localhost:55432/flowcontext_test");
  }
  return raw;
}

const owner: Principal = {
  ownerId: "00000000-0000-4000-8000-000000000001",
  deviceId: "10000000-0000-4000-8000-000000000001",
};
const otherOwner: Principal = {
  ownerId: "00000000-0000-4000-8000-000000000002",
  deviceId: "10000000-0000-4000-8000-000000000002",
};
const projectId = "20000000-0000-4000-8000-000000000001";

describe.runIf(enabled)("PostgresFlowRepository against disposable PostgreSQL", () => {
  let pool: Pool;
  let repository: PostgresFlowRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: disposableDatabaseUrl() });
    await pool.query("drop extension if exists pgcrypto cascade");
    await pool.query("drop schema public cascade");
    await pool.query("create schema public");
    const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
    await expect(runMigrations(pool, migrations)).resolves.toEqual(["001_core.sql", "002_api_constraints.sql"]);
    repository = new PostgresFlowRepository(pool);
  });

  beforeEach(async () => {
    await pool.query("truncate table device_enrollments, owners cascade");
    await pool.query("insert into owners (id) values ($1)", [owner.ownerId]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function seedProject(): Promise<void> {
    await repository.upsertProjectProjection(owner, projectId, {
      id: projectId,
      projectKey: "flowcontext",
      title: "FlowContext",
      lifecycleStatus: "active",
      summary: "",
      nextAction: "ship",
      lastSyncedAt: null,
    });
  }

  it("applies schema constraints and preserves PostgreSQL date/time types under owner isolation", async () => {
    await seedProject();
    const created = await repository.createTodo(owner, {
      title: "real row",
      plannedDate: "2026-08-05",
      plannedTime: "09:30",
      isCompleted: false,
      projectId,
      topicCardId: null,
    });

    expect(created).toMatchObject({ plannedDate: "2026-08-05", plannedTime: "09:30", projectId });
    await expect(repository.listTodos(owner, "2026-08-05")).resolves.toEqual([created]);
    await expect(repository.listTodos(otherOwner, "2026-08-05")).resolves.toEqual([]);
    await expect(repository.createTodo(owner, {
      title: "seconds forbidden",
      plannedDate: "2026-08-05",
      plannedTime: "09:30:30" as "09:30",
      isCompleted: false,
      projectId,
      topicCardId: null,
    })).rejects.toEqual(expect.objectContaining<ApiError>({ statusCode: 422, code: "invalid_request" }));
  });

  it("rolls only incomplete rows in one real transaction", async () => {
    await seedProject();
    const incomplete = await repository.createTodo(owner, {
      title: "move",
      plannedDate: "2026-08-05",
      plannedTime: null,
      isCompleted: false,
      projectId,
      topicCardId: null,
    });
    const completed = await repository.createTodo(owner, {
      title: "stay",
      plannedDate: "2026-08-05",
      plannedTime: null,
      isCompleted: true,
      projectId,
      topicCardId: null,
    });

    await expect(repository.rolloverIncompleteTodos(owner, "2026-08-05", "2026-08-06", "Asia/Shanghai"))
      .resolves.toEqual([expect.objectContaining({ id: incomplete.id, plannedDate: "2026-08-06" })]);
    await expect(repository.listTodos(owner, "2026-08-05")).resolves.toEqual([completed]);
    await expect(repository.listTodos(owner, "2026-08-06")).resolves.toEqual([
      expect.objectContaining({ id: incomplete.id }),
    ]);
  });

  it("rolls back the immutable Handoff when the Topic continuity update fails", async () => {
    await seedProject();
    const topic = await repository.createTopic(owner, { projectId, title: "Topic" });
    expect(topic).not.toBeNull();
    const session = await repository.createSession(owner, {
      topicCardId: topic!.id,
      codexThreadId: "thread-real-postgres",
      deviceId: owner.deviceId,
      workspacePath: "/tmp/flowcontext-test",
    });
    expect(session).not.toBeNull();
    await pool.query(`
      create function fail_topic_update() returns trigger language plpgsql as $$
      begin
        raise exception 'forced topic update failure';
      end;
      $$;
      create trigger fail_topic_update before update on topic_cards
      for each row execute function fail_topic_update();
    `);

    await expect(repository.createHandoff(owner, {
      sessionId: session!.id,
      topicCardId: topic!.id,
      content: "must roll back",
      idempotencyKey: "rollback-real-postgres",
      topicUpdate: { nextAction: "never committed" },
    })).rejects.toThrow("forced topic update failure");
    const persisted = await pool.query(
      "select id from handoffs where owner_id = $1 and idempotency_key = $2",
      [owner.ownerId, "rollback-real-postgres"],
    );
    expect(persisted.rowCount).toBe(0);
  });

  it("delivers a real committed NOTIFY through LISTEN with typed payload", async () => {
    await seedProject();
    const eventSource = new PostgresTodoEventSource(pool);
    let resolveEvent!: (event: TodoEvent) => void;
    const received = new Promise<TodoEvent>((resolve) => { resolveEvent = resolve; });
    const unsubscribe = await eventSource.subscribe(owner.ownerId, "2026-08-06", resolveEvent);
    try {
      const todo = await repository.createTodo(owner, {
        title: "notify",
        plannedDate: "2026-08-06",
        plannedTime: null,
        isCompleted: false,
        projectId,
        topicCardId: null,
      });
      const event = await Promise.race([
        received,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("NOTIFY timeout")), 2_000)),
      ]);
      expect(event).toEqual({ ownerId: owner.ownerId, date: "2026-08-06", todoId: todo.id, kind: "upsert" });
    } finally {
      await unsubscribe();
    }
  });
});
