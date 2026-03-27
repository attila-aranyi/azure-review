import { describe, it, expect } from "vitest";
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

  describe("managed mode provider priority", () => {
    it("prefers anthropic when both API keys set", () => {
      const router = createLlmRouter(
        mockAppConfig({ ANTHROPIC_API_KEY: "sk-ant-key", OPENAI_API_KEY: "sk-oai-key" }),
        { tenantId: "t1", llmMode: "managed" },
        undefined,
        logger,
      );
      const client = router.getClient("llm1");
      expect(client.providerName).toBe("anthropic");
    });
  });

  describe("BYOK azure_openai", () => {
    it("creates azure_openai BYOK client with endpoint", () => {
      const key = generateKey();
      const encryptedKey = encrypt("az-api-key", key).toString("base64");

      const router = createLlmRouter(
        mockAppConfig(),
        {
          tenantId: "t1",
          llmMode: "byok",
          llmProvider: "azure_openai",
          llmApiKeyEnc: encryptedKey,
          llmEndpoint: "https://myorg.openai.azure.com",
          llmModelReview: "gpt-4o",
          llmModelA11y: "gpt-4-turbo",
        },
        key,
        logger,
      );

      // llm1 should not throw (azure_openai is valid for llm1)
      const client = router.getClient("llm1");
      expect(client).toBeDefined();
      expect(client.providerName).toBe("azure_openai");
    });

    it("passes llmEndpoint to azure_openai config", () => {
      const key = generateKey();
      const encryptedKey = encrypt("az-api-key", key).toString("base64");
      const endpoint = "https://custom.openai.azure.com";

      // The endpoint is validated inside createLLMClient → AzureOpenAIProvider
      // If it wasn't passed, it would throw "Missing Azure OpenAI config"
      const router = createLlmRouter(
        mockAppConfig(),
        {
          tenantId: "t1",
          llmMode: "byok",
          llmProvider: "azure_openai",
          llmApiKeyEnc: encryptedKey,
          llmEndpoint: endpoint,
          llmModelReview: "gpt-4o",
        },
        key,
        logger,
      );

      expect(() => router.getClient("llm1")).not.toThrow();
    });
  });

  describe("BYOK model selection per stage", () => {
    function createByokRouter(models: { review?: string; a11y?: string }) {
      const key = generateKey();
      const encryptedKey = encrypt("sk-test", key).toString("base64");
      return createLlmRouter(
        mockAppConfig(),
        {
          tenantId: "t1",
          llmMode: "byok",
          llmProvider: "openai",
          llmApiKeyEnc: encryptedKey,
          llmModelReview: models.review,
          llmModelA11y: models.a11y,
        },
        key,
        logger,
      );
    }

    it("uses llmModelReview for llm1 stage", () => {
      const router = createByokRouter({ review: "gpt-4o-mini", a11y: "gpt-4-turbo" });
      const client = router.getClient("llm1");
      expect(client.modelName).toBe("gpt-4o-mini");
    });

    it("uses llmModelReview for llm2 stage", () => {
      const router = createByokRouter({ review: "gpt-4o-mini", a11y: "gpt-4-turbo" });
      const client = router.getClient("llm2");
      expect(client.modelName).toBe("gpt-4o-mini");
    });

    it("uses llmModelA11y for llm3 stage", () => {
      const router = createByokRouter({ review: "gpt-4o-mini", a11y: "gpt-4-turbo" });
      const client = router.getClient("llm3");
      expect(client.modelName).toBe("gpt-4-turbo");
    });

    it("uses llmModelA11y for llm4 stage", () => {
      const router = createByokRouter({ review: "gpt-4o-mini", a11y: "gpt-4-turbo" });
      const client = router.getClient("llm4");
      expect(client.modelName).toBe("gpt-4-turbo");
    });

    it("defaults to gpt-4o when llmModelReview is null", () => {
      const router = createByokRouter({ review: undefined, a11y: "gpt-4-turbo" });
      const client = router.getClient("llm1");
      expect(client.modelName).toBe("gpt-4o");
    });

    it("defaults to gpt-4o when llmModelA11y is null", () => {
      const router = createByokRouter({ review: "gpt-4o-mini", a11y: undefined });
      const client = router.getClient("llm3");
      expect(client.modelName).toBe("gpt-4o");
    });
  });
});
