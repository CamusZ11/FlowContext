import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from "fastify";

import { authenticate, hashSecret, type Principal } from "./auth.js";
import type { ApiConfig } from "./config.js";
import { invalidRequest, ApiError } from "./errors.js";
import { generateDeviceToken, type AuthRepository } from "./enrollment.js";

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export interface ServerDependencies {
  config: ApiConfig;
  repository: AuthRepository;
  logger?: FastifyServerOptions["logger"];
}

function isEnrollmentPayload(value: unknown): value is { enrollmentCode: string; deviceId: string; platform: "macos" | "windows" } {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.enrollmentCode === "string"
    && payload.enrollmentCode.length > 0
    && typeof payload.deviceId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.deviceId)
    && (payload.platform === "macos" || payload.platform === "windows");
}

export function buildServer({ config, repository, logger }: ServerDependencies): FastifyInstance {
  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    logger: logger ?? (config.logLevel === "silent" ? false : { level: config.logLevel }),
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.status(error.statusCode).send({ error: error.code });
    return reply.status(500).send({ error: "internal_error" });
  });

  app.addHook("preHandler", async (request) => {
    if (!request.url.startsWith("/v1/") || request.url === "/v1/devices/enroll") return;
    request.principal = await authenticate(request, repository);
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.post("/v1/devices/enroll", async (request, reply) => {
    if (!isEnrollmentPayload(request.body)) throw invalidRequest();

    const deviceToken = generateDeviceToken();
    const enrolled = await repository.enrollDevice({
      codeHash: hashSecret(request.body.enrollmentCode),
      deviceId: request.body.deviceId,
      ownerId: config.ownerId,
      tokenHash: hashSecret(deviceToken),
    });
    if (!enrolled) throw new ApiError(401, "device_unauthorized");

    app.log.info({ deviceId: request.body.deviceId }, "device enrolled");
    return reply.status(201).send({ deviceToken, userId: config.ownerId });
  });

  app.get("/v1/auth/session", async (request) => ({ userId: request.principal!.ownerId }));

  return app;
}
