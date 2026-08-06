export interface ApiConfig {
  port: number;
  databaseUrl: string;
  ownerId: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl,
    ownerId: env.FLOWCONTEXT_OWNER_ID!,
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
