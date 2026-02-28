import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerRepoConfigRoutes } from "../../../src/routes/api/repoConfig";

// Mock DB and repos
const mockFindByTenantAndRepo = vi.fn();
const mockFindByTenantId = vi.fn();
const mockUpsert = vi.fn();
const mockRemove = vi.fn();
const mockResolve = vi.fn();

vi.mock("../../../src/db/repos/repoConfigRepo", () => ({
  createRepoConfigRepo: () => ({
    findByTenantAndRepo: mockFindByTenantAndRepo,
    findByTenantId: mockFindByTenantId,
    upsert: mockUpsert,
    remove: mockRemove,
  }),
}));

vi.mock("../../../src/config/configResolver", () => ({
  createConfigResolver: () => ({
    resolve: mockResolve,
  }),
}));

function buildApp(tenantId?: string) {
  const app = Fastify();
  // Simulate auth middleware
  app.decorateRequest("tenantId", "");
  app.addHook("onRequest", async (request) => {
    (request as { tenantId?: string }).tenantId = tenantId;
  });
  return app;
}

describe("repoConfig API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /repos/:repoId/config", () => {
    it("returns overrides when repo config exists", async () => {
      mockFindByTenantAndRepo.mockResolvedValue({
        tenantId: "t1",
        adoRepoId: "repo-1",
        reviewStrictness: "strict",
        maxFiles: 50,
        maxDiffSize: null,
        enableA11yText: null,
        enableA11yVisual: null,
        enableSecurity: null,
        commentStyle: null,
        minSeverity: null,
        fileIncludeGlob: null,
        fileExcludeGlob: null,
        enableAxon: true,
      });

      const app = buildApp("t1");
      await app.register(registerRepoConfigRoutes, { db: {} as never });

      const res = await app.inject({ method: "GET", url: "/repos/repo-1/config" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.overrides.reviewStrictness).toBe("strict");
      expect(body.overrides.maxFiles).toBe(50);
      expect(body.overrides.enableAxon).toBe(true);
    });

    it("returns null overrides when no repo config exists", async () => {
      mockFindByTenantAndRepo.mockResolvedValue(null);

      const app = buildApp("t1");
      await app.register(registerRepoConfigRoutes, { db: {} as never });

      const res = await app.inject({ method: "GET", url: "/repos/repo-1/config" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.overrides).toBeNull();
    });

    it("returns 401 without tenant", async () => {
      const app = buildApp(undefined);
      await app.register(registerRepoConfigRoutes, { db: {} as never });

      const res = await app.inject({ method: "GET", url: "/repos/repo-1/config" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /repos/:repoId/config/effective", () => {
    it("returns merged effective config", async () => {
      mockResolve.mockResolvedValue({
        reviewStrictness: "strict",
        maxFiles: 20,
        maxDiffSize: 2000,
        enableA11yText: true,
      });

      const app = buildApp("t1");
      await app.register(registerRepoConfigRoutes, { db: {} as never });

      const res = await app.inject({ method: "GET", url: "/repos/repo-1/config/effective" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.config.reviewStrictness).toBe("strict");
      expect(body.repoId).toBe("repo-1");
    });
  });

  describe("PUT /repos/:repoId/config", () => {
    it("creates or updates repo config", async () => {
      mockUpsert.mockResolvedValue({
        tenantId: "t1",
        adoRepoId: "repo-1",
        reviewStrictness: "strict",
        maxFiles: 50,
        maxDiffSize: null,
        enableA11yText: null,
        enableA11yVisual: null,
        enableSecurity: null,
        commentStyle: null,
        minSeverity: null,
        fileIncludeGlob: null,
        fileExcludeGlob: null,
        enableAxon: null,
      });

      const app = buildApp("t1");
      await app.register(registerRepoConfigRoutes, { db: {} as never });

      const res = await app.inject({
        method: "PUT",
        url: "/repos/repo-1/config",
        payload: { reviewStrictness: "strict", maxFiles: 50 },
      });
      expect(res.statusCode).toBe(200);
      expect(mockUpsert).toHaveBeenCalledWith("t1", "repo-1", { reviewStrictness: "strict", maxFiles: 50 });
    });

    it("returns 400 for invalid config", async () => {
      const app = buildApp("t1");
      await app.register(registerRepoConfigRoutes, { db: {} as never });

      const res = await app.inject({
        method: "PUT",
        url: "/repos/repo-1/config",
        payload: { reviewStrictness: "invalid-value" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("DELETE /repos/:repoId/config", () => {
    it("removes repo config", async () => {
      mockRemove.mockResolvedValue(true);

      const app = buildApp("t1");
      await app.register(registerRepoConfigRoutes, { db: {} as never });

      const res = await app.inject({ method: "DELETE", url: "/repos/repo-1/config" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
    });

    it("returns 404 when no config to delete", async () => {
      mockRemove.mockResolvedValue(false);

      const app = buildApp("t1");
      await app.register(registerRepoConfigRoutes, { db: {} as never });

      const res = await app.inject({ method: "DELETE", url: "/repos/repo-1/config" });
      expect(res.statusCode).toBe(404);
    });
  });
});
