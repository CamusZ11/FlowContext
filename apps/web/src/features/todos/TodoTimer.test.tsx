import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TodoTimer, type TodoTimerTask } from "./TodoTimer";

const first: TodoTimerTask = { id: "first", title: "复核账单", revision: 0 };
const second: TodoTimerTask = { id: "second", title: "发出结算单", revision: 1 };

it("archives the active duration before closing, excluding pauses", async () => {
  vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval"] });
  const archive = vi.fn(async () => { expect(close).not.toHaveBeenCalled(); });
  const close = vi.fn(async () => true);
  const { unmount } = render(<TodoTimer initialTask={first} archive={archive} onClose={close} />);
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
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "关闭计时" })); });
    expect(archive).toHaveBeenCalledExactlyOnceWith("first", expect.objectContaining({ elapsedMs: 5100 }));
    expect(close).toHaveBeenCalledExactlyOnceWith(0);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("keeps a failed switch's snapshot and retries it before starting the next task", async () => {
  vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval"] });
  const archive = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
  const close = vi.fn(async () => true);
  const view = render(<TodoTimer initialTask={first} archive={archive} onClose={close} />);
  try {
    act(() => { vi.advanceTimersByTime(2000); });
    await act(async () => { view.rerender(<TodoTimer initialTask={first} request={{ task: second }} archive={archive} onClose={close} />); });
    expect(screen.getByRole("alert")).toHaveTextContent("保存失败");
    expect(screen.getByText(first.title)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5000); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试保存" })); });
    expect(archive.mock.calls[1]).toEqual(archive.mock.calls[0]);
    expect(archive.mock.calls[0][1].elapsedMs).toBe(2000);
    expect(screen.getByText(second.title)).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it("coalesces rapid switches and archives the original session only once", async () => {
  let release: () => void = () => undefined;
  const archive = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const close = vi.fn(async () => true);
  const third: TodoTimerTask = { id: "third", title: "准备会议", revision: 3 };
  const props = { initialTask: first, archive, onClose: close };
  const view = render(<TodoTimer {...props} />);

  view.rerender(<TodoTimer {...props} request={{ task: { ...first, revision: 1 } }} />);
  expect(archive).not.toHaveBeenCalled();
  view.rerender(<TodoTimer {...props} request={{ task: { ...second, revision: 2 } }} />);
  expect(archive).toHaveBeenCalledExactlyOnceWith(first.id, expect.any(Object));
  view.rerender(<TodoTimer {...props} request={{ task: third }} />);
  await act(async () => { release(); });

  expect(archive).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText(third.title)).toBeInTheDocument();
});

it("starts the newer task if a previously requested native close is superseded", async () => {
  let release: (closed: boolean) => void = () => undefined;
  const archive = vi.fn(async () => undefined);
  const close = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve; }));
  const props = { initialTask: first, archive, onClose: close };
  const view = render(<TodoTimer {...props} />);

  await act(async () => { view.rerender(<TodoTimer {...props} request={{ close: true, revision: first.revision }} />); });
  expect(close).toHaveBeenCalledExactlyOnceWith(first.revision);
  view.rerender(<TodoTimer {...props} request={{ task: second }} />);
  await act(async () => { release(false); });

  expect(archive).toHaveBeenCalledOnce();
  expect(screen.getByText(second.title)).toBeInTheDocument();
});

it("honors a newer close request after native rejects the old revision", async () => {
  let release: (closed: boolean) => void = () => undefined;
  const archive = vi.fn(async () => undefined);
  const close = vi.fn()
    .mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }))
    .mockResolvedValueOnce(true);
  const props = { initialTask: first, archive, onClose: close };
  const view = render(<TodoTimer {...props} />);

  await act(async () => { view.rerender(<TodoTimer {...props} request={{ close: true, revision: first.revision }} />); });
  view.rerender(<TodoTimer {...props} request={{ task: second }} />);
  view.rerender(<TodoTimer {...props} request={{ close: true, revision: second.revision }} />);
  await act(async () => { release(false); });

  expect(archive).toHaveBeenCalledOnce();
  expect(close.mock.calls).toEqual([[first.revision], [second.revision]]);
});

it("keeps a native quit pending when saving fails and closes after retrying the same entry", async () => {
  const archive = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
  const close = vi.fn(async () => true);
  const props = { initialTask: first, archive, onClose: close };
  const view = render(<TodoTimer {...props} />);

  await act(async () => { view.rerender(<TodoTimer {...props} request={{ close: true, revision: first.revision }} />); });
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("保存失败");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试保存" })); });

  expect(archive.mock.calls[1]).toEqual(archive.mock.calls[0]);
  expect(close).toHaveBeenCalledExactlyOnceWith(first.revision);
});
