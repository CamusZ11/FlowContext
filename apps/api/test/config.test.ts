import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it("rejects a missing database URL without exposing environment values", () => {
    expect(() => loadConfig({ PORT: "8080" })).toThrow("DATABASE_URL is required");
  });
});
