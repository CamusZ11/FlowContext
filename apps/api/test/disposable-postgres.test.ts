import { describe, expect, it } from "vitest";
import type { PoolConfig } from "pg";

import { createDisposablePool, validatedDisposablePoolConfig } from "./disposable-postgres.ts";

describe("disposable PostgreSQL connection guard", () => {
  it("rejects connection-affecting URL query parameters before Pool construction", () => {
    let constructions = 0;
    class RecordingPool {
      constructor(_config: PoolConfig) { constructions += 1; }
    }

    expect(() => createDisposablePool(
      "postgresql://flowcontext_test:flowcontext_test@127.0.0.1:55432/flowcontext_test?host=/var/run/postgresql&port=5432",
      RecordingPool,
    )).toThrow("refusing non-disposable DATABASE_URL");
    expect(constructions).toBe(0);
  });

  it("returns a fixed loopback Pool config rather than the original URL", () => {
    expect(validatedDisposablePoolConfig(
      "postgresql://flowcontext_test:flowcontext_test@localhost:55432/flowcontext_test",
    )).toEqual({
      host: "127.0.0.1",
      port: 55432,
      database: "flowcontext_test",
      user: "flowcontext_test",
      password: "flowcontext_test",
      ssl: false,
    });
  });
});
