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
  it("exposes providerName and modelName", () => {
    const provider = new MockLLMProvider();
    expect(provider.providerName).toBe("mock");
    expect(provider.modelName).toBe("mock");
  });

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

  it("detects missing alt attribute for llm3 stage", async () => {
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
      stage: "llm3",
      system: "",
      prompt: 'FILE_PATH: /app.tsx\nHUNK_START_LINE: 1\nHUNK_END_LINE: 10\n<img src="photo.jpg">',
      schema,
      timeoutMs: 5000
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].issueType).toBe("accessibility");
    expect(result.findings[0].message).toContain("alt");
  });

  it("detects onClick without keyboard handler for llm3 stage", async () => {
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
      stage: "llm3",
      system: "",
      prompt: "FILE_PATH: /btn.tsx\nHUNK_START_LINE: 5\nHUNK_END_LINE: 15\n<div onClick={handleClick}>Click</div>",
      schema,
      timeoutMs: 5000
    });
    const keyboardFinding = result.findings.find((f) => f.message.includes("keyboard"));
    expect(keyboardFinding).toBeDefined();
  });

  it("detects non-semantic divs for llm3 stage", async () => {
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
      stage: "llm3",
      system: "",
      prompt: "FILE_PATH: /page.html\nHUNK_START_LINE: 1\nHUNK_END_LINE: 5\n<div class=\"header\">Title</div>",
      schema,
      timeoutMs: 5000
    });
    const semanticFinding = result.findings.find((f) => f.message.includes("semantic"));
    expect(semanticFinding).toBeDefined();
  });

  it("returns no findings for accessible code in llm3 stage", async () => {
    const provider = new MockLLMProvider();
    const schema = z.object({
      findings: z.array(z.object({ message: z.string() })).default([])
    });

    const result = await provider.completeJSON({
      stage: "llm3",
      system: "",
      prompt: "FILE_PATH: /page.html\nHUNK_START_LINE: 1\nHUNK_END_LINE: 5\n<nav><a href=\"/\">Home</a></nav>",
      schema,
      timeoutMs: 5000
    });
    expect(result.findings).toHaveLength(0);
  });
});

describe("AnthropicProvider", () => {
  it("exposes providerName and modelName", () => {
    const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-3-sonnet" });
    expect(provider.providerName).toBe("anthropic");
    expect(provider.modelName).toBe("claude-3-sonnet");
  });

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
  it("exposes providerName and modelName", () => {
    const provider = new OpenAIResponsesProvider({ apiKey: "test-key", model: "gpt-4o" });
    expect(provider.providerName).toBe("openai");
    expect(provider.modelName).toBe("gpt-4o");
  });

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
  it("exposes providerName and modelName from deployment", () => {
    const provider = new AzureOpenAIProvider({
      endpoint: "https://myendpoint.openai.azure.com",
      apiKey: "test-key",
      deployment: "gpt-4o-deploy"
    });
    expect(provider.providerName).toBe("azure_openai");
    expect(provider.modelName).toBe("gpt-4o-deploy");
  });

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
