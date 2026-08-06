import { describe, expect, it } from "vitest";

import type { Principal } from "../src/auth.ts";
import { PostgresFlowRepository } from "../src/repository.ts";

type Statement = { sql: string; values?: readonly unknown[]; executor: "pool" | "client" };

class RecordingDatabase {
  readonly statements: Statement[] = [];
  readonly rows = new Map<string, unknown[]>();
  failOn = "";

  private result(sql: string): { rows: unknown[]; rowCount: number } {
    if (this.failOn && sql.includes(this.failOn)) throw new Error("database failure");
    const entry = [...this.rows.entries()].find(([needle]) => sql.includes(needle));
    const rows = entry?.[1] ?? [];
    return { rows, rowCount: rows.length };
  }

  async query(sql: string, values?: readonly unknown[]) {
    this.statements.push({ sql, values, executor: "pool" });
    return this.result(sql);
  }

  async connect() {
    return {
      query: async (sql: string, values?: readonly unknown[]) => {
        this.statements.push({ sql, values, executor: "client" });
        return this.result(sql);
      },
      release() {},
    };
  }
}

const ownerA: Principal = {
  ownerId: "00000000-0000-0000-0000-000000000001",
  deviceId: "10000000-0000-4000-8000-000000000001",
};

const todoRow = {
  id: "20000000-0000-4000-8000-000000000001",
  title: "Carry forward",
  planned_date: "2026-08-06",
  planned_time: "09:30:00",
  is_completed: false,
  project_id: null,
  topic_card_id: null,
  old_planned_date: "2026-08-06",
};

function asPool(database: RecordingDatabase): ConstructorParameters<typeof PostgresFlowRepository>[0] {
  return database as unknown as ConstructorParameters<typeof PostgresFlowRepository>[0];
}

