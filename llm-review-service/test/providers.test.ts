import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import * as undici from "undici";
import { AnthropicProvider } from "../src/llm/providers/anthropicProvider";
import { OpenAIResponsesProvider } from "../src/llm/providers/openaiResponsesProvider";
import { AzureOpenAIProvider } from "../src/llm/providers/azureOpenAIProvider";
import { MockLLMProvider } from "../src/llm/providers/mockProvider";

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof undici>("undici");
  return {
    ...actual,
    request: vi.fn()
  };
});

const mockRequest = vi.mocked(undici.request);

function mockResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {},
    body: { text: vi.fn(async () => typeof body === "string" ? body : JSON.stringify(body)) }
  } as unknown as undici.Dispatcher.ResponseData;
}

const testSchema = z.object({
  findings: z.array(z.object({ message: z.string() })).default([])
});

afterEach(() => {
  mockRequest.mockReset();
});

describe("MockLLMProvider", () => {
  it("returns local context for llm1 stage", async () => {
    const provider = new MockLLMProvider();
    const schema = z.object({
      selected: z.array(z.object({ id: z.string(), source: z.string(), reason: z.string(), text: z.string() }))
    });

    const result = await provider.completeJSON({
      stage: "llm1",
      system: "",
      prompt: "<<<LOCAL_CONTEXT>>>some context<<<END_LOCAL_CONTEXT>>>",
      schema,
      timeoutMs: 5000
    });
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].text).toBe("some context");
  });

  it("detects suspicious keywords for llm2 stage", async () => {
    const provider = new MockLLMProvider();
    const schema = z.object({
      findings: z.array(
        z.object({
          issueType: z.string(),
          severity: z.string(),
          filePath: z.string(),
          startLine: z.number(),
          endLine: z.number(),
          message: z.string(),
          suggestion: z.string().optional()
        })
      ).default([])
    });

    const result = await provider.completeJSON({
      stage: "llm2",
      system: "",
      prompt: "FILE_PATH: /test.ts\nHUNK_START_LINE: 1\nHUNK_END_LINE: 10\neval(input)",
      schema,
      timeoutMs: 5000
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].issueType).toBe("security");
    expect(result.findings[0].severity).toBe("high");
  });

  it("returns no findings for clean code", async () => {
    const provider = new MockLLMProvider();
    const schema = z.object({
      findings: z.array(z.object({ message: z.string() })).default([])
    });

    const result = await provider.completeJSON({
      stage: "llm2",
      system: "",
      prompt: "FILE_PATH: /clean.ts\nHUNK_START_LINE: 1\nHUNK_END_LINE: 5\nconst x = 1;",
      schema,
      timeoutMs: 5000
    });
    expect(result.findings).toHaveLength(0);
  });
});

describe("AnthropicProvider", () => {
  it("parses a valid response", async () => {
    mockRequest.mockResolvedValueOnce(
      mockResponse(200, {
        content: [{ type: "text", text: '{"findings":[]}' }]
      })
    );

    const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-3" });
    const result = await provider.completeJSON({
      stage: "llm2",
      system: "system",
      prompt: "prompt",
      schema: testSchema,
      timeoutMs: 5000
    });
    expect(result.findings).toEqual([]);
  });

  it("throws on non-retryable error", async () => {
    mockRequest.mockResolvedValue(mockResponse(400, "Bad Request"));

    const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-3" });
    await expect(
      provider.completeJSON({
        stage: "llm2",
        system: "system",
        prompt: "prompt",
        schema: testSchema,
        timeoutMs: 5000
      })
    ).rejects.toThrow("Anthropic API failed: 400");
  });
});

describe("OpenAIResponsesProvider", () => {
  it("parses a valid response via output_text", async () => {
    mockRequest.mockResolvedValueOnce(
      mockResponse(200, { output_text: '{"findings":[]}' })
    );

    const provider = new OpenAIResponsesProvider({ apiKey: "test-key", model: "gpt-4" });
    const result = await provider.completeJSON({
      stage: "llm2",
      system: "system",
      prompt: "prompt",
      schema: testSchema,
      timeoutMs: 5000
    });
    expect(result.findings).toEqual([]);
  });

  it("throws on 403", async () => {
    mockRequest.mockResolvedValue(mockResponse(403, "Forbidden"));

    const provider = new OpenAIResponsesProvider({ apiKey: "bad-key", model: "gpt-4" });
    await expect(
      provider.completeJSON({
        stage: "llm2",
        system: "system",
        prompt: "prompt",
        schema: testSchema,
        timeoutMs: 5000
      })
    ).rejects.toThrow("OpenAI Responses API failed: 403");
  });
});

describe("AzureOpenAIProvider", () => {
  it("parses a valid chat completions response", async () => {
    mockRequest.mockResolvedValueOnce(
      mockResponse(200, {
        choices: [{ message: { content: '{"findings":[]}' } }]
      })
    );

    const provider = new AzureOpenAIProvider({
      endpoint: "https://myendpoint.openai.azure.com",
      apiKey: "test-key",
      deployment: "my-deployment"
    });
    const result = await provider.completeJSON({
      stage: "llm2",
      system: "system",
      prompt: "prompt",
      schema: testSchema,
      timeoutMs: 5000
    });
    expect(result.findings).toEqual([]);
  });

  it("throws on auth error", async () => {
    mockRequest.mockResolvedValue(mockResponse(401, "Unauthorized"));

    const provider = new AzureOpenAIProvider({
      endpoint: "https://myendpoint.openai.azure.com",
      apiKey: "bad-key",
      deployment: "my-deployment"
    });
    await expect(
      provider.completeJSON({
        stage: "llm2",
        system: "system",
        prompt: "prompt",
        schema: testSchema,
        timeoutMs: 5000
      })
    ).rejects.toThrow("Azure OpenAI API failed: 401");
  });
});
