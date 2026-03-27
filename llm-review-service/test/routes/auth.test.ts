import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerAuthRoutes } from "../../src/routes/auth";
import { TokenManager } from "../../src/auth/tokenManager";
import { generateKey } from "../../src/auth/encryption";
import type { DrizzleInstance } from "../../src/db/connection";
import { createTenantRepo } from "../../src/db/repos/tenantRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../db/testDbHelper";
import type { AppConfig } from "../../src/config/appConfig";

function mockAppConfig(): AppConfig {
  return {
    PORT: 3000,
    LOG_LEVEL: "info",
    CORS_ORIGINS: [],
    RATE_LIMIT_MAX: 30,
    RATE_LIMIT_WINDOW_MS: 60000,
    DATABASE_URL: "postgresql://localhost:5432/test",
    DEPLOYMENT_MODE: "saas",
    OAUTH_CLIENT_ID: "test-client-id",
    OAUTH_CLIENT_SECRET: "test-client-secret",
    OAUTH_REDIRECT_URI: "https://example.com/callback",
    TOKEN_ENCRYPTION_KEY: "a".repeat(32),
    AXON_ENABLED: false,
    AUDIT_ENABLED: true,
    AUDIT_RETENTION_DAYS: 30,
  } as AppConfig;
}

describe.skipIf(!isDbAvailable())("Auth routes (integration)", () => {
  let db: DrizzleInstance;
  let encKey: Buffer;
  let tokenManager: TokenManager;

  beforeAll(async () => {
    db = await setupTestDb();
    encKey = generateKey();
    tokenManager = new TokenManager(db, encKey);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  async function buildTestApp() {
    const app = Fastify({ logger: false });
    await app.register(registerAuthRoutes, {
      appConfig: mockAppConfig(),
      db,
      tokenManager,
    });
    return app;
  }

  it("/authorize redirects to correct ADO URL", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/ado/authorize",
    });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("app.vssps.visualstudio.com/oauth2/authorize");
    expect(location).toContain("client_id=test-client-id");
    expect(location).toContain("state=");
    expect(location).toContain("scope=");
    expect(location).toContain("redirect_uri=");
  });

  it("/callback with invalid state returns 400", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/ado/callback?code=test-code&state=invalid-state",
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("Invalid or expired state");
  });

  it("/callback with missing code returns 400", async () => {
    const app = await buildTestApp();

    // First get the state from authorize
    const authRes = await app.inject({
      method: "GET",
      url: "/auth/ado/authorize",
    });
    const location = authRes.headers.location as string;
    const url = new URL(location);
    const state = url.searchParams.get("state");

    const res = await app.inject({
      method: "GET",
      url: `/auth/ado/callback?state=${state}`,
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("Missing authorization code");
  });

  it("/callback with error param returns 400", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/ado/callback?error=access_denied",
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("access_denied");
  });

  it("/connection DELETE revokes tokens and disables tenant", async () => {
    // Use self-hosted mode so the DELETE auth can use a simple API key
    const selfHostedConfig: AppConfig = {
      ...mockAppConfig(),
      DEPLOYMENT_MODE: "self-hosted",
      ADO_PAT: "test-api-key",
    };
    const app = Fastify({ logger: false });
    await app.register(registerAuthRoutes, {
      appConfig: selfHostedConfig,
      db,
      tokenManager,
    });

    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: "revoke-test-org" });
    await tokenManager.storeTokens(tenant.id, {
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/auth/ado/connection/${tenant.id}`,
      headers: { Authorization: "Bearer test-api-key" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);

    const updated = await tenantRepo.findById(tenant.id);
    expect(updated!.status).toBe("disconnected");
  });
});
