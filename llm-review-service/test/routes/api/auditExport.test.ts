import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerAuditExportRoutes } from "../../../src/routes/api/auditExport";

const mockExportReviewsWithFindings = vi.fn();

vi.mock("../../../src/db/repos/auditExportRepo", () => ({
  createAuditExportRepo: () => ({
    exportReviewsWithFindings: mockExportReviewsWithFindings,
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

const sampleRows = [
  {
    reviewId: "r1",
    repoId: "repo-1",
    prId: 42,
    reviewStatus: "completed",
    reviewCreatedAt: new Date("2026-03-01T12:00:00Z"),
    reviewCompletedAt: new Date("2026-03-01T12:01:00Z"),
    findingId: "f1",
    issueType: "bug",
    severity: "high",
    filePath: "src/main.ts",
    startLine: 10,
    endLine: 15,
    message: "Null reference",
    suggestion: "Add null check",
    findingStatus: "posted",
  },
  {
    reviewId: "r1",
    repoId: "repo-1",
    prId: 42,
    reviewStatus: "completed",
    reviewCreatedAt: new Date("2026-03-01T12:00:00Z"),
    reviewCompletedAt: new Date("2026-03-01T12:01:00Z"),
    findingId: "f2",
    issueType: "style",
    severity: "low",
    filePath: "src/utils.ts",
    startLine: 5,
    endLine: 5,
    message: "Consider renaming",
    suggestion: null,
    findingStatus: "posted",
  },
];

describe("audit export API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /export/audit", () => {
    it("returns 401 without tenant", async () => {
      const app = buildApp(undefined);
      await app.register(registerAuditExportRoutes, { db: {} as never });

      const res = await app.inject({
        method: "GET",
        url: "/export/audit?from=2026-03-01&to=2026-03-31",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 when from or to is missing", async () => {
      const app = buildApp("t1");
      await app.register(registerAuditExportRoutes, { db: {} as never });

      const res = await app.inject({ method: "GET", url: "/export/audit" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when date range exceeds 90 days", async () => {
      const app = buildApp("t1");
      await app.register(registerAuditExportRoutes, { db: {} as never });

      const res = await app.inject({
        method: "GET",
        url: "/export/audit?from=2026-01-01&to=2026-06-01",
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("90 days");
    });

    it("returns 400 when from is after to", async () => {
      const app = buildApp("t1");
      await app.register(registerAuditExportRoutes, { db: {} as never });

      const res = await app.inject({
        method: "GET",
        url: "/export/audit?from=2026-04-01&to=2026-03-01",
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns JSON by default", async () => {
      mockExportReviewsWithFindings.mockResolvedValue(sampleRows);

      const app = buildApp("t1");
      await app.register(registerAuditExportRoutes, { db: {} as never });

      const res = await app.inject({
        method: "GET",
        url: "/export/audit?from=2026-03-01&to=2026-03-31",
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");

      const body = JSON.parse(res.body);
      expect(body.reviews).toBeDefined();
      expect(body.reviews).toHaveLength(1); // One review with 2 findings
      expect(body.reviews[0].findings).toHaveLength(2);
    });

    it("returns JSON with format=json", async () => {
      mockExportReviewsWithFindings.mockResolvedValue(sampleRows);

      const app = buildApp("t1");
      await app.register(registerAuditExportRoutes, { db: {} as never });

      const res = await app.inject({
        method: "GET",
        url: "/export/audit?from=2026-03-01&to=2026-03-31&format=json",
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.reviews).toBeDefined();
    });

    it("returns CSV with format=csv", async () => {
      mockExportReviewsWithFindings.mockResolvedValue(sampleRows);

      const app = buildApp("t1");
      await app.register(registerAuditExportRoutes, { db: {} as never });

      const res = await app.inject({
        method: "GET",
        url: "/export/audit?from=2026-03-01&to=2026-03-31&format=csv",
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment");

      const lines = res.body.trim().split("\n");
      expect(lines.length).toBe(3); // header + 2 finding rows
      expect(lines[0]).toContain("reviewId");
      expect(lines[0]).toContain("issueType");
      expect(lines[0]).toContain("severity");
    });

    it("returns empty result when no data", async () => {
      mockExportReviewsWithFindings.mockResolvedValue([]);

      const app = buildApp("t1");
      await app.register(registerAuditExportRoutes, { db: {} as never });

      const res = await app.inject({
        method: "GET",
        url: "/export/audit?from=2026-03-01&to=2026-03-31&format=json",
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.reviews).toEqual([]);
    });

    it("returns 400 for invalid format", async () => {
      const app = buildApp("t1");
      await app.register(registerAuditExportRoutes, { db: {} as never });

      const res = await app.inject({
        method: "GET",
        url: "/export/audit?from=2026-03-01&to=2026-03-31&format=xml",
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
