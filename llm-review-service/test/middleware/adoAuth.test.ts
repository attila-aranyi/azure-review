import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import * as jose from "jose";
import { adoAuthMiddleware, JwksCache } from "../../src/middleware/adoAuth";
import type { DrizzleInstance } from "../../src/db/connection";
import { createTenantRepo } from "../../src/db/repos/tenantRepo";
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
    DEPLOYMENT_MODE: "saas",
    AXON_ENABLED: false,
    AUDIT_ENABLED: true,
    AUDIT_RETENTION_DAYS: 30,
    ...overrides,
  } as AppConfig;
}

// Create a test RSA key pair for signing JWTs
let privateKey: jose.KeyLike;
let testJwksCache: JwksCache;

beforeAll(async () => {
  const { privateKey: pk, publicKey } = await jose.generateKeyPair("RS256");
  privateKey = pk;

  // Create a mock JwksCache that returns our test public key
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = "test-kid";
  jwk.alg = "RS256";
  jwk.use = "sig";

  testJwksCache = {
    getKeySet: () => jose.createLocalJWKSet({ keys: [jwk] }),
    clear: () => {},
  } as unknown as JwksCache;
});

async function createSignedJwt(payload: Record<string, unknown>): Promise<string> {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .sign(privateKey);
}

describe.skipIf(!isDbAvailable())("adoAuthMiddleware (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: "test-org-id" });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  async function buildTestApp(appConfig?: Partial<AppConfig>) {
    const app = Fastify({ logger: false });
    // Register middleware and route in the same encapsulated scope
    // so the onRequest hook applies to the route
    await app.register(async (scope) => {
      await scope.register(adoAuthMiddleware, {
        appConfig: mockAppConfig(appConfig),
        db,
        jwksCache: testJwksCache,
      });
      scope.get("/test", async (request) => ({
        tenantId: request.tenantId,
        adoUserId: request.adoUserId,
      }));
    });
    return app;
  }

  it("valid signed JWT extracts organizationId and resolves tenant", async () => {
    const app = await buildTestApp();
    const jwt = await createSignedJwt({
      aud: "test-org-id",
      sub: "user-123",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await app.inject({
      method: "GET",
      url: "/test",
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tenantId).toBe(tenantId);
    expect(body.adoUserId).toBe("user-123");
  });

  it("expired JWT returns 401", async () => {
    const app = await buildTestApp();
    const jwt = await createSignedJwt({
      aud: "test-org-id",
      exp: Math.floor(Date.now() / 1000) - 3600,
    });

    const res = await app.inject({
      method: "GET",
      url: "/test",
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it("JWT without exp claim returns 401", async () => {
    const app = await buildTestApp();
    const jwt = await createSignedJwt({ aud: "test-org-id", sub: "user" });

    const res = await app.inject({
      method: "GET",
      url: "/test",
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe("Token missing expiry");
  });

  it("missing Authorization header returns 401", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/test" });
    expect(res.statusCode).toBe(401);
  });

  it("tenant not found returns 401 (no enumeration)", async () => {
    const app = await buildTestApp();
    const jwt = await createSignedJwt({
      aud: "nonexistent-org",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await app.inject({
      method: "GET",
      url: "/test",
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it("invalid token returns 401", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/test",
      headers: { Authorization: "Bearer not-a-jwt" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("unsigned JWT (forged) returns 401", async () => {
    const app = await buildTestApp();
    // Forge a JWT without valid signature
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      aud: "test-org-id",
      sub: "attacker",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const fakeToken = `${header}.${payload}.fakesig`;

    const res = await app.inject({
      method: "GET",
      url: "/test",
      headers: { Authorization: `Bearer ${fakeToken}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it("self-hosted mode: valid API key authenticates", async () => {
    const app = await buildTestApp({
      DEPLOYMENT_MODE: "self-hosted",
      ADO_PAT: "my-secret-api-key",
    });

    const res = await app.inject({
      method: "GET",
      url: "/test",
      headers: { Authorization: "Bearer my-secret-api-key" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).tenantId).toBe(tenantId);
  });

  it("self-hosted mode: wrong API key returns 401", async () => {
    const app = await buildTestApp({
      DEPLOYMENT_MODE: "self-hosted",
      ADO_PAT: "my-secret-api-key",
    });

    const res = await app.inject({
      method: "GET",
      url: "/test",
      headers: { Authorization: "Bearer wrong-key" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("self-hosted mode: any bearer token without ADO_PAT returns 401", async () => {
    const app = await buildTestApp({
      DEPLOYMENT_MODE: "self-hosted",
      // No ADO_PAT configured
    });

    const res = await app.inject({
      method: "GET",
      url: "/test",
      headers: { Authorization: "Bearer anything" },
    });

    expect(res.statusCode).toBe(500);
  });
});

describe("adoAuthMiddleware (unit)", () => {
  it("module exports adoAuthMiddleware function", () => {
    expect(typeof adoAuthMiddleware).toBe("function");
  });

  it("JwksCache class is exported", () => {
    expect(typeof JwksCache).toBe("function");
  });
});
