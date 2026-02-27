import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import type { Config } from "../config";
import { runReview } from "../review/runReview";
import type { ReviewQueue } from "../review/queue";
import type { AuditStore } from "../review/audit";

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = new Uint8Array(Buffer.from(a));
  const bufB = new Uint8Array(Buffer.from(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export const registerWebhookRoutes: FastifyPluginAsync<{ config: Config; queue: ReviewQueue; auditStore?: AuditStore }> = async (
  app,
  opts
) => {
  await app.register(rateLimit, {
    max: opts.config.RATE_LIMIT_MAX,
    timeWindow: opts.config.RATE_LIMIT_WINDOW_MS
  });

  app.post(
    "/webhooks/azure-devops/pr",
    { bodyLimit: 1_048_576 },
    async (request, reply) => {
      const headerValue = request.headers["x-webhook-secret"];
      const secret = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (!secret || !timingSafeEqual(secret, opts.config.WEBHOOK_SECRET)) {
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

      const previewUrl = (body as Record<string, unknown>).previewUrl as string | undefined;

      if (opts.queue.enabled) {
        await opts.queue.enqueue({ repoId, prId, requestId: request.id, previewUrl });
      } else {
        const timeoutMs = 120_000;
        setImmediate(() => {
          void Promise.race([
            runReview({ config: opts.config, repoId, prId, requestId: request.id, auditStore: opts.auditStore, previewUrl }),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("review timeout")), timeoutMs)
            )
          ]).catch((err) => {
            app.log.error({ err, repoId, prId }, "Review pipeline failed");
          });
        });
      }

      return reply.send({ ok: true });
    }
  );
};
