import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { DrizzleInstance } from "../../db/connection";
import { createRepoConfigRepo } from "../../db/repos/repoConfigRepo";
import { createConfigResolver } from "../../config/configResolver";

const repoConfigUpdateSchema = z.object({
  adoRepoName: z.string().optional(),
  reviewStrictness: z.enum(["relaxed", "balanced", "strict"]).nullable().optional(),
  maxFiles: z.number().int().positive().nullable().optional(),
  maxDiffSize: z.number().int().positive().nullable().optional(),
  enableA11yText: z.boolean().nullable().optional(),
  enableA11yVisual: z.boolean().nullable().optional(),
  enableSecurity: z.boolean().nullable().optional(),
  commentStyle: z.enum(["inline", "summary", "both"]).nullable().optional(),
  minSeverity: z.enum(["low", "medium", "high", "critical"]).nullable().optional(),
  fileIncludeGlob: z.string().nullable().optional(),
  fileExcludeGlob: z.string().nullable().optional(),
  enableAxon: z.boolean().nullable().optional(),
});

const repoIdParamSchema = z.object({
  repoId: z.string().min(1),
});

export const registerRepoConfigRoutes: FastifyPluginAsync<{
  db: DrizzleInstance;
}> = async (app, opts) => {
  const { db } = opts;
  const repoConfigRepo = createRepoConfigRepo(db);
  const configResolver = createConfigResolver(db);

  // GET /api/repos/:repoId/config - Get effective config for a repo
  app.get<{ Params: { repoId: string } }>("/repos/:repoId/config", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const params = repoIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid repo ID" });

    const repoConfig = await repoConfigRepo.findByTenantAndRepo(tenantId, params.data.repoId);

    return {
      tenantId,
      repoId: params.data.repoId,
      overrides: repoConfig ? {
        reviewStrictness: repoConfig.reviewStrictness,
        maxFiles: repoConfig.maxFiles,
        maxDiffSize: repoConfig.maxDiffSize,
        enableA11yText: repoConfig.enableA11yText,
        enableA11yVisual: repoConfig.enableA11yVisual,
        enableSecurity: repoConfig.enableSecurity,
        commentStyle: repoConfig.commentStyle,
        minSeverity: repoConfig.minSeverity,
        fileIncludeGlob: repoConfig.fileIncludeGlob,
        fileExcludeGlob: repoConfig.fileExcludeGlob,
        enableAxon: repoConfig.enableAxon,
      } : null,
    };
  });

  // GET /api/repos/:repoId/config/effective - Get merged effective config
  app.get<{ Params: { repoId: string } }>("/repos/:repoId/config/effective", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const params = repoIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid repo ID" });

    const effective = await configResolver.resolve(tenantId, params.data.repoId);
    return { tenantId, repoId: params.data.repoId, config: effective };
  });

  // PUT /api/repos/:repoId/config - Set repo-level overrides
  app.put<{ Params: { repoId: string } }>("/repos/:repoId/config", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const params = repoIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid repo ID" });

    const parsed = repoConfigUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid config", details: parsed.error.issues });
    }

    const config = await repoConfigRepo.upsert(tenantId, params.data.repoId, parsed.data);
    return {
      tenantId: config.tenantId,
      repoId: config.adoRepoId,
      overrides: {
        reviewStrictness: config.reviewStrictness,
        maxFiles: config.maxFiles,
        maxDiffSize: config.maxDiffSize,
        enableA11yText: config.enableA11yText,
        enableA11yVisual: config.enableA11yVisual,
        enableSecurity: config.enableSecurity,
        commentStyle: config.commentStyle,
        minSeverity: config.minSeverity,
        fileIncludeGlob: config.fileIncludeGlob,
        fileExcludeGlob: config.fileExcludeGlob,
        enableAxon: config.enableAxon,
      },
    };
  });

  // DELETE /api/repos/:repoId/config - Remove repo-level overrides
  app.delete<{ Params: { repoId: string } }>("/repos/:repoId/config", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const params = repoIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid repo ID" });

    const removed = await repoConfigRepo.remove(tenantId, params.data.repoId);
    if (!removed) {
      return reply.code(404).send({ error: "No repo config found" });
    }
    return { ok: true };
  });
};
