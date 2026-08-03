import type { SessionStoragePort } from "./PlatformPort";

export interface StringStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SupabaseStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createBrowserSessionStorage(
  storage: StringStorageLike | undefined = typeof window === "undefined" ? undefined : window.localStorage,
  namespace = "flowcontext",
): SessionStoragePort & SupabaseStorageLike {
  const prefix = `${namespace}:`;
  const adapter = {
    get: (key: string) => storage?.getItem(`${prefix}${key}`) ?? null,
    set: (key: string, value: string) => storage?.setItem(`${prefix}${key}`, value),
    remove: (key: string) => storage?.removeItem(`${prefix}${key}`),
    getItem: (key: string) => storage?.getItem(`${prefix}${key}`) ?? null,
    setItem: (key: string, value: string) => storage?.setItem(`${prefix}${key}`, value),
    removeItem: (key: string) => storage?.removeItem(`${prefix}${key}`),
  };
  return adapter;
}
