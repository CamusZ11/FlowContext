import { authenticate, requestIdFor } from "./auth.ts";
import {
  type ApiLogger,
  type ApiRepository,
  createSupabaseRepository,
  createUnconfiguredRepository,
  type SupabaseClientLike,
} from "./repository.ts";
import { errorResponse, route } from "./router.ts";
import { createClient } from "npm:@supabase/supabase-js@2.111.0";

export interface EnvironmentLike {
  get(name: string): string | undefined;
}

export interface SupabaseClientOptions {
  auth: {
    persistSession: boolean;
    autoRefreshToken: boolean;
    detectSessionInUrl: boolean;
  };
}

export type SupabaseClientFactory = (
  url: string,
  serviceRoleKey: string,
  options: SupabaseClientOptions,
) => SupabaseClientLike;

const defaultClientFactory: SupabaseClientFactory = (
  url,
  serviceRoleKey,
  options,
) =>
  createClient(url, serviceRoleKey, options) as unknown as SupabaseClientLike;

function runtimeEnvironment(): EnvironmentLike {
  return {
    get(name) {
      try {
        return Deno.env.get(name);
      } catch {
        // Local unit tests may not grant env access; fail closed in that case.
        return undefined;
      }
    },
  };
}

export function createRepositoryFromEnvironment(
  environment: EnvironmentLike = runtimeEnvironment(),
  clientFactory: SupabaseClientFactory = defaultClientFactory,
): ApiRepository {
  const url = environment.get("SUPABASE_URL");
  const serviceRoleKey = environment.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return createUnconfiguredRepository();

  return createSupabaseRepository(clientFactory(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }));
}

const consoleLogger: ApiLogger = {
  info(event, fields) {
    // Only request ID, device ID, and a fixed event reach logs.
    console.info(JSON.stringify({ event, ...fields }));
  },
};

/** Build a request handler so tests and the deployed function share one path. */
export function createHandler(
  repo: ApiRepository,
  logger: ApiLogger = consoleLogger,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const requestId = requestIdFor(request);
    try {
      const { principal, requestId: authenticatedRequestId } =
        await authenticate(request, repo);
      const response = await route(request, repo, principal);
      logger.info("flowcontext.request", {
        requestId: authenticatedRequestId,
        deviceId: principal.deviceId,
      });
      return response;
    } catch (error) {
      const response = errorResponse(error);
      logger.info("flowcontext.request", {
        requestId,
        deviceId: "anonymous",
      });
      return response;
    }
  };
}

export async function handleRequest(
  request: Request,
  repo: ApiRepository = createUnconfiguredRepository(),
  logger: ApiLogger = consoleLogger,
): Promise<Response> {
  return createHandler(repo, logger)(request);
}

const defaultHandler = createHandler(createRepositoryFromEnvironment());

export default { fetch: defaultHandler };

// Supabase Edge Runtime executes this module as the function entrypoint.
if (import.meta.main) {
  Deno.serve(defaultHandler);
}
