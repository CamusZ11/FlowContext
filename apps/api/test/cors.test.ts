import { describe, expect, it } from "vitest";

import type { AuthRepository } from "../src/enrollment.ts";
import { buildServer } from "../src/server.ts";

class EmptyRepository implements AuthRepository {
  async findEnrollment() {
    return null;
  }

  async enrollDevice() {
    return false;
  }

  async findActiveDeviceToken() {
    return null;
  }
}

function build() {
  const app = buildServer({
    repository: new EmptyRepository(),
    config: {
      port: 8080,
      databaseUrl: "postgres://test:test@localhost:5432/flowcontext",
      ownerId: "00000000-0000-0000-0000-000000000001",
      logLevel: "silent",
    },
  });
  return app.ready();
}

describe("CORS for the desktop webview origin", () => {
  it("answers preflight without authentication and allows the bearer headers", async () => {
    const app = await build();
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/auth/session",
      headers: {
        origin: "tauri://localhost",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers["access-control-allow-methods"]).toContain("GET");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain("authorization");
    expect(response.headers["access-control-allow-headers"].toLowerCase()).toContain("content-type");
  });

  it("includes the allow-origin header on regular and error responses", async () => {
    const app = await build();

    const health = await app.inject({ url: "/healthz" });
    expect(health.headers["access-control-allow-origin"]).toBe("*");

    const unauthorized = await app.inject({ url: "/v1/auth/session" });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["access-control-allow-origin"]).toBe("*");
  });
});
