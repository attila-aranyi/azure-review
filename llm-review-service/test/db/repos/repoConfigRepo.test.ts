import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { DrizzleInstance } from "../../../src/db/connection";
import { createRepoConfigRepo } from "../../../src/db/repos/repoConfigRepo";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../testDbHelper";

describe.skipIf(!isDbAvailable())("repoConfigRepo (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: "test-org" });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("returns null when no repo config exists", async () => {
    const repo = createRepoConfigRepo(db);
    const result = await repo.findByTenantAndRepo(tenantId, "repo-1");
    expect(result).toBeNull();
  });

  it("upserts creates a new repo config", async () => {
    const repo = createRepoConfigRepo(db);
    const config = await repo.upsert(tenantId, "repo-1", {
      reviewStrictness: "strict",
      maxFiles: 50,
      adoRepoName: "My Repo",
    });
    expect(config.tenantId).toBe(tenantId);
    expect(config.adoRepoId).toBe("repo-1");
    expect(config.reviewStrictness).toBe("strict");
    expect(config.maxFiles).toBe(50);
    expect(config.adoRepoName).toBe("My Repo");
    expect(config.enableA11yText).toBeNull();
  });

  it("upsert updates existing repo config", async () => {
    const repo = createRepoConfigRepo(db);
    await repo.upsert(tenantId, "repo-1", { reviewStrictness: "strict" });
    const updated = await repo.upsert(tenantId, "repo-1", { reviewStrictness: "relaxed", maxFiles: 30 });
    expect(updated.reviewStrictness).toBe("relaxed");
    expect(updated.maxFiles).toBe(30);
  });

  it("findByTenantAndRepo retrieves correct config", async () => {
    const repo = createRepoConfigRepo(db);
    await repo.upsert(tenantId, "repo-1", { reviewStrictness: "strict" });
    const config = await repo.findByTenantAndRepo(tenantId, "repo-1");
    expect(config).not.toBeNull();
    expect(config!.reviewStrictness).toBe("strict");
  });

  it("findByTenantId returns all repo configs for tenant", async () => {
    const repo = createRepoConfigRepo(db);
    await repo.upsert(tenantId, "repo-1", { reviewStrictness: "strict" });
    await repo.upsert(tenantId, "repo-2", { reviewStrictness: "relaxed" });
    const configs = await repo.findByTenantId(tenantId);
    expect(configs).toHaveLength(2);
  });

  it("remove deletes repo config and returns true", async () => {
    const repo = createRepoConfigRepo(db);
    await repo.upsert(tenantId, "repo-1", { reviewStrictness: "strict" });
    const removed = await repo.remove(tenantId, "repo-1");
    expect(removed).toBe(true);
    const config = await repo.findByTenantAndRepo(tenantId, "repo-1");
    expect(config).toBeNull();
  });

  it("remove returns false for non-existent config", async () => {
    const repo = createRepoConfigRepo(db);
    const removed = await repo.remove(tenantId, "non-existent");
    expect(removed).toBe(false);
  });

  it("configs are tenant-scoped (no cross-tenant leakage)", async () => {
    const tenantRepo = createTenantRepo(db);
    const tenant2 = await tenantRepo.create({ adoOrgId: "other-org" });
    const repo = createRepoConfigRepo(db);
    await repo.upsert(tenantId, "repo-1", { reviewStrictness: "strict" });
    const config = await repo.findByTenantAndRepo(tenant2.id, "repo-1");
    expect(config).toBeNull();
  });

  it("supports enableAxon field", async () => {
    const repo = createRepoConfigRepo(db);
    const config = await repo.upsert(tenantId, "repo-1", { enableAxon: true });
    expect(config.enableAxon).toBe(true);
  });
});
