export type LLMProviderName = "mock" | "openai" | "azure_openai" | "anthropic" | "custom";

export type LLMStage = "llm1" | "llm2";

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

export type LLMCompleteJSONArgs = {
  stage: LLMStage;
  system: string;
  prompt: string;
  schema: object;
  timeoutMs: number;
};

export interface LLMClient {
  completeJSON<T>(args: LLMCompleteJSONArgs): Promise<T>;
}

