import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createConfigRepo } from "../../../src/db/repos/configRepo";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import type { ConfigRepo } from "../../../src/db/repos/configRepo";
import type { TenantRepo } from "../../../src/db/repos/tenantRepo";
import type { DrizzleInstance } from "../../../src/db/connection";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../testDbHelper";

describe.skipIf(!isDbAvailable())("configRepo (integration)", () => {
  let db: DrizzleInstance;
  let configRepo: ConfigRepo;
  let tenantRepo: TenantRepo;
  let tenantId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    configRepo = createConfigRepo(db);
    tenantRepo = createTenantRepo(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenant = await tenantRepo.create({ adoOrgId: `org-${Date.now()}` });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("findByTenantId returns null when no config exists", async () => {
    const found = await configRepo.findByTenantId(tenantId);
    expect(found).toBeNull();
  });

  it("upsert creates a config on first call", async () => {
    const config = await configRepo.upsert(tenantId, { reviewStrictness: "strict" });
    expect(config.tenantId).toBe(tenantId);
    expect(config.reviewStrictness).toBe("strict");
    expect(config.llmMode).toBe("managed"); // default
  });

  it("upsert updates on subsequent calls", async () => {
    await configRepo.upsert(tenantId, { reviewStrictness: "strict" });
    const updated = await configRepo.upsert(tenantId, { reviewStrictness: "relaxed", maxFiles: 50 });
    expect(updated.reviewStrictness).toBe("relaxed");
    expect(updated.maxFiles).toBe(50);
  });

  it("findByTenantId returns the config after upsert", async () => {
    await configRepo.upsert(tenantId, { minSeverity: "high" });
    const found = await configRepo.findByTenantId(tenantId);
    expect(found).not.toBeNull();
    expect(found!.minSeverity).toBe("high");
  });

  it("config is scoped by tenant - no cross-tenant leakage", async () => {
    const tenant2 = await tenantRepo.create({ adoOrgId: `org2-${Date.now()}` });
    await configRepo.upsert(tenantId, { reviewStrictness: "strict" });
    await configRepo.upsert(tenant2.id, { reviewStrictness: "relaxed" });

    const config1 = await configRepo.findByTenantId(tenantId);
    const config2 = await configRepo.findByTenantId(tenant2.id);
    expect(config1!.reviewStrictness).toBe("strict");
    expect(config2!.reviewStrictness).toBe("relaxed");
  });
});
