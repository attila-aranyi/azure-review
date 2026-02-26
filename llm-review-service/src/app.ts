import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerWebhookRoutes } from "./routes/webhooks";
import { registerHealthRoutes } from "./routes/health";
import { createLogger } from "./logger";
import type { Config } from "./config";
import { createReviewQueue } from "./review/queue";

export async function buildApp(args: { config: Config }) {
  const logger = createLogger();
  const app = Fastify({ logger });

  const corsOrigins = args.config.CORS_ORIGINS;
  await app.register(cors, {
    origin: corsOrigins.length > 0 ? corsOrigins : false
  });

  const queue = createReviewQueue(args.config);
  app.addHook("onClose", async () => {
    await queue.close();
  });

  await app.register(registerHealthRoutes, { queue });
  await app.register(registerWebhookRoutes, { config: args.config, queue });

  return app;
}
