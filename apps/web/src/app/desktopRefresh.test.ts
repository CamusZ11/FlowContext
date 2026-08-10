import { describe, expect, it } from "vitest";
import { desktopRefreshQueryKeys } from "./desktopRefresh";

describe("desktop authoritative refresh", () => {
  it("refreshes the selected to-do date and continuity topic families", () => {
    expect(desktopRefreshQueryKeys("2026-08-09")).toEqual([
      ["todos", "2026-08-09"],
      ["suggested-topics"],
      ["suggested-topic-contexts"],
      ["daily-projection", "2026-08-09"],
    ]);
  });
});
