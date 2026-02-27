import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import type { TenantRepo } from "../../../src/db/repos/tenantRepo";
import type { DrizzleInstance } from "../../../src/db/connection";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../testDbHelper";

describe.skipIf(!isDbAvailable())("tenantRepo (integration)", () => {
  let db: DrizzleInstance;
  let repo: TenantRepo;

  beforeAll(async () => {
    db = await setupTestDb();
    repo = createTenantRepo(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("create returns a tenant with generated id", async () => {
    const tenant = await repo.create({ adoOrgId: "org-1", adoOrgName: "Test Org" });
    expect(tenant.id).toBeDefined();
    expect(tenant.adoOrgId).toBe("org-1");
    expect(tenant.adoOrgName).toBe("Test Org");
    expect(tenant.status).toBe("active");
    expect(tenant.plan).toBe("free");
  });

  it("findById returns the created tenant", async () => {
    const created = await repo.create({ adoOrgId: "org-2" });
    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.adoOrgId).toBe("org-2");
  });

  it("findById returns null for nonexistent id", async () => {
    const found = await repo.findById("00000000-0000-0000-0000-000000000000");
    expect(found).toBeNull();
  });

  it("findByAdoOrgId returns the tenant", async () => {
    await repo.create({ adoOrgId: "org-3", adoOrgName: "Org 3" });
    const found = await repo.findByAdoOrgId("org-3");
    expect(found).not.toBeNull();
    expect(found!.adoOrgId).toBe("org-3");
  });

  it("findByAdoOrgId returns null for nonexistent org", async () => {
    const found = await repo.findByAdoOrgId("nonexistent");
    expect(found).toBeNull();
  });

  it("duplicate adoOrgId throws unique constraint error", async () => {
    await repo.create({ adoOrgId: "org-dup" });
    await expect(repo.create({ adoOrgId: "org-dup" })).rejects.toThrow();
  });

  it("updateStatus changes the tenant status", async () => {
    const created = await repo.create({ adoOrgId: "org-status" });
    await repo.updateStatus(created.id, "suspended");
    const found = await repo.findById(created.id);
    expect(found!.status).toBe("suspended");
  });

  it("upsert creates on first call", async () => {
    const result = await repo.upsert({ adoOrgId: "org-upsert", adoOrgName: "First" });
    expect(result.adoOrgId).toBe("org-upsert");
    expect(result.adoOrgName).toBe("First");
  });

  it("upsert updates on subsequent calls", async () => {
    await repo.upsert({ adoOrgId: "org-upsert2", adoOrgName: "First" });
    const updated = await repo.upsert({ adoOrgId: "org-upsert2", adoOrgName: "Updated" });
    expect(updated.adoOrgName).toBe("Updated");

    const all = await repo.findByAdoOrgId("org-upsert2");
    expect(all).not.toBeNull();
  });
});
