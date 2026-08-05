import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { FlowRepository } from "@flowcontext/data";
import type { Todo } from "@flowcontext/domain";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { PlatformProvider } from "../../app/PlatformContext";
import { RepositoryProvider } from "../../app/RepositoryContext";
import { webPlatform } from "../../platform/webPlatform";
import { todosQueryKey, useTodos } from "./useTodos";

const today = "2026-08-05";

function createRepository(options: {
  listTodos?: (date: string) => Promise<Todo[]>;
  rolloverIncompleteTodos?: (fromDate: string, toDate: string) => Promise<Todo[]>;
} = {}) {
  const rolloverCalls: Array<[string, string]> = [];
  const listCalls: string[] = [];
  const repository: FlowRepository = {
    listTodos: async (date) => {
      listCalls.push(date);
      return options.listTodos?.(date) ?? [];
    },
    createTodo: async (input) => ({ ...input, id: "created" }),
    updateTodo: async (id, patch) => ({
      id,
      title: "updated",
      plannedDate: today,
      plannedTime: null,
      isCompleted: false,
      projectId: null,
      topicCardId: null,
      ...patch,
    }),
    deleteTodo: async () => undefined,
    rolloverIncompleteTodos: async (fromDate, toDate) => {
      rolloverCalls.push([fromDate, toDate]);
      return options.rolloverIncompleteTodos?.(fromDate, toDate) ?? [];
    },
    subscribeTodos: () => () => undefined,
    listSuggestedTopics: async () => [],
    getTopicContext: async () => null,
    getDailyProjection: async () => null,
  };
  return { repository, rolloverCalls, listCalls };
}

function renderTodos(
  repository: FlowRepository,
  selectedDate = today,
  queryRetry: number | false = false,
  platformToday = today,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: queryRetry, retryDelay: 1 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider value={repository}>
        <PlatformProvider value={{ ...webPlatform, today: () => platformToday }}>{children}</PlatformProvider>
      </RepositoryProvider>
    </QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useTodos(selectedDate), { wrapper }) };
}

describe("useTodos", () => {
  it("rolls unfinished todos from the local calendar yesterday when first entering today", async () => {
    const { repository, rolloverCalls } = createRepository();
    renderTodos(repository);

    await waitFor(() => {
      expect(rolloverCalls).toEqual([["2026-08-04", "2026-08-05"]]);
    });
  });

  it("uses the prior local calendar date across a year boundary", async () => {
    const { repository, rolloverCalls } = createRepository();
    renderTodos(repository, "2026-01-01", false, "2026-01-01");

    await waitFor(() => {
      expect(rolloverCalls).toEqual([["2025-12-31", "2026-01-01"]]);
    });
  });

  it("does not hold a historical date loading while rollover is disabled", async () => {
    const { repository, rolloverCalls } = createRepository();
    const { result } = renderTodos(repository, "2026-08-04");

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.isPending).toBe(false);
    expect(rolloverCalls).toEqual([]);
  });

  it("loads the current list only after rollover succeeds", async () => {
    const rolledTodo: Todo = {
      id: "rolled",
      title: "昨天未完成",
      plannedDate: today,
      plannedTime: null,
      isCompleted: false,
      projectId: null,
      topicCardId: null,
    };
    let todos: Todo[] = [];
    let finishRollover: (() => void) | undefined;
    const { repository, listCalls, rolloverCalls } = createRepository({
      listTodos: async () => todos,
      rolloverIncompleteTodos: async () => new Promise((resolve) => {
        finishRollover = () => {
          todos = [rolledTodo];
          resolve(todos);
        };
      }),
    });
    const { result } = renderTodos(repository);

    await waitFor(() => {
      expect(rolloverCalls).toEqual([["2026-08-04", "2026-08-05"]]);
    });
    expect(listCalls).toEqual([]);

    finishRollover?.();

    await waitFor(() => {
      expect(result.current.data).toEqual([rolledTodo]);
    });
    expect(listCalls).toEqual([today]);
  });

  it("runs rollover once when today rerenders in the same query client", async () => {
    const { repository, rolloverCalls } = createRepository();
    const { rerender } = renderTodos(repository);

    await waitFor(() => {
      expect(rolloverCalls).toEqual([["2026-08-04", "2026-08-05"]]);
    });
    rerender();

    expect(rolloverCalls).toEqual([["2026-08-04", "2026-08-05"]]);
  });

  it("invalidates yesterday and today after a successful rollover", async () => {
    const { repository, rolloverCalls } = createRepository();
    const { queryClient } = renderTodos(repository);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => {
      expect(rolloverCalls).toEqual([["2026-08-04", "2026-08-05"]]);
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: todosQueryKey("2026-08-04") });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: todosQueryKey(today) });
  });

  it("surfaces a rollover failure through the todos query", async () => {
    const { repository } = createRepository({
      rolloverIncompleteTodos: async () => { throw new Error("rollover unavailable"); },
    });
    const { result } = renderTodos(repository);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toMatchObject({ message: "rollover unavailable" });
  });

  it("does not repeat a failed rollover in the same query client", async () => {
    const { repository, rolloverCalls } = createRepository({
      rolloverIncompleteTodos: async () => { throw new Error("rollover unavailable"); },
    });
    const { result } = renderTodos(repository, today, 1);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(rolloverCalls).toEqual([["2026-08-04", "2026-08-05"]]);
  });
});
