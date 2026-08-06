import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { hashSecret } from "../src/auth.ts";
import { PostgresAuthRepository, type AuthRepository, type EnrollmentRecord } from "../src/enrollment.ts";
import { buildServer } from "../src/server.ts";

class EnrollmentRepository implements AuthRepository {
  readonly enrollments = new Map<string, EnrollmentRecord>();
  readonly tokens = new Map<string, { ownerId: string; deviceId: string; revokedAt: string | null }>();

  async findEnrollment(codeHash: string): Promise<EnrollmentRecord | null> {
    return this.enrollments.get(codeHash) ?? null;
  }

  async enrollDevice(input: {
    codeHash: string;
    deviceId: string;
    ownerId: string;
    tokenHash: string;
  }): Promise<boolean> {
    const enrollment = this.enrollments.get(input.codeHash);
    if (!enrollment || enrollment.consumedAt || enrollment.expiresAt <= new Date().toISOString()) return false;

    enrollment.consumedAt = new Date().toISOString();
    enrollment.deviceId = input.deviceId;
    this.tokens.set(input.tokenHash, { ownerId: input.ownerId, deviceId: input.deviceId, revokedAt: null });
    return true;
  }

  async findActiveDeviceToken(tokenHash: string) {
    const token = this.tokens.get(tokenHash);
    return token?.revokedAt ? null : token ?? null;
  }
}

describe("POST /v1/devices/enroll", () => {
  it("returns a token once when a valid unused code enrolls a device", async () => {
    const repository = new EnrollmentRepository();
    const enrollmentCode = randomBytes(24).toString("base64url");
    const validEnrollment = {
      enrollmentCode,
      deviceId: "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725",
      platform: "macos",
    };
    repository.enrollments.set(hashSecret(enrollmentCode), {
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: null,
      deviceId: null,
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
    const response = await app.inject({ method: "POST", url: "/v1/devices/enroll", payload: validEnrollment });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      deviceToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      userId: "00000000-0000-0000-0000-000000000001",
    });
    expect(await repository.findEnrollment(hashSecret(enrollmentCode))).toMatchObject({ consumedAt: expect.any(String) });
    expect((await app.inject({ method: "POST", url: "/v1/devices/enroll", payload: validEnrollment })).statusCode).toBe(401);
    await app.close();
  });

  it("consumes an enrollment and stores only the token hash in one transaction", async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const client = {
      async query(sql: string, values?: readonly unknown[]) {
        statements.push({ sql, values });
        if (sql.startsWith("update device_enrollments")) return { rowCount: 1, rows: [] };
        return { rowCount: 1, rows: [] };
      },
      release() {},
    };
    const repository = new PostgresAuthRepository({
      async connect() { return client; },
    });

    await expect(repository.enrollDevice({
      codeHash: "a".repeat(64),
      deviceId: "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725",
      ownerId: "00000000-0000-0000-0000-000000000001",
      tokenHash: "b".repeat(64),
    })).resolves.toBe(true);

    expect(statements.map(({ sql }) => sql)).toEqual(expect.arrayContaining(["begin", "commit"]));
    expect(statements.find(({ sql }) => sql.startsWith("update device_enrollments"))?.values).toEqual([
      "a".repeat(64),
      "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725",
    ]);
    expect(statements.find(({ sql }) => sql.startsWith("insert into device_tokens"))?.values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725",
      "b".repeat(64),
    ]);
  });

  it("does not log the supplied enrollment code or issued device token", async () => {
    const repository = new EnrollmentRepository();
    const enrollmentCode = randomBytes(24).toString("base64url");
    const deviceId = "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725";
    repository.enrollments.set(hashSecret(enrollmentCode), {
      expiresAt: "2099-01-01T00:00:00.000Z",
      consumedAt: null,
      deviceId: null,
    });
    const logs: string[] = [];
    const app = buildServer({
      repository,
      config: {
        port: 8080,
        databaseUrl: "postgres://test:test@localhost:5432/flowcontext",
        ownerId: "00000000-0000-0000-0000-000000000001",
        logLevel: "info",
      },
      logger: {
        level: "info",
        stream: new Writable({
          write(chunk, _encoding, callback) {
            logs.push(String(chunk));
            callback();
          },
        }),
      },
    });

    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/v1/devices/enroll",
      payload: { enrollmentCode, deviceId, platform: "macos" },
    });
    const output = logs.join("");

    expect(logs).not.toEqual([]);
    expect(output).not.toContain(enrollmentCode);
    expect(output).not.toContain(response.json().deviceToken);
    expect(output).not.toContain("Bearer ");
    await app.close();
  });
});
