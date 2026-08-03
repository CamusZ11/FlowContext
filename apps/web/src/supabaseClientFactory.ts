import { createSupabaseClient } from "@flowcontext/data";
import type { SupabaseAuthStorage } from "@flowcontext/data";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SupabaseViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

type SupabaseClientFactory<TClient> = (
  url?: string,
  anonKey?: string,
  options?: { authStorage?: SupabaseAuthStorage },
) => TClient;

export function createConfiguredSupabaseClient(
  env: SupabaseViteEnv,
  authStorage?: SupabaseAuthStorage,
): SupabaseClient;
export function createConfiguredSupabaseClient<TClient>(
  env: SupabaseViteEnv,
  authStorage: SupabaseAuthStorage | undefined,
  factory: SupabaseClientFactory<TClient>,
): TClient;
export function createConfiguredSupabaseClient<TClient>(
  env: SupabaseViteEnv,
  authStorage?: SupabaseAuthStorage,
  factory: SupabaseClientFactory<TClient> = createSupabaseClient as SupabaseClientFactory<TClient>,
): TClient {
  return factory(
    env.VITE_SUPABASE_URL?.trim(),
    env.VITE_SUPABASE_ANON_KEY?.trim(),
    authStorage ? { authStorage } : undefined,
  );
}
