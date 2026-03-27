import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createFeedbackRepo } from "../../../src/db/repos/feedbackRepo";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import { createReviewRepo } from "../../../src/db/repos/reviewRepo";
import type { FeedbackRepo } from "../../../src/db/repos/feedbackRepo";
import type { DrizzleInstance } from "../../../src/db/connection";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../testDbHelper";

describe.skipIf(!isDbAvailable())("feedbackRepo (integration)", () => {
  let db: DrizzleInstance;
  let feedbackRepo: FeedbackRepo;
  let tenantId: string;
  let findingId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    feedbackRepo = createFeedbackRepo(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: `org-${Date.now()}` });
    tenantId = tenant.id;

    // Create a review and finding to reference
    const reviewRepo = createReviewRepo(db);
    const review = await reviewRepo.create({ tenantId, repoId: "repo-1", prId: 1 });
    await reviewRepo.createFinding({
      reviewId: review.id,
      issueType: "bug",
      severity: "high",
      filePath: "/src/a.ts",
      startLine: 1,
      endLine: 5,
      message: "Test finding",
      findingHash: "hash1",
    });
    const findings = await reviewRepo.findFindingsByReviewId(review.id);
    findingId = findings[0].id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("create returns feedback with generated id", async () => {
    const feedback = await feedbackRepo.create({
      findingId,
      tenantId,
      adoUserId: "user-1",
      vote: "up",
      comment: "Good catch",
    });
    expect(feedback.id).toBeDefined();
    expect(feedback.findingId).toBe(findingId);
    expect(feedback.tenantId).toBe(tenantId);
    expect(feedback.vote).toBe("up");
    expect(feedback.comment).toBe("Good catch");
  });

  it("findByFindingId returns feedback for a finding", async () => {
    await feedbackRepo.create({ findingId, tenantId, vote: "up" });
    await feedbackRepo.create({ findingId, tenantId, vote: "down", comment: "False positive" });

    const results = await feedbackRepo.findByFindingId(findingId);
    expect(results).toHaveLength(2);
  });

  it("findByFindingId returns empty array when no feedback", async () => {
    const results = await feedbackRepo.findByFindingId("00000000-0000-0000-0000-000000000000");
    expect(results).toEqual([]);
  });

  it("getStats returns correct up/down counts", async () => {
    await feedbackRepo.create({ findingId, tenantId, vote: "up" });
    await feedbackRepo.create({ findingId, tenantId, vote: "up" });
    await feedbackRepo.create({ findingId, tenantId, vote: "down" });

    const stats = await feedbackRepo.getStats(tenantId);
    expect(stats.totalUp).toBe(2);
    expect(stats.totalDown).toBe(1);
  });

  it("getStats returns zeros when no feedback", async () => {
    const stats = await feedbackRepo.getStats(tenantId);
    expect(stats.totalUp).toBe(0);
    expect(stats.totalDown).toBe(0);
  });
});
