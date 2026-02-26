import { request } from "undici";
import type { Dispatcher } from "undici";
import type { LLMClient, LLMCompleteJSONArgs } from "../types";

type AnthropicProviderOptions = {
  apiKey: string;
  model: string;
};

class AnthropicProviderError extends Error {
  readonly name = "AnthropicProviderError";
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

export class AnthropicProvider implements LLMClient {
  readonly providerName = "anthropic";
  private readonly apiKey: string;
  private readonly opts: AnthropicProviderOptions;

  get modelName() { return this.opts.model; }

  constructor(opts: AnthropicProviderOptions) {
    this.opts = opts;
    this.apiKey = opts.apiKey;
  }

  async completeJSON<T>(args: LLMCompleteJSONArgs<T>): Promise<T> {
    const url = "https://api.anthropic.com/v1/messages";
    const maxAttempts = 4;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
      try {
        const prompt = attempt === 1 ? args.prompt : `${args.prompt}\n\nReturn ONLY valid JSON.`;
        const body = {
          model: this.opts.model,
          temperature: 0,
          max_tokens: 2048,
          system: args.system,
          messages: [{ role: "user", content: prompt }]
        };

        const res = await request(url, {
          method: "POST" as Dispatcher.HttpMethod,
          signal: controller.signal,
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(body)
        });

        const text = await res.body.text();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new AnthropicProviderError(`Anthropic API failed: ${res.statusCode}`, {
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
        const contentParts = isRecord(json) && Array.isArray(json.content) ? json.content : [];
        const contentText = contentParts
          .map((p) => (isRecord(p) && typeof p.text === "string" ? p.text : ""))
          .filter((s) => s.length > 0)
          .join("\n");

        if (contentText.length === 0) {
          throw new AnthropicProviderError("Anthropic response missing content text", { cause: json });
        }

        const parsed = extractJsonFromText(contentText);
        return args.schema.parse(parsed);
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof AnthropicProviderError ? isRetryableStatus(err.details.statusCode ?? 0) : false;
        if (attempt < maxAttempts && retryable) {
          await sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        if (attempt < maxAttempts && !(err instanceof AnthropicProviderError)) {
          // Allow one retry on invalid JSON / schema errors by continuing.
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new AnthropicProviderError("Anthropic provider failed after retries", { cause: lastErr });
  }
}
