import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashSecret } from "../src/auth.ts";
import type { AuthRepository } from "../src/enrollment.ts";
import { buildServer } from "../src/server.ts";

class TokenRepository implements AuthRepository {
  readonly tokens = new Map<string, { ownerId: string; deviceId: string; revokedAt: string | null }>();

  async findEnrollment() {
    return null;
  }

  async enrollDevice() {
    return false;
  }

  async findActiveDeviceToken(tokenHash: string) {
    const token = this.tokens.get(tokenHash);
    return token?.revokedAt ? null : token ?? null;
  }
}

describe("device authentication", () => {
  it("hashes a secret with SHA-256", () => {
    expect(hashSecret("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("rejects a revoked device without reaching a protected session route", async () => {
    const repository = new TokenRepository();
    const revokedToken = randomBytes(32).toString("base64url");
    repository.tokens.set(hashSecret(revokedToken), {
      ownerId: "00000000-0000-0000-0000-000000000001",
      deviceId: "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725",
      revokedAt: "2026-08-06T00:00:00.000Z",
    });
    const app = buildServer({
      repository,
      config: {
        port: 8080,
        databaseUrl: "postgres://test:test@localhost:5432/flowcontext",
        ownerId: "00000000-0000-0000-0000-000000000001",
        logLevel: "silent",
      },
    });

    await app.ready();
    const response = await app.inject({ url: "/v1/auth/session", headers: { authorization: `Bearer ${revokedToken}` } });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "device_unauthorized" });
    await app.close();
  });
});
