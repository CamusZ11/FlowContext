import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

import { deviceUnauthorized } from "./errors.js";
import type { AuthRepository } from "./enrollment.js";

export interface Principal {
  ownerId: string;
  deviceId: string;
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function authenticate(
  request: Pick<FastifyRequest, "headers">,
  repository: AuthRepository,
): Promise<Principal> {
  const authorization = request.headers.authorization;
  const token = typeof authorization === "string" ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1] : undefined;
  if (!token) throw deviceUnauthorized();

  const device = await repository.findActiveDeviceToken(hashSecret(token));
  if (!device) throw deviceUnauthorized();

  return { ownerId: device.ownerId, deviceId: device.deviceId };
}
