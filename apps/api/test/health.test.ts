import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server.ts";

describe("GET /healthz", () => {
  it("serves an unauthenticated health response", async () => {
    const app = buildServer({
      repository: {},
      config: {
        port: 8080,
        databaseUrl: "postgres://test:test@localhost:5432/flowcontext",
        ownerId: "00000000-0000-0000-0000-000000000001",
        logLevel: "silent",
      },
    });

    await app.ready();
    expect((await app.inject("/healthz")).json()).toEqual({ status: "ok" });
    await app.close();
  });
});
