export type LLMProviderName = "mock" | "openai" | "azure_openai" | "anthropic" | "custom";

export type LLMStage = "llm1" | "llm2";

import type { ZodType } from "zod";
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
    | "docs";
  severity: "low" | "medium" | "high" | "critical";
  filePath: string;
  startLine: number;
  endLine: number;
  message: string;
  suggestion?: string;
};

export type LLMCompleteJSONArgs<T> = {
  stage: LLMStage;
  system: string;
  prompt: string;
  schema: ZodType<T, any, unknown>;
  timeoutMs: number;
};

export interface LLMClient {
  completeJSON<T>(args: LLMCompleteJSONArgs<T>): Promise<T>;
}

export function createLLMClient(config: Config, stage: LLMStage): LLMClient {
  const provider = stage === "llm1" ? config.LLM1_PROVIDER : config.LLM2_PROVIDER;

  switch (provider) {
    case "mock":
      return new MockLLMProvider();
    case "openai": {
      const apiKey = config.OPENAI_API_KEY;
      const model = stage === "llm1" ? config.OPENAI_MODEL_LLM1 : config.OPENAI_MODEL_LLM2;
      if (!apiKey || !model) throw new Error(`Missing OpenAI config for ${stage}`);
      return new OpenAIResponsesProvider({ apiKey, model });
    }
    case "azure_openai": {
      const endpoint = config.AZURE_OPENAI_ENDPOINT;
      const apiKey = config.AZURE_OPENAI_API_KEY;
      const deployment =
        stage === "llm1" ? config.AZURE_OPENAI_DEPLOYMENT_LLM1 : config.AZURE_OPENAI_DEPLOYMENT_LLM2;
      if (!endpoint || !apiKey || !deployment) throw new Error(`Missing Azure OpenAI config for ${stage}`);
      return new AzureOpenAIProvider({ endpoint, apiKey, deployment });
    }
    case "anthropic": {
      const apiKey = config.ANTHROPIC_API_KEY;
      const model = stage === "llm1" ? config.ANTHROPIC_MODEL_LLM1 : config.ANTHROPIC_MODEL_LLM2;
      if (!apiKey || !model) throw new Error(`Missing Anthropic config for ${stage}`);
      return new AnthropicProvider({ apiKey, model });
    }
    case "custom":
      throw new Error("Custom LLM provider not implemented");
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported LLM provider: ${_exhaustive}`);
    }
  }
}
