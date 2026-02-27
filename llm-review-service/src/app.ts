import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerWebhookRoutes } from "./routes/webhooks";
import { registerHealthRoutes } from "./routes/health";
import { createLogger } from "./logger";
import type { Config } from "./config";
import { createReviewQueue } from "./review/queue";
import { createFileAuditStore, createInMemoryAuditStore } from "./review/audit";
import type { AuditStore } from "./review/audit";

export async function buildApp(args: { config: Config }) {
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
  await app.register(cors, {
    origin: corsOrigins.length > 0 ? corsOrigins : false
  });

  const queue = createReviewQueue(args.config, auditStore);
  app.addHook("onClose", async () => {
    await queue.close();
  });

  await app.register(registerHealthRoutes, { queue });
  await app.register(registerWebhookRoutes, { config: args.config, queue, auditStore });

  return app;
}
