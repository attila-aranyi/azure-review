import type { Logger } from "pino";
import type { LLMClient, LLMStage, LLMProviderName } from "./types";
import { createLLMClient } from "./types";
import type { Config } from "../config";
import type { AppConfig } from "../config/appConfig";
import type { DrizzleInstance } from "../db/connection";
import { decrypt } from "../auth/encryption";
import { createConfigRepo } from "../db/repos/configRepo";

export interface LlmRouterConfig {
  tenantId: string;
  llmMode: "managed" | "byok";
  llmProvider?: string | null;
  llmApiKeyEnc?: string | null;
  llmEndpoint?: string | null;
  llmModelReview?: string;
  llmModelA11y?: string;
}

export interface LlmRouter {
  getClient(stage: LLMStage): LLMClient;
}

/**
 * Creates an LLM router that selects the correct provider based on tenant config.
 * In "managed" mode, uses app-level API keys. In "byok" mode, uses the tenant's
 * encrypted API key.
 */
export function createLlmRouter(
  appConfig: AppConfig,
  routerConfig: LlmRouterConfig,
  encryptionKey: Buffer | undefined,
  logger: Logger,
): LlmRouter {
  const clients = new Map<LLMStage, LLMClient>();

  function buildManagedClient(stage: LLMStage): LLMClient {
    const provider: LLMProviderName = appConfig.ANTHROPIC_API_KEY ? "anthropic" : appConfig.OPENAI_API_KEY ? "openai" : "mock";
    const defaultModel = provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o";
    // Build a Config-compatible object from AppConfig for the existing createLLMClient
    const config: Record<string, unknown> = {
      ...appConfig,
      LLM1_PROVIDER: provider,
      LLM2_PROVIDER: provider,
      LLM3_ENABLED: false,
      LLM4_ENABLED: false,
      // Set default models for the detected provider
      ...(provider === "anthropic" && {
        ANTHROPIC_MODEL_LLM1: defaultModel,
        ANTHROPIC_MODEL_LLM2: defaultModel,
        ANTHROPIC_MODEL_LLM3: defaultModel,
        ANTHROPIC_MODEL_LLM4: defaultModel,
      }),
      ...(provider === "openai" && {
        OPENAI_MODEL_LLM1: defaultModel,
        OPENAI_MODEL_LLM2: defaultModel,
        OPENAI_MODEL_LLM3: defaultModel,
        OPENAI_MODEL_LLM4: defaultModel,
      }),
    };
    return createLLMClient(config as Config, stage);
  }

  function buildByokClient(stage: LLMStage): LLMClient {
    if (!routerConfig.llmProvider || !routerConfig.llmApiKeyEnc) {
      logger.warn({ stage, tenantId: routerConfig.tenantId }, "BYOK config incomplete, falling back to managed");
      return buildManagedClient(stage);
    }

    if (!encryptionKey) {
      logger.error({ tenantId: routerConfig.tenantId }, "Encryption key not available for BYOK decryption");
      throw new Error("Encryption key required for BYOK mode");
    }

    const apiKey = decrypt(Buffer.from(routerConfig.llmApiKeyEnc, "base64"), encryptionKey);
    const provider = routerConfig.llmProvider as LLMProviderName;

    // Determine model based on stage
    const model = (stage === "llm3" || stage === "llm4")
      ? routerConfig.llmModelA11y ?? "gpt-4o"
      : routerConfig.llmModelReview ?? "gpt-4o";

    const config: Record<string, unknown> = {
      // Provider for all stages
      LLM1_PROVIDER: provider,
      LLM2_PROVIDER: provider,
      LLM3_PROVIDER: provider,
      LLM4_PROVIDER: provider,
      LLM3_ENABLED: true,
      LLM4_ENABLED: true,
      // API keys based on provider
      ...(provider === "openai" && {
        OPENAI_API_KEY: apiKey,
        OPENAI_MODEL_LLM1: model,
        OPENAI_MODEL_LLM2: model,
        OPENAI_MODEL_LLM3: model,
        OPENAI_MODEL_LLM4: model,
      }),
      ...(provider === "anthropic" && {
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_MODEL_LLM1: model,
        ANTHROPIC_MODEL_LLM2: model,
        ANTHROPIC_MODEL_LLM3: model,
        ANTHROPIC_MODEL_LLM4: model,
      }),
      ...(provider === "azure_openai" && {
        AZURE_OPENAI_API_KEY: apiKey,
        AZURE_OPENAI_ENDPOINT: routerConfig.llmEndpoint,
        AZURE_OPENAI_DEPLOYMENT_LLM1: model,
        AZURE_OPENAI_DEPLOYMENT_LLM2: model,
        AZURE_OPENAI_DEPLOYMENT_LLM3: model,
        AZURE_OPENAI_DEPLOYMENT_LLM4: model,
      }),
    };

    return createLLMClient(config as Config, stage);
  }

  return {
    getClient(stage: LLMStage): LLMClient {
      let client = clients.get(stage);
      if (client) return client;

      client = routerConfig.llmMode === "byok"
        ? buildByokClient(stage)
        : buildManagedClient(stage);

      clients.set(stage, client);
      return client;
    },
  };
}

/**
 * Load LLM router config from the tenant's DB config.
 */
export async function loadLlmRouterConfig(
  db: DrizzleInstance,
  tenantId: string,
): Promise<LlmRouterConfig> {
  const configRepo = createConfigRepo(db);
  const tenantConfig = await configRepo.findByTenantId(tenantId);

  return {
    tenantId,
    llmMode: (tenantConfig?.llmMode as "managed" | "byok") ?? "managed",
    llmProvider: tenantConfig?.llmProvider,
    llmApiKeyEnc: tenantConfig?.llmApiKeyEnc,
    llmEndpoint: tenantConfig?.llmEndpoint,
    llmModelReview: tenantConfig?.llmModelReview ?? "gpt-4o",
    llmModelA11y: tenantConfig?.llmModelA11y ?? "gpt-4o",
  };
}
