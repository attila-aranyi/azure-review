import type { LLMClient, LLMCompleteJSONArgs } from "../types";

export class AnthropicProvider implements LLMClient {
  async completeJSON<T>(_args: LLMCompleteJSONArgs): Promise<T> {
    throw new Error("Not implemented");
  }
}

