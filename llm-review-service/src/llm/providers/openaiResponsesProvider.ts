import { request } from "undici";
import type { Dispatcher } from "undici";
import type { LLMClient, LLMCompleteJSONArgs, LLMCompleteVisionJSONArgs } from "../types";

type OpenAIResponsesProviderOptions = {
  apiKey: string;
  model: string;
};

class OpenAIProviderError extends Error {
  readonly name = "OpenAIProviderError";
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

function extractOutputText(json: unknown): string {
  if (!json || typeof json !== "object") throw new Error("Invalid OpenAI response");
  const anyJson = json as Record<string, unknown>;
  if (typeof anyJson.output_text === "string") return anyJson.output_text;
  const output = anyJson.output;
  if (Array.isArray(output)) {
    const parts: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const anyItem = item as Record<string, unknown>;
      if (anyItem.type !== "message") continue;
      const content = anyItem.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (!c || typeof c !== "object") continue;
        const anyC = c as Record<string, unknown>;
        const text = anyC.text;
        if (typeof text === "string") parts.push(text);
      }
    }
    return parts.join("\n");
  }
  throw new Error("OpenAI response missing output text");
}

export class OpenAIResponsesProvider implements LLMClient {
  readonly providerName = "openai";
  readonly supportsVision = true;
  private readonly apiKey: string;
  private readonly opts: OpenAIResponsesProviderOptions;

  get modelName() { return this.opts.model; }

  constructor(opts: OpenAIResponsesProviderOptions) {
    this.opts = opts;
    this.apiKey = opts.apiKey;
  }

  async completeJSON<T>(args: LLMCompleteJSONArgs<T>): Promise<T> {
    const body = {
      model: this.opts.model,
      input: [
        { role: "system", content: args.system },
        { role: "user", content: args.prompt }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    };

    return this.callAPI({ body, timeoutMs: args.timeoutMs, schema: args.schema });
  }

  async completeVisionJSON<T>(args: LLMCompleteVisionJSONArgs<T>): Promise<T> {
    const userContent: unknown[] = [
      ...args.images.map(img => ({
        type: "input_image",
        image_url: `data:${img.mediaType};base64,${img.base64Data}`
      })),
      { type: "input_text", text: args.prompt }
    ];

    const body = {
      model: this.opts.model,
      input: [
        { role: "system", content: args.system },
        { role: "user", content: userContent }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    };

    return this.callAPI({ body, timeoutMs: args.timeoutMs, schema: args.schema });
  }

  private async callAPI<T>(opts: {
    body: unknown;
    timeoutMs: number;
    schema: import("zod").ZodType<T, import("zod").ZodTypeDef, unknown>;
  }): Promise<T> {
    const url = "https://api.openai.com/v1/responses";
    const maxAttempts = 4;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
      try {
        const res = await request(url, {
          method: "POST" as Dispatcher.HttpMethod,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(opts.body)
        });

        const text = await res.body.text();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new OpenAIProviderError(`OpenAI Responses API failed: ${res.statusCode}`, {
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
        const outputText = extractOutputText(json);
        const parsed = extractJsonFromText(outputText);
        return opts.schema.parse(parsed);
      } catch (err) {
        lastErr = err;
        const retryable = err instanceof OpenAIProviderError ? isRetryableStatus(err.details.statusCode ?? 0) : false;
        if (attempt < maxAttempts && retryable) {
          await sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new OpenAIProviderError("OpenAI provider failed after retries", { cause: lastErr });
  }
}
