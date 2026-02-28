import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPlanEnforcer } from "../../src/review/planEnforcement";
import pino from "pino";

const mockFindById = vi.fn();
const mockGetPlanLimits = vi.fn();
const mockGetMonthlyUsage = vi.fn();
const mockRecordUsage = vi.fn();

vi.mock("../../src/db/repos/usageRepo", () => ({
  createUsageRepo: () => ({
    getPlanLimits: mockGetPlanLimits,
    getMonthlyUsage: mockGetMonthlyUsage,
    recordUsage: mockRecordUsage,
  }),
}));

vi.mock("../../src/db/repos/tenantRepo", () => ({
  createTenantRepo: () => ({
    findById: mockFindById,
  }),
}));

const logger = pino({ level: "silent" });

describe("PlanEnforcer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows review when no plan limits defined", async () => {
    mockFindById.mockResolvedValue({ id: "t1", plan: "free" });
    mockGetPlanLimits.mockResolvedValue(null);

    const enforcer = createPlanEnforcer({} as never, logger);
    const result = await enforcer.checkReviewAllowed("t1");
    expect(result.allowed).toBe(true);
  });

  it("allows review when under limits", async () => {
    mockFindById.mockResolvedValue({ id: "t1", plan: "free" });
    mockGetPlanLimits.mockResolvedValue({ maxReviewsPerMonth: 50, maxTokensPerMonth: 100000 });
    mockGetMonthlyUsage.mockResolvedValue({ reviewCount: 10, tokensUsed: 5000 });

    const enforcer = createPlanEnforcer({} as never, logger);
    const result = await enforcer.checkReviewAllowed("t1");
    expect(result.allowed).toBe(true);
  });

  it("blocks review when over review count limit", async () => {
    mockFindById.mockResolvedValue({ id: "t1", plan: "free" });
    mockGetPlanLimits.mockResolvedValue({ maxReviewsPerMonth: 50, maxTokensPerMonth: 100000 });
    mockGetMonthlyUsage.mockResolvedValue({ reviewCount: 50, tokensUsed: 5000 });

    const enforcer = createPlanEnforcer({} as never, logger);
    const result = await enforcer.checkReviewAllowed("t1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Monthly review limit reached");
    expect(result.usage).toEqual({ reviewCount: 50, limit: 50 });
  });

  it("blocks review when over token limit", async () => {
    mockFindById.mockResolvedValue({ id: "t1", plan: "free" });
    mockGetPlanLimits.mockResolvedValue({ maxReviewsPerMonth: 1000, maxTokensPerMonth: 100000 });
    mockGetMonthlyUsage.mockResolvedValue({ reviewCount: 10, tokensUsed: 100000 });

    const enforcer = createPlanEnforcer({} as never, logger);
    const result = await enforcer.checkReviewAllowed("t1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Monthly token limit reached");
  });

  it("blocks review when tenant not found", async () => {
    mockFindById.mockResolvedValue(null);

    const enforcer = createPlanEnforcer({} as never, logger);
    const result = await enforcer.checkReviewAllowed("t1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Tenant not found");
  });

  it("records review usage", async () => {
    mockRecordUsage.mockResolvedValue(undefined);

    const enforcer = createPlanEnforcer({} as never, logger);
    await enforcer.recordReviewUsage("t1", { findingsCount: 5, tokensUsed: 1000 });

    expect(mockRecordUsage).toHaveBeenCalledWith("t1", {
      reviewCount: 1,
      findingsCount: 5,
      tokensUsed: 1000,
    });
  });
});
