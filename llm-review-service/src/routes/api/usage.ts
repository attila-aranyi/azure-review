import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { DrizzleInstance } from "../../db/connection";
import { createUsageRepo } from "../../db/repos/usageRepo";
import { createTenantRepo } from "../../db/repos/tenantRepo";

const usageQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export const registerUsageRoutes: FastifyPluginAsync<{
  db: DrizzleInstance;
}> = async (app, opts) => {
  const { db } = opts;
  const usageRepo = createUsageRepo(db);
  const tenantRepo = createTenantRepo(db);

  // GET /api/usage - Current month usage + plan limits
  app.get("/usage", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const query = usageQuerySchema.safeParse(request.query);
    const now = new Date();
    const year = query.success && query.data.year ? query.data.year : now.getUTCFullYear();
    const month = query.success && query.data.month ? query.data.month : now.getUTCMonth() + 1;

    const [monthly, tenant] = await Promise.all([
      usageRepo.getMonthlyUsage(tenantId, year, month),
      tenantRepo.findById(tenantId),
    ]);

    const limits = tenant ? await usageRepo.getPlanLimits(tenant.plan) : null;

    return {
      tenantId,
      period: { year, month },
      usage: monthly,
      limits: limits ? {
        maxReviewsPerMonth: limits.maxReviewsPerMonth,
        maxTokensPerMonth: limits.maxTokensPerMonth,
        maxFilesPerReview: limits.maxFilesPerReview,
        maxReposPerOrg: limits.maxReposPerOrg,
      } : null,
      plan: tenant?.plan ?? "free",
    };
  });

  // GET /api/usage/daily - Daily breakdown
  app.get("/usage/daily", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const query = usageQuerySchema.safeParse(request.query);
    const now = new Date();
    const year = query.success && query.data.year ? query.data.year : now.getUTCFullYear();
    const month = query.success && query.data.month ? query.data.month : now.getUTCMonth() + 1;

    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const daily = await usageRepo.getDailyUsage(tenantId, from, to);

    return {
      tenantId,
      period: { year, month },
      daily: daily.map((d) => ({
        date: d.date,
        reviewCount: d.reviewCount,
        findingsCount: d.findingsCount,
        tokensUsed: d.tokensUsed,
        llmCostCents: d.llmCostCents,
      })),
    };
  });
};
