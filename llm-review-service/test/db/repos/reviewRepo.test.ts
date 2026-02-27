import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createReviewRepo } from "../../../src/db/repos/reviewRepo";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import type { ReviewRepo } from "../../../src/db/repos/reviewRepo";
import type { TenantRepo } from "../../../src/db/repos/tenantRepo";
import type { DrizzleInstance } from "../../../src/db/connection";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../testDbHelper";

describe.skipIf(!isDbAvailable())("reviewRepo (integration)", () => {
  let db: DrizzleInstance;
  let reviewRepo: ReviewRepo;
  let tenantRepo: TenantRepo;
  let tenantId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    reviewRepo = createReviewRepo(db);
    tenantRepo = createTenantRepo(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenant = await tenantRepo.create({ adoOrgId: `org-${Date.now()}` });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("create returns a review with generated id", async () => {
    const review = await reviewRepo.create({
      tenantId,
      repoId: "repo-1",
      prId: 42,
      idempotencyKey: "key-1",
    });
    expect(review.id).toBeDefined();
    expect(review.tenantId).toBe(tenantId);
    expect(review.repoId).toBe("repo-1");
    expect(review.prId).toBe(42);
    expect(review.status).toBe("pending");
  });

  it("findById returns the review", async () => {
    const created = await reviewRepo.create({ tenantId, repoId: "r", prId: 1 });
    const found = await reviewRepo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it("findById returns null for nonexistent", async () => {
    const found = await reviewRepo.findById("00000000-0000-0000-0000-000000000000");
    expect(found).toBeNull();
  });

  it("findByIdempotencyKey returns the review", async () => {
    await reviewRepo.create({ tenantId, repoId: "r", prId: 1, idempotencyKey: "idem-1" });
    const found = await reviewRepo.findByIdempotencyKey("idem-1");
    expect(found).not.toBeNull();
    expect(found!.idempotencyKey).toBe("idem-1");
  });

  it("findByIdempotencyKey returns null for nonexistent", async () => {
    const found = await reviewRepo.findByIdempotencyKey("nonexistent");
    expect(found).toBeNull();
  });

  it("duplicate idempotencyKey throws unique constraint error", async () => {
    await reviewRepo.create({ tenantId, repoId: "r", prId: 1, idempotencyKey: "dup-key" });
    await expect(
      reviewRepo.create({ tenantId, repoId: "r2", prId: 2, idempotencyKey: "dup-key" })
    ).rejects.toThrow();
  });

  it("updateCompleted updates review fields", async () => {
    const created = await reviewRepo.create({ tenantId, repoId: "r", prId: 1 });
    await reviewRepo.updateCompleted(created.id, {
      status: "success",
      hunksProcessed: 5,
      tokenUsage: { llm1: 1000, llm2: 2000 },
      timings: { totalMs: 5000 },
    });
    const found = await reviewRepo.findById(created.id);
    expect(found!.status).toBe("success");
    expect(found!.hunksProcessed).toBe(5);
    expect(found!.completedAt).not.toBeNull();
  });

  it("listByTenant returns paginated results", async () => {
    for (let i = 0; i < 5; i++) {
      await reviewRepo.create({ tenantId, repoId: "r", prId: i + 1 });
    }

    const page1 = await reviewRepo.listByTenant(tenantId, { page: 1, limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);

    const page3 = await reviewRepo.listByTenant(tenantId, { page: 3, limit: 2 });
    expect(page3.data).toHaveLength(1);
  });

  it("listByTenant filters by projectId", async () => {
    await reviewRepo.create({ tenantId, repoId: "r", prId: 1, adoProjectId: "proj-a" });
    await reviewRepo.create({ tenantId, repoId: "r", prId: 2, adoProjectId: "proj-b" });

    const results = await reviewRepo.listByTenant(tenantId, { projectId: "proj-a" });
    expect(results.data).toHaveLength(1);
    expect(results.total).toBe(1);
  });

  it("no cross-tenant leakage in listByTenant", async () => {
    const tenant2 = await tenantRepo.create({ adoOrgId: `org2-${Date.now()}` });
    await reviewRepo.create({ tenantId, repoId: "r", prId: 1 });
    await reviewRepo.create({ tenantId: tenant2.id, repoId: "r", prId: 2 });

    const t1Reviews = await reviewRepo.listByTenant(tenantId, {});
    const t2Reviews = await reviewRepo.listByTenant(tenant2.id, {});
    expect(t1Reviews.total).toBe(1);
    expect(t2Reviews.total).toBe(1);
  });

  it("createFinding and findFindingsByReviewId", async () => {
    const review = await reviewRepo.create({ tenantId, repoId: "r", prId: 1 });
    await reviewRepo.createFinding({
      reviewId: review.id,
      issueType: "bug",
      severity: "high",
      filePath: "/src/foo.ts",
      startLine: 10,
      endLine: 15,
      message: "Null pointer dereference",
      findingHash: "abc123",
    });

    const findings = await reviewRepo.findFindingsByReviewId(review.id);
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("bug");
    expect(findings[0].message).toBe("Null pointer dereference");
  });

  it("createFindings bulk insert", async () => {
    const review = await reviewRepo.create({ tenantId, repoId: "r", prId: 1 });
    await reviewRepo.createFindings([
      { reviewId: review.id, issueType: "bug", severity: "high", filePath: "/a.ts", startLine: 1, endLine: 2, message: "Bug 1", findingHash: "h1" },
      { reviewId: review.id, issueType: "security", severity: "critical", filePath: "/b.ts", startLine: 5, endLine: 10, message: "XSS", findingHash: "h2" },
    ]);

    const findings = await reviewRepo.findFindingsByReviewId(review.id);
    expect(findings).toHaveLength(2);
  });

  it("createFindings with empty array is no-op", async () => {
    await reviewRepo.createFindings([]);
    // Should not throw
  });
});
