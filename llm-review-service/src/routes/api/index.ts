import type { FastifyPluginAsync } from "fastify";
import { adoAuthMiddleware } from "../../middleware/adoAuth";
import { registerTenantRoutes } from "./tenants";
import { registerConfigRoutes } from "./config";
import { registerProjectRoutes } from "./projects";
import { registerReviewRoutes } from "./reviews";
import { registerRepoConfigRoutes } from "./repoConfig";
import { registerLlmConfigRoutes } from "./llmConfig";
import { registerUsageRoutes } from "./usage";
import { registerRulesRoutes } from "./rules";
import { registerAuditExportRoutes } from "./auditExport";
import type { AppConfig } from "../../config/appConfig";
import type { DrizzleInstance } from "../../db/connection";
import type { TokenManager } from "../../auth/tokenManager";
import type { ReviewQueue } from "../../review/queue";

export const registerApiRoutes: FastifyPluginAsync<{
  appConfig: AppConfig;
  db: DrizzleInstance;
  tokenManager: TokenManager;
  queue: ReviewQueue;
  encryptionKey?: Buffer;
}> = async (app, opts) => {
  const { appConfig, db, tokenManager, queue, encryptionKey } = opts;

  // Apply ADO auth middleware to all /api routes
  await app.register(adoAuthMiddleware, { appConfig, db });

  await app.register(registerTenantRoutes, { db });
  await app.register(registerConfigRoutes, { db });
  await app.register(registerProjectRoutes, { db, appConfig, tokenManager });
  await app.register(registerReviewRoutes, { db, queue });
  await app.register(registerRepoConfigRoutes, { db });
  await app.register(registerLlmConfigRoutes, { db, encryptionKey });
  await app.register(registerUsageRoutes, { db });
  await app.register(registerRulesRoutes, { db });
  await app.register(registerAuditExportRoutes, { db });
};
