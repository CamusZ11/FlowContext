import { createRepositoryFromEnvironment } from "./index.ts";
import type { SupabaseClientLike, SupabaseResponse } from "./repository.ts";

type EnvLike = { get(name: string): string | undefined };
type ClientOptions = {
  auth: {
    persistSession: boolean;
    autoRefreshToken: boolean;
    detectSessionInUrl: boolean;
  };
};
type ClientFactory = (
  url: string,
  key: string,
  options: ClientOptions,
) => SupabaseClientLike;

class EmptyClient implements SupabaseClientLike {
  from(_table: string): never {
    throw new Error("not used");
  }

  rpc(
    _functionName: string,
    _args: Record<string, unknown>,
  ): Promise<SupabaseResponse> {
    throw new Error("not used");
  }
}

function env(values: Record<string, string | undefined>): EnvLike {
  return { get: (name) => values[name] };
}

Deno.test("missing Supabase environment fails closed", () => {
  const repository = createRepositoryFromEnvironment(env({}));
  if (!repository) throw new Error("expected repository boundary");
});

Deno.test("service-role client factory receives URL and key without logging it", () => {
  let receivedUrl = "";
  let receivedKey = "";
  let receivedOptions: ClientOptions | undefined;
  const repository = createRepositoryFromEnvironment(
    env({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key",
    }),
    ((url: string, key: string, options: ClientOptions) => {
      receivedUrl = url;
      receivedKey = key;
      receivedOptions = options;
      return new EmptyClient();
    }) as ClientFactory,
  );

  if (!repository) throw new Error("expected repository boundary");
  if (receivedUrl !== "https://example.supabase.co") {
    throw new Error("URL not passed to client factory");
  }
  if (receivedKey !== "fixture-service-role-key") {
    throw new Error("service-role key not passed to client factory");
  }
  if (receivedOptions?.auth?.persistSession !== false) {
    throw new Error("session persistence must be disabled");
  }
  if (receivedOptions?.auth?.autoRefreshToken !== false) {
    throw new Error("token refresh must be disabled");
  }
  if (receivedOptions?.auth?.detectSessionInUrl !== false) {
    throw new Error("URL session detection must be disabled");
  }
});
