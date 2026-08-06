import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { hashSecret } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDatabasePool } from "./db.js";
import { PostgresAuthRepository, type EnrollmentManagementRepository } from "./enrollment.js";

const MIN_TTL_MINUTES = 1;
const MAX_TTL_MINUTES = 60;
const DEFAULT_TTL_MINUTES = 15;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AdminRepository = EnrollmentManagementRepository & {
  revokeActiveDeviceTokens(deviceId: string): Promise<number>;
};

export interface AdminDependencies {
  repository: AdminRepository;
  now: () => Date;
  generateEnrollmentCode: () => string;
  write: (line: string) => void;
}

function parseTtlMinutes(args: string[]): number {
  if (args.length === 0) return DEFAULT_TTL_MINUTES;
  if (args.length !== 2 || args[0] !== "--ttl-minutes") throw new Error("ttl_minutes_invalid");
  const ttl = Number(args[1]);
  if (!Number.isInteger(ttl) || ttl < MIN_TTL_MINUTES || ttl > MAX_TTL_MINUTES) throw new Error("ttl_minutes_invalid");
  return ttl;
}

function parseDeviceId(args: string[]): string {
  if (args.length !== 2 || args[0] !== "--device-id" || !UUID_PATTERN.test(args[1] ?? "")) {
    throw new Error("device_id_invalid");
  }
  return args[1]!;
}

export async function runAdminCommand(args: string[], dependencies: AdminDependencies): Promise<void> {
  const [resource, action, ...options] = args;
  if (resource === "enrollment" && action === "create") {
    const ttlMinutes = parseTtlMinutes(options);
    const enrollmentCode = dependencies.generateEnrollmentCode();
    const expiresAt = new Date(dependencies.now().getTime() + ttlMinutes * 60_000).toISOString();
    const enrollment = await dependencies.repository.createEnrollment({
      codeHash: hashSecret(enrollmentCode),
      expiresAt,
    });
    dependencies.write(enrollmentCode);
    dependencies.write(`enrollment_id=${enrollment.id} expires_at=${enrollment.expiresAt}`);
    return;
  }

  if (resource === "device" && action === "revoke") {
    const deviceId = parseDeviceId(options);
    const revoked = await dependencies.repository.revokeActiveDeviceTokens(deviceId);
    dependencies.write(`device_id=${deviceId} revoked_tokens=${revoked}`);
    return;
  }

  throw new Error("admin_command_invalid");
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = createDatabasePool(config.databaseUrl);
  try {
    await runAdminCommand(process.argv.slice(2), {
      repository: new PostgresAuthRepository(pool),
      now: () => new Date(),
      generateEnrollmentCode: () => randomBytes(32).toString("base64url"),
      write: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
