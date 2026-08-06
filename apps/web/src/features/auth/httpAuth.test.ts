import { createHttpAuth, DEVICE_TOKEN_STORAGE_KEY } from "./useAuth";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const deviceId = "5d3e3ab4-2e5a-4d6e-a2fb-5d64d6a0e725";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
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
    },
  };
}

describe("passwordless HTTP authentication", () => {
  it("stores an enrolled device token under the secure key and confirms the session", async () => {
    const { values, storage } = memoryStorage({ "device-id": deviceId });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ deviceToken: "issued-token", userId: "owner-1" }, 201))
      .mockResolvedValueOnce(jsonResponse({ userId: "owner-1" }));
    const auth = createHttpAuth({
      baseUrl: "https://api.example",
      storage,
      deviceId,
      devicePlatform: "macos",
      fetchImpl,
    });

    await auth.enroll({ apiUrl: "https://api.example", enrollmentCode: "single-use" });

    await expect(storage.get(DEVICE_TOKEN_STORAGE_KEY)).resolves.toBe("issued-token");
    expect(values).toEqual(new Map([
      ["device-id", deviceId],
      [DEVICE_TOKEN_STORAGE_KEY, "issued-token"],
    ]));
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.example/v1/devices/enroll");
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ enrollmentCode: "single-use", deviceId, platform: "macos" }),
    }));
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer issued-token" }),
    }));
  });

  it("rejects an enrollment URL that differs from the configured repository URL", async () => {
    const { storage } = memoryStorage();
    const fetchImpl = vi.fn();
    const auth = createHttpAuth({
      baseUrl: "https://api.example",
      storage,
      deviceId,
      devicePlatform: "macos",
      fetchImpl,
    });

    await expect(auth.enroll({ apiUrl: "https://other.example", enrollmentCode: "single-use" }))
      .rejects.toMatchObject({ code: "invalid_enrollment", status: 422 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns no session without a device token and makes no network request", async () => {
    const { storage } = memoryStorage({ "device-id": deviceId });
    const fetchImpl = vi.fn();
    const auth = createHttpAuth({ baseUrl: "https://api.example", storage, fetchImpl });

    await expect(auth.getSession()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to a status code when an error payload contains secret or body text", async () => {
    const secret = "opaque-token secret/body";
    const bodyText = "enrollment code and full response body";
    const { storage } = memoryStorage({ [DEVICE_TOKEN_STORAGE_KEY]: "stored-token" });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: secret, detail: bodyText }, 500));
    const auth = createHttpAuth({ baseUrl: "https://api.example", storage, fetchImpl });

    let caught: unknown;
    try {
      await auth.getSession();
    } catch (reason: unknown) {
      caught = reason;
    }

    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error & { code?: string; status?: number };
    expect(error).toMatchObject({ code: "http_500", status: 500, message: "http_500" });
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(bodyText);
  });

  it("removes only the rejected device token before notifying listeners on a 401", async () => {
    const values = new Map([
      ["device-id", deviceId],
      [DEVICE_TOKEN_STORAGE_KEY, "expired-token"],
      ["unrelated", "keep-me"],
    ]);
    const operations: string[] = [];
    const storage = {
      get: (key: string) => values.get(key) ?? null,
      set: (key: string, value: string) => { values.set(key, value); },
      async remove(key: string) {
        await Promise.resolve();
        values.delete(key);
        operations.push(`removed:${key}`);
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "device_unauthorized" }, 401));
    const auth = createHttpAuth({ baseUrl: "https://api.example", storage, fetchImpl });
    auth.onAuthStateChange((session) => operations.push(`notified:${String(session)}`));

    await expect(auth.getSession()).resolves.toBeNull();

    expect(operations).toEqual([`removed:${DEVICE_TOKEN_STORAGE_KEY}`, "notified:null"]);
    expect(values).toEqual(new Map([["device-id", deviceId], ["unrelated", "keep-me"]]));
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer expired-token" }),
    }));
  });

  it("never removes a newly enrolled token when an older session request returns 401", async () => {
    let releaseRemove!: () => void;
    let markRemoveStarted!: () => void;
    const removeStarted = new Promise<void>((resolve) => { markRemoveStarted = resolve; });
    const removeMayFinish = new Promise<void>((resolve) => { releaseRemove = resolve; });
    const values = new Map([[DEVICE_TOKEN_STORAGE_KEY, "old-token"]]);
    const storage = {
      get: (key: string) => values.get(key) ?? null,
      set: (key: string, value: string) => { values.set(key, value); },
      async remove(key: string) {
        markRemoveStarted();
        await removeMayFinish;
        values.delete(key);
      },
    };
    let sessionCalls = 0;
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith("/v1/devices/enroll")) {
        return jsonResponse({ deviceToken: "new-token", userId: "owner-1" }, 201);
      }
      sessionCalls += 1;
      if (sessionCalls === 1) return jsonResponse({ error: "device_unauthorized" }, 401);
      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer new-token" }));
      return jsonResponse({ userId: "owner-1" });
    });
    const auth = createHttpAuth({
      baseUrl: "https://api.example",
      storage,
      deviceId,
      devicePlatform: "macos",
      fetchImpl,
    });

    const staleSession = auth.getSession();
    await removeStarted;
    const enrollment = auth.enroll({ apiUrl: "https://api.example", enrollmentCode: "single-use" });
    for (let attempt = 0; attempt < 20 && values.get(DEVICE_TOKEN_STORAGE_KEY) !== "new-token"; attempt += 1) {
      await Promise.resolve();
    }
    releaseRemove();

    await expect(staleSession).resolves.toBeNull();
    await expect(enrollment).resolves.toEqual({ userId: "owner-1" });
    expect(values.get(DEVICE_TOKEN_STORAGE_KEY)).toBe("new-token");
  });

  it("supports async getItem/setItem/removeItem storage without password methods", async () => {
    const values = new Map<string, string>();
    const storage = {
      async getItem(key: string) { return values.get(key) ?? null; },
      async setItem(key: string, value: string) { values.set(key, value); },
      async removeItem(key: string) { values.delete(key); },
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ deviceToken: "fallback-token", userId: "owner-2" }, 201))
      .mockResolvedValueOnce(jsonResponse({ userId: "owner-2" }));
    const auth = createHttpAuth({
      baseUrl: "https://api.example",
      storage,
      deviceId,
      devicePlatform: "windows",
      fetchImpl,
    });

    await auth.enroll({ apiUrl: "https://api.example", enrollmentCode: "single-use" });
    await expect(storage.getItem(DEVICE_TOKEN_STORAGE_KEY)).resolves.toBe("fallback-token");
    await auth.clearDeviceCredential();
    await expect(storage.getItem(DEVICE_TOKEN_STORAGE_KEY)).resolves.toBeNull();
    expect("signIn" in auth).toBe(false);
    expect("signOut" in auth).toBe(false);
  });

  it("notifies active listeners after enrollment and credential clearing", async () => {
    const { storage } = memoryStorage();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ deviceToken: "listener-token", userId: "owner-3" }, 201))
      .mockResolvedValueOnce(jsonResponse({ userId: "owner-3" }));
    const auth = createHttpAuth({
      baseUrl: "https://api.example",
      storage,
      deviceId,
      devicePlatform: "macos",
      fetchImpl,
    });
    const listener = vi.fn();
    const removedListener = vi.fn();
    const unsubscribe = auth.onAuthStateChange(listener);
    const unsubscribeRemoved = auth.onAuthStateChange(removedListener);

    await auth.enroll({ apiUrl: "https://api.example", enrollmentCode: "single-use" });
    expect(listener).toHaveBeenLastCalledWith({ userId: "owner-3" });
    expect(removedListener).toHaveBeenCalledTimes(1);

    unsubscribeRemoved();
    unsubscribeRemoved();
    await auth.clearDeviceCredential();
    expect(listener).toHaveBeenLastCalledWith(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(removedListener).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribe();
  });
});
