export type LLMProviderName = "mock" | "openai" | "azure_openai" | "anthropic";

export type ReviewStrictness = "relaxed" | "balanced" | "strict";

export type LLMStage = "llm1" | "llm2" | "llm3" | "llm4";

import type { ZodType, ZodTypeDef } from "zod";
import type { Config } from "../config";
import { AnthropicProvider } from "./providers/anthropicProvider";
import { AzureOpenAIProvider } from "./providers/azureOpenAIProvider";
import { MockLLMProvider } from "./providers/mockProvider";
import { OpenAIResponsesProvider } from "./providers/openaiResponsesProvider";

export type Finding = {
  issueType:
    | "bug"
    | "security"
    | "performance"
    | "style"
    | "correctness"
    | "maintainability"
    | "testing"
    | "docs"
    | "accessibility";
  severity: "low" | "medium" | "high" | "critical";
  filePath: string;
  startLine: number;
  endLine: number;
  message: string;
  suggestion?: string;
};

export type ImageInput = {
  base64Data: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
};

export type LLMCompleteJSONArgs<T> = {
  stage: LLMStage;
  system: string;
  prompt: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  timeoutMs: number;
};

export type LLMCompleteVisionJSONArgs<T> = {
  stage: LLMStage;
  system: string;
  prompt: string;
  images: ImageInput[];
  schema: ZodType<T, ZodTypeDef, unknown>;
  timeoutMs: number;
  maxTokens?: number;
};

export interface LLMClient {
  readonly providerName: string;
  readonly modelName: string;
  readonly supportsVision: boolean;
  completeJSON<T>(args: LLMCompleteJSONArgs<T>): Promise<T>;
  completeVisionJSON<T>(args: LLMCompleteVisionJSONArgs<T>): Promise<T>;
}

function getProviderForStage(config: Config, stage: LLMStage): LLMProviderName {
  switch (stage) {
    case "llm1": return config.LLM1_PROVIDER;
    case "llm2": return config.LLM2_PROVIDER;
    case "llm3": return config.LLM3_PROVIDER!;
    case "llm4": return config.LLM4_PROVIDER!;
  }
}

function getModelForStage(
  config: Config,
  stage: LLMStage,
  keys: { llm1: keyof Config; llm2: keyof Config; llm3: keyof Config; llm4: keyof Config }
): string | undefined {
  switch (stage) {
    case "llm1": return config[keys.llm1] as string | undefined;
    case "llm2": return config[keys.llm2] as string | undefined;
    case "llm3": return config[keys.llm3] as string | undefined;
    case "llm4": return config[keys.llm4] as string | undefined;
  }
}

export function createLLMClient(config: Config, stage: LLMStage): LLMClient {
  const provider = getProviderForStage(config, stage);

  switch (provider) {
    case "mock":
      return new MockLLMProvider();
    case "openai": {
      const apiKey = config.OPENAI_API_KEY;
      const model = getModelForStage(config, stage, {
        llm1: "OPENAI_MODEL_LLM1", llm2: "OPENAI_MODEL_LLM2", llm3: "OPENAI_MODEL_LLM3", llm4: "OPENAI_MODEL_LLM4"
      });
      if (!apiKey || !model) throw new Error(`Missing OpenAI config for ${stage}`);
      return new OpenAIResponsesProvider({ apiKey, model });
    }
    case "azure_openai": {
      if (stage === "llm4") throw new Error("Azure OpenAI does not support vision. Use anthropic or openai for LLM4.");
      const endpoint = config.AZURE_OPENAI_ENDPOINT;
      const apiKey = config.AZURE_OPENAI_API_KEY;
      const deployment = getModelForStage(config, stage, {
        llm1: "AZURE_OPENAI_DEPLOYMENT_LLM1", llm2: "AZURE_OPENAI_DEPLOYMENT_LLM2", llm3: "AZURE_OPENAI_DEPLOYMENT_LLM3", llm4: "AZURE_OPENAI_DEPLOYMENT_LLM3"
      });
      if (!endpoint || !apiKey || !deployment) throw new Error(`Missing Azure OpenAI config for ${stage}`);
      return new AzureOpenAIProvider({ endpoint, apiKey, deployment });
    }
    case "anthropic": {
      const apiKey = config.ANTHROPIC_API_KEY;
      const model = getModelForStage(config, stage, {
        llm1: "ANTHROPIC_MODEL_LLM1", llm2: "ANTHROPIC_MODEL_LLM2", llm3: "ANTHROPIC_MODEL_LLM3", llm4: "ANTHROPIC_MODEL_LLM4"
      });
      if (!apiKey || !model) throw new Error(`Missing Anthropic config for ${stage}`);
      return new AnthropicProvider({ apiKey, model });
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported LLM provider: ${_exhaustive}`);
    }
  }
}
