import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerWebhookRoutes } from "./routes/webhooks";
import { registerHealthRoutes } from "./routes/health";
import { registerAuthRoutes } from "./routes/auth";
import { registerApiRoutes } from "./routes/api/index";
import { createLogger } from "./logger";
import type { Config } from "./config";
import type { AppConfig } from "./config/appConfig";
import type { DrizzleInstance } from "./db/connection";
import type { TokenManager } from "./auth/tokenManager";
import { createReviewQueue } from "./review/queue";
import { createFileAuditStore, createInMemoryAuditStore } from "./review/audit";
import type { AuditStore } from "./review/audit";
import { deriveEncryptionKey } from "./auth/encryption";

export type BuildAppArgs = {
  config: Config;
  appConfig?: AppConfig;
  db?: DrizzleInstance;
  tokenManager?: TokenManager;
};

export async function buildApp(args: BuildAppArgs) {
  const logger = createLogger();
  const app = Fastify({ logger });

  // Audit store (enabled by default)
  let auditStore: AuditStore | undefined;
  if (args.config.AUDIT_ENABLED) {
    auditStore = await createFileAuditStore({
      dataDir: path.join(process.cwd(), ".data"),
      retentionDays: args.config.AUDIT_RETENTION_DAYS,
    }).catch(() => {
      logger.warn("File audit store unavailable, using in-memory fallback");
      return createInMemoryAuditStore({
        retentionDays: args.config.AUDIT_RETENTION_DAYS,
      });
    });
  }

  const corsOrigins = args.config.CORS_ORIGINS;
  const isSelfHosted = args.appConfig?.DEPLOYMENT_MODE === "self-hosted";
  await app.register(cors, {
    origin: corsOrigins.length > 0 ? corsOrigins : isSelfHosted ? true : false,
  });

  const queue = createReviewQueue(args.config, auditStore, {
    db: args.db,
    appConfig: args.appConfig,
    tokenManager: args.tokenManager,
  });
  app.addHook("onClose", async () => {
    await queue.close();
  });

  await app.register(registerHealthRoutes, { queue });

  // Build encryption key for multi-tenant webhook auth
  let encryptionKey: Buffer | undefined;
  if (args.appConfig?.TOKEN_ENCRYPTION_KEY) {
    encryptionKey = deriveEncryptionKey(args.appConfig.TOKEN_ENCRYPTION_KEY);
  }

  await app.register(registerWebhookRoutes, {
    config: args.config,
    queue,
    auditStore,
    db: args.db,
    encryptionKey,
  });

  // Multi-tenant routes (only when DB + appConfig are provided)
  if (args.appConfig && args.db && args.tokenManager) {
    await app.register(registerAuthRoutes, {
      appConfig: args.appConfig,
      db: args.db,
      tokenManager: args.tokenManager,
    });

    await app.register(registerApiRoutes, {
      prefix: "/api",
      appConfig: args.appConfig,
      db: args.db,
      tokenManager: args.tokenManager,
      queue,
    });
  }

  return app;
}
