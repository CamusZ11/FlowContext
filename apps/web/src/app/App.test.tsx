import { render, screen } from "@testing-library/react";
import type { FlowRepository } from "@flowcontext/data";
import { App } from "./App";
import { webPlatform } from "../platform/webPlatform";

const fakeRepository: FlowRepository = {
  listTodos: async () => [],
  createTodo: async () => { throw new Error("not used"); },
  updateTodo: async () => { throw new Error("not used"); },
  deleteTodo: async () => undefined,
  subscribeTodos: () => () => undefined,
  listSuggestedTopics: async () => [],
  getTopicContext: async () => null,
  getDailyProjection: async () => null,
};

describe("App shell", () => {
  it("keeps sync status aligned with the brand without a headline", () => {
    const { container } = render(<App mode="desktop" repository={fakeRepository} platform={webPlatform} />);
    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    expect(headings).toEqual(expect.arrayContaining(["今日待办", "建议继续", "Daily Lens"]));
    expect(screen.queryByRole("heading", { name: "今天，继续推进" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /关闭|收起 FlowContext/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("connection-status").closest(".brand-row")).toBe(container.querySelector(".brand-row"));
    expect(screen.getByTestId("flowcontext-mark")).toBeInTheDocument();
    expect(screen.getByTestId("synced-mark")).toBeInTheDocument();
    expect(screen.getByText("今日待办").compareDocumentPosition(screen.getByText("建议继续")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

});