describe("PostgresFlowRepository", () => {
  it("scopes every to-do read and mutation to the authenticated owner with bound parameters", async () => {
    const database = new RecordingDatabase();
    database.rows.set("from todos", [todoRow]);
    const repository = new PostgresFlowRepository(asPool(database));

    await expect(repository.listTodos(ownerA, "2026-08-06")).resolves.toEqual([{
      id: todoRow.id,
      title: "Carry forward",
      plannedDate: "2026-08-06",
      plannedTime: "09:30",
      isCompleted: false,
      projectId: null,
      topicCardId: null,
    }]);
    await repository.updateTodo(ownerA, todoRow.id, { title: "Updated" });
    await repository.deleteTodo(ownerA, todoRow.id);

    const businessStatements = database.statements.filter(({ sql }) => /\b(todos|pg_notify)\b/.test(sql));
    expect(businessStatements).not.toHaveLength(0);
    for (const statement of businessStatements.filter(({ sql }) => sql.includes("todos"))) {
      expect(statement.sql).toMatch(/owner_id\s*=\s*\$1/);
      expect(statement.values?.[0]).toBe(ownerA.ownerId);
      expect(statement.sql).not.toContain(ownerA.ownerId);
    }
  });

  it("rolls incomplete to-dos forward in one transaction and notifies only after commit", async () => {
    const database = new RecordingDatabase();
    database.rows.set("update todos", [todoRow]);
    const repository = new PostgresFlowRepository(asPool(database));

    await expect(repository.rolloverIncompleteTodos(
      ownerA,
      "2026-08-05",
      "2026-08-06",
      "Asia/Shanghai",
    )).resolves.toEqual([expect.objectContaining({ id: todoRow.id, plannedDate: "2026-08-06" })]);

    expect(database.statements.map(({ sql }) => sql.trim())).toEqual([
      "begin",
      expect.stringMatching(/^update todos/),
      "commit",
      "select pg_notify($1, $2)",
      "select pg_notify($1, $2)",
    ]);
    expect(database.statements[1]?.values).toEqual([
      ownerA.ownerId,
      "2026-08-05",
      "2026-08-06",
    ]);
    expect(database.statements[3]?.values?.[1]).toBe(JSON.stringify({
      ownerId: ownerA.ownerId,
      date: "2026-08-05",
      todoId: todoRow.id,
      kind: "rollover",
    }));
    expect(database.statements[4]?.values?.[1]).toBe(JSON.stringify({
      ownerId: ownerA.ownerId,
      date: "2026-08-06",
      todoId: todoRow.id,
      kind: "rollover",
    }));
  });

  it("rolls back a failed rollover and publishes no event", async () => {
    const database = new RecordingDatabase();
    database.failOn = "update todos";
    const repository = new PostgresFlowRepository(asPool(database));

    await expect(repository.rolloverIncompleteTodos(
      ownerA,
      "2026-08-05",
      "2026-08-06",
      "Asia/Shanghai",
    )).rejects.toThrow("database failure");

    expect(database.statements.map(({ sql }) => sql.trim())).toEqual([
      "begin",
      expect.stringMatching(/^update todos/),
      "rollback",
    ]);
    expect(database.statements.some(({ sql }) => sql.includes("pg_notify"))).toBe(false);
  });

  it("writes an immutable Handoff and Topic continuity atomically under the owner", async () => {
    const database = new RecordingDatabase();
    database.rows.set("select id from sessions", [{ id: "30000000-0000-4000-8000-000000000001" }]);
    database.rows.set("insert into handoffs", [{
      id: "40000000-0000-4000-8000-000000000001",
      session_id: "30000000-0000-4000-8000-000000000001",
      topic_card_id: "50000000-0000-4000-8000-000000000001",
      content: "handoff",
      idempotency_key: "idempotency-1",
      created_at: "2026-08-06T00:00:00.000Z",
      generated_at: "2026-08-06T00:00:00.000Z",
    }]);
    const repository = new PostgresFlowRepository(asPool(database));

    await expect(repository.createHandoff(ownerA, {
      sessionId: "30000000-0000-4000-8000-000000000001",
      topicCardId: "50000000-0000-4000-8000-000000000001",
      content: "handoff",
      idempotencyKey: "idempotency-1",
      topicUpdate: { currentState: "ready", nextAction: "ship", openQuestions: [] },
    })).resolves.toMatchObject({ created: true, record: { idempotencyKey: "idempotency-1" } });

    expect(database.statements.map(({ sql }) => sql.trim())).toEqual([
      "begin",
      expect.stringMatching(/^select /),
      expect.stringMatching(/^select id from sessions/),
      expect.stringMatching(/^insert into handoffs/),
      expect.stringMatching(/^update topic_cards/),
      "commit",
    ]);
    for (const statement of database.statements.filter(({ sql }) => /sessions|handoffs|topic_cards/.test(sql))) {
      expect(statement.sql).toMatch(/owner_id\s*=\s*\$1|owner_id[,\s]/);
      expect(statement.values?.[0]).toBe(ownerA.ownerId);
    }
  });

  it("rolls back both Handoff and Topic continuity when the Topic update fails", async () => {
    const database = new RecordingDatabase();
    database.rows.set("select id from sessions", [{ id: "30000000-0000-4000-8000-000000000001" }]);
    database.rows.set("insert into handoffs", [{
      id: "40000000-0000-4000-8000-000000000001",
      session_id: "30000000-0000-4000-8000-000000000001",
      topic_card_id: "50000000-0000-4000-8000-000000000001",
      content: "handoff",
      idempotency_key: "idempotency-1",
      created_at: "2026-08-06T00:00:00.000Z",
      generated_at: "2026-08-06T00:00:00.000Z",
    }]);
    database.failOn = "update topic_cards";
    const repository = new PostgresFlowRepository(asPool(database));

    await expect(repository.createHandoff(ownerA, {
      sessionId: "30000000-0000-4000-8000-000000000001",
      topicCardId: "50000000-0000-4000-8000-000000000001",
      content: "handoff",
      idempotencyKey: "idempotency-1",
      topicUpdate: { nextAction: "ship" },
    })).rejects.toThrow("database failure");

    expect(database.statements.map(({ sql }) => sql.trim()).at(-1)).toBe("rollback");
    expect(database.statements.some(({ sql }) => sql.trim() === "commit")).toBe(false);
  });
});
