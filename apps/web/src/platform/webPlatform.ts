import type { PlatformPort } from "./PlatformPort";
import { createBrowserSessionStorage } from "./browserSessionStorage";

export const webSessionStorage = createBrowserSessionStorage();

function localIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const webPlatform: PlatformPort = {
  mode: "web",
  devicePlatform: getPublicDevicePlatform(),
  deviceId: getPublicDeviceId(),
  today: localIsoDate,
  openExternal: async (url) => {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
  sessionStorage: webSessionStorage,
};

function getPublicDevicePlatform(): "macos" | "windows" {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
    ? "windows"
    : "macos";
}

function getPublicDeviceId(): string | undefined {
  const configured = (import.meta as ImportMeta & { env?: { VITE_FLOWCONTEXT_DEVICE_ID?: string } }).env?.VITE_FLOWCONTEXT_DEVICE_ID?.trim();
  const stored = webSessionStorage.get("device-id") as string | null;
  if (configured || stored) return configured || stored || undefined;
  const generated = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : undefined;
  if (generated) webSessionStorage.set("device-id", generated);
  return generated;
}
