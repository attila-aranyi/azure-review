import type { FastifyPluginAsync } from "fastify";
import type { Config } from "../config";

export const registerWebhookRoutes: FastifyPluginAsync<{ config: Config }> = async (app, opts) => {
  app.post("/webhooks/azure-devops/pr", async (request, reply) => {
    const secret = request.headers["x-webhook-secret"];
    if (secret !== opts.config.WEBHOOK_SECRET) {
      return reply.code(401).send({ ok: false });
    }

    // Pipeline stub for scaffolding; implemented in later steps.
    return reply.send({ ok: true });
  });
};

