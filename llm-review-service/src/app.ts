import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerWebhookRoutes } from "./routes/webhooks";
import { createLogger } from "./logger";
import type { Config } from "./config";
import { createReviewQueue } from "./review/queue";

export async function buildApp(args: { config: Config }) {
  const logger = createLogger();
  const app = Fastify({ logger });

  await app.register(cors, { origin: true });
  const queue = createReviewQueue(args.config);
  app.addHook("onClose", async () => {
    await queue.close();
  });

  await app.register(registerWebhookRoutes, { config: args.config, queue });

  return app;
}
