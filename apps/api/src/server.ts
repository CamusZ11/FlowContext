import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from "fastify";

import { authenticate, hashSecret, type Principal } from "./auth.js";
import type { ApiConfig } from "./config.js";
import { invalidRequest, ApiError } from "./errors.js";
import { generateDeviceToken, type AuthRepository } from "./enrollment.js";
import type { FlowDataRepository } from "./repository.js";
import { registerFlowRoutes } from "./router.js";
import type { TodoEventSource } from "./sse.js";

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export interface ServerDependencies {
  config: ApiConfig;
  repository: AuthRepository & FlowDataRepository;
  logger?: FastifyServerOptions["logger"];
  todoEvents?: TodoEventSource;
  now?: () => Date;
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

export function buildServer({ config, repository, logger, todoEvents, now }: ServerDependencies): FastifyInstance {
  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    logger: logger ?? (config.logLevel === "silent" ? false : { level: config.logLevel }),
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.status(error.statusCode).send({ error: error.code });
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 400) {
      return reply.status(400).send({ error: "invalid_json" });
    }
    return reply.status(500).send({ error: "internal_error" });
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: "not_found" }));

  // The desktop shell talks to this API from a tauri:// webview origin, so
  // every response (including errors and SSE) must carry CORS headers and
  // preflight must be answered before the auth hook runs. Credentials travel
  // in the Authorization header rather than cookies, so "*" is safe here.
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "OPTIONS") return;
    return reply
      .status(204)
      .headers({
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "authorization,content-type",
        "access-control-max-age": "86400",
      })
      .send();
  });

  app.addHook("onSend", async (_request, reply) => {
    if (!reply.hasHeader("access-control-allow-origin")) {
      reply.header("access-control-allow-origin", "*");
    }
  });

  app.addHook("preHandler", async (request) => {
    const pathname = request.url.split("?", 1)[0];
    if (!pathname.startsWith("/v1/") || pathname === "/v1/devices/enroll") return;
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

  registerFlowRoutes(app, repository, { todoEvents, now });

  return app;
}
