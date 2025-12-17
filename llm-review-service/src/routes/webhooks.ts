import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Config } from "../config";
import { runReview } from "../review/runReview";

export const registerWebhookRoutes: FastifyPluginAsync<{ config: Config }> = async (app, opts) => {
  app.post("/webhooks/azure-devops/pr", async (request, reply) => {
    const headerValue = request.headers["x-webhook-secret"];
    const secret = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (secret !== opts.config.WEBHOOK_SECRET) {
      return reply.code(401).send({ ok: false });
    }

    const payloadSchema = z
      .object({
        pullRequestId: z.number().int().positive().optional(),
        repository: z
          .object({
            id: z.string().min(1)
          })
          .passthrough()
          .optional(),
        resource: z
          .object({
            pullRequestId: z.number().int().positive(),
            repository: z
              .object({
                id: z.string().min(1)
              })
              .passthrough()
          })
          .passthrough()
          .optional()
      })
      .passthrough();

    const parsed = payloadSchema.safeParse(request.body);
    if (!parsed.success) {
      app.log.warn({ issues: parsed.error.issues }, "Invalid webhook payload");
      return reply.code(400).send({ ok: false });
    }

    const body = parsed.data;
    const prId = body.pullRequestId ?? body.resource?.pullRequestId;
    const repoId = body.repository?.id ?? body.resource?.repository.id;
    if (!prId || !repoId) {
      app.log.warn({ bodyKeys: Object.keys(body) }, "Webhook missing PR identifiers");
      return reply.code(400).send({ ok: false });
    }

    const timeoutMs = 120_000;
    setImmediate(() => {
      void Promise.race([
        runReview({ config: opts.config, repoId, prId }),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("review timeout")), timeoutMs))
      ]).catch((err) => {
        app.log.error({ err, repoId, prId }, "Review pipeline failed");
      });
    });

    return reply.send({ ok: true });
  });
};
