import { createHttpAuth } from "./useAuth";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HTTP authentication", () => {
  it("stores only the returned access token behind AuthPort and awaits async app storage", async () => {
    const values = new Map<string, string>();
    const storage = {
      async get(key: string) {
        return values.get(key) ?? null;
      },
      async set(key: string, value: string) {
        await Promise.resolve();
        values.set(key, value);
      },
      async remove(key: string) {
        await Promise.resolve();
        values.delete(key);
      },
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        userId: "user-1",
        email: "camus@example.com",
        accessToken: "opaque-token",
      }))
      .mockResolvedValueOnce(jsonResponse({
        userId: "user-1",
        email: "camus@example.com",
      }));
    const auth = createHttpAuth({
      baseUrl: "https://flowcontext.example.com/",
      storage,
      fetchImpl,
    });

    await auth.signIn("camus@example.com", "test-password");
    await expect(storage.get("auth-token")).resolves.toBe("opaque-token");
    await expect(auth.getSession()).resolves.toEqual({
      userId: "user-1",
      email: "camus@example.com",
    });

    expect(values).toEqual(new Map([["auth-token", "opaque-token"]]));
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://flowcontext.example.com/v1/auth/sign-in");
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "camus@example.com", password: "test-password" }),
    }));
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer opaque-token" }),
    }));
  });

  it("falls back to a status code when an error payload contains secret or body text", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const secret = "opaque-token secret/body";
    const bodyText = "password and full response body";
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: secret, detail: bodyText }, 500),
    );
    const auth = createHttpAuth({
      baseUrl: "https://flowcontext.example.com",
      storage,
      fetchImpl,
    });

    let caught: unknown;
    try {
      await auth.getSession();
    } catch (reason: unknown) {
      caught = reason;
    }

    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error & { code?: string; status?: number };
    expect(error).toMatchObject({ code: "http_500", status: 500, message: "http_500" });
    expect(error.code).not.toContain(secret);
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(bodyText);
  });

  it("clears storage and stops exposing a session on a 401", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue("expired-token"),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: "invalid_credentials" }, 401),
    );
    const auth = createHttpAuth({
      baseUrl: "https://flowcontext.example.com",
      storage,
      fetchImpl,
    });

    await expect(auth.getSession()).resolves.toBeNull();
    expect(storage.remove).toHaveBeenCalledWith("auth-token");
    expect(storage.set).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer expired-token" }),
    }));
  });

  it("falls back to async getItem/setItem/removeItem storage", async () => {
    const values = new Map<string, string>();
    const storage = {
      async getItem(key: string) {
        await Promise.resolve();
        return values.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        await Promise.resolve();
        values.set(key, value);
      },
      async removeItem(key: string) {
        await Promise.resolve();
        values.delete(key);
      },
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        userId: "user-2",
        email: "fallback@example.com",
        accessToken: "fallback-token",
      }))
      .mockResolvedValueOnce(jsonResponse({
        userId: "user-2",
        email: "fallback@example.com",
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const auth = createHttpAuth({
      baseUrl: "https://flowcontext.example.com",
      storage,
      fetchImpl,
    });

    await auth.signIn("fallback@example.com", "test-password");
    await expect(storage.getItem("auth-token")).resolves.toBe("fallback-token");
    await expect(auth.getSession()).resolves.toEqual({
      userId: "user-2",
      email: "fallback@example.com",
    });
    await auth.signOut();
    await expect(storage.getItem("auth-token")).resolves.toBeNull();
  });

  it("notifies active listeners after sign-in and sign-out, with idempotent unsubscribe", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        userId: "user-3",
        email: "listener@example.com",
        accessToken: "listener-token",
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const listener = vi.fn();
    const removedListener = vi.fn();
    const auth = createHttpAuth({
      baseUrl: "https://flowcontext.example.com",
      storage,
      fetchImpl,
    });
    const unsubscribe = auth.onAuthStateChange(listener);
    const unsubscribeRemoved = auth.onAuthStateChange(removedListener);

    await auth.signIn("listener@example.com", "test-password");
    expect(listener).toHaveBeenLastCalledWith({
      userId: "user-3",
      email: "listener@example.com",
    });
    expect(removedListener).toHaveBeenCalledTimes(1);

    unsubscribeRemoved();
    unsubscribeRemoved();
    await auth.signOut();
    expect(listener).toHaveBeenLastCalledWith(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(removedListener).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribe();
  });
});
