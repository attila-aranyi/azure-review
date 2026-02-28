import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLlmConfigRoutes } from "../../../src/routes/api/llmConfig";
import { generateKey } from "../../../src/auth/encryption";

const mockFindByTenantId = vi.fn();
const mockUpsert = vi.fn();

vi.mock("../../../src/db/repos/configRepo", () => ({
  createConfigRepo: () => ({
    findByTenantId: mockFindByTenantId,
    upsert: mockUpsert,
  }),
}));

function buildApp(tenantId?: string) {
  const app = Fastify();
  app.decorateRequest("tenantId", "");
  app.addHook("onRequest", async (request) => {
    (request as { tenantId?: string }).tenantId = tenantId;
  });
  return app;
}

describe("llmConfig API routes", () => {
  const encryptionKey = generateKey();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PUT /config/llm-key", () => {
    it("stores encrypted API key and sets BYOK mode", async () => {
      mockUpsert.mockResolvedValue({});

      const app = buildApp("t1");
      await app.register(registerLlmConfigRoutes, { db: {} as never, encryptionKey });

      const res = await app.inject({
        method: "PUT",
        url: "/config/llm-key",
        payload: {
          llmProvider: "openai",
          llmApiKey: "sk-test-key-12345",
          llmModelReview: "gpt-4o-mini",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.llmMode).toBe("byok");
      expect(body.llmProvider).toBe("openai");
      expect(body.llmKeySet).toBe(true);
      // API key should NOT be in response
      expect(body.llmApiKey).toBeUndefined();

      // Verify upsert was called with encrypted key
      expect(mockUpsert).toHaveBeenCalledWith("t1", expect.objectContaining({
        llmMode: "byok",
        llmProvider: "openai",
        llmApiKeyEnc: expect.any(String), // encrypted, base64
      }));
    });

    it("returns 400 for invalid provider", async () => {
      const app = buildApp("t1");
      await app.register(registerLlmConfigRoutes, { db: {} as never, encryptionKey });

      const res = await app.inject({
        method: "PUT",
        url: "/config/llm-key",
        payload: { llmProvider: "invalid", llmApiKey: "key" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for missing API key", async () => {
      const app = buildApp("t1");
      await app.register(registerLlmConfigRoutes, { db: {} as never, encryptionKey });

      const res = await app.inject({
        method: "PUT",
        url: "/config/llm-key",
        payload: { llmProvider: "openai" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 500 when encryption key not configured", async () => {
      const app = buildApp("t1");
      await app.register(registerLlmConfigRoutes, { db: {} as never });

      const res = await app.inject({
        method: "PUT",
        url: "/config/llm-key",
        payload: { llmProvider: "openai", llmApiKey: "key" },
      });
      expect(res.statusCode).toBe(500);
    });

    it("returns 401 without tenant", async () => {
      const app = buildApp(undefined);
      await app.register(registerLlmConfigRoutes, { db: {} as never, encryptionKey });

      const res = await app.inject({
        method: "PUT",
        url: "/config/llm-key",
        payload: { llmProvider: "openai", llmApiKey: "key" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("DELETE /config/llm-key", () => {
    it("reverts to managed mode", async () => {
      mockUpsert.mockResolvedValue({});

      const app = buildApp("t1");
      await app.register(registerLlmConfigRoutes, { db: {} as never, encryptionKey });

      const res = await app.inject({ method: "DELETE", url: "/config/llm-key" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.llmMode).toBe("managed");

      expect(mockUpsert).toHaveBeenCalledWith("t1", expect.objectContaining({
        llmMode: "managed",
        llmApiKeyEnc: null,
      }));
    });
  });

  describe("GET /config/llm-status", () => {
    it("returns managed status when no config", async () => {
      mockFindByTenantId.mockResolvedValue(null);

      const app = buildApp("t1");
      await app.register(registerLlmConfigRoutes, { db: {} as never, encryptionKey });

      const res = await app.inject({ method: "GET", url: "/config/llm-status" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.llmMode).toBe("managed");
      expect(body.llmKeySet).toBe(false);
    });

    it("returns BYOK status with key indicator", async () => {
      mockFindByTenantId.mockResolvedValue({
        llmMode: "byok",
        llmProvider: "anthropic",
        llmApiKeyEnc: "some-encrypted-value",
        llmEndpoint: null,
        llmModelReview: "claude-sonnet-4-20250514",
        llmModelA11y: "claude-sonnet-4-20250514",
      });

      const app = buildApp("t1");
      await app.register(registerLlmConfigRoutes, { db: {} as never, encryptionKey });

      const res = await app.inject({ method: "GET", url: "/config/llm-status" });
      const body = JSON.parse(res.body);
      expect(body.llmMode).toBe("byok");
      expect(body.llmProvider).toBe("anthropic");
      expect(body.llmKeySet).toBe(true);
      // Should never expose the encrypted key
      expect(body.llmApiKeyEnc).toBeUndefined();
    });
  });
});
