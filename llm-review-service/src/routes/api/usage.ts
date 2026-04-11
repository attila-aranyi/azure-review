import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { eq, sql, and, gte } from "drizzle-orm";
import type { DrizzleInstance } from "../../db/connection";
import { createUsageRepo } from "../../db/repos/usageRepo";
import { createTenantRepo } from "../../db/repos/tenantRepo";
import { reviewFindings, reviews } from "../../db/schema";

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

    // Fallback: if usage_daily is empty, compute from reviews + findings tables
    let usage = monthly;
    if (usage.reviewCount === 0) {
      try {
        const from = new Date(Date.UTC(year, month - 1, 1));
        const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
        const fromStr = from.toISOString();
        const toStr = to.toISOString();
        const reviewRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(reviews)
          .where(and(eq(reviews.tenantId, tenantId), sql`${reviews.createdAt} >= ${fromStr}::timestamptz`, sql`${reviews.createdAt} <= ${toStr}::timestamptz`));
        const findingRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(reviewFindings)
          .innerJoin(reviews, eq(reviewFindings.reviewId, reviews.id))
          .where(and(eq(reviews.tenantId, tenantId), eq(reviewFindings.status, "posted"), sql`${reviews.createdAt} >= ${fromStr}::timestamptz`, sql`${reviews.createdAt} <= ${toStr}::timestamptz`));
        usage = {
          reviewCount: reviewRows[0]?.count ?? 0,
          findingsCount: findingRows[0]?.count ?? 0,
          tokensUsed: 0,
          llmCostCents: 0,
        };
      } catch {
        // Fallback query failed — keep the original (zero) usage
      }
    }

    const limits = tenant ? await usageRepo.getPlanLimits(tenant.plan) : null;

    return {
      tenantId,
      period: { year, month },
      usage,
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

    type DayRow = { date: string; reviewCount: number; findingsCount: number; tokensUsed: number; llmCostCents: number };
    let days: DayRow[] = daily.map((d) => ({
      date: d.date instanceof Date ? d.date.toISOString().slice(0, 10) : String(d.date),
      reviewCount: d.reviewCount,
      findingsCount: d.findingsCount,
      tokensUsed: d.tokensUsed,
      llmCostCents: d.llmCostCents,
    }));

    // Fallback: compute daily stats from reviews table if usage_daily is empty
    if (days.length === 0) {
      try {
      const fromStr = from.toISOString();
      const toStr = to.toISOString();
      const reviewDaily = await db
        .select({
          date: sql<string>`date_trunc('day', ${reviews.createdAt})::date::text`,
          reviewCount: sql<number>`count(*)::int`,
        })
        .from(reviews)
        .where(and(eq(reviews.tenantId, tenantId), sql`${reviews.createdAt} >= ${fromStr}::timestamptz`, sql`${reviews.createdAt} <= ${toStr}::timestamptz`))
        .groupBy(sql`date_trunc('day', ${reviews.createdAt})`)
        .orderBy(sql`date_trunc('day', ${reviews.createdAt})`);

      days = reviewDaily.map((r) => ({
        date: r.date,
        reviewCount: r.reviewCount,
        findingsCount: 0,
        tokensUsed: 0,
        llmCostCents: 0,
      }));
      } catch {
        // Fallback query failed — keep empty days
      }
    }

    return {
      tenantId,
      period: { year, month },
      daily: days,
    };
  });

  // GET /api/usage/issue-types - Findings grouped by issue type (last 30 days)
  app.get("/usage/issue-types", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const rows = await db
      .select({
        issueType: reviewFindings.issueType,
        count: sql<number>`count(*)::int`,
      })
      .from(reviewFindings)
      .innerJoin(reviews, eq(reviewFindings.reviewId, reviews.id))
      .where(
        and(
          eq(reviews.tenantId, tenantId),
          eq(reviewFindings.status, "posted"),
          gte(reviews.createdAt, thirtyDaysAgo),
        ),
      )
      .groupBy(reviewFindings.issueType)
      .orderBy(sql`count(*) desc`);

    return {
      issueTypes: rows.map((r) => ({
        name: r.issueType,
        value: r.count,
      })),
    };
  });
};
