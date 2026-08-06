import { describe, expect, it } from "vitest";
import { getBootstrapErrorDetail } from "./bootstrapMessages";

describe("bootstrap error messaging", () => {
  it("does not label runtime failures as missing provider configuration", () => {
    expect(getBootstrapErrorDetail("runtime", undefined)).toContain("本地存储");
  });

  it("points every production configuration failure to the self-hosted API", () => {
    expect(getBootstrapErrorDetail("configuration", undefined)).toContain("API URL");
    expect(getBootstrapErrorDetail("configuration", "self-hosted")).toContain("API URL");
  });
});
