import type { DrizzleInstance } from "../db/connection";
import { createUsageRepo } from "../db/repos/usageRepo";
import { createTenantRepo } from "../db/repos/tenantRepo";
import type { Logger } from "pino";

export interface PlanCheckResult {
  allowed: boolean;
  reason?: string;
  usage?: { reviewCount: number; limit: number };
}

export interface PlanEnforcer {
  checkReviewAllowed(tenantId: string): Promise<PlanCheckResult>;
  recordReviewUsage(tenantId: string, data: { findingsCount: number; tokensUsed: number }): Promise<void>;
}

export function createPlanEnforcer(db: DrizzleInstance, logger: Logger): PlanEnforcer {
  const usageRepo = createUsageRepo(db);
  const tenantRepo = createTenantRepo(db);

  return {
    async checkReviewAllowed(tenantId) {
      const tenant = await tenantRepo.findById(tenantId);
      if (!tenant) return { allowed: false, reason: "Tenant not found" };

      const limits = await usageRepo.getPlanLimits(tenant.plan);
      if (!limits) {
        // No limits defined for plan means unlimited
        return { allowed: true };
      }

      const now = new Date();
      const monthly = await usageRepo.getMonthlyUsage(tenantId, now.getUTCFullYear(), now.getUTCMonth() + 1);

      if (monthly.reviewCount >= limits.maxReviewsPerMonth) {
        logger.warn({ tenantId, plan: tenant.plan, reviewCount: monthly.reviewCount, limit: limits.maxReviewsPerMonth }, "Review blocked: over plan limit");
        return {
          allowed: false,
          reason: `Monthly review limit reached (${monthly.reviewCount}/${limits.maxReviewsPerMonth})`,
          usage: { reviewCount: monthly.reviewCount, limit: limits.maxReviewsPerMonth },
        };
      }

      if (monthly.tokensUsed >= limits.maxTokensPerMonth) {
        logger.warn({ tenantId, plan: tenant.plan, tokensUsed: monthly.tokensUsed, limit: limits.maxTokensPerMonth }, "Review blocked: over token limit");
        return {
          allowed: false,
          reason: `Monthly token limit reached (${monthly.tokensUsed}/${limits.maxTokensPerMonth})`,
        };
      }

      return { allowed: true };
    },

    async recordReviewUsage(tenantId, data) {
      await usageRepo.recordUsage(tenantId, {
        reviewCount: 1,
        findingsCount: data.findingsCount,
        tokensUsed: data.tokensUsed,
      });
    },
  };
}
