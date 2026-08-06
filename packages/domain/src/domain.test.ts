import { describe, expect, it } from "vitest";
import {
  assertExplicitTopicCompletion,
  handoffUpdateSchema,
  isoDateSchema,
  sessionSchema,
  sortTodosForDate,
  timeSchema,
  topicCardSchema,
} from "./index.ts";

describe("FlowContext invariants", () => {
  it("rejects implicit topic completion", () => {
    expect(() => assertExplicitTopicCompletion(false)).toThrow("explicit topic completion required");
  });

  it("accepts an explicitly confirmed topic completion", () => {
    expect(() => assertExplicitTopicCompletion(true)).not.toThrow();
  });

  it("orders timed, untimed, then completed todos and excludes other dates", () => {
    const rows = [
      { id: "other-date", plannedDate: "2026-08-03", plannedTime: "08:00", isCompleted: false, title: "tomorrow" },
      { id: "3", plannedDate: "2026-08-02", plannedTime: null, isCompleted: false, title: "later" },
      { id: "2", plannedDate: "2026-08-02", plannedTime: "14:00", isCompleted: false, title: "afternoon" },
      { id: "1", plannedDate: "2026-08-02", plannedTime: "09:00", isCompleted: true, title: "done" },
    ];

    expect(sortTodosForDate(rows, "2026-08-02").map((row) => row.id)).toEqual(["2", "3", "1"]);
  });

  it("validates calendar dates rather than only matching a date-shaped string", () => {
    expect(isoDateSchema.safeParse("2026-08-02").success).toBe(true);
    expect(isoDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-8-2").success).toBe(false);
  });

  it("validates optional clock times in 24-hour HH:mm form", () => {
    expect(timeSchema.safeParse("09:05").success).toBe(true);
    expect(timeSchema.safeParse(null).success).toBe(true);
    expect(timeSchema.safeParse("24:00").success).toBe(false);
    expect(timeSchema.safeParse("9:05").success).toBe(false);
  });

  it("requires every topic card to belong to a project", () => {
    expect(
      topicCardSchema.safeParse({
        id: "topic-1",
        title: "A topic",
        state: "open",
        currentState: "",
        nextAction: "",
        openQuestions: [],
        lastActiveAt: "2026-08-02T08:00:00.000Z",
      }).success,
    ).toBe(false);

    expect(
      topicCardSchema.safeParse({
        id: "topic-1",
        projectId: "project-1",
        title: "A topic",
        state: "open",
        currentState: "",
        nextAction: "",
        openQuestions: [],
        lastActiveAt: "2026-08-02T08:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("requires every topic card to carry a valid last-active timestamp", () => {
    const withoutLastActiveAt = {
      id: "topic-1",
      projectId: "project-1",
      title: "A topic",
      state: "open" as const,
      currentState: "",
      nextAction: "",
      openQuestions: [],
    };

    expect(topicCardSchema.safeParse(withoutLastActiveAt).success).toBe(false);
    expect(
      topicCardSchema.safeParse({
        ...withoutLastActiveAt,
        lastActiveAt: "2026-08-02T08:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("requires a Session to preserve its device platform", () => {
    const session = {
      id: "session-1",
      topicCardId: "topic-1",
      codexThreadId: "thread-1",
      deviceId: "device-1",
      workspacePath: "/workspace/FlowContext",
      startedAt: "2026-08-06T00:00:00.000Z",
    };

    expect(sessionSchema.safeParse({ ...session, platform: "windows" }).success).toBe(true);
    expect(sessionSchema.safeParse(session).success).toBe(false);
    expect(sessionSchema.safeParse({ ...session, platform: "linux" }).success).toBe(false);
  });

  it("rejects topic state and project lifecycle fields from handoff updates", () => {
    expect(handoffUpdateSchema.safeParse({ topicState: "done" }).success).toBe(false);
    expect(handoffUpdateSchema.safeParse({ lifecycleStatus: "done" }).success).toBe(false);
    expect(handoffUpdateSchema.safeParse({ projectLifecycleStatus: "done" }).success).toBe(false);
    expect(handoffUpdateSchema.safeParse({ currentState: "paused", nextAction: "resume" }).success).toBe(true);
  });
});
