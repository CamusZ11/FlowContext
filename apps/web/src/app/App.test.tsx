import { fireEvent, render, screen, within } from "@testing-library/react";
import type { FlowRepository } from "@flowcontext/data";
import { App } from "./App";
import { webPlatform } from "../platform/webPlatform";

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

describe("App shell", () => {
  it("keeps sync status aligned with the brand without a headline", () => {
    const { container } = render(<App mode="desktop" repository={fakeRepository} platform={webPlatform} />);
    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    expect(headings).toEqual(expect.arrayContaining(["08 / 05", "建议继续", "Daily Lens"]));
    expect(screen.queryByRole("heading", { name: "今天，继续推进" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /关闭|收起 FlowContext/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("connection-status").closest(".brand-row")).toBe(container.querySelector(".brand-row"));
    expect(screen.getByTestId("flowcontext-mark")).toBeInTheDocument();
    expect(screen.getByTestId("synced-mark")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择日期，当前 2026-08-05" }).compareDocumentPosition(screen.getByText("建议继续")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("uses the todo date selection for the Daily Lens", () => {
    render(<App mode="desktop" repository={fakeRepository} platform={webPlatform} />);

    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: "2026-08-19" } });

    expect(screen.getByRole("button", { name: "选择日期，当前 2026-08-19" })).toBeInTheDocument();
    const dailyLens = screen.getByRole("heading", { name: "Daily Lens" }).closest("details");
    expect(within(dailyLens!).getByText("2026-08-19")).toBeInTheDocument();
  });

});
