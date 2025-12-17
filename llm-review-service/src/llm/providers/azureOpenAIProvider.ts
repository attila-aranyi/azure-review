import { request } from "undici";
import type { Dispatcher } from "undici";
import type { LLMClient, LLMCompleteJSONArgs } from "../types";

type AzureOpenAIProviderOptions = {
  endpoint: string;
  apiKey: string;
  deployment: string;
};

class AzureOpenAIProviderError extends Error {
  readonly name = "AzureOpenAIProviderError";
  constructor(
    message: string,
    readonly details: { statusCode?: number; cause?: unknown }
  ) {
    super(message);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(statusCode: number) {
  return statusCode === 429 || statusCode >= 500;
}

function extractJsonFromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      const candidate = text.slice(first, last + 1);
      return JSON.parse(candidate);
    }
    throw new Error("Model output was not valid JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class AzureOpenAIProvider implements LLMClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly deployment: string;

  constructor(opts: AzureOpenAIProviderOptions) {
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.deployment = opts.deployment;
  }

  async completeJSON<T>(args: LLMCompleteJSONArgs<T>): Promise<T> {
    const url = `${this.endpoint}/openai/deployments/${encodeURIComponent(
      this.deployment
    )}/chat/completions?api-version=2024-06-01`;

    const body = {
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.prompt }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    };

    const maxAttempts = 4;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
      try {
        const res = await request(url, {
          method: "POST" as Dispatcher.HttpMethod,
          signal: controller.signal,
          headers: {
            "api-key": this.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(body)
        });

        const text = await res.body.text();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new AzureOpenAIProviderError(`Azure OpenAI API failed: ${res.statusCode}`, {
            statusCode: res.statusCode,
            cause: text
          });
          if (attempt < maxAttempts && isRetryableStatus(res.statusCode)) {
            lastErr = err;
            await sleep(250 * 2 ** (attempt - 1));
            continue;
          }
          throw err;
        }

        const json = JSON.parse(text) as unknown;
        let content: unknown;
        if (isRecord(json) && Array.isArray(json.choices) && json.choices.length > 0) {
          const first = json.choices[0];
          if (isRecord(first) && isRecord(first.message)) {
            content = first.message.content;
          }
        }
        if (typeof content !== "string") {
          throw new AzureOpenAIProviderError("Azure OpenAI response missing message content", { cause: json });
        }

        const parsed = extractJsonFromText(content);
        return args.schema.parse(parsed);
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof AzureOpenAIProviderError ? isRetryableStatus(err.details.statusCode ?? 0) : false;
        if (attempt < maxAttempts && retryable) {
          await sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new AzureOpenAIProviderError("Azure OpenAI provider failed after retries", { cause: lastErr });
  }
}
