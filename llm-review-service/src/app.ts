import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerWebhookRoutes } from "./routes/webhooks";
import { createLogger } from "./logger";
import type { Config } from "./config";

export async function buildApp(args: { config: Config }) {
  const logger = createLogger();
  const app = Fastify({ logger });

  await app.register(cors, { origin: true });
  await app.register(registerWebhookRoutes, { config: args.config });

  return app;
}

