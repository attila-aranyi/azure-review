import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { DrizzleInstance } from "../../db/connection";
import { createConfigRepo } from "../../db/repos/configRepo";

const configUpdateSchema = z.object({
  llmMode: z.enum(["managed", "byok"]).optional(),
  reviewStrictness: z.enum(["relaxed", "balanced", "strict"]).optional(),
  maxFiles: z.number().int().positive().optional(),
  maxDiffSize: z.number().int().positive().optional(),
  enableA11yText: z.boolean().optional(),
  enableA11yVisual: z.boolean().optional(),
  enableSecurity: z.boolean().optional(),
  commentStyle: z.enum(["inline", "summary", "both"]).optional(),
  minSeverity: z.enum(["low", "medium", "high", "critical"]).optional(),
  fileIncludeGlob: z.string().optional(),
  fileExcludeGlob: z.string().optional(),
});

export const registerConfigRoutes: FastifyPluginAsync<{
  db: DrizzleInstance;
}> = async (app, opts) => {
  const { db } = opts;
  const configRepo = createConfigRepo(db);

  // GET /api/config
  app.get("/config", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const config = await configRepo.findByTenantId(tenantId);
    if (!config) {
      return {
        tenantId,
        llmMode: "managed",
        reviewStrictness: "balanced",
        maxFiles: 20,
        maxDiffSize: 2000,
        enableA11yText: true,
        enableA11yVisual: false,
        enableSecurity: true,
        commentStyle: "inline",
        minSeverity: "low",
      };
    }

    return {
      tenantId: config.tenantId,
      llmMode: config.llmMode,
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
    };
  });

  // PUT /api/config
  app.put("/config", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = configUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid config", details: parsed.error.issues });
    }

    const config = await configRepo.upsert(tenantId, parsed.data);
    return {
      tenantId: config.tenantId,
      llmMode: config.llmMode,
      reviewStrictness: config.reviewStrictness,
      maxFiles: config.maxFiles,
      maxDiffSize: config.maxDiffSize,
      enableA11yText: config.enableA11yText,
      enableA11yVisual: config.enableA11yVisual,
      enableSecurity: config.enableSecurity,
      commentStyle: config.commentStyle,
      minSeverity: config.minSeverity,
    };
  });
};
