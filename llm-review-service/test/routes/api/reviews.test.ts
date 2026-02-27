import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerReviewRoutes } from "../../../src/routes/api/reviews";
import type { DrizzleInstance } from "../../../src/db/connection";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import { createReviewRepo } from "../../../src/db/repos/reviewRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../../db/testDbHelper";
import type { ReviewQueue } from "../../../src/review/queue";

const mockQueue: ReviewQueue = {
  enabled: false,
  enqueue: async () => {},
  ping: async () => true,
  close: async () => {},
};

describe.skipIf(!isDbAvailable())("Review API routes (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;
  let reviewRepo: ReturnType<typeof createReviewRepo>;

  beforeAll(async () => {
    db = await setupTestDb();
    reviewRepo = createReviewRepo(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: `org-${Date.now()}` });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  async function buildApp() {
    const app = Fastify({ logger: false });
    app.decorateRequest("tenantId", undefined);
    app.addHook("onRequest", async (req) => {
      req.tenantId = tenantId;
    });
    await app.register(registerReviewRoutes, { db, queue: mockQueue });
    return app;
  }

  it("GET /reviews returns paginated list", async () => {
    const app = await buildApp();
    for (let i = 0; i < 3; i++) {
      await reviewRepo.create({ tenantId, repoId: "r", prId: i + 1 });
    }

    const res = await app.inject({ method: "GET", url: "/reviews?page=1&limit=2" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(3);
  });

  it("GET /reviews filters by projectId", async () => {
    const app = await buildApp();
    await reviewRepo.create({ tenantId, repoId: "r", prId: 1, adoProjectId: "proj-a" });
    await reviewRepo.create({ tenantId, repoId: "r", prId: 2, adoProjectId: "proj-b" });

    const res = await app.inject({ method: "GET", url: "/reviews?projectId=proj-a" });
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("GET /reviews/:id returns review with findings", async () => {
    const app = await buildApp();
    const review = await reviewRepo.create({ tenantId, repoId: "r", prId: 1 });
    await reviewRepo.createFinding({
      reviewId: review.id,
      issueType: "bug",
      severity: "high",
      filePath: "/a.ts",
      startLine: 1,
      endLine: 5,
      message: "Bug found",
      findingHash: "hash1",
    });

    const res = await app.inject({ method: "GET", url: `/reviews/${review.id}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(review.id);
    expect(body.findings).toHaveLength(1);
  });

  it("GET /reviews/:id returns 404 for other tenant's review", async () => {
    const app = await buildApp();
    const tenantRepo = createTenantRepo(db);
    const otherTenant = await tenantRepo.create({ adoOrgId: `other-${Date.now()}` });
    const review = await reviewRepo.create({ tenantId: otherTenant.id, repoId: "r", prId: 1 });

    const res = await app.inject({ method: "GET", url: `/reviews/${review.id}` });
    expect(res.statusCode).toBe(404);
  });

  it("POST /reviews/:id/retrigger returns 503 when queue disabled", async () => {
    const app = await buildApp();
    const review = await reviewRepo.create({ tenantId, repoId: "r", prId: 1 });

    const res = await app.inject({ method: "POST", url: `/reviews/${review.id}/retrigger` });
    expect(res.statusCode).toBe(503);
  });
});
