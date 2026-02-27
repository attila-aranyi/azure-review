import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerProjectRoutes } from "../../../src/routes/api/projects";
import { TokenManager } from "../../../src/auth/tokenManager";
import { generateKey } from "../../../src/auth/encryption";
import type { DrizzleInstance } from "../../../src/db/connection";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../../db/testDbHelper";
import type { AppConfig } from "../../../src/config/appConfig";

function mockAppConfig(): AppConfig {
  return {
    PORT: 3000,
    LOG_LEVEL: "info",
    CORS_ORIGINS: [],
    RATE_LIMIT_MAX: 30,
    RATE_LIMIT_WINDOW_MS: 60000,
    DATABASE_URL: "postgresql://localhost:5432/test",
    DEPLOYMENT_MODE: "saas",
    TOKEN_ENCRYPTION_KEY: "a".repeat(32),
    AUDIT_ENABLED: true,
    AUDIT_RETENTION_DAYS: 30,
  } as AppConfig;
}

describe.skipIf(!isDbAvailable())("Project API routes (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;
  let tokenManager: TokenManager;

  beforeAll(async () => {
    db = await setupTestDb();
    tokenManager = new TokenManager(db, generateKey());
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
    await app.register(registerProjectRoutes, { db, appConfig: mockAppConfig(), tokenManager });
    return app;
  }

  it("GET /projects returns empty list initially", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/projects" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it("POST /projects/:id/enable creates enrollment", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/projects/proj-1/enable",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.projectId).toBe("proj-1");
    expect(body.status).toBe("active");
    expect(body.webhookUrl).toContain(tenantId);
    expect(body.webhookSecret).toBeDefined();
  });

  it("POST /projects/:id/enable twice returns 409", async () => {
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/projects/proj-1/enable" });
    const res = await app.inject({ method: "POST", url: "/projects/proj-1/enable" });
    expect(res.statusCode).toBe(409);
  });

  it("POST /projects/:id/disable deactivates enrollment", async () => {
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/projects/proj-1/enable" });
    const res = await app.inject({ method: "POST", url: "/projects/proj-1/disable" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("inactive");
  });

  it("POST /projects/:id/disable for nonexistent returns 404", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/projects/nonexistent/disable" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /projects shows enrolled projects", async () => {
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/projects/proj-a/enable" });
    await app.inject({ method: "POST", url: "/projects/proj-b/enable" });

    const res = await app.inject({ method: "GET", url: "/projects" });
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
  });
});
