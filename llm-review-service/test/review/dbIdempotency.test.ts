import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDbIdempotencyStore } from "../../src/review/idempotency";
import type { IdempotencyStore } from "../../src/review/idempotency";
import type { DrizzleInstance } from "../../src/db/connection";
import { createTenantRepo } from "../../src/db/repos/tenantRepo";
import { createReviewRepo } from "../../src/db/repos/reviewRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../db/testDbHelper";

describe.skipIf(!isDbAvailable())("createDbIdempotencyStore (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;
  let store: IdempotencyStore;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: `org-${Date.now()}` });
    tenantId = tenant.id;
    store = createDbIdempotencyStore(db, { tenantId });
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("has() returns false for unknown key", async () => {
    const result = await store.has({ repoId: "r1", prId: 1, findingHash: "abc" });
    expect(result).toBe(false);
  });

  it("put() + has() works for within-run dedup", async () => {
    const key = { repoId: "r1", prId: 1, findingHash: "abc" };
    await store.put(key);
    const result = await store.has(key);
    expect(result).toBe(true);
  });

  it("has() finds findings from previous review runs", async () => {
    // Simulate a previous review that stored a finding in the DB
    const reviewRepo = createReviewRepo(db);
    const review = await reviewRepo.create({ tenantId, repoId: "r1", prId: 1 });
    await reviewRepo.createFinding({
      reviewId: review.id,
      issueType: "bug",
      severity: "high",
      filePath: "/a.ts",
      startLine: 1,
      endLine: 5,
      message: "Bug found",
      findingHash: "existing-hash",
    });

    // A new store instance should detect the existing finding
    const newStore = createDbIdempotencyStore(db, { tenantId });
    const result = await newStore.has({ repoId: "r1", prId: 1, findingHash: "existing-hash" });
    expect(result).toBe(true);
  });

  it("has() does not match different repo", async () => {
    const reviewRepo = createReviewRepo(db);
    const review = await reviewRepo.create({ tenantId, repoId: "r1", prId: 1 });
    await reviewRepo.createFinding({
      reviewId: review.id,
      issueType: "bug",
      severity: "high",
      filePath: "/a.ts",
      startLine: 1,
      endLine: 5,
      message: "Bug",
      findingHash: "hash1",
    });

    const result = await store.has({ repoId: "r2", prId: 1, findingHash: "hash1" });
    expect(result).toBe(false);
  });

  it("has() does not match different PR", async () => {
    const reviewRepo = createReviewRepo(db);
    const review = await reviewRepo.create({ tenantId, repoId: "r1", prId: 1 });
    await reviewRepo.createFinding({
      reviewId: review.id,
      issueType: "bug",
      severity: "high",
      filePath: "/a.ts",
      startLine: 1,
      endLine: 5,
      message: "Bug",
      findingHash: "hash1",
    });

    const result = await store.has({ repoId: "r1", prId: 2, findingHash: "hash1" });
    expect(result).toBe(false);
  });

  it("has() scoped by tenantId (no cross-tenant leakage)", async () => {
    const tenantRepo = createTenantRepo(db);
    const otherTenant = await tenantRepo.create({ adoOrgId: `other-${Date.now()}` });

    const reviewRepo = createReviewRepo(db);
    const review = await reviewRepo.create({ tenantId: otherTenant.id, repoId: "r1", prId: 1 });
    await reviewRepo.createFinding({
      reviewId: review.id,
      issueType: "bug",
      severity: "high",
      filePath: "/a.ts",
      startLine: 1,
      endLine: 5,
      message: "Bug",
      findingHash: "cross-tenant-hash",
    });

    // Our store (scoped to our tenant) should not see other tenant's findings
    const result = await store.has({ repoId: "r1", prId: 1, findingHash: "cross-tenant-hash" });
    expect(result).toBe(false);
  });
});
