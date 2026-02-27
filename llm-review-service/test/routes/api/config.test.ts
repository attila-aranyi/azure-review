import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerConfigRoutes } from "../../../src/routes/api/config";
import type { DrizzleInstance } from "../../../src/db/connection";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../../db/testDbHelper";

describe.skipIf(!isDbAvailable())("Config API routes (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;

  beforeAll(async () => {
    db = await setupTestDb();
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
    await app.register(registerConfigRoutes, { db });
    return app;
  }

  it("GET /config returns defaults when no config exists", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/config" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.reviewStrictness).toBe("balanced");
    expect(body.maxFiles).toBe(20);
    expect(body.llmMode).toBe("managed");
  });

  it("PUT /config updates and returns config", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/config",
      payload: { reviewStrictness: "strict", maxFiles: 50 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.reviewStrictness).toBe("strict");
    expect(body.maxFiles).toBe(50);
  });

  it("PUT /config with invalid strictness returns 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/config",
      payload: { reviewStrictness: "ultra-strict" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /config returns updated values after PUT", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PUT",
      url: "/config",
      payload: { minSeverity: "high" },
    });

    const res = await app.inject({ method: "GET", url: "/config" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.minSeverity).toBe("high");
  });
});
