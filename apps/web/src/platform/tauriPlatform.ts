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
  const bytes = typeof cryptoApi?.getRandomValues === "function"
    ? cryptoApi.getRandomValues(new Uint8Array(16))
    : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return hex.slice(0, 4).join("")
    + "-" + hex.slice(4, 6).join("")
    + "-" + hex.slice(6, 8).join("")
    + "-" + hex.slice(8, 10).join("")
    + "-" + hex.slice(10, 16).join("");
}

function nativeDevicePlatform(): "macos" | "windows" {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
    ? "windows"
    : "macos";
}

function asRuntimePlatform(value: unknown): "macos" | "windows" | null {
  return value === "macos" || value === "windows" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const DEVICE_TOKEN_KEY = "flowcontext.device-token";
const API_DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_TOKEN_DELETE_TOMBSTONE = "__flowcontext_device_token_delete_pending_v1__";
const DEVICE_TOKEN_CLEAR_INTENT_GET = "device_token_clear_intent_get";
const DEVICE_TOKEN_CLEAR_INTENT_SET = "device_token_clear_intent_set";
const DEVICE_TOKEN_CLEAR_INTENT_REMOVE = "device_token_clear_intent_remove";

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

async function hasDeviceTokenForIdentityMigration(
  invoke: TauriInvoke,
  fallbackStorage: SessionStoragePort,
): Promise<boolean> {
  try {
    if (await invoke(DEVICE_TOKEN_CLEAR_INTENT_GET) === true) {
      return Boolean(await fallbackStorage.get(DEVICE_TOKEN_KEY));
    }
    const nativeValue = asString(await invoke("secure_storage_get", { key: DEVICE_TOKEN_KEY }));
    return Boolean(nativeValue && nativeValue !== DEVICE_TOKEN_DELETE_TOMBSTONE);
  } catch {
    return Boolean(await fallbackStorage.get(DEVICE_TOKEN_KEY));
  }
}

export function createTauriSessionStorage(
  invoke: TauriInvoke,
  fallbackStorage: SessionStoragePort = createFallbackSessionStorage(),
): SessionStoragePort {
  const get = async (key: string): Promise<string | null> => {
    if (key === DEVICE_TOKEN_KEY) {
      let clearPending: boolean;
      try {
        clearPending = await invoke(DEVICE_TOKEN_CLEAR_INTENT_GET) === true;
      } catch {
        // The intent state is authoritative. If it cannot be read, neither a
        // native credential nor a possibly stale process fallback is trusted.
        await fallbackStorage.remove(key);
        return null;
      }
      if (clearPending) {
        const fallbackValue = await fallbackStorage.get(key);
        if (fallbackValue) return fallbackValue;
        try {
          await invoke("secure_storage_remove", { key });
          await invoke(DEVICE_TOKEN_CLEAR_INTENT_REMOVE);
        } catch {
          // The durable marker remains, so every later launch retries cleanup.
        }
        await fallbackStorage.remove(key);
        return null;
      }
    }
    try {
      const nativeValue = asString(await invoke("secure_storage_get", { key }));
      if (key !== DEVICE_TOKEN_KEY || nativeValue !== DEVICE_TOKEN_DELETE_TOMBSTONE) {
        return nativeValue;
      }
      const fallbackValue = await fallbackStorage.get(key);
      if (fallbackValue) return fallbackValue;
      try {
        await invoke("secure_storage_remove", { key });
      } catch {
        // Keep the protected tombstone so the next launch retries cleanup.
      }
      await fallbackStorage.remove(key);
      return null;
    } catch {
      return await fallbackStorage.get(key);
    }
  };
  const set = async (key: string, value: string) => {
    try {
      await invoke("secure_storage_set", { key, value });
    } catch {
      await fallbackStorage.set(key, value);
      return;
    }
    await fallbackStorage.remove(key);
    if (key === DEVICE_TOKEN_KEY) {
      await invoke(DEVICE_TOKEN_CLEAR_INTENT_REMOVE);
    }
  };
  const remove = async (key: string) => {
    if (key === DEVICE_TOKEN_KEY) {
      await invoke(DEVICE_TOKEN_CLEAR_INTENT_SET);
      await fallbackStorage.remove(key);
      let tombstoneReason: unknown;
      try {
        await invoke("secure_storage_set", { key, value: DEVICE_TOKEN_DELETE_TOMBSTONE });
      } catch (reason: unknown) {
        tombstoneReason = reason;
      }
      try {
        await invoke("secure_storage_remove", { key });
      } catch (reason: unknown) {
        throw tombstoneReason ?? reason;
      }
      await invoke(DEVICE_TOKEN_CLEAR_INTENT_REMOVE);
      return;
    }
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

export function isCodexDeepLink(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "codex:" || url.username || url.password || url.port) return false;
    if (url.hostname === "threads") {
      const segments = url.pathname.split("/").filter(Boolean);
      return segments.length === 1 && segments[0].trim().length > 0;
    }
    return url.hostname === "new" && (url.pathname === "" || url.pathname === "/");
  } catch {
    return false;
  }
}

export async function createTauriPlatform(options: TauriPlatformOptions): Promise<PlatformPort> {
  const now = options.now ?? (() => new Date());
  const fallbackStorage = options.fallbackStorage ?? createFallbackSessionStorage();
  const storage = createTauriSessionStorage(options.invoke, fallbackStorage);
  const detectedPlatform = asRuntimePlatform(await options.invoke("get_runtime_platform").catch(() => null));
  let deviceId = asString(await storage.get("device-id"));
  const needsMigration = Boolean(deviceId && !API_DEVICE_ID_PATTERN.test(deviceId));
  const deviceTokenPresent = needsMigration
    ? await hasDeviceTokenForIdentityMigration(options.invoke, fallbackStorage)
    : false;
  if (!deviceId || (needsMigration && !deviceTokenPresent)) {
    deviceId = (options.createDeviceId ?? nativeDeviceId)();
    await storage.set("device-id", deviceId);
  }

  return {
    mode: "desktop",
    // Registration uses the Rust compile target rather than the WebView UA.
    devicePlatform: options.devicePlatform ?? detectedPlatform ?? nativeDevicePlatform(),
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
