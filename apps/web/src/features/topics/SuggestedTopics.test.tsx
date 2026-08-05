import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import type { FlowRepository } from "@flowcontext/data";
import type { TopicCard } from "@flowcontext/domain";
import { AppProviders } from "../../app/AppProviders";
import { SuggestedTopics, rankSuggestedTopics } from "./SuggestedTopics";
import { webPlatform } from "../../platform/webPlatform";

const makeTopic = (id: string, overrides: Partial<TopicCard> = {}): TopicCard => ({
  id,
  projectId: "project-1",
  title: id,
  state: "open",
  currentState: "进行中",
  nextAction: "继续",
  openQuestions: [],
  lastActiveAt: "2026-08-02T08:00:00.000Z",
  ...overrides,
});

const fakeRepository: FlowRepository = {
  capabilities: { todoRollover: true },
  listTodos: async () => [],
  createTodo: async () => { throw new Error("not used"); },
  updateTodo: async () => { throw new Error("not used"); },
  deleteTodo: async () => undefined,
  rolloverIncompleteTodos: async () => [],
  subscribeTodos: () => () => undefined,
  listSuggestedTopics: async () => [],
  getTopicContext: async () => null,
  getDailyProjection: async () => null,
};

describe("SuggestedTopics", () => {
  it("ranks and displays at most three topic cards", async () => {
    const topics = [
      makeTopic("focus", { focusRank: 1 }),
      makeTopic("second", { focusRank: 2 }),
      makeTopic("third", { focusRank: 3 }),
      makeTopic("fourth", { focusRank: 4 }),
    ];
    const ranked = rankSuggestedTopics(topics, new Date("2026-08-02T12:00:00.000Z"));
    render(
      <AppProviders repository={fakeRepository} platform={webPlatform}>
        <SuggestedTopics topics={topics} />
      </AppProviders>,
    );
    expect(ranked.slice(0, 3).map((topic) => topic.id)).toEqual(["focus", "second", "third"]);
    expect(await screen.findAllByTestId("topic-card")).toHaveLength(3);
  });

  it("disables handed-off cards without a current device path", () => {
    const topic = makeTopic("handed-off", {
      latestHandoffId: "handoff-1",
    });
    render(
      <AppProviders repository={fakeRepository} platform={webPlatform}>
        <SuggestedTopics
          topics={[topic]}
          topicContexts={{
            [topic.id]: {
              latestHandoff: {
                id: "handoff-1",
                sessionId: "session-1",
                topicCardId: topic.id,
                content: "等待继续",
                idempotencyKey: "idem-1",
              },
            },
          }}
        />
      </AppProviders>,
    );
    expect(screen.getByText("先配置此设备项目路径")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续此主题" })).toBeDisabled();
  });

  it("loads production session context and opens the current Codex thread", async () => {
    const topic = makeTopic("production-topic");
    const openExternal = vi.fn(async () => undefined);
    const repository: FlowRepository = {
      ...fakeRepository,
      listSuggestedTopics: async () => [topic],
      getTopicContext: async () => ({
        topic,
        latestSession: {
          id: "session-1",
          topicCardId: topic.id,
          codexThreadId: "thread-123",
          deviceId: "mac-1",
          workspacePath: "/Users/camus/项目/Alpha",
          startedAt: "2026-08-02T08:00:00.000Z",
        },
        latestHandoff: null,
        currentWorkspace: null,
      }),
    };
    render(
      <AppProviders repository={repository} platform={{ ...webPlatform, deviceId: "mac-1", openExternal }}>
        <SuggestedTopics deviceId="mac-1" />
      </AppProviders>,
    );
    const button = await screen.findByRole("button", { name: "打开当前任务" });
    await userEvent.click(button);
    expect(openExternal).toHaveBeenCalledWith("codex://threads/thread-123");
  });

  it("opens an existing thread even when the device is not configured", async () => {
    const topic = makeTopic("unconfigured-device-topic");
    const openExternal = vi.fn(async () => undefined);
    const repository: FlowRepository = {
      ...fakeRepository,
      listSuggestedTopics: async () => [topic],
      getTopicContext: async (_topicId, requestedDeviceId) => {
        expect(requestedDeviceId).toBeUndefined();
        return {
          topic,
          latestSession: {
            id: "session-1",
            topicCardId: topic.id,
            codexThreadId: "thread-no-device",
            deviceId: "mac-1",
            workspacePath: "/Users/camus/项目/Alpha",
            startedAt: "2026-08-02T08:00:00.000Z",
          },
          latestHandoff: null,
          currentWorkspace: null,
        };
      },
    };
    render(
      <AppProviders
        repository={repository}
        platform={{ ...webPlatform, deviceId: undefined, openExternal }}
        queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SuggestedTopics />
      </AppProviders>,
    );
    const button = await screen.findByRole("button", { name: "打开当前任务" });
    await userEvent.click(button);
    expect(openExternal).toHaveBeenCalledWith("codex://threads/thread-no-device");
  });
});
