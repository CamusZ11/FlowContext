import type { SessionStoragePort } from "./PlatformPort";

export interface StringStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createBrowserSessionStorage(
  // Browser credentials are a development-only convenience and must expire
  // with the tab. Production desktop builds use native secure storage.
  storage: StringStorageLike | undefined = typeof window === "undefined" ? undefined : window.sessionStorage,
  namespace = "flowcontext",
): SessionStoragePort & BrowserStorageLike {
  const availableStorage = isStringStorageLike(storage) ? storage : undefined;
  const prefix = `${namespace}:`;
  const adapter = {
    get: (key: string) => availableStorage?.getItem(`${prefix}${key}`) ?? null,
    set: (key: string, value: string) => availableStorage?.setItem(`${prefix}${key}`, value),
    remove: (key: string) => availableStorage?.removeItem(`${prefix}${key}`),
    getItem: (key: string) => availableStorage?.getItem(`${prefix}${key}`) ?? null,
    setItem: (key: string, value: string) => availableStorage?.setItem(`${prefix}${key}`, value),
    removeItem: (key: string) => availableStorage?.removeItem(`${prefix}${key}`),
  };
  return adapter;
}

function isStringStorageLike(storage: unknown): storage is StringStorageLike {
  return typeof storage === "object"
    && storage !== null
    && typeof (storage as StringStorageLike).getItem === "function"
    && typeof (storage as StringStorageLike).setItem === "function"
    && typeof (storage as StringStorageLike).removeItem === "function";
}
