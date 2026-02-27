import type { FastifyPluginAsync } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "../config/appConfig";

export const tenantRateLimiter: FastifyPluginAsync<{
  appConfig: AppConfig;
}> = async (app, opts) => {
  await app.register(rateLimit, {
    max: opts.appConfig.RATE_LIMIT_MAX,
    timeWindow: opts.appConfig.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (request) => {
      // Per-tenant rate limiting
      return (request as { tenantId?: string }).tenantId ?? request.ip;
    },
  });
};
