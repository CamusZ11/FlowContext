import Fastify, { type FastifyInstance } from "fastify";

import type { ApiConfig } from "./config.js";

export interface ServerDependencies {
  config: ApiConfig;
  repository: unknown;
}

export function buildServer({ config }: ServerDependencies): FastifyInstance {
  const app = Fastify({ logger: config.logLevel === "silent" ? false : { level: config.logLevel } });

  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
}
