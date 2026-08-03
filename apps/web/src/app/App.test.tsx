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
  it("renders the three required sections in order", () => {
    render(<App mode="web" repository={fakeRepository} platform={webPlatform} />);
    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    expect(headings).toEqual(expect.arrayContaining(["To-do", "建议继续", "Daily Lens"]));
    expect(screen.getByText("To-do").compareDocumentPosition(screen.getByText("建议继续")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
