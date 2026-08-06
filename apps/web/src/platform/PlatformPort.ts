export interface SessionStoragePort {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface PlatformPort {
  mode: "web" | "desktop";
  /** Native device family used by the enrollment API. */
  devicePlatform?: "macos" | "windows";
  /** Explicit device identity; absent means the device is not configured. */
  deviceId?: string;
  today(): string;
  openExternal(url: string): Promise<void>;
  sessionStorage: SessionStoragePort;
}
