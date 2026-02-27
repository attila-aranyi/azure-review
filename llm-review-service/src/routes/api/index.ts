import type { FastifyPluginAsync } from "fastify";
import { adoAuthMiddleware } from "../../middleware/adoAuth";
import { registerTenantRoutes } from "./tenants";
import { registerConfigRoutes } from "./config";
import { registerProjectRoutes } from "./projects";
import { registerReviewRoutes } from "./reviews";
import type { AppConfig } from "../../config/appConfig";
import type { DrizzleInstance } from "../../db/connection";
import type { TokenManager } from "../../auth/tokenManager";
import type { ReviewQueue } from "../../review/queue";

export const registerApiRoutes: FastifyPluginAsync<{
  appConfig: AppConfig;
  db: DrizzleInstance;
  tokenManager: TokenManager;
  queue: ReviewQueue;
}> = async (app, opts) => {
  const { appConfig, db, tokenManager, queue } = opts;

  // Apply ADO auth middleware to all /api routes
  await app.register(adoAuthMiddleware, { appConfig, db });

  await app.register(registerTenantRoutes, { db });
  await app.register(registerConfigRoutes, { db });
  await app.register(registerProjectRoutes, { db, appConfig, tokenManager });
  await app.register(registerReviewRoutes, { db, queue });
};
