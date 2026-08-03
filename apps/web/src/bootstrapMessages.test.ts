import { describe, expect, it } from "vitest";
import { getBootstrapErrorDetail } from "./bootstrapMessages";

describe("bootstrap error messaging", () => {
  it("does not label runtime failures as missing Supabase configuration", () => {
    expect(getBootstrapErrorDetail("runtime", undefined)).not.toContain("Supabase");
  });

  it("keeps provider configuration failures actionable", () => {
    expect(getBootstrapErrorDetail("configuration", undefined)).toContain("Supabase");
    expect(getBootstrapErrorDetail("configuration", "self-hosted")).toContain("API URL");
  });
});
