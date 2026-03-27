import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { DrizzleInstance } from "../../../src/db/connection";
import { createFeedbackRepo } from "../../../src/db/repos/feedbackRepo";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import { createReviewRepo } from "../../../src/db/repos/reviewRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../testDbHelper";

describe.skipIf(!isDbAvailable())("feedbackRepo (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;
  let findingId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);

    // Setup chain: tenant → review → finding
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: "feedback-test-org" });
    tenantId = tenant.id;

    const reviewRepo = createReviewRepo(db);
    const review = await reviewRepo.create({
      tenantId,
      repoId: "repo-1",
      prId: 1,
      status: "completed",
    });

    await reviewRepo.createFinding({
      reviewId: review.id,
      issueType: "bug",
      severity: "high",
      filePath: "src/main.ts",
      startLine: 10,
      endLine: 15,
      message: "Potential null reference",
      findingHash: "hash-1",
      status: "posted",
    });

    const findings = await reviewRepo.findFindingsByReviewId(review.id);
    findingId = findings[0].id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  describe("create()", () => {
    it("creates feedback with all fields", async () => {
      const repo = createFeedbackRepo(db);
      const row = await repo.create({
        findingId,
        tenantId,
        adoUserId: "user-123",
        vote: "up",
        comment: "Great catch!",
      });

      expect(row.id).toBeDefined();
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.findingId).toBe(findingId);
      expect(row.tenantId).toBe(tenantId);
      expect(row.adoUserId).toBe("user-123");
      expect(row.vote).toBe("up");
      expect(row.comment).toBe("Great catch!");
    });

    it("creates feedback with only required fields", async () => {
      const repo = createFeedbackRepo(db);
      const row = await repo.create({
        findingId,
        tenantId,
        vote: "down",
      });

      expect(row.id).toBeDefined();
      expect(row.adoUserId).toBeNull();
      expect(row.comment).toBeNull();
      expect(row.vote).toBe("down");
    });

    it("allows multiple feedback entries for the same finding", async () => {
      const repo = createFeedbackRepo(db);
      await repo.create({ findingId, tenantId, vote: "up" });
      await repo.create({ findingId, tenantId, vote: "down", adoUserId: "user-2" });

      const all = await repo.findByFindingId(findingId);
      expect(all).toHaveLength(2);
    });
  });

  describe("findByFindingId()", () => {
    it("returns empty array when no feedback exists", async () => {
      const repo = createFeedbackRepo(db);
      const result = await repo.findByFindingId(findingId);
      expect(result).toEqual([]);
    });

    it("returns all feedback entries for a given finding", async () => {
      const repo = createFeedbackRepo(db);
      await repo.create({ findingId, tenantId, vote: "up" });
      await repo.create({ findingId, tenantId, vote: "down" });
      await repo.create({ findingId, tenantId, vote: "up" });

      const result = await repo.findByFindingId(findingId);
      expect(result).toHaveLength(3);
    });

    it("does not return feedback from other findings", async () => {
      const repo = createFeedbackRepo(db);
      const reviewRepo = createReviewRepo(db);

      // Create a second finding
      const reviews = await reviewRepo.listByTenant(tenantId, { limit: 1 });
      const reviewId = reviews.data[0].id;
      await reviewRepo.createFinding({
        reviewId,
        issueType: "style",
        severity: "low",
        filePath: "src/other.ts",
        startLine: 1,
        endLine: 2,
        message: "Style issue",
        findingHash: "hash-2",
        status: "posted",
      });
      const allFindings = await reviewRepo.findFindingsByReviewId(reviewId);
      const otherFindingId = allFindings.find((f) => f.findingHash === "hash-2")!.id;

      // Add feedback to both findings
      await repo.create({ findingId, tenantId, vote: "up" });
      await repo.create({ findingId: otherFindingId, tenantId, vote: "down" });

      const result = await repo.findByFindingId(findingId);
      expect(result).toHaveLength(1);
      expect(result[0].vote).toBe("up");
    });
  });

  describe("getStats()", () => {
    it("returns zeros when no feedback exists for tenant", async () => {
      const repo = createFeedbackRepo(db);
      const stats = await repo.getStats(tenantId);
      expect(stats).toEqual({ totalUp: 0, totalDown: 0 });
    });

    it("correctly counts up and down votes", async () => {
      const repo = createFeedbackRepo(db);
      await repo.create({ findingId, tenantId, vote: "up" });
      await repo.create({ findingId, tenantId, vote: "up" });
      await repo.create({ findingId, tenantId, vote: "up" });
      await repo.create({ findingId, tenantId, vote: "down" });
      await repo.create({ findingId, tenantId, vote: "down" });

      const stats = await repo.getStats(tenantId);
      expect(stats).toEqual({ totalUp: 3, totalDown: 2 });
    });

    it("scopes stats to the given tenant", async () => {
      const repo = createFeedbackRepo(db);
      await repo.create({ findingId, tenantId, vote: "up" });

      const tenantRepo = createTenantRepo(db);
      const tenant2 = await tenantRepo.create({ adoOrgId: "other-org" });

      const stats = await repo.getStats(tenant2.id);
      expect(stats).toEqual({ totalUp: 0, totalDown: 0 });
    });
  });

  describe("tenant isolation", () => {
    it("feedback from one tenant is not visible to another", async () => {
      const repo = createFeedbackRepo(db);

      // Create feedback for tenant 1
      await repo.create({ findingId, tenantId, vote: "up" });
      await repo.create({ findingId, tenantId, vote: "down" });

      // Create tenant 2 with its own chain
      const tenantRepo = createTenantRepo(db);
      const tenant2 = await tenantRepo.create({ adoOrgId: "isolated-org" });
      const reviewRepo = createReviewRepo(db);
      const review2 = await reviewRepo.create({
        tenantId: tenant2.id,
        repoId: "repo-2",
        prId: 2,
        status: "completed",
      });
      await reviewRepo.createFinding({
        reviewId: review2.id,
        issueType: "bug",
        severity: "medium",
        filePath: "src/other.ts",
        startLine: 1,
        endLine: 1,
        message: "Other bug",
        findingHash: "hash-other",
        status: "posted",
      });
      const findings2 = await reviewRepo.findFindingsByReviewId(review2.id);
      const findingId2 = findings2[0].id;

      await repo.create({ findingId: findingId2, tenantId: tenant2.id, vote: "up" });

      // Verify isolation
      const stats1 = await repo.getStats(tenantId);
      const stats2 = await repo.getStats(tenant2.id);
      expect(stats1).toEqual({ totalUp: 1, totalDown: 1 });
      expect(stats2).toEqual({ totalUp: 1, totalDown: 0 });

      // findByFindingId also isolated
      const fb1 = await repo.findByFindingId(findingId);
      const fb2 = await repo.findByFindingId(findingId2);
      expect(fb1).toHaveLength(2);
      expect(fb2).toHaveLength(1);
    });
  });
});
