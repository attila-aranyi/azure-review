import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerReviewRoutes } from "../../src/routes/api/reviews";

const mockFindById = vi.fn();
const mockFindFindingsByReviewId = vi.fn();
const mockListByTenant = vi.fn();
const mockFeedbackCreate = vi.fn();
const mockEnqueue = vi.fn();

vi.mock("../../src/db/repos/reviewRepo", () => ({
  createReviewRepo: () => ({
    findById: mockFindById,
    findFindingsByReviewId: mockFindFindingsByReviewId,
    listByTenant: mockListByTenant,
  }),
}));

vi.mock("../../src/db/repos/feedbackRepo", () => ({
  createFeedbackRepo: () => ({
    create: mockFeedbackCreate,
  }),
}));

function buildApp(tenantId?: string) {
  const app = Fastify();
  app.decorateRequest("tenantId", "");
  app.decorateRequest("adoUserId", "");
  app.addHook("onRequest", async (request) => {
    (request as { tenantId?: string }).tenantId = tenantId;
    (request as { adoUserId?: string }).adoUserId = "user-123";
  });
  return app;
}

describe("feedback API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /reviews/:id/findings/:findingId/feedback stores vote", async () => {
    mockFindById.mockResolvedValue({ id: "rev-1", tenantId: "t1" });
    mockFindFindingsByReviewId.mockResolvedValue([
      { id: "finding-1", reviewId: "rev-1" },
    ]);
    mockFeedbackCreate.mockResolvedValue({ id: "fb-1" });

    const app = buildApp("t1");
    const queue = { enabled: false, enqueue: mockEnqueue };
    await app.register(registerReviewRoutes, { db: {} as never, queue: queue as never });

    const res = await app.inject({
      method: "POST",
      url: "/reviews/rev-1/findings/finding-1/feedback",
      payload: { vote: "up", comment: "Helpful!" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.feedbackId).toBe("fb-1");
    expect(mockFeedbackCreate).toHaveBeenCalledWith({
      findingId: "finding-1",
      tenantId: "t1",
      adoUserId: "user-123",
      vote: "up",
      comment: "Helpful!",
    });
  });

  it("returns 404 for non-existent review", async () => {
    mockFindById.mockResolvedValue(null);

    const app = buildApp("t1");
    const queue = { enabled: false, enqueue: mockEnqueue };
    await app.register(registerReviewRoutes, { db: {} as never, queue: queue as never });

    const res = await app.inject({
      method: "POST",
      url: "/reviews/rev-1/findings/finding-1/feedback",
      payload: { vote: "down" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for non-existent finding", async () => {
    mockFindById.mockResolvedValue({ id: "rev-1", tenantId: "t1" });
    mockFindFindingsByReviewId.mockResolvedValue([]);

    const app = buildApp("t1");
    const queue = { enabled: false, enqueue: mockEnqueue };
    await app.register(registerReviewRoutes, { db: {} as never, queue: queue as never });

    const res = await app.inject({
      method: "POST",
      url: "/reviews/rev-1/findings/finding-1/feedback",
      payload: { vote: "up" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid vote", async () => {
    mockFindById.mockResolvedValue({ id: "rev-1", tenantId: "t1" });
    mockFindFindingsByReviewId.mockResolvedValue([{ id: "finding-1" }]);

    const app = buildApp("t1");
    const queue = { enabled: false, enqueue: mockEnqueue };
    await app.register(registerReviewRoutes, { db: {} as never, queue: queue as never });

    const res = await app.inject({
      method: "POST",
      url: "/reviews/rev-1/findings/finding-1/feedback",
      payload: { vote: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without tenant", async () => {
    const app = buildApp(undefined);
    const queue = { enabled: false, enqueue: mockEnqueue };
    await app.register(registerReviewRoutes, { db: {} as never, queue: queue as never });

    const res = await app.inject({
      method: "POST",
      url: "/reviews/rev-1/findings/finding-1/feedback",
      payload: { vote: "up" },
    });
    expect(res.statusCode).toBe(401);
  });
});
