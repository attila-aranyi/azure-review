import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { DrizzleInstance } from "../../../src/db/connection";
import { createUsageRepo } from "../../../src/db/repos/usageRepo";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../testDbHelper";

describe.skipIf(!isDbAvailable())("usageRepo (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: "test-org" });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("records and retrieves monthly usage", async () => {
    const repo = createUsageRepo(db);
    await repo.recordUsage(tenantId, { reviewCount: 1, findingsCount: 5, tokensUsed: 1000 });
    await repo.recordUsage(tenantId, { reviewCount: 1, findingsCount: 3, tokensUsed: 800 });

    const now = new Date();
    const usage = await repo.getMonthlyUsage(tenantId, now.getUTCFullYear(), now.getUTCMonth() + 1);
    expect(usage.reviewCount).toBe(2);
    expect(usage.findingsCount).toBe(8);
    expect(usage.tokensUsed).toBe(1800);
  });

  it("returns zero for months with no usage", async () => {
    const repo = createUsageRepo(db);
    const usage = await repo.getMonthlyUsage(tenantId, 2020, 1);
    expect(usage.reviewCount).toBe(0);
    expect(usage.tokensUsed).toBe(0);
  });

  it("upserts plan limits", async () => {
    const repo = createUsageRepo(db);
    await repo.upsertPlanLimits({
      plan: "free",
      maxReviewsPerMonth: 50,
      maxTokensPerMonth: 100000,
      maxFilesPerReview: 20,
      maxReposPerOrg: 5,
      rateLimitPerMinute: 10,
    });

    const limits = await repo.getPlanLimits("free");
    expect(limits).not.toBeNull();
    expect(limits!.maxReviewsPerMonth).toBe(50);
    expect(limits!.maxTokensPerMonth).toBe(100000);
  });

  it("updates plan limits on conflict", async () => {
    const repo = createUsageRepo(db);
    await repo.upsertPlanLimits({
      plan: "free",
      maxReviewsPerMonth: 50,
      maxTokensPerMonth: 100000,
      maxFilesPerReview: 20,
      maxReposPerOrg: 5,
      rateLimitPerMinute: 10,
    });
    await repo.upsertPlanLimits({
      plan: "free",
      maxReviewsPerMonth: 100,
      maxTokensPerMonth: 200000,
      maxFilesPerReview: 30,
      maxReposPerOrg: 10,
      rateLimitPerMinute: 20,
    });

    const limits = await repo.getPlanLimits("free");
    expect(limits!.maxReviewsPerMonth).toBe(100);
  });

  it("returns null for unknown plan", async () => {
    const repo = createUsageRepo(db);
    const limits = await repo.getPlanLimits("nonexistent");
    expect(limits).toBeNull();
  });

  it("usage is tenant-scoped", async () => {
    const tenantRepo = createTenantRepo(db);
    const tenant2 = await tenantRepo.create({ adoOrgId: "other-org" });
    const repo = createUsageRepo(db);
    await repo.recordUsage(tenantId, { reviewCount: 5 });

    const now = new Date();
    const usage = await repo.getMonthlyUsage(tenant2.id, now.getUTCFullYear(), now.getUTCMonth() + 1);
    expect(usage.reviewCount).toBe(0);
  });
});
