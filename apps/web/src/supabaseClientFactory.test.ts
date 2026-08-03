import { describe, expect, it } from "vitest";
import { createConfiguredSupabaseClient } from "./supabaseClientFactory";

describe("createConfiguredSupabaseClient", () => {
  it("passes Vite Supabase env values explicitly into the browser client", () => {
    const calls: unknown[][] = [];
    const client = createConfiguredSupabaseClient({
      VITE_SUPABASE_URL: "https://vite.example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "public-client-key",
    }, undefined, (...args) => {
      calls.push(args);
      return { ok: true };
    });

    expect(client).toEqual({ ok: true });
    expect(calls).toEqual([[
      "https://vite.example.supabase.co",
      "public-client-key",
      undefined,
    ]]);
  });
});
