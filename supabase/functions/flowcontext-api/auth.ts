import {
  ApiError,
  type ApiRepository,
  type DeviceTokenRecord,
} from "./repository.ts";

export interface Principal {
  ownerId: string;
  deviceId: string;
}

export interface TokenLookup {
  findDeviceTokenByHash(hash: string): Promise<DeviceTokenRecord | null>;
}

export interface Authentication {
  principal: Principal;
  requestId: string;
}

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Hash a raw device token; the raw value never crosses the repository boundary. */
export async function hashToken(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawToken),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Accept a caller-supplied request ID only when it is a short, log-safe token.
 * Any other value is replaced so logs cannot be used as a body/token sink.
 */
export function requestIdFor(request: Request): string {
  const candidate = request.headers.get("X-Request-Id")?.trim() ?? "";
  return requestIdPattern.test(candidate) ? candidate : crypto.randomUUID();
}

/** Authenticate a Codex request using a device-token hash lookup. */
export async function authenticate(
  request: Request,
  repo: ApiRepository & Partial<TokenLookup>,
): Promise<Authentication> {
  const requestId = requestIdFor(request);
  const rawToken = request.headers.get("X-FlowContext-Token")?.trim();
  if (!rawToken) throw new ApiError(401, "unauthorized");

  const lookup = repo.findDeviceTokenByHash;
  if (!lookup) throw new ApiError(503, "auth_not_configured");

  const tokenHash = await hashToken(rawToken);
  const record = await lookup.call(repo, tokenHash);
  if (!record || record.revokedAt) throw new ApiError(401, "unauthorized");

  // Defend the adapter boundary as well: a repository must return the row
  // addressed by the hash we supplied, never a raw-token comparison.
  if (record.tokenHash !== tokenHash || !record.ownerId || !record.deviceId) {
    throw new ApiError(401, "unauthorized");
  }

  return {
    requestId,
    principal: {
      ownerId: record.ownerId,
      deviceId: record.deviceId,
    },
  };
}
