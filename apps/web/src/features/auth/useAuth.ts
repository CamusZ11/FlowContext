import { useEffect, useState } from "react";

export const DEVICE_TOKEN_STORAGE_KEY = "flowcontext.device-token";

export interface AuthSession {
  userId: string;
  email?: string | null;
}

export interface DeviceEnrollmentInput {
  apiUrl: string;
  enrollmentCode: string;
}

export interface PasswordlessAuthPort {
  getSession(): Promise<AuthSession | null>;
  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void;
  enroll(input: DeviceEnrollmentInput): Promise<AuthSession>;
  clearDeviceCredential(): Promise<void>;
}

export type AuthPort = PasswordlessAuthPort;

type Awaitable<T> = T | PromiseLike<T>;

interface AppAuthStorage {
  get(key: string): Awaitable<string | null>;
  set(key: string, value: string): Awaitable<void>;
  remove(key: string): Awaitable<void>;
}

interface SupabaseCompatibleAuthStorage {
  getItem(key: string): Awaitable<string | null>;
  setItem(key: string, value: string): Awaitable<void>;
  removeItem(key: string): Awaitable<void>;
}

/**
 * HTTP auth only needs one complete storage API. The alternate API is
 * optional so callers do not have to manufacture duplicate methods.
 */
export type HttpAuthStorage =
  | (AppAuthStorage & Partial<SupabaseCompatibleAuthStorage>)
  | (SupabaseCompatibleAuthStorage & Partial<AppAuthStorage>);

export interface HttpAuthFetchOptions {
  baseUrl: string;
  storage: HttpAuthStorage;
  deviceId?: string;
  devicePlatform?: "macos" | "windows";
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

export class HttpAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "HttpAuthError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readAuthToken(storage: HttpAuthStorage): Promise<string | null> {
  if (typeof storage.get === "function") return await storage.get(DEVICE_TOKEN_STORAGE_KEY);
  if (typeof storage.getItem === "function") return await storage.getItem(DEVICE_TOKEN_STORAGE_KEY);
  throw new Error("auth storage must implement get/set/remove or getItem/setItem/removeItem");
}

async function writeAuthToken(storage: HttpAuthStorage, value: string): Promise<void> {
  if (typeof storage.set === "function") {
    await storage.set(DEVICE_TOKEN_STORAGE_KEY, value);
    return;
  }
  if (typeof storage.setItem === "function") {
    await storage.setItem(DEVICE_TOKEN_STORAGE_KEY, value);
    return;
  }
  throw new Error("auth storage must implement get/set/remove or getItem/setItem/removeItem");
}

async function clearAuthToken(storage: HttpAuthStorage): Promise<void> {
  if (typeof storage.remove === "function") {
    await storage.remove(DEVICE_TOKEN_STORAGE_KEY);
    return;
  }
  if (typeof storage.removeItem === "function") {
    await storage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
    return;
  }
  throw new Error("auth storage must implement get/set/remove or getItem/setItem/removeItem");
}

async function parseHttpAuthError(response: Response): Promise<HttpAuthError> {
  let code = `http_${response.status}`;
  try {
    const text = await response.text();
    if (text.trim()) {
      const body: unknown = JSON.parse(text);
      if (
        isRecord(body)
        && typeof body.error === "string"
        && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(body.error)
      ) {
        code = body.error;
      }
    }
  } catch {
    // Keep the status-derived code and never include a response body in errors.
  }
  return new HttpAuthError(code, response.status);
}

async function parseHttpAuthJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new HttpAuthError("invalid_response", response.status);
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpAuthError("invalid_response", response.status);
  }
}

function asSession(value: unknown): AuthSession | null {
  if (!isRecord(value) || typeof value.userId !== "string" || !value.userId.trim()) return null;
  const email = value.email;
  return {
    userId: value.userId,
    ...(typeof email === "string" || email === null ? { email } : {}),
  };
}

/**
 * AuthPort implementation for the self-hosted HTTP API. Access tokens never
 * leave the injected storage and are only read when constructing a Bearer
 * header for an authenticated request.
 */
export function createHttpAuth({
  baseUrl,
  storage,
  deviceId,
  devicePlatform,
  fetchImpl,
}: HttpAuthFetchOptions): PasswordlessAuthPort {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl) throw new Error("FlowContext API URL is required");
  const requestFetch = fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const listeners = new Set<(session: AuthSession | null) => void>();
  let credentialMutationTail: Promise<void> = Promise.resolve();

  const notify = (session: AuthSession | null) => {
    for (const listener of [...listeners]) listener(session);
  };

  const mutateCredential = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = credentialMutationTail.then(operation, operation);
    credentialMutationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const request = async (
    requestBaseUrl: string,
    path: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
    authToken?: string,
  ): Promise<Response> => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const response = await requestFetch(`${requestBaseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw await parseHttpAuthError(response);
    return response;
  };

  const getSessionAt = async (requestBaseUrl: string): Promise<AuthSession | null> => {
    const token = await readAuthToken(storage);
    if (!token) return null;
    try {
      const response = await request(requestBaseUrl, "/v1/auth/session", "GET", undefined, token);
      const session = asSession(await parseHttpAuthJson(response));
      if (!session) throw new HttpAuthError("invalid_response", response.status);
      return session;
    } catch (reason: unknown) {
      if (reason instanceof HttpAuthError && reason.status === 401) {
        const cleared = await mutateCredential(async () => {
          if (await readAuthToken(storage) !== token) return false;
          await clearAuthToken(storage);
          return true;
        });
        if (cleared) notify(null);
        return null;
      }
      throw reason;
    }
  };

  return {
    async getSession() {
      return getSessionAt(normalizedBaseUrl);
    },
    onAuthStateChange(listener) {
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    async enroll({ apiUrl, enrollmentCode }) {
      const enrollmentBaseUrl = apiUrl.trim().replace(/\/+$/, "");
      if (
        !enrollmentBaseUrl
        || enrollmentBaseUrl !== normalizedBaseUrl
        || !enrollmentCode
        || !deviceId
        || !devicePlatform
      ) {
        throw new HttpAuthError("invalid_enrollment", 422);
      }
      const response = await request(
        enrollmentBaseUrl,
        "/v1/devices/enroll",
        "POST",
        { enrollmentCode, deviceId, platform: devicePlatform },
      );
      const payload = await parseHttpAuthJson(response);
      if (
        !isRecord(payload)
        || typeof payload.deviceToken !== "string"
        || !payload.deviceToken
        || typeof payload.userId !== "string"
        || !payload.userId
      ) {
        throw new HttpAuthError("invalid_response", response.status);
      }
      const deviceToken = payload.deviceToken;
      await mutateCredential(() => writeAuthToken(storage, deviceToken));
      const session = await getSessionAt(enrollmentBaseUrl);
      if (!session) throw new HttpAuthError("device_unauthorized", 401);
      notify(session);
      return session;
    },
    async clearDeviceCredential() {
      await mutateCredential(() => clearAuthToken(storage));
      notify(null);
    },
  };
}

export function useAuth(auth: AuthPort) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    void auth.getSession().then((value) => {
      if (active) {
        setSession(value);
        setError(null);
        setLoading(false);
      }
    }).catch((reason: unknown) => {
      if (active) {
        setError(reason instanceof Error ? reason : new Error("auth session unavailable"));
        setLoading(false);
      }
    });
    const unsubscribe = auth.onAuthStateChange((value) => {
      if (active) {
        setSession(value);
        setError(null);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth]);

  return { session, loading, error };
}
