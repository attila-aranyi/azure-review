import { eq, and, sql, gte, lte } from "drizzle-orm";
import type { DrizzleInstance } from "../connection";
import { usageDaily, planLimits } from "../schema";

export type UsageDailyRow = typeof usageDaily.$inferSelect;
export type PlanLimitsRow = typeof planLimits.$inferSelect;

export interface UsageRepo {
  recordUsage(tenantId: string, data: { reviewCount?: number; findingsCount?: number; tokensUsed?: number; llmCostCents?: number }): Promise<void>;
  getMonthlyUsage(tenantId: string, year: number, month: number): Promise<{ reviewCount: number; findingsCount: number; tokensUsed: number; llmCostCents: number }>;
  getDailyUsage(tenantId: string, from: Date, to: Date): Promise<UsageDailyRow[]>;
  getPlanLimits(plan: string): Promise<PlanLimitsRow | null>;
  upsertPlanLimits(data: Omit<PlanLimitsRow, "id" | "createdAt">): Promise<void>;
}

export function createUsageRepo(db: DrizzleInstance): UsageRepo {
  return {
    async recordUsage(tenantId, data) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      await db
        .insert(usageDaily)
        .values({
          tenantId,
          date: today,
          reviewCount: data.reviewCount ?? 0,
          findingsCount: data.findingsCount ?? 0,
          tokensUsed: data.tokensUsed ?? 0,
          llmCostCents: data.llmCostCents ?? 0,
        })
        .onConflictDoUpdate({
          target: [usageDaily.tenantId, usageDaily.date],
          set: {
            reviewCount: sql`${usageDaily.reviewCount} + ${data.reviewCount ?? 0}`,
            findingsCount: sql`${usageDaily.findingsCount} + ${data.findingsCount ?? 0}`,
            tokensUsed: sql`${usageDaily.tokensUsed} + ${data.tokensUsed ?? 0}`,
            llmCostCents: sql`${usageDaily.llmCostCents} + ${data.llmCostCents ?? 0}`,
            updatedAt: new Date(),
          },
        });
    },

    async getMonthlyUsage(tenantId, year, month) {
      const startDate = new Date(Date.UTC(year, month - 1, 1));
      const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

      const result = await db
        .select({
          reviewCount: sql<number>`COALESCE(SUM(${usageDaily.reviewCount}), 0)`,
          findingsCount: sql<number>`COALESCE(SUM(${usageDaily.findingsCount}), 0)`,
          tokensUsed: sql<number>`COALESCE(SUM(${usageDaily.tokensUsed}), 0)`,
          llmCostCents: sql<number>`COALESCE(SUM(${usageDaily.llmCostCents}), 0)`,
        })
        .from(usageDaily)
        .where(
          and(
            eq(usageDaily.tenantId, tenantId),
            gte(usageDaily.date, startDate),
            lte(usageDaily.date, endDate),
          )
        );

      const row = result[0];
      return {
        reviewCount: Number(row?.reviewCount ?? 0),
        findingsCount: Number(row?.findingsCount ?? 0),
        tokensUsed: Number(row?.tokensUsed ?? 0),
        llmCostCents: Number(row?.llmCostCents ?? 0),
      };
    },

    async getDailyUsage(tenantId, from, to) {
      return db
        .select()
        .from(usageDaily)
        .where(
          and(
            eq(usageDaily.tenantId, tenantId),
            gte(usageDaily.date, from),
            lte(usageDaily.date, to),
          )
        );
    },

    async getPlanLimits(plan) {
      const result = await db
        .select()
        .from(planLimits)
        .where(eq(planLimits.plan, plan))
        .limit(1);
      return result[0] ?? null;
    },

    async upsertPlanLimits(data) {
      await db
        .insert(planLimits)
        .values(data)
        .onConflictDoUpdate({
          target: planLimits.plan,
          set: {
            maxReviewsPerMonth: data.maxReviewsPerMonth,
            maxTokensPerMonth: data.maxTokensPerMonth,
            maxFilesPerReview: data.maxFilesPerReview,
            maxReposPerOrg: data.maxReposPerOrg,
            rateLimitPerMinute: data.rateLimitPerMinute,
          },
        });
    },
  };
}
