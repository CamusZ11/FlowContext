import { randomBytes } from "node:crypto";
import type { Pool } from "pg";

export interface EnrollmentRecord {
  expiresAt: string;
  consumedAt: string | null;
  deviceId: string | null;
}

export interface DeviceTokenRecord {
  ownerId: string;
  deviceId: string;
  revokedAt: string | null;
}

export interface AuthRepository {
  findEnrollment(codeHash: string): Promise<EnrollmentRecord | null>;
  enrollDevice(input: {
    codeHash: string;
    deviceId: string;
    ownerId: string;
    tokenHash: string;
  }): Promise<boolean>;
  findActiveDeviceToken(tokenHash: string): Promise<DeviceTokenRecord | null>;
}

export interface DeviceManagementRepository {
  revokeDevice(deviceId: string): Promise<boolean>;
}

type QueryResult<Row> = { rows: Row[]; rowCount: number | null };

type EnrollmentClient = {
  query<Row = Record<string, never>>(sql: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
  release(): void;
};

type EnrollmentPool = Pick<Pool, "connect" | "query">;

export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function revokeDevice(repository: DeviceManagementRepository, deviceId: string): Promise<boolean> {
  return repository.revokeDevice(deviceId);
}

export class PostgresAuthRepository implements AuthRepository, DeviceManagementRepository {
  constructor(private readonly pool: EnrollmentPool) {}

  async findEnrollment(codeHash: string): Promise<EnrollmentRecord | null> {
    const result = await this.pool.query<{
      expires_at: string;
      consumed_at: string | null;
      device_id: string | null;
    }>(
      "select expires_at, consumed_at, device_id from device_enrollments where code_hash = $1",
      [codeHash],
    );
    const enrollment = result.rows[0];
    return enrollment ? {
      expiresAt: enrollment.expires_at,
      consumedAt: enrollment.consumed_at,
      deviceId: enrollment.device_id,
    } : null;
  }

  async enrollDevice(input: {
    codeHash: string;
    deviceId: string;
    ownerId: string;
    tokenHash: string;
  }): Promise<boolean> {
    const client = await this.pool.connect() as unknown as EnrollmentClient;
    try {
      await client.query("begin");
      const consumed = await client.query(
        "update device_enrollments set consumed_at = now(), device_id = $2 where code_hash = $1 and consumed_at is null and expires_at > now()",
        [input.codeHash, input.deviceId],
      );
      if (consumed.rowCount !== 1) {
        await client.query("rollback");
        return false;
      }
      await client.query(
        "insert into device_tokens (owner_id, device_id, token_hash) values ($1, $2, $3)",
        [input.ownerId, input.deviceId, input.tokenHash],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findActiveDeviceToken(tokenHash: string): Promise<DeviceTokenRecord | null> {
    const result = await this.pool.query<{
      owner_id: string;
      device_id: string;
      revoked_at: string | null;
    }>(
      "select owner_id, device_id, revoked_at from device_tokens where token_hash = $1 and revoked_at is null",
      [tokenHash],
    );
    const token = result.rows[0];
    return token ? {
      ownerId: token.owner_id,
      deviceId: token.device_id,
      revokedAt: token.revoked_at,
    } : null;
  }

  async revokeDevice(deviceId: string): Promise<boolean> {
    const result = await this.pool.query(
      "update device_tokens set revoked_at = now() where device_id = $1 and revoked_at is null",
      [deviceId],
    );
    return result.rowCount !== 0;
  }
}
