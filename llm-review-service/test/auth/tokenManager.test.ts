import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { TokenManager } from "../../src/auth/tokenManager";
import { generateKey, encrypt } from "../../src/auth/encryption";
import type { DrizzleInstance } from "../../src/db/connection";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../db/testDbHelper";
import { createTenantRepo } from "../../src/db/repos/tenantRepo";

// Mock undici for HTTP calls
vi.mock("undici", () => ({
  request: vi.fn(),
}));

import { request as mockRequest } from "undici";

describe.skipIf(!isDbAvailable())("TokenManager (integration)", () => {
  let db: DrizzleInstance;
  let encKey: Buffer;
  let tenantId: string;
  let tokenManager: TokenManager;

  beforeAll(async () => {
    db = await setupTestDb();
    encKey = generateKey();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: `org-${Date.now()}` });
    tenantId = tenant.id;
    tokenManager = new TokenManager(db, encKey, "https://mock-token-endpoint/oauth2/token", "client-id", "client-secret", "https://redirect");
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("storeTokens encrypts and persists", async () => {
    await tokenManager.storeTokens(tenantId, {
      access_token: "access-123",
      refresh_token: "refresh-456",
      expires_in: 3600,
    });

    const token = await tokenManager.getAccessToken(tenantId);
    expect(token).toBe("access-123");
  });

  it("getAccessToken returns decrypted token when valid", async () => {
    await tokenManager.storeTokens(tenantId, {
      access_token: "my-access-token",
      refresh_token: "my-refresh-token",
      expires_in: 3600,
    });

    const token = await tokenManager.getAccessToken(tenantId);
    expect(token).toBe("my-access-token");
  });

  it("getAccessToken throws for nonexistent tenant", async () => {
    await expect(
      tokenManager.getAccessToken("00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow("No tokens found");
  });

  it("storeTokens updates on subsequent calls", async () => {
    await tokenManager.storeTokens(tenantId, {
      access_token: "first",
      refresh_token: "refresh",
      expires_in: 3600,
    });
    await tokenManager.storeTokens(tenantId, {
      access_token: "second",
      refresh_token: "refresh2",
      expires_in: 3600,
    });

    const token = await tokenManager.getAccessToken(tenantId);
    expect(token).toBe("second");
  });

  it("revoke deletes tokens and marks tenant disconnected", async () => {
    await tokenManager.storeTokens(tenantId, {
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
    });

    await tokenManager.revoke(tenantId);

    await expect(tokenManager.getAccessToken(tenantId)).rejects.toThrow("No tokens found");

    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.findById(tenantId);
    expect(tenant!.status).toBe("disconnected");
  });
});

describe("TokenManager (unit - no DB)", () => {
  it("can be instantiated with required params", () => {
    const encKey = generateKey();
    // Just test the constructor doesn't throw
    const tm = new TokenManager(null as unknown as DrizzleInstance, encKey);
    expect(tm).toBeInstanceOf(TokenManager);
  });
});
