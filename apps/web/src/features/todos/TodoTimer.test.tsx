import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TodoTimer } from "./TodoTimer";

it("counts up immediately, pauses without counting the break, and can close", () => {
  vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval"] });
  const close = vi.fn(async () => undefined);
  const { unmount } = render(<TodoTimer title="复核账单" onClose={close} />);
  try {
    expect(screen.getByText("复核账单")).toBeInTheDocument();
    const elapsed = screen.getByRole("timer");
    expect(elapsed).toHaveTextContent("00:00");
    act(() => { vi.advanceTimersByTime(3500); });
    expect(elapsed).toHaveTextContent("00:03");

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(elapsed).toHaveTextContent("00:03");

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    act(() => { vi.advanceTimersByTime(1600); });
    expect(elapsed).toHaveTextContent("00:05");
    fireEvent.click(screen.getByRole("button", { name: "关闭计时" }));
    expect(close).toHaveBeenCalledOnce();
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
