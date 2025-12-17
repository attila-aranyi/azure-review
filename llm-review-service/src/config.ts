import { z } from "zod";
import type { LLMProviderName } from "./llm/types";

const optionalNonEmpty = () =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    z.string().min(1).optional()
  );

const providerEnum = z.enum(["mock", "openai", "azure_openai", "anthropic", "custom"]);

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    WEBHOOK_SECRET: z.string().min(1),

    ADO_ORG: z.string().min(1),
    ADO_PROJECT: z.string().min(1),
    ADO_PAT: z.string().min(1),

    LLM1_PROVIDER: providerEnum,
    LLM2_PROVIDER: providerEnum,

    OPENAI_API_KEY: optionalNonEmpty(),
    OPENAI_MODEL_LLM1: optionalNonEmpty(),
    OPENAI_MODEL_LLM2: optionalNonEmpty(),

    AZURE_OPENAI_ENDPOINT: optionalNonEmpty(),
    AZURE_OPENAI_API_KEY: optionalNonEmpty(),
    AZURE_OPENAI_DEPLOYMENT_LLM1: optionalNonEmpty(),
    AZURE_OPENAI_DEPLOYMENT_LLM2: optionalNonEmpty(),

    ANTHROPIC_API_KEY: optionalNonEmpty(),
    ANTHROPIC_MODEL_LLM1: optionalNonEmpty(),
    ANTHROPIC_MODEL_LLM2: optionalNonEmpty(),

    MAX_FILES: z.coerce.number().int().positive().default(20),
    MAX_TOTAL_DIFF_LINES: z.coerce.number().int().positive().default(2000),
    MAX_HUNKS: z.coerce.number().int().positive().default(80),
    HUNK_CONTEXT_LINES: z.coerce.number().int().nonnegative().default(20),
    TOKEN_BUDGET_LLM1: z.coerce.number().int().positive().default(3000),
    TOKEN_BUDGET_LLM2: z.coerce.number().int().positive().default(6000),

    REDIS_URL: optionalNonEmpty()
  })
  .passthrough();

export type Config = z.infer<typeof envSchema> & {
  LLM1_PROVIDER: LLMProviderName;
  LLM2_PROVIDER: LLMProviderName;
};

function requireProviderConfig(parsed: Config) {
  const requireFor = (key: keyof Config, when: boolean) => {
    if (!when) return;
    const value = parsed[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Missing required env var ${key}`);
    }
  };

  const needsOpenAI = parsed.LLM1_PROVIDER === "openai" || parsed.LLM2_PROVIDER === "openai";
  const needsAzureOpenAI =
    parsed.LLM1_PROVIDER === "azure_openai" || parsed.LLM2_PROVIDER === "azure_openai";
  const needsAnthropic =
    parsed.LLM1_PROVIDER === "anthropic" || parsed.LLM2_PROVIDER === "anthropic";

  requireFor("OPENAI_API_KEY", needsOpenAI);
  requireFor("OPENAI_MODEL_LLM1", parsed.LLM1_PROVIDER === "openai");
  requireFor("OPENAI_MODEL_LLM2", parsed.LLM2_PROVIDER === "openai");

  requireFor("AZURE_OPENAI_ENDPOINT", needsAzureOpenAI);
  requireFor("AZURE_OPENAI_API_KEY", needsAzureOpenAI);
  requireFor("AZURE_OPENAI_DEPLOYMENT_LLM1", parsed.LLM1_PROVIDER === "azure_openai");
  requireFor("AZURE_OPENAI_DEPLOYMENT_LLM2", parsed.LLM2_PROVIDER === "azure_openai");

  requireFor("ANTHROPIC_API_KEY", needsAnthropic);
  requireFor("ANTHROPIC_MODEL_LLM1", parsed.LLM1_PROVIDER === "anthropic");
  requireFor("ANTHROPIC_MODEL_LLM2", parsed.LLM2_PROVIDER === "anthropic");
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.parse(env) as Config;
  requireProviderConfig(parsed);
  return parsed;
}
