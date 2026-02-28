import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerUsageRoutes } from "../../../src/routes/api/usage";

const mockGetMonthlyUsage = vi.fn();
const mockGetDailyUsage = vi.fn();
const mockGetPlanLimits = vi.fn();
const mockFindById = vi.fn();

vi.mock("../../../src/db/repos/usageRepo", () => ({
  createUsageRepo: () => ({
    getMonthlyUsage: mockGetMonthlyUsage,
    getDailyUsage: mockGetDailyUsage,
    getPlanLimits: mockGetPlanLimits,
  }),
}));

vi.mock("../../../src/db/repos/tenantRepo", () => ({
  createTenantRepo: () => ({
    findById: mockFindById,
  }),
}));

function buildApp(tenantId?: string) {
  const app = Fastify();
  app.decorateRequest("tenantId", "");
  app.addHook("onRequest", async (request) => {
    (request as { tenantId?: string }).tenantId = tenantId;
  });
  return app;
}

describe("usage API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /usage", () => {
    it("returns monthly usage and plan limits", async () => {
      mockGetMonthlyUsage.mockResolvedValue({ reviewCount: 10, findingsCount: 25, tokensUsed: 5000, llmCostCents: 50 });
      mockFindById.mockResolvedValue({ id: "t1", plan: "pro" });
      mockGetPlanLimits.mockResolvedValue({
        maxReviewsPerMonth: 100,
        maxTokensPerMonth: 500000,
        maxFilesPerReview: 50,
        maxReposPerOrg: 20,
      });

      const app = buildApp("t1");
      await app.register(registerUsageRoutes, { db: {} as never });

      const res = await app.inject({ method: "GET", url: "/usage" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.usage.reviewCount).toBe(10);
      expect(body.limits.maxReviewsPerMonth).toBe(100);
      expect(body.plan).toBe("pro");
    });

    it("returns null limits when no plan defined", async () => {
      mockGetMonthlyUsage.mockResolvedValue({ reviewCount: 0, findingsCount: 0, tokensUsed: 0, llmCostCents: 0 });
      mockFindById.mockResolvedValue({ id: "t1", plan: "free" });
      mockGetPlanLimits.mockResolvedValue(null);

      const app = buildApp("t1");
      await app.register(registerUsageRoutes, { db: {} as never });

      const res = await app.inject({ method: "GET", url: "/usage" });
      const body = JSON.parse(res.body);
      expect(body.limits).toBeNull();
    });

    it("supports year/month query params", async () => {
      mockGetMonthlyUsage.mockResolvedValue({ reviewCount: 5, findingsCount: 10, tokensUsed: 2000, llmCostCents: 20 });
      mockFindById.mockResolvedValue({ id: "t1", plan: "free" });
      mockGetPlanLimits.mockResolvedValue(null);

      const app = buildApp("t1");
      await app.register(registerUsageRoutes, { db: {} as never });

      const res = await app.inject({ method: "GET", url: "/usage?year=2025&month=6" });
      const body = JSON.parse(res.body);
      expect(body.period).toEqual({ year: 2025, month: 6 });
    });

    it("returns 401 without tenant", async () => {
      const app = buildApp(undefined);
      await app.register(registerUsageRoutes, { db: {} as never });

      const res = await app.inject({ method: "GET", url: "/usage" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /usage/daily", () => {
    it("returns daily breakdown", async () => {
      const date = new Date("2025-06-15T00:00:00Z");
      mockGetDailyUsage.mockResolvedValue([
        { date, reviewCount: 3, findingsCount: 10, tokensUsed: 1000, llmCostCents: 10 },
      ]);

      const app = buildApp("t1");
      await app.register(registerUsageRoutes, { db: {} as never });

      const res = await app.inject({ method: "GET", url: "/usage/daily?year=2025&month=6" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.daily).toHaveLength(1);
      expect(body.daily[0].reviewCount).toBe(3);
    });
  });
});
