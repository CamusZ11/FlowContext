import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FlowRepository } from "@flowcontext/data";
import type { Todo } from "@flowcontext/domain";
import type { PlatformPort } from "../../platform/PlatformPort";
import { AppProviders } from "../../app/AppProviders";
import { PlatformProvider } from "../../app/PlatformContext";
import { RepositoryProvider } from "../../app/RepositoryContext";
import { TodoSection } from "./TodoSection";
import { webPlatform } from "../../platform/webPlatform";

const date = "2026-08-02";
const seed: Todo[] = [
  { id: "untimed", title: "无时刻任务", plannedDate: date, plannedTime: null, isCompleted: false, projectId: null, topicCardId: null },
  { id: "timed", title: "上午任务", plannedDate: date, plannedTime: "09:00", isCompleted: false, projectId: null, topicCardId: null },
  { id: "done", title: "done task", plannedDate: date, plannedTime: "08:00", isCompleted: true, projectId: null, topicCardId: null },
];

function renderTodoSection(options: {
  date?: string;
  platform?: PlatformPort;
  updateTodo?: FlowRepository["updateTodo"];
  subscribeTodos?: FlowRepository["subscribeTodos"];
  rolloverIncompleteTodos?: FlowRepository["rolloverIncompleteTodos"];
} = {}) {
  let rows = [...seed];
  const repository: FlowRepository = {
    listTodos: async () => rows,
    createTodo: async (input) => {
      const todo = { ...input, id: "new" };
      rows = [...rows, todo];
      return todo;
    },
    updateTodo: options.updateTodo ?? (async (id, patch) => {
      rows = rows.map((row) => row.id === id ? { ...row, ...patch } : row);
      return rows.find((row) => row.id === id)!;
    }),
    deleteTodo: async (id) => { rows = rows.filter((row) => row.id !== id); },
    rolloverIncompleteTodos: options.rolloverIncompleteTodos ?? (async () => []),
    subscribeTodos: options.subscribeTodos ?? (() => () => undefined),
    listSuggestedTopics: async () => [],
    getTopicContext: async () => null,
    getDailyProjection: async () => null,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider value={repository}>
        <PlatformProvider value={options.platform ?? webPlatform}>
          <TodoSection date={options.date ?? date} />
        </PlatformProvider>
      </RepositoryProvider>
    </QueryClientProvider>,
  );
}

describe("TodoSection", () => {
  it("shows timed, untimed, then completed todos", async () => {
    renderTodoSection();
    const rows = await screen.findAllByTestId("todo-row");
    expect(rows.map((row) => row.dataset.todoId)).toEqual(["timed", "untimed", "done"]);
    expect(screen.getByText("done task")).toHaveClass("completed");
    expect(screen.getByRole("button", { name: "编辑 上午任务" })).toHaveAttribute("data-icon-button", "true");
    expect(screen.getByRole("button", { name: "删除 上午任务" })).toHaveAttribute("data-icon-button", "true");
  });

  it("keeps the old checkbox value when the server rejects", async () => {
    renderTodoSection({ updateTodo: async () => { throw new Error("network"); } });
    const checkbox = await screen.findByRole("checkbox", { name: "完成 上午任务" });
    await userEvent.click(checkbox);
    expect(await screen.findByText("保存失败，请重试")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "完成 上午任务" })).not.toBeChecked();
  });

  it("checks a todo immediately while the server update is pending", async () => {
    let resolveUpdate: (() => void) | undefined;
    renderTodoSection({ updateTodo: () => new Promise((resolve) => { resolveUpdate = () => resolve(seed[1]); }) });
    const checkbox = await screen.findByRole("checkbox", { name: "完成 上午任务" });
    await userEvent.click(checkbox);
    expect(await screen.findByRole("checkbox", { name: "完成 上午任务" })).toBeChecked();
    resolveUpdate?.();
  });

  it("keeps the optimistic checked state when a stale subscription arrives", async () => {
    let resolveUpdate: (() => void) | undefined;
    let notify: ((todos: Todo[]) => void) | undefined;
    renderTodoSection({
      updateTodo: () => new Promise((resolve) => { resolveUpdate = () => resolve(seed[1]); }),
      subscribeTodos: (_date, listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    const checkbox = await screen.findByRole("checkbox", { name: "完成 上午任务" });
    await userEvent.click(checkbox);
    notify?.(seed);
    expect(await screen.findByRole("checkbox", { name: "完成 上午任务" })).toBeChecked();
    expect(screen.getByText("上午任务")).toHaveClass("completed");
    resolveUpdate?.();
  });

  it("shows a loading error when today rollover fails", async () => {
    renderTodoSection({
      date: "2026-08-05",
      platform: { ...webPlatform, today: () => "2026-08-05" },
      rolloverIncompleteTodos: async () => { throw new Error("network"); },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("加载失败，请重试");
  });
});
