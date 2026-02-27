import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerTenantRoutes } from "../../../src/routes/api/tenants";
import type { DrizzleInstance } from "../../../src/db/connection";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../../db/testDbHelper";

describe.skipIf(!isDbAvailable())("Tenant API routes (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: "test-org", adoOrgName: "Test Org" });
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
    await app.register(registerTenantRoutes, { db });
    return app;
  }

  it("GET /tenants/me returns tenant info", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/tenants/me" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(tenantId);
    expect(body.adoOrgId).toBe("test-org");
    expect(body.adoOrgName).toBe("Test Org");
    expect(body.status).toBe("active");
    expect(body.plan).toBe("free");
  });

  it("GET /tenants/me/status returns connection health", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/tenants/me/status" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.connected).toBe(true);
    expect(body.status).toBe("active");
    expect(body.projectCount).toBe(0);
    expect(body.totalReviews).toBe(0);
  });
});
