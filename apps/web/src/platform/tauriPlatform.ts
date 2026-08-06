import type { PlatformPort, SessionStoragePort } from "./PlatformPort";
import { webPlatform } from "./webPlatform";

export interface TauriInvoke {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface TauriPlatformOptions {
  invoke: TauriInvoke;
  now?: () => Date;
  createDeviceId?: () => string;
  devicePlatform?: "macos" | "windows";
  fallbackStorage?: SessionStoragePort;
}

export interface RuntimePlatformOptions extends Partial<TauriPlatformOptions> {
  scope?: unknown;
}

type TauriRuntimeMarker = {
  __TAURI_INTERNALS__?: {
    invoke?: unknown;
  };
};

export function isTauriRuntime(scope: unknown = globalThis): boolean {
  const marker = scope as TauriRuntimeMarker | null | undefined;
  return typeof marker?.__TAURI_INTERNALS__?.invoke === "function";
}

function localIsoDate(now: () => Date): string {
  const date = now();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nativeDeviceId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nativeDevicePlatform(): "macos" | "windows" {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
    ? "windows"
    : "macos";
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function createMemorySessionStorage(): SessionStoragePort {
  const values = new Map<string, string>();
  const get = (key: string) => values.get(key) ?? null;
  const set = (key: string, value: string) => { values.set(key, value); };
  const remove = (key: string) => { values.delete(key); };
  return { get, set, remove, getItem: get, setItem: set, removeItem: remove };
}

/**
 * The native keychain is preferred, but a locked/unavailable login keychain
 * must not prevent the desktop UI from starting. Session material never falls
 * back to WebView localStorage, so the only fallback is process memory.
 */
function createFallbackSessionStorage(): SessionStoragePort {
  return createMemorySessionStorage();
}

export function createTauriSessionStorage(
  invoke: TauriInvoke,
  fallbackStorage: SessionStoragePort = createFallbackSessionStorage(),
): SessionStoragePort {
  const useNativeOrFallback = async <T>(
    nativeOperation: () => Promise<T>,
    fallbackOperation: () => T | Promise<T>,
  ): Promise<T> => {
    try {
      return await nativeOperation();
    } catch {
      return await fallbackOperation();
    }
  };
  const get = (key: string) => useNativeOrFallback(
    async () => asString(await invoke("secure_storage_get", { key })),
    () => fallbackStorage.get(key),
  );
  const set = async (key: string, value: string) => {
    try {
      await invoke("secure_storage_set", { key, value });
    } catch {
      await fallbackStorage.set(key, value);
      return;
    }
    await fallbackStorage.remove(key);
  };
  const remove = async (key: string) => {
    try {
      await invoke("secure_storage_remove", { key });
    } catch (reason: unknown) {
      await fallbackStorage.remove(key);
      throw reason;
    }
    await fallbackStorage.remove(key);
  };
  return {
    get,
    set,
    remove,
    getItem: get,
    setItem: set,
    removeItem: remove,
  };
}

function isCodexDeepLink(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "codex:") return false;
    if (url.hostname === "threads") return Boolean(url.pathname.replace(/^\//, ""));
    return url.hostname === "new";
  } catch {
    return false;
  }
}

export async function createTauriPlatform(options: TauriPlatformOptions): Promise<PlatformPort> {
  const now = options.now ?? (() => new Date());
  const storage = createTauriSessionStorage(options.invoke, options.fallbackStorage);
  let deviceId = asString(await storage.get("device-id"));
  if (!deviceId) {
    deviceId = (options.createDeviceId ?? nativeDeviceId)();
    await storage.set("device-id", deviceId);
  }

  return {
    mode: "desktop",
    devicePlatform: options.devicePlatform ?? nativeDevicePlatform(),
    deviceId,
    today: () => localIsoDate(now),
    openExternal: async (url) => {
      if (!isCodexDeepLink(url)) throw new Error("Only validated codex:// links can be opened by the desktop shell");
      await options.invoke("open_codex_link", { url });
    },
    sessionStorage: storage,
  };
}

export async function createRuntimePlatform(options: RuntimePlatformOptions = {}): Promise<PlatformPort> {
  if (!isTauriRuntime(options.scope ?? globalThis)) return webPlatform;
  const invoke = options.invoke ?? (await import("@tauri-apps/api/core")).invoke;
  return createTauriPlatform({
    invoke,
    now: options.now,
    createDeviceId: options.createDeviceId,
    devicePlatform: options.devicePlatform,
    fallbackStorage: options.fallbackStorage,
  });
}
