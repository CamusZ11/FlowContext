import { describe, expect, it, vi } from "vitest";
import {
  createRuntimePlatform,
  createTauriPlatform,
  isTauriRuntime,
  type TauriInvoke,
} from "./tauriPlatform";

function fakeTauriScope() {
  return { __TAURI_INTERNALS__: { invoke: vi.fn() } };
}

function secureInvoke(initialDeviceId: string | null = null) {
  const values = new Map<string, string>();
  if (initialDeviceId) values.set("device-id", initialDeviceId);
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invoke: TauriInvoke = async (command, args) => {
    calls.push({ command, args });
    const key = String(args?.key ?? "");
    if (command === "secure_storage_get") return values.get(key) ?? null;
    if (command === "secure_storage_set") {
      values.set(key, String(args?.value ?? ""));
      return null;
    }
    if (command === "secure_storage_remove") {
      values.delete(key);
      return null;
    }
    return null;
  };
  return { invoke, calls, values };
}

describe("Tauri platform", () => {
  it("reliably detects the Tauri runtime marker", () => {
    expect(isTauriRuntime(fakeTauriScope())).toBe(true);
    expect(isTauriRuntime({})).toBe(false);
  });

  it("uses desktop mode and only returns today", async () => {
    const { invoke } = secureInvoke();
    const platform = await createTauriPlatform({
      invoke,
      now: () => new Date("2026-08-03T08:00:00+08:00"),
      createDeviceId: () => "device-mac-1",
      devicePlatform: "macos",
    });

    expect(platform.mode).toBe("desktop");
    expect(platform.devicePlatform).toBe("macos");
    expect(platform.today()).toBe("2026-08-03");
  });

  it("stores the device token through native secure storage, never browser localStorage", async () => {
    const { invoke, calls } = secureInvoke();
    const fallbackSet = vi.fn();
    const fallbackStorage = {
      get: () => null,
      set: fallbackSet,
      remove: () => undefined,
      getItem: () => null,
      setItem: fallbackSet,
      removeItem: () => undefined,
    };
    const platform = await createTauriPlatform({
      invoke,
      createDeviceId: () => "device-mac-1",
      fallbackStorage,
    });

    await platform.sessionStorage.set("flowcontext.device-token", "secret-session");
    expect(fallbackSet).not.toHaveBeenCalled();
    expect(calls).toContainEqual({
      command: "secure_storage_set",
      args: { key: "flowcontext.device-token", value: "secret-session" },
    });
  });

  it("keeps sessions in memory when native secure storage is unavailable", async () => {
    window.localStorage.clear();
    const invoke: TauriInvoke = async (command) => {
      if (command === "device_token_clear_intent_get") return false;
      throw new Error("keychain unavailable");
    };
    const platform = await createTauriPlatform({
      invoke,
      createDeviceId: () => "device-fallback-1",
    });

    await platform.sessionStorage.set("flowcontext.device-token", "secret-session");

    expect(platform.deviceId).toBe("device-fallback-1");
    expect(await platform.sessionStorage.get("flowcontext.device-token")).toBe("secret-session");
    expect(window.localStorage.getItem("flowcontext.device-token")).toBeNull();
  });

  it("persists a session after a temporary Keychain failure during startup", async () => {
    const values = new Map<string, string>();
    let failNextGet = true;
    const invoke: TauriInvoke = async (command, args) => {
      const key = String(args?.key ?? "");
      if (command === "secure_storage_get" && failNextGet) {
        failNextGet = false;
        throw new Error("keychain is temporarily unavailable");
      }
      if (command === "secure_storage_get") return values.get(key) ?? null;
      if (command === "secure_storage_set") {
        values.set(key, String(args?.value ?? ""));
        return null;
      }
      if (command === "secure_storage_remove") {
        values.delete(key);
        return null;
      }
      return null;
    };

    const firstLaunch = await createTauriPlatform({
      invoke,
      createDeviceId: () => "device-mac-1",
    });
    await firstLaunch.sessionStorage.set("flowcontext.device-token", "persistent-session");

    const restartedLaunch = await createTauriPlatform({
      invoke,
      createDeviceId: () => "device-mac-2",
    });

    expect(await restartedLaunch.sessionStorage.get("flowcontext.device-token")).toBe("persistent-session");
  });

  it("persists deletion intent so a failed native delete cannot resurrect the token after restart", async () => {
    const values = new Map([
      ["device-id", "device-mac-1"],
      ["flowcontext.device-token", "persistent-session"],
    ]);
    let failRemove = true;
    let removeCalls = 0;
    const invoke: TauriInvoke = async (command, args) => {
      const key = String(args?.key ?? "");
      if (command === "secure_storage_get") return values.get(key) ?? null;
      if (command === "secure_storage_set") {
        values.set(key, String(args?.value ?? ""));
        return null;
      }
      if (command === "secure_storage_remove") {
        removeCalls += 1;
        if (failRemove) throw new Error("keychain delete failed");
        values.delete(key);
      }
      return null;
    };
    const firstLaunch = await createTauriPlatform({ invoke });

    await expect(firstLaunch.sessionStorage.remove("flowcontext.device-token"))
      .rejects.toThrow("keychain delete failed");

    const restartedLaunch = await createTauriPlatform({ invoke });
    expect(await restartedLaunch.sessionStorage.get("flowcontext.device-token")).toBeNull();
    expect(removeCalls).toBe(2);

    failRemove = false;
    expect(await restartedLaunch.sessionStorage.get("flowcontext.device-token")).toBeNull();
    expect(values.has("flowcontext.device-token")).toBe(false);
    expect(removeCalls).toBe(3);
  });

  it("does not resurrect a token after both the protected tombstone write and delete fail", async () => {
    const values = new Map([
      ["device-id", "device-mac-1"],
      ["flowcontext.device-token", "persistent-session"],
    ]);
    let clearIntent = false;
    let failTokenSet = true;
    let failTokenRemove = true;
    const invoke: TauriInvoke = async (command, args) => {
      const key = String(args?.key ?? "");
      if (command === "device_token_clear_intent_get") return clearIntent;
      if (command === "device_token_clear_intent_set") {
        clearIntent = true;
        return null;
      }
      if (command === "device_token_clear_intent_remove") {
        clearIntent = false;
        return null;
      }
      if (command === "secure_storage_get") return values.get(key) ?? null;
      if (command === "secure_storage_set") {
        if (key === "flowcontext.device-token" && failTokenSet) {
          throw new Error("keychain tombstone write failed");
        }
        values.set(key, String(args?.value ?? ""));
        return null;
      }
      if (command === "secure_storage_remove") {
        if (key === "flowcontext.device-token" && failTokenRemove) {
          throw new Error("keychain delete failed");
        }
        values.delete(key);
      }
      return null;
    };
    const firstLaunch = await createTauriPlatform({ invoke });

    await expect(firstLaunch.sessionStorage.remove("flowcontext.device-token"))
      .rejects.toThrow("keychain tombstone write failed");

    const restartedLaunch = await createTauriPlatform({ invoke });
    expect(await restartedLaunch.sessionStorage.get("flowcontext.device-token")).toBeNull();
    expect(values.get("flowcontext.device-token")).toBe("persistent-session");

    failTokenSet = false;
    failTokenRemove = false;
    expect(await restartedLaunch.sessionStorage.get("flowcontext.device-token")).toBeNull();
    expect(values.has("flowcontext.device-token")).toBe(false);
    expect(clearIntent).toBe(false);
  });

  it("does not read an old native token when the clear-intent state is unreadable", async () => {
    const nativeTokenReads = vi.fn();
    const fallbackValues = new Map([["flowcontext.device-token", "stale-process-session"]]);
    const invoke: TauriInvoke = async (command, args) => {
      const key = String(args?.key ?? "");
      if (command === "device_token_clear_intent_get") {
        throw new Error("invalid device token clear intent store");
      }
      if (command === "secure_storage_get" && key === "device-id") return "device-mac-1";
      if (command === "secure_storage_get" && key === "flowcontext.device-token") {
        nativeTokenReads();
        return "persistent-session";
      }
      return null;
    };
    const fallbackStorage = {
      get: (key: string) => fallbackValues.get(key) ?? null,
      set: (key: string, value: string) => { fallbackValues.set(key, value); },
      remove: (key: string) => { fallbackValues.delete(key); },
      getItem: (key: string) => fallbackValues.get(key) ?? null,
      setItem: (key: string, value: string) => { fallbackValues.set(key, value); },
      removeItem: (key: string) => { fallbackValues.delete(key); },
    };
    const restartedLaunch = await createTauriPlatform({ invoke, fallbackStorage });

    expect(await restartedLaunch.sessionStorage.get("flowcontext.device-token")).toBeNull();
    expect(nativeTokenReads).not.toHaveBeenCalled();
    expect(fallbackValues.has("flowcontext.device-token")).toBe(false);
  });

  it("also deletes the process-memory copy after native credential deletion succeeds", async () => {
    const nativeValues = new Map([
      ["device-id", "device-mac-1"],
      ["flowcontext.device-token", "persistent-session"],
    ]);
    const fallbackValues = new Map([["flowcontext.device-token", "persistent-session"]]);
    let failNativeGet = false;
    const invoke: TauriInvoke = async (command, args) => {
      const key = String(args?.key ?? "");
      if (command === "secure_storage_get") {
        if (failNativeGet) throw new Error("keychain read failed");
        return nativeValues.get(key) ?? null;
      }
      if (command === "secure_storage_set") {
        nativeValues.set(key, String(args?.value ?? ""));
        return null;
      }
      if (command === "secure_storage_remove") nativeValues.delete(key);
      return null;
    };
    const fallbackStorage = {
      get: (key: string) => fallbackValues.get(key) ?? null,
      set: (key: string, value: string) => { fallbackValues.set(key, value); },
      remove: (key: string) => { fallbackValues.delete(key); },
      getItem: (key: string) => fallbackValues.get(key) ?? null,
      setItem: (key: string, value: string) => { fallbackValues.set(key, value); },
      removeItem: (key: string) => { fallbackValues.delete(key); },
    };
    const platform = await createTauriPlatform({ invoke, fallbackStorage });

    await platform.sessionStorage.remove("flowcontext.device-token");
    failNativeGet = true;

    expect(await platform.sessionStorage.get("flowcontext.device-token")).toBeNull();
  });

  it("discards a stale process-memory token after a newer native token is stored", async () => {
    const nativeValues = new Map([["device-id", "device-mac-1"]]);
    const fallbackValues = new Map([["flowcontext.device-token", "stale-session"]]);
    let failNativeGet = false;
    const invoke: TauriInvoke = async (command, args) => {
      const key = String(args?.key ?? "");
      if (command === "secure_storage_get") {
        if (failNativeGet) throw new Error("keychain read failed");
        return nativeValues.get(key) ?? null;
      }
      if (command === "secure_storage_set") {
        nativeValues.set(key, String(args?.value ?? ""));
        return null;
      }
      if (command === "secure_storage_remove") nativeValues.delete(key);
      return null;
    };
    const fallbackStorage = {
      get: (key: string) => fallbackValues.get(key) ?? null,
      set: (key: string, value: string) => { fallbackValues.set(key, value); },
      remove: (key: string) => { fallbackValues.delete(key); },
      getItem: (key: string) => fallbackValues.get(key) ?? null,
      setItem: (key: string, value: string) => { fallbackValues.set(key, value); },
      removeItem: (key: string) => { fallbackValues.delete(key); },
    };
    const platform = await createTauriPlatform({ invoke, fallbackStorage });

    await platform.sessionStorage.set("flowcontext.device-token", "new-session");
    failNativeGet = true;

    expect(await platform.sessionStorage.get("flowcontext.device-token")).toBeNull();
  });

  it("opens codex links through the validated native command", async () => {
    const { invoke, calls } = secureInvoke();
    const platform = await createTauriPlatform({
      invoke,
      createDeviceId: () => "device-mac-1",
    });

    await platform.openExternal("codex://threads/thread-1");
    expect(calls).toContainEqual({
      command: "open_codex_link",
      args: { url: "codex://threads/thread-1" },
    });
    await expect(platform.openExternal("https://example.com")).rejects.toThrow(/codex/i);
  });

  it("selects desktop mode from the Tauri runtime without changing the web platform", async () => {
    const { invoke } = secureInvoke();
    const platform = await createRuntimePlatform({
      scope: fakeTauriScope(),
      invoke,
      createDeviceId: () => "device-win-1",
    });
    expect(platform.mode).toBe("desktop");
    expect(platform.deviceId).toBe("device-win-1");
  });
});
