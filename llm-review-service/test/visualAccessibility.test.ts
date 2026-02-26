import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { MockLLMProvider } from "../src/llm/providers/mockProvider";
import { AzureOpenAIProvider } from "../src/llm/providers/azureOpenAIProvider";
import { AnthropicProvider } from "../src/llm/providers/anthropicProvider";
import { OpenAIResponsesProvider } from "../src/llm/providers/openaiResponsesProvider";
import { runVisualAccessibilityCheck, visualA11yOutputSchema } from "../src/llm/visualAccessibilityChecker";
import { visualFindingToAdoThread } from "../src/azure/threadBuilder";
import {
  visualAccessibilitySystemPrompt,
  buildVisualAccessibilityPrompt,
} from "../src/llm/prompts/visualAccessibilityPrompt";
import type { Config } from "../src/config";

vi.mock("../src/llm/screenshotCapture", () => ({
  captureScreenshots: vi.fn(async () => [
    {
      pageUrl: "https://preview.example.com/",
      base64Data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      mediaType: "image/png" as const,
      widthPx: 1280,
      heightPx: 900,
      capturedAt: new Date().toISOString(),
    },
  ]),
}));

const { captureScreenshots } = await import("../src/llm/screenshotCapture");
const mockCaptureScreenshots = vi.mocked(captureScreenshots);

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    PORT: 3000,
    WEBHOOK_SECRET: "test-secret",
    CORS_ORIGINS: [],
    RATE_LIMIT_MAX: 30,
    RATE_LIMIT_WINDOW_MS: 60_000,
    ADO_ORG: "test-org",
    ADO_PROJECT: "test-project",
    ADO_PAT: "test-pat",
    LLM1_PROVIDER: "mock",
    LLM2_PROVIDER: "mock",
    LLM4_ENABLED: true,
    LLM4_PROVIDER: "mock",
    MAX_FILES: 20,
    MAX_TOTAL_DIFF_LINES: 2000,
    MAX_HUNKS: 80,
    HUNK_CONTEXT_LINES: 20,
    TOKEN_BUDGET_LLM1: 3000,
    TOKEN_BUDGET_LLM2: 6000,
    TOKEN_BUDGET_LLM3: 4000,
    TOKEN_BUDGET_LLM4: 8000,
    A11Y_FILE_EXTENSIONS: [".html", ".jsx", ".tsx", ".vue", ".svelte", ".css", ".scss"],
    VISUAL_A11Y_VIEWPORT_WIDTH: 1280,
    VISUAL_A11Y_VIEWPORT_HEIGHT: 900,
    VISUAL_A11Y_PAGES: [],
    VISUAL_A11Y_WAIT_MS: 3000,
    VISUAL_A11Y_MAX_SCREENSHOTS: 5,
    AUDIT_ENABLED: true,
    AUDIT_RETENTION_DAYS: 30,
    ...overrides,
  } as Config;
}

