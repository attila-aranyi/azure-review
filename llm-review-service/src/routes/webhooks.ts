import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import type { Config } from "../config";
import type { AppConfig } from "../config/appConfig";
import { runReview } from "../review/runReview";
import type { ReviewQueue } from "../review/queue";
import type { AuditStore } from "../review/audit";
import { createDbAuditStore } from "../review/audit";
import { createDbIdempotencyStore } from "../review/idempotency";
import type { DrizzleInstance } from "../db/connection";
import type { TokenManager } from "../auth/tokenManager";
import { createTenantRepo } from "../db/repos/tenantRepo";
import { createProjectRepo } from "../db/repos/projectRepo";
import { decrypt } from "../auth/encryption";
import { buildTenantContext } from "../context/tenantContext";
import { createConfigResolver } from "../config/configResolver";

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = new Uint8Array(Buffer.from(a));
  const bufB = new Uint8Array(Buffer.from(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// MED-13: Shared base payload schema (used by both legacy and multi-tenant routes)
const basePayloadSchema = z
  .object({
    pullRequestId: z.number().int().positive().optional(),
    repository: z
      .object({
        id: z.string().min(1),
        project: z.object({ id: z.string().min(1) }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    resource: z
      .object({
        pullRequestId: z.number().int().positive(),
        repository: z
          .object({
            id: z.string().min(1),
            project: z.object({ id: z.string().min(1) }).passthrough().optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .optional(),
    resourceContainers: z
      .object({
        collection: z.object({ id: z.string() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    // HIGH-3: Validate previewUrl as proper URL
    previewUrl: z.string().url().optional(),
  })
  .passthrough();

// MED-20: UUID format validation for tenantId path param
const tenantIdParamSchema = z.object({
  tenantId: z.string().uuid(),
});

export const registerWebhookRoutes: FastifyPluginAsync<{
  config: Config;
  queue: ReviewQueue;
  auditStore?: AuditStore;
  db?: DrizzleInstance;
  encryptionKey?: Buffer;
  appConfig?: AppConfig;
  tokenManager?: TokenManager;
}> = async (
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

      const parsed = basePayloadSchema.safeParse(request.body);
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

      const previewUrl = body.previewUrl;

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

  // ── Multi-tenant webhook route ──
  if (opts.db && opts.encryptionKey) {
    const tenantRepo = createTenantRepo(opts.db);
    const projectRepo = createProjectRepo(opts.db);

    app.post<{ Params: { tenantId: string } }>(
      "/webhooks/ado/:tenantId",
      { bodyLimit: 1_048_576 },
      async (request, reply) => {
        // MED-20: Validate tenantId is a UUID
        const paramsParsed = tenantIdParamSchema.safeParse(request.params);
        if (!paramsParsed.success) {
          return reply.code(401).send({ ok: false, error: "Unauthorized" });
        }
        const { tenantId } = paramsParsed.data;

        // Lookup tenant
        const tenant = await tenantRepo.findById(tenantId);
        // MED-9: Return same 401 for not-found and inactive (anti-enumeration)
        if (!tenant || tenant.status === "inactive") {
          return reply.code(401).send({ ok: false, error: "Unauthorized" });
        }

        // Parse webhook secret from Basic Auth or x-webhook-secret header
        let providedSecret: string | undefined;
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith("Basic ")) {
          const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
          const colonIndex = decoded.indexOf(":");
          providedSecret = colonIndex >= 0 ? decoded.slice(colonIndex + 1) : decoded;
        }
        if (!providedSecret) {
          const headerValue = request.headers["x-webhook-secret"];
          providedSecret = Array.isArray(headerValue) ? headerValue[0] : headerValue;
        }
        if (!providedSecret) {
          return reply.code(401).send({ ok: false, error: "Unauthorized" });
        }

        // Parse payload
        const parsed = basePayloadSchema.safeParse(request.body);
        if (!parsed.success) {
          app.log.warn({ issues: parsed.error.issues }, "Invalid webhook payload");
          return reply.code(400).send({ ok: false });
        }

        const body = parsed.data;
        const prId = body.pullRequestId ?? body.resource?.pullRequestId;
        const repoId = body.repository?.id ?? body.resource?.repository.id;
        const adoProjectId = body.repository?.project?.id ?? body.resource?.repository.project?.id;

        if (!prId || !repoId) {
          app.log.warn({ bodyKeys: Object.keys(body) }, "Webhook missing PR identifiers");
          return reply.code(400).send({ ok: false });
        }

        // Find all active project enrollments for this tenant and validate secret
        const enrollments = await projectRepo.findByTenantId(tenantId);
        const activeEnrollments = enrollments.filter((e) => e.status === "active");

        // LOW-4: Check all enrollments without early break to avoid timing leak
        let secretValid = false;
        for (const enrollment of activeEnrollments) {
          if (!enrollment.webhookSecretEnc) continue;
          try {
            const storedSecret = decrypt(Buffer.from(enrollment.webhookSecretEnc, "base64"), opts.encryptionKey!);
            if (timingSafeEqual(providedSecret, storedSecret)) {
              secretValid = true;
              // Don't break — check all to prevent timing leak
            }
          } catch {
            // skip decrypt failures
          }
        }

        // MED-9: Same response for not-found and invalid secret
        if (!secretValid) {
          return reply.code(401).send({ ok: false, error: "Unauthorized" });
        }

        const previewUrl = body.previewUrl;

        if (opts.queue.enabled) {
          await opts.queue.enqueue({ repoId, prId, requestId: request.id, previewUrl, tenantId, adoProjectId });
        } else {
          // Sync mode: run review in background with tenant context for DB persistence
          const timeoutMs = 300_000;
          setImmediate(() => {
            void (async () => {
              try {
                let context;
                let tenantAuditStore = opts.auditStore;
                let idempotencyStore;

                // Build tenant context for DB persistence (same as queue worker)
                if (tenantId && opts.db && opts.appConfig && opts.tokenManager) {
                  context = await buildTenantContext(tenantId, opts.db, opts.appConfig, opts.tokenManager);
                  // Resolve per-repo config overrides (e.g. enableAxon)
                  const resolver = createConfigResolver(opts.db);
                  context.config = await resolver.resolve(tenantId, repoId);
                  tenantAuditStore = createDbAuditStore(opts.db, tenantId);
                  idempotencyStore = createDbIdempotencyStore(opts.db, { tenantId });
                }

                await Promise.race([
                  runReview({ config: opts.config, repoId, prId, requestId: request.id, auditStore: tenantAuditStore, previewUrl, context, idempotencyStore }),
                  new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error("review timeout")), timeoutMs)
                  )
                ]);

              } catch (err) {
                app.log.error({ err, repoId, prId, tenantId }, "Review pipeline failed");
              }
            })();
          });
        }

        return reply.code(202).send({ ok: true });
      },
    );
  }
};
