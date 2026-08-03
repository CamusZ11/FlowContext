import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type RuntimeEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

export interface SupabaseAuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export function mergeRuntimeEnv(viteEnv: RuntimeEnv, processEnv: RuntimeEnv): RuntimeEnv {
  return { ...processEnv, ...viteEnv };
}

function runtimeEnv(): RuntimeEnv {
  const viteEnv = (import.meta as ImportMeta & { env?: RuntimeEnv }).env ?? {};
  const processEnv = (globalThis as typeof globalThis & {
    process?: { env?: RuntimeEnv };
  }).process?.env;
  return mergeRuntimeEnv(viteEnv, processEnv ?? {});
}

/**
 * Create a browser-safe client from an explicitly supplied publishable key or
 * the Vite/Node public environment variables. Callers must never pass a
 * service-role key to this browser-facing factory.
 */
export function createSupabaseClient(
  url = runtimeEnv().VITE_SUPABASE_URL,
  anonKey = runtimeEnv().VITE_SUPABASE_ANON_KEY,
  options: { authStorage?: SupabaseAuthStorage } = {},
): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required");
  }
  return createClient(url, anonKey, options.authStorage ? {
    auth: {
      storage: options.authStorage,
    },
  } : undefined);
}
