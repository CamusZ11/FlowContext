import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashSecret } from "../src/auth.ts";
import { runAdminCommand } from "../src/admin.ts";

describe("server-only device administration", () => {
  it("creates a 15-minute enrollment bound to the requested device and stores only its hash", async () => {
    const created: Array<{ codeHash: string; expiresAt: string; expectedDeviceId: string }> = [];
    const output: string[] = [];
    const code = randomBytes(24).toString("base64url");
    const deviceId = "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725";

    await runAdminCommand(["enrollment", "create", "--device-id", deviceId], {
      now: () => new Date("2026-08-06T00:00:00.000Z"),
      generateEnrollmentCode: () => code,
      repository: {
        async createEnrollment(input) {
          created.push(input);
          return { id: "6c76f8f1-3e02-4d87-b648-2f2d66be2ec6", expiresAt: input.expiresAt };
        },
        async revokeActiveDeviceTokens() {
          return 0;
        },
      },
      write: (line) => output.push(line),
    });

    expect(created).toEqual([{
      codeHash: hashSecret(code),
      expiresAt: "2026-08-06T00:15:00.000Z",
      expectedDeviceId: deviceId,
    }]);
    expect(JSON.stringify(created)).not.toContain(code);
    expect(output).toEqual([code, "enrollment_id=6c76f8f1-3e02-4d87-b648-2f2d66be2ec6 expires_at=2026-08-06T00:15:00.000Z"]);
  });

  it("accepts only bounded whole-minute enrollment TTL values", async () => {
    const code = randomBytes(24).toString("base64url");
    const dependencies = {
      now: () => new Date("2026-08-06T00:00:00.000Z"),
      generateEnrollmentCode: () => code,
      repository: {
        async createEnrollment(input: { codeHash: string; expiresAt: string; expectedDeviceId: string }) {
          return { id: "6c76f8f1-3e02-4d87-b648-2f2d66be2ec6", expiresAt: input.expiresAt };
        },
        async revokeActiveDeviceTokens() {
          return 0;
        },
      },
      write: () => {},
    };

    const deviceId = "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725";
    await expect(runAdminCommand(["enrollment", "create", "--device-id", deviceId, "--ttl-minutes", "1"], dependencies)).resolves.toBeUndefined();
    await expect(runAdminCommand(["enrollment", "create", "--device-id", deviceId, "--ttl-minutes", "60"], dependencies)).resolves.toBeUndefined();
    await expect(runAdminCommand(["enrollment", "create", "--device-id", deviceId, "--ttl-minutes", "0"], dependencies)).rejects.toThrow("ttl_minutes_invalid");
    await expect(runAdminCommand(["enrollment", "create", "--device-id", deviceId, "--ttl-minutes", "61"], dependencies)).rejects.toThrow("ttl_minutes_invalid");
    await expect(runAdminCommand(["enrollment", "create", "--device-id", deviceId, "--ttl-minutes", "1.5"], dependencies)).rejects.toThrow("ttl_minutes_invalid");
  });

  it("rejects a missing or malformed enrollment device ID before creating a code", async () => {
    let created = false;
    const dependencies = {
      now: () => new Date(),
      generateEnrollmentCode: () => "unused",
      repository: {
        async createEnrollment() { created = true; throw new Error("unreachable"); },
        async revokeActiveDeviceTokens() { return 0; },
      },
      write: () => {},
    };

    await expect(runAdminCommand(["enrollment", "create"], dependencies)).rejects.toThrow("device_id_invalid");
    await expect(runAdminCommand(["enrollment", "create", "--device-id", "not-a-uuid"], dependencies)).rejects.toThrow("device_id_invalid");
    expect(created).toBe(false);
  });

  it("rejects duplicate enrollment options even when the first TTL is the default", async () => {
    const dependencies = {
      now: () => new Date(),
      generateEnrollmentCode: () => "unused",
      repository: {
        async createEnrollment() { throw new Error("unreachable"); },
        async revokeActiveDeviceTokens() { return 0; },
      },
      write: () => {},
    };
    const deviceId = "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725";

    await expect(runAdminCommand([
      "enrollment", "create", "--device-id", deviceId, "--ttl-minutes", "15", "--ttl-minutes", "16",
    ], dependencies)).rejects.toThrow("ttl_minutes_invalid");
  });

  it("rejects an invalid device ID before revocation", async () => {
    let called = false;
    const code = randomBytes(24).toString("base64url");

    await expect(runAdminCommand(["device", "revoke", "--device-id", "not-a-uuid"], {
      now: () => new Date(),
      generateEnrollmentCode: () => code,
      repository: {
        async createEnrollment() {
          throw new Error("unreachable");
        },
        async revokeActiveDeviceTokens() {
          called = true;
          return 0;
        },
      },
      write: () => {},
    })).rejects.toThrow("device_id_invalid");

    expect(called).toBe(false);
  });

  it("revokes every active token for a valid device without outputting secrets", async () => {
    const output: string[] = [];
    const deviceId = "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725";
    const code = randomBytes(24).toString("base64url");

    await runAdminCommand(["device", "revoke", "--device-id", deviceId], {
      now: () => new Date(),
      generateEnrollmentCode: () => code,
      repository: {
        async createEnrollment() {
          throw new Error("unreachable");
        },
        async revokeActiveDeviceTokens(id) {
          expect(id).toBe(deviceId);
          return 2;
        },
      },
      write: (line) => output.push(line),
    });

    expect(output).toEqual([`device_id=${deviceId} revoked_tokens=2`]);
  });
});
