import { createContext, useContext } from "react";
import type { PlatformPort } from "../platform/PlatformPort";

const PlatformContext = createContext<PlatformPort | null>(null);

export const PlatformProvider = PlatformContext.Provider;

export function usePlatform(): PlatformPort {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error("Platform is not configured");
  return platform;
}
