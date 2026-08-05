import { act, renderHook } from "@testing-library/react";
import type { PlatformPort } from "../../platform/PlatformPort";
import { useSelectedDate } from "./useSelectedDate";

function platform(today: () => string): PlatformPort {
  return {
    mode: "web",
    today,
    openExternal: async () => undefined,
    sessionStorage: {
      get: () => null,
      set: () => undefined,
      remove: () => undefined,
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  };
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("useSelectedDate", () => {
  it("keeps a desktop date chosen by the user", () => {
    const { result } = renderHook(() => useSelectedDate("desktop", platform(() => "2026-08-05")));

    act(() => result.current[1]("2026-08-19"));

    expect(result.current[0]).toBe("2026-08-19");
  });

  it("uses a valid URL date in desktop mode", () => {
    window.history.replaceState({}, "", "/?date=2026-08-19");

    const { result } = renderHook(() => useSelectedDate("desktop", platform(() => "2026-08-05")));

    expect(result.current[0]).toBe("2026-08-19");
  });

  it("writes web date changes to the URL and accepts browser navigation", () => {
    const { result } = renderHook(() => useSelectedDate("web", platform(() => "2026-08-05")));

    act(() => result.current[1]("2026-08-19"));
    expect(window.location.search).toBe("?date=2026-08-19");

    act(() => {
      window.history.pushState({}, "", "/?date=2026-08-02");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current[0]).toBe("2026-08-02");
  });

  it("follows a new today only while the current selection was the old today", () => {
    let currentToday = "2026-08-05";
    const currentPlatform = platform(() => currentToday);
    const { result, rerender } = renderHook(() => useSelectedDate("desktop", currentPlatform));

    currentToday = "2026-08-06";
    rerender();
    expect(result.current[0]).toBe("2026-08-06");

    act(() => result.current[1]("2026-08-19"));
    currentToday = "2026-08-07";
    rerender();
    expect(result.current[0]).toBe("2026-08-19");
  });
});
