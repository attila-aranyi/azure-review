export type Config = {
  PORT: number;
  WEBHOOK_SECRET: string;
  ADO_ORG: string;
  ADO_PROJECT: string;
  ADO_PAT: string;
  LLM1_PROVIDER: string;
  LLM2_PROVIDER: string;
  MAX_FILES: number;
  MAX_TOTAL_DIFF_LINES: number;
  MAX_HUNKS: number;
  HUNK_CONTEXT_LINES: number;
  TOKEN_BUDGET_LLM1: number;
  TOKEN_BUDGET_LLM2: number;
  REDIS_URL?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const requireString = (key: keyof NodeJS.ProcessEnv) => {
    const value = env[key];
    if (!value) throw new Error(`Missing required env var ${key}`);
    return value;
  };

  return {
    PORT: env.PORT ? Number(env.PORT) : 3000,
    WEBHOOK_SECRET: requireString("WEBHOOK_SECRET"),
    ADO_ORG: requireString("ADO_ORG"),
    ADO_PROJECT: requireString("ADO_PROJECT"),
    ADO_PAT: requireString("ADO_PAT"),
    LLM1_PROVIDER: requireString("LLM1_PROVIDER"),
    LLM2_PROVIDER: requireString("LLM2_PROVIDER"),
    MAX_FILES: env.MAX_FILES ? Number(env.MAX_FILES) : 20,
    MAX_TOTAL_DIFF_LINES: env.MAX_TOTAL_DIFF_LINES ? Number(env.MAX_TOTAL_DIFF_LINES) : 2000,
    MAX_HUNKS: env.MAX_HUNKS ? Number(env.MAX_HUNKS) : 80,
    HUNK_CONTEXT_LINES: env.HUNK_CONTEXT_LINES ? Number(env.HUNK_CONTEXT_LINES) : 20,
    TOKEN_BUDGET_LLM1: env.TOKEN_BUDGET_LLM1 ? Number(env.TOKEN_BUDGET_LLM1) : 3000,
    TOKEN_BUDGET_LLM2: env.TOKEN_BUDGET_LLM2 ? Number(env.TOKEN_BUDGET_LLM2) : 6000,
    REDIS_URL: env.REDIS_URL || undefined
  };
}

