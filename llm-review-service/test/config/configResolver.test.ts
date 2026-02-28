import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { DrizzleInstance } from "../../src/db/connection";
import { createConfigResolver } from "../../src/config/configResolver";
import { createTenantRepo } from "../../src/db/repos/tenantRepo";
import { createConfigRepo } from "../../src/db/repos/configRepo";
import { createRepoConfigRepo } from "../../src/db/repos/repoConfigRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../db/testDbHelper";

describe.skipIf(!isDbAvailable())("ConfigResolver (integration)", () => {
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

  it("returns system defaults when no config exists", async () => {
    const resolver = createConfigResolver(db);
    const config = await resolver.resolve(tenantId);
    expect(config.reviewStrictness).toBe("balanced");
    expect(config.maxFiles).toBe(20);
    expect(config.maxDiffSize).toBe(2000);
    expect(config.enableA11yText).toBe(true);
    expect(config.enableA11yVisual).toBe(false);
    expect(config.enableSecurity).toBe(true);
    expect(config.commentStyle).toBe("inline");
    expect(config.minSeverity).toBe("low");
  });

  it("applies tenant config over defaults", async () => {
    const configRepo = createConfigRepo(db);
    await configRepo.upsert(tenantId, { reviewStrictness: "strict", maxFiles: 50 });

    const resolver = createConfigResolver(db);
    const config = await resolver.resolve(tenantId);
    expect(config.reviewStrictness).toBe("strict");
    expect(config.maxFiles).toBe(20); // capped by free plan
    expect(config.enableA11yText).toBe(true); // default preserved
  });

  it("applies repo config overrides over tenant config", async () => {
    const configRepo = createConfigRepo(db);
    await configRepo.upsert(tenantId, { reviewStrictness: "strict", maxFiles: 15 });

    const repoConfigRepo = createRepoConfigRepo(db);
    await repoConfigRepo.upsert(tenantId, "repo-1", { reviewStrictness: "relaxed" });

    const resolver = createConfigResolver(db);
    const config = await resolver.resolve(tenantId, "repo-1");
    expect(config.reviewStrictness).toBe("relaxed"); // repo override
    expect(config.maxFiles).toBe(15); // tenant config (no repo override for maxFiles)
  });

  it("caps maxFiles by plan limits (free plan)", async () => {
    const configRepo = createConfigRepo(db);
    await configRepo.upsert(tenantId, { maxFiles: 100 });

    const resolver = createConfigResolver(db);
    const config = await resolver.resolve(tenantId, undefined, "free");
    expect(config.maxFiles).toBe(20); // capped by free plan
  });

  it("caps maxFiles by plan limits (pro plan)", async () => {
    const configRepo = createConfigRepo(db);
    await configRepo.upsert(tenantId, { maxFiles: 100 });

    const resolver = createConfigResolver(db);
    const config = await resolver.resolve(tenantId, undefined, "pro");
    expect(config.maxFiles).toBe(50); // capped by pro plan
  });

  it("enterprise plan allows higher limits", async () => {
    const configRepo = createConfigRepo(db);
    await configRepo.upsert(tenantId, { maxFiles: 150 });

    const resolver = createConfigResolver(db);
    const config = await resolver.resolve(tenantId, undefined, "enterprise");
    expect(config.maxFiles).toBe(150); // within enterprise cap of 200
  });

  it("repo override is also capped by plan", async () => {
    const repoConfigRepo = createRepoConfigRepo(db);
    await repoConfigRepo.upsert(tenantId, "repo-1", { maxFiles: 100 });

    const resolver = createConfigResolver(db);
    const config = await resolver.resolve(tenantId, "repo-1", "free");
    expect(config.maxFiles).toBe(20); // capped by free plan
  });

  it("handles null repo config fields (only overrides non-null)", async () => {
    const configRepo = createConfigRepo(db);
    await configRepo.upsert(tenantId, { reviewStrictness: "strict", enableSecurity: false });

    const repoConfigRepo = createRepoConfigRepo(db);
    // Only override enableA11yVisual, leave others null
    await repoConfigRepo.upsert(tenantId, "repo-1", { enableA11yVisual: true });

    const resolver = createConfigResolver(db);
    const config = await resolver.resolve(tenantId, "repo-1");
    expect(config.reviewStrictness).toBe("strict"); // from tenant
    expect(config.enableSecurity).toBe(false); // from tenant
    expect(config.enableA11yVisual).toBe(true); // from repo override
  });

  it("preserves system defaults for non-overridable fields", async () => {
    const resolver = createConfigResolver(db);
    const config = await resolver.resolve(tenantId);
    expect(config.maxHunks).toBe(80);
    expect(config.hunkContextLines).toBe(20);
    expect(config.tokenBudgetLlm1).toBe(3000);
    expect(config.tokenBudgetLlm2).toBe(6000);
    expect(config.a11yFileExtensions).toEqual([".html", ".jsx", ".tsx", ".vue", ".svelte", ".css", ".scss"]);
  });
});
