import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createProjectRepo } from "../../../src/db/repos/projectRepo";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import type { ProjectRepo } from "../../../src/db/repos/projectRepo";
import type { TenantRepo } from "../../../src/db/repos/tenantRepo";
import type { DrizzleInstance } from "../../../src/db/connection";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../testDbHelper";

describe.skipIf(!isDbAvailable())("projectRepo (integration)", () => {
  let db: DrizzleInstance;
  let projectRepo: ProjectRepo;
  let tenantRepo: TenantRepo;
  let tenantId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    projectRepo = createProjectRepo(db);
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

  it("create returns a project enrollment", async () => {
    const proj = await projectRepo.create({
      tenantId,
      adoProjectId: "proj-1",
      adoProjectName: "My Project",
    });
    expect(proj.id).toBeDefined();
    expect(proj.tenantId).toBe(tenantId);
    expect(proj.adoProjectId).toBe("proj-1");
    expect(proj.status).toBe("active");
  });

  it("findByTenantId returns all enrollments for tenant", async () => {
    await projectRepo.create({ tenantId, adoProjectId: "proj-a" });
    await projectRepo.create({ tenantId, adoProjectId: "proj-b" });
    const results = await projectRepo.findByTenantId(tenantId);
    expect(results).toHaveLength(2);
  });

  it("findByTenantAndProject returns the enrollment", async () => {
    await projectRepo.create({ tenantId, adoProjectId: "proj-find" });
    const found = await projectRepo.findByTenantAndProject(tenantId, "proj-find");
    expect(found).not.toBeNull();
    expect(found!.adoProjectId).toBe("proj-find");
  });

  it("findByTenantAndProject returns null for nonexistent", async () => {
    const found = await projectRepo.findByTenantAndProject(tenantId, "nonexistent");
    expect(found).toBeNull();
  });

  it("duplicate (tenantId, adoProjectId) throws unique constraint error", async () => {
    await projectRepo.create({ tenantId, adoProjectId: "dup-proj" });
    await expect(projectRepo.create({ tenantId, adoProjectId: "dup-proj" })).rejects.toThrow();
  });

  it("deactivate sets status to inactive", async () => {
    await projectRepo.create({ tenantId, adoProjectId: "proj-deactivate" });
    await projectRepo.deactivate(tenantId, "proj-deactivate");
    const found = await projectRepo.findByTenantAndProject(tenantId, "proj-deactivate");
    expect(found!.status).toBe("inactive");
  });

  it("no cross-tenant leakage", async () => {
    const tenant2 = await tenantRepo.create({ adoOrgId: `org2-${Date.now()}` });
    await projectRepo.create({ tenantId, adoProjectId: "shared-proj-id" });
    await projectRepo.create({ tenantId: tenant2.id, adoProjectId: "shared-proj-id" });

    const t1Projects = await projectRepo.findByTenantId(tenantId);
    const t2Projects = await projectRepo.findByTenantId(tenant2.id);
    expect(t1Projects).toHaveLength(1);
    expect(t2Projects).toHaveLength(1);
    expect(t1Projects[0].tenantId).toBe(tenantId);
    expect(t2Projects[0].tenantId).toBe(tenant2.id);
  });
});
