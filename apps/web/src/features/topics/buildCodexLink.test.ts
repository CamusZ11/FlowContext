import { buildCodexLink } from "./buildCodexLink";

const base = {
  id: "topic-1",
  projectId: "project-1",
  title: "Alpha",
  state: "open" as const,
  currentState: "进行中",
  nextAction: "下一步检查测试",
  openQuestions: [],
  lastActiveAt: "2026-08-02T08:00:00.000Z",
};

describe("Codex deep links", () => {
  it("opens the current thread when no handoff exists", () => {
    expect(buildCodexLink({ ...base, codexThreadId: "thread-123" })).toBe("codex://threads/thread-123");
  });

  it("encodes path and handoff for a new task", () => {
    const link = buildCodexLink({
      ...base,
      latestHandoff: {
        id: "handoff-1",
        sessionId: "session-1",
        topicCardId: base.id,
        content: "停在 API 测试，下一步运行回归。",
        idempotencyKey: "idem-1",
      },
      currentWorkspace: {
        deviceId: "mac-1",
        platform: "macos",
        projectId: base.projectId,
        workspacePath: "/Users/camus/项目/Alpha",
      },
    });
    expect(link).toContain("codex://new?");
    expect(new URL(link!).searchParams.get("path")).toBe("/Users/camus/项目/Alpha");
    expect(new URL(link!).searchParams.get("prompt")).toContain("下一步");
  });

  it("does not guess a path from another device session", () => {
    expect(buildCodexLink({
      ...base,
      latestSession: {
        id: "session-1",
        topicCardId: base.id,
        codexThreadId: "thread-old",
        deviceId: "windows-1",
        platform: "windows",
        workspacePath: "F:/项目/Alpha",
        startedAt: "2026-08-02T08:00:00.000Z",
      },
      latestHandoff: {
        id: "handoff-1",
        sessionId: "session-1",
        topicCardId: base.id,
        content: "等待继续",
        idempotencyKey: "idem-1",
      },
    })).toBeNull();
  });
});
