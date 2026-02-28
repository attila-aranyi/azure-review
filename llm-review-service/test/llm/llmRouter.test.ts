import { describe, it, expect, vi } from "vitest";
import { createLlmRouter } from "../../src/llm/llmRouter";
import { encrypt, generateKey } from "../../src/auth/encryption";
import type { AppConfig } from "../../src/config/appConfig";
import pino from "pino";

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

const logger = pino({ level: "silent" });

describe("LlmRouter", () => {
  it("returns mock client in managed mode when no API keys configured", () => {
    const router = createLlmRouter(
      mockAppConfig(),
      { tenantId: "t1", llmMode: "managed" },
      undefined,
      logger,
    );
    const client = router.getClient("llm1");
    expect(client).toBeDefined();
    expect(client.providerName).toBe("mock");
  });

  it("returns anthropic client in managed mode when ANTHROPIC_API_KEY set", () => {
    const router = createLlmRouter(
      mockAppConfig({ ANTHROPIC_API_KEY: "sk-ant-test-key" }),
      { tenantId: "t1", llmMode: "managed" },
      undefined,
      logger,
    );
    const client = router.getClient("llm1");
    expect(client).toBeDefined();
    expect(client.providerName).toBe("anthropic");
  });

  it("returns openai client in managed mode when OPENAI_API_KEY set", () => {
    const router = createLlmRouter(
      mockAppConfig({ OPENAI_API_KEY: "sk-test-key" }),
      { tenantId: "t1", llmMode: "managed" },
      undefined,
      logger,
    );
    const client = router.getClient("llm1");
    expect(client).toBeDefined();
    expect(client.providerName).toBe("openai");
  });

  it("caches clients per stage", () => {
    const router = createLlmRouter(
      mockAppConfig(),
      { tenantId: "t1", llmMode: "managed" },
      undefined,
      logger,
    );
    const client1 = router.getClient("llm1");
    const client2 = router.getClient("llm1");
    expect(client1).toBe(client2);
  });

  it("different stages get different client instances", () => {
    const router = createLlmRouter(
      mockAppConfig(),
      { tenantId: "t1", llmMode: "managed" },
      undefined,
      logger,
    );
    const llm1 = router.getClient("llm1");
    const llm2 = router.getClient("llm2");
    expect(llm1).not.toBe(llm2);
  });

  describe("BYOK mode", () => {
    it("falls back to managed when BYOK config is incomplete", () => {
      const router = createLlmRouter(
        mockAppConfig(),
        { tenantId: "t1", llmMode: "byok" }, // no llmProvider or llmApiKeyEnc
        undefined,
        logger,
      );
      const client = router.getClient("llm1");
      expect(client.providerName).toBe("mock"); // falls back to managed → mock
    });

    it("throws when encryption key is missing for BYOK", () => {
      expect(() => createLlmRouter(
        mockAppConfig(),
        {
          tenantId: "t1",
          llmMode: "byok",
          llmProvider: "openai",
          llmApiKeyEnc: "encrypted-key",
        },
        undefined, // no encryption key
        logger,
      ).getClient("llm1")).toThrow("Encryption key required for BYOK mode");
    });

    it("decrypts API key and creates BYOK client", () => {
      const key = generateKey();
      const apiKeyPlaintext = "sk-byok-test-key";
      const encryptedKey = encrypt(apiKeyPlaintext, key).toString("base64");

      const router = createLlmRouter(
        mockAppConfig(),
        {
          tenantId: "t1",
          llmMode: "byok",
          llmProvider: "openai",
          llmApiKeyEnc: encryptedKey,
          llmModelReview: "gpt-4o-mini",
        },
        key,
        logger,
      );
      const client = router.getClient("llm1");
      expect(client).toBeDefined();
      expect(client.providerName).toBe("openai");
    });
  });
});
