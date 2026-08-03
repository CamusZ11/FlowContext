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
    });

    expect(platform.mode).toBe("desktop");
    expect(platform.today()).toBe("2026-08-03");
  });

  it("stores auth sessions through native secure storage, never browser localStorage", async () => {
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

    await platform.sessionStorage.set("supabase.session", "secret-session");
    expect(fallbackSet).not.toHaveBeenCalled();
    expect(calls).toContainEqual({
      command: "secure_storage_set",
      args: { key: "supabase.session", value: "secret-session" },
    });
  });

  it("keeps sessions in memory when native secure storage is unavailable", async () => {
    const invoke: TauriInvoke = async () => {
      throw new Error("keychain unavailable");
    };
    const platform = await createTauriPlatform({
      invoke,
      createDeviceId: () => "device-fallback-1",
    });

    await platform.sessionStorage.set("supabase.session", "secret-session");

    expect(platform.deviceId).toBe("device-fallback-1");
    expect(await platform.sessionStorage.get("supabase.session")).toBe("secret-session");
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