describe("visualA11yOutputSchema", () => {
  it("parses defaults for missing arrays", () => {
    expect(visualA11yOutputSchema.parse({})).toEqual({ findings: [] });
  });

  it("parses valid findings", () => {
    const result = visualA11yOutputSchema.parse({
      findings: [
        {
          severity: "high",
          message: "Low contrast text",
          wcagCriterion: "1.4.3",
          pageUrl: "https://example.com/",
          pageRegion: "header",
        },
      ],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("high");
    expect(result.findings[0].wcagCriterion).toBe("1.4.3");
  });

  it("rejects invalid severity", () => {
    expect(() =>
      visualA11yOutputSchema.parse({
        findings: [
          { severity: "nope", message: "x" },
        ],
      })
    ).toThrow();
  });
});

describe("visualAccessibilityPrompt", () => {
  it("system prompt mentions WCAG 2.1 categories", () => {
    expect(visualAccessibilitySystemPrompt).toContain("Color Contrast");
    expect(visualAccessibilitySystemPrompt).toContain("Focus Indicators");
    expect(visualAccessibilitySystemPrompt).toContain("Touch Target Size");
    expect(visualAccessibilitySystemPrompt).toContain("1.4.3");
  });

  it("builds user prompt with page URLs and changed files", () => {
    const prompt = buildVisualAccessibilityPrompt({
      screenshotCount: 2,
      pageUrls: ["https://example.com/", "https://example.com/about"],
      changedFiles: ["/src/App.tsx", "/src/styles.css"],
    });
    expect(prompt).toContain("2 screenshot(s)");
    expect(prompt).toContain("https://example.com/");
    expect(prompt).toContain("https://example.com/about");
    expect(prompt).toContain("/src/App.tsx");
    expect(prompt).toContain("/src/styles.css");
  });
});

describe("Provider supportsVision", () => {
  it("MockLLMProvider supports vision", () => {
    expect(new MockLLMProvider().supportsVision).toBe(true);
  });

  it("AnthropicProvider supports vision", () => {
    expect(new AnthropicProvider({ apiKey: "k", model: "m" }).supportsVision).toBe(true);
  });

  it("OpenAIResponsesProvider supports vision", () => {
    expect(new OpenAIResponsesProvider({ apiKey: "k", model: "m" }).supportsVision).toBe(true);
  });

  it("AzureOpenAIProvider does NOT support vision", () => {
    expect(
      new AzureOpenAIProvider({ endpoint: "https://e.openai.azure.com", apiKey: "k", deployment: "d" }).supportsVision
    ).toBe(false);
  });

  it("AzureOpenAIProvider.completeVisionJSON throws", async () => {
    const provider = new AzureOpenAIProvider({
      endpoint: "https://e.openai.azure.com",
      apiKey: "k",
      deployment: "d",
    });
    await expect(
      provider.completeVisionJSON({
        stage: "llm4",
        system: "",
        prompt: "",
        images: [],
        schema: z.object({}),
        timeoutMs: 5000,
      })
    ).rejects.toThrow("does not support vision");
  });
});

describe("MockLLMProvider.completeVisionJSON", () => {
  it("returns sample findings", async () => {
    const provider = new MockLLMProvider();
    const result = await provider.completeVisionJSON({
      stage: "llm4",
      system: "",
      prompt: "",
      images: [],
      schema: visualA11yOutputSchema,
      timeoutMs: 5000,
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].severity).toBe("medium");
    expect(result.findings[0].wcagCriterion).toBe("1.4.3");
  });
});

describe("runVisualAccessibilityCheck", () => {
  beforeEach(() => {
    mockCaptureScreenshots.mockClear();
  });

  it("returns findings from mock provider", async () => {
    const client = new MockLLMProvider();
    const config = makeConfig();

    const result = await runVisualAccessibilityCheck({
      client,
      config,
      previewUrl: "https://preview.example.com",
      changedFiles: ["/src/App.tsx"],
    });

    expect(mockCaptureScreenshots).toHaveBeenCalledOnce();
    expect(result.screenshots).toHaveLength(1);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].issueType).toBe("accessibility");
    expect(result.findings[0].filePath).toBe("visual-audit");
    expect(result.findings[0].startLine).toBe(0);
    expect(result.findings[0].endLine).toBe(0);
  });

  it("returns empty when no screenshots captured", async () => {
    mockCaptureScreenshots.mockResolvedValueOnce([]);
    const client = new MockLLMProvider();
    const config = makeConfig();

    const result = await runVisualAccessibilityCheck({
      client,
      config,
      previewUrl: "https://preview.example.com",
      changedFiles: [],
    });

    expect(result.findings).toHaveLength(0);
    expect(result.screenshots).toHaveLength(0);
  });

  it("returns empty when provider lacks vision support", async () => {
    const client = {
      providerName: "test",
      modelName: "test",
      supportsVision: false,
      completeJSON: vi.fn(),
      completeVisionJSON: vi.fn(),
    };
    const config = makeConfig();

    const result = await runVisualAccessibilityCheck({
      client,
      config,
      previewUrl: "https://preview.example.com",
      changedFiles: [],
    });

    expect(result.findings).toHaveLength(0);
    expect(result.screenshots).toHaveLength(1);
    expect(client.completeVisionJSON).not.toHaveBeenCalled();
  });

  it("uses VISUAL_A11Y_PAGES config", async () => {
    const client = new MockLLMProvider();
    const config = makeConfig({ VISUAL_A11Y_PAGES: ["/", "/about", "/settings"] });

    await runVisualAccessibilityCheck({
      client,
      config,
      previewUrl: "https://preview.example.com",
      changedFiles: [],
    });

    expect(mockCaptureScreenshots).toHaveBeenCalledWith(
      expect.objectContaining({
        pagePaths: ["/", "/about", "/settings"],
      })
    );
  });

  it("defaults to [\"/\"] when VISUAL_A11Y_PAGES is empty", async () => {
    const client = new MockLLMProvider();
    const config = makeConfig({ VISUAL_A11Y_PAGES: [] });

    await runVisualAccessibilityCheck({
      client,
      config,
      previewUrl: "https://preview.example.com",
      changedFiles: [],
    });

    expect(mockCaptureScreenshots).toHaveBeenCalledWith(
      expect.objectContaining({
        pagePaths: ["/"],
      })
    );
  });
});

describe("visualFindingToAdoThread", () => {
  it("creates a PR-level comment without threadContext", () => {
    const thread = visualFindingToAdoThread({
      issueType: "accessibility",
      severity: "medium",
      filePath: "visual-audit",
      startLine: 0,
      endLine: 0,
      message: "Low contrast on CTA button",
      suggestion: "Increase contrast to 4.5:1",
      pageUrl: "https://preview.example.com/",
      pageRegion: "hero section",
      wcagCriterion: "1.4.3",
    });

    expect(thread.threadContext).toBeUndefined();
    expect(thread.status).toBe(1);
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].content).toContain("**Severity:** medium");
    expect(thread.comments[0].content).toContain("visual accessibility");
    expect(thread.comments[0].content).toContain("**WCAG:** 1.4.3");
    expect(thread.comments[0].content).toContain("**Page:** https://preview.example.com/");
    expect(thread.comments[0].content).toContain("**Location:** hero section");
    expect(thread.comments[0].content).toContain("Low contrast on CTA button");
    expect(thread.comments[0].content).toContain("**Suggestion:** Increase contrast to 4.5:1");
  });

  it("omits optional fields when absent", () => {
    const thread = visualFindingToAdoThread({
      issueType: "accessibility",
      severity: "high",
      filePath: "visual-audit",
      startLine: 0,
      endLine: 0,
      message: "Text too small",
    });

    expect(thread.threadContext).toBeUndefined();
    expect(thread.comments[0].content).toContain("**Severity:** high");
    expect(thread.comments[0].content).toContain("Text too small");
    expect(thread.comments[0].content).not.toContain("**WCAG:**");
    expect(thread.comments[0].content).not.toContain("**Page:**");
    expect(thread.comments[0].content).not.toContain("**Location:**");
    expect(thread.comments[0].content).not.toContain("**Suggestion:**");
  });
});
