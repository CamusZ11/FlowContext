import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthSession {
  userId: string;
  email?: string | null;
}

export interface AuthPort {
  getSession(): Promise<AuthSession | null>;
  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

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
  if (typeof storage.get === "function") return await storage.get("auth-token");
  if (typeof storage.getItem === "function") return await storage.getItem("auth-token");
  throw new Error("auth storage must implement get/set/remove or getItem/setItem/removeItem");
}

async function writeAuthToken(storage: HttpAuthStorage, value: string): Promise<void> {
  if (typeof storage.set === "function") {
    await storage.set("auth-token", value);
    return;
  }
  if (typeof storage.setItem === "function") {
    await storage.setItem("auth-token", value);
    return;
  }
  throw new Error("auth storage must implement get/set/remove or getItem/setItem/removeItem");
}

async function clearAuthToken(storage: HttpAuthStorage): Promise<void> {
  if (typeof storage.remove === "function") {
    await storage.remove("auth-token");
    return;
  }
  if (typeof storage.removeItem === "function") {
    await storage.removeItem("auth-token");
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
export function createHttpAuth({ baseUrl, storage, fetchImpl }: HttpAuthFetchOptions): AuthPort {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  if (!normalizedBaseUrl) throw new Error("FlowContext API URL is required");
  const requestFetch = fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const listeners = new Set<(session: AuthSession | null) => void>();

  const notify = (session: AuthSession | null) => {
    for (const listener of [...listeners]) listener(session);
  };

  const request = async (
    path: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
    authenticated = true,
  ): Promise<Response> => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (authenticated) {
      const token = await readAuthToken(storage);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await requestFetch(`${normalizedBaseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw await parseHttpAuthError(response);
    return response;
  };

  return {
    async getSession() {
      try {
        const response = await request("/v1/auth/session", "GET");
        const session = asSession(await parseHttpAuthJson(response));
        if (!session) throw new HttpAuthError("invalid_response", response.status);
        return session;
      } catch (reason: unknown) {
        if (reason instanceof HttpAuthError && reason.status === 401) {
          await clearAuthToken(storage);
          notify(null);
          return null;
        }
        throw reason;
      }
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
    async signIn(email, password) {
      const response = await request(
        "/v1/auth/sign-in",
        "POST",
        { email, password },
        false,
      );
      const payload = await parseHttpAuthJson(response);
      if (!isRecord(payload) || typeof payload.accessToken !== "string" || !payload.accessToken) {
        throw new HttpAuthError("invalid_response", response.status);
      }
      await writeAuthToken(storage, payload.accessToken);
      notify(asSession(payload));
    },
    async signOut() {
      try {
        await request("/v1/auth/sign-out", "POST");
      } catch (reason: unknown) {
        if (!(reason instanceof HttpAuthError) || reason.status !== 401) throw reason;
      }
      await clearAuthToken(storage);
      notify(null);
    },
  };
}

export function createSupabaseAuth(client: SupabaseClient): AuthPort {
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session?.user
        ? { userId: data.session.user.id, email: data.session.user.email }
        : null;
    },
    onAuthStateChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(session?.user ? { userId: session.user.id, email: session.user.email } : null);
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
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

  const signIn = useCallback(async (email: string, password: string) => {
    await auth.signIn(email, password);
    setSession(await auth.getSession());
  }, [auth]);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setSession(null);
  }, [auth]);

  return { session, loading, error, signIn, signOut };
}
