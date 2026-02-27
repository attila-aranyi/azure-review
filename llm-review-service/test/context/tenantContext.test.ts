import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildTenantContext } from "../../src/context/tenantContext";
import { TokenManager } from "../../src/auth/tokenManager";
import { generateKey } from "../../src/auth/encryption";
import type { DrizzleInstance } from "../../src/db/connection";
import { createTenantRepo } from "../../src/db/repos/tenantRepo";
import { createConfigRepo } from "../../src/db/repos/configRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../db/testDbHelper";
import type { AppConfig } from "../../src/config/appConfig";

function mockAppConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    PORT: 3000,
    LOG_LEVEL: "info",
    CORS_ORIGINS: [],
    RATE_LIMIT_MAX: 30,
    RATE_LIMIT_WINDOW_MS: 60000,
    DATABASE_URL: "postgresql://localhost:5432/test",
    DEPLOYMENT_MODE: "self-hosted",
    ADO_PAT: "test-pat",
    AUDIT_ENABLED: true,
    AUDIT_RETENTION_DAYS: 30,
    ...overrides,
  } as AppConfig;
}

describe.skipIf(!isDbAvailable())("buildTenantContext (integration)", () => {
  let db: DrizzleInstance;
  let encKey: Buffer;
  let tokenManager: TokenManager;
  let tenantId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    encKey = generateKey();
    tokenManager = new TokenManager(db, encKey);
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

  it("builds context with correct orgUrl from tenant record", async () => {
    const ctx = await buildTenantContext(tenantId, db, mockAppConfig(), tokenManager);
    expect(ctx.orgUrl).toBe("https://dev.azure.com/test-org");
    expect(ctx.tenantId).toBe(tenantId);
  });

  it("uses tenant config overrides", async () => {
    const configRepo = createConfigRepo(db);
    await configRepo.upsert(tenantId, { reviewStrictness: "strict", maxFiles: 50 });

    const ctx = await buildTenantContext(tenantId, db, mockAppConfig(), tokenManager);
    expect(ctx.config.reviewStrictness).toBe("strict");
    expect(ctx.config.maxFiles).toBe(50);
  });

  it("uses defaults when no tenant config exists", async () => {
    const ctx = await buildTenantContext(tenantId, db, mockAppConfig(), tokenManager);
    expect(ctx.config.reviewStrictness).toBe("balanced");
    expect(ctx.config.maxFiles).toBe(20);
  });

  it("throws if tenant not found", async () => {
    await expect(
      buildTenantContext("00000000-0000-0000-0000-000000000000", db, mockAppConfig(), tokenManager)
    ).rejects.toThrow("Tenant not found");
  });

  it("throws if tenant is inactive", async () => {
    const tenantRepo = createTenantRepo(db);
    await tenantRepo.updateStatus(tenantId, "inactive");
    await expect(
      buildTenantContext(tenantId, db, mockAppConfig(), tokenManager)
    ).rejects.toThrow("Tenant unavailable");
  });

  it("throws if tenant needs_reauth", async () => {
    const tenantRepo = createTenantRepo(db);
    await tenantRepo.updateStatus(tenantId, "needs_reauth");
    await expect(
      buildTenantContext(tenantId, db, mockAppConfig(), tokenManager)
    ).rejects.toThrow("Tenant needs re-authentication");
  });

  it("self-hosted mode uses PAT auth", async () => {
    const ctx = await buildTenantContext(tenantId, db, mockAppConfig({ ADO_PAT: "my-pat" }), tokenManager);
    expect(ctx.adoClient).toBeDefined();
  });

  it("creates LLM clients", async () => {
    const ctx = await buildTenantContext(tenantId, db, mockAppConfig(), tokenManager);
    expect(ctx.llmClients.llm1).toBeDefined();
    expect(ctx.llmClients.llm2).toBeDefined();
  });

  it("logger is tagged with tenantId", async () => {
    const ctx = await buildTenantContext(tenantId, db, mockAppConfig(), tokenManager);
    expect(ctx.logger).toBeDefined();
  });
});
