import { describe, it, expect, vi } from "vitest";
import { accessibilityOutputSchema, runAccessibilityCheck } from "../src/llm/accessibilityChecker";
import { MockLLMProvider } from "../src/llm/providers/mockProvider";
import { getAccessibilitySystemPrompt } from "../src/llm/prompts/accessibilityPrompt";

describe("accessibilityOutputSchema", () => {
  it("parses defaults for missing arrays", () => {
    expect(accessibilityOutputSchema.parse({})).toEqual({ findings: [] });
  });

  it("parses valid findings", () => {
    const result = accessibilityOutputSchema.parse({
      findings: [
        {
          issueType: "accessibility",
          severity: "high",
          filePath: "/app.tsx",
          startLine: 5,
          endLine: 10,
          message: "Missing alt attribute"
        }
      ]
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].issueType).toBe("accessibility");
  });

  it("rejects invalid severity", () => {
    expect(() =>
      accessibilityOutputSchema.parse({
        findings: [
          {
            issueType: "accessibility",
            severity: "nope",
            filePath: "/a.tsx",
            startLine: 1,
            endLine: 1,
            message: "x"
          }
        ]
      })
    ).toThrow();
  });
});

describe("runAccessibilityCheck", () => {
  it("returns findings using mock provider with a11y issues", async () => {
    const client = new MockLLMProvider();
    const result = await runAccessibilityCheck({
      client,
      input: {
        filePath: "/src/app.tsx",
        hunkStartLine: 1,
        hunkEndLine: 10,
        hunkText: '<img src="photo.jpg">',
        localContext: "function render() {}"
      },
      timeoutMs: 5000
    });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.issueType === "accessibility")).toBe(true);
    expect(result.findings[0].message).toContain("alt");
  });

  it("returns empty findings for accessible code", async () => {
    const client = new MockLLMProvider();
    const result = await runAccessibilityCheck({
      client,
      input: {
        filePath: "/src/app.tsx",
        hunkStartLine: 1,
        hunkEndLine: 5,
        hunkText: '<nav><a href="/">Home</a></nav>',
        localContext: ""
      },
      timeoutMs: 5000
    });

    expect(result.findings).toHaveLength(0);
  });

  it("clamps line numbers to hunk range", async () => {
    const client = new MockLLMProvider();
    const result = await runAccessibilityCheck({
      client,
      input: {
        filePath: "/src/page.html",
        hunkStartLine: 20,
        hunkEndLine: 30,
        hunkText: '<div onClick={() => {}}><img src="x.png"></div>',
        localContext: ""
      },
      timeoutMs: 5000
    });

    for (const finding of result.findings) {
      expect(finding.startLine).toBeGreaterThanOrEqual(20);
      expect(finding.endLine).toBeLessThanOrEqual(30);
      expect(finding.issueType).toBe("accessibility");
      expect(finding.filePath).toBe("/src/page.html");
    }
  });
});

describe("getAccessibilitySystemPrompt", () => {
  it("balanced returns base prompt without addon", () => {
    const prompt = getAccessibilitySystemPrompt("balanced");
    expect(prompt).toContain("WCAG 2.1 accessibility auditor");
    expect(prompt).not.toContain("Level A violations");
    expect(prompt).not.toContain("Level A, AA, and AAA");
  });

  it("relaxed appends Level A focus", () => {
    const prompt = getAccessibilitySystemPrompt("relaxed");
    expect(prompt).toContain("WCAG 2.1 accessibility auditor");
    expect(prompt).toContain("Level A violations");
  });

  it("strict appends AA and AAA", () => {
    const prompt = getAccessibilitySystemPrompt("strict");
    expect(prompt).toContain("WCAG 2.1 accessibility auditor");
    expect(prompt).toContain("Level A, AA, and AAA");
  });
});

describe("runAccessibilityCheck strictness", () => {
  it("passes strictness to completeJSON system prompt", async () => {
    const client = new MockLLMProvider();
    const spy = vi.spyOn(client, "completeJSON");

    await runAccessibilityCheck({
      client,
      input: {
        filePath: "/src/app.tsx",
        hunkStartLine: 1,
        hunkEndLine: 10,
        hunkText: '<img src="photo.jpg">',
        localContext: ""
      },
      strictness: "strict",
      timeoutMs: 5000
    });

    expect(spy).toHaveBeenCalledOnce();
    const callArgs = spy.mock.calls[0][0];
    expect(callArgs.system).toContain("Level A, AA, and AAA");
  });

  it("defaults to balanced when strictness is omitted", async () => {
    const client = new MockLLMProvider();
    const spy = vi.spyOn(client, "completeJSON");

    await runAccessibilityCheck({
      client,
      input: {
        filePath: "/src/app.tsx",
        hunkStartLine: 1,
        hunkEndLine: 10,
        hunkText: '<img src="photo.jpg">',
        localContext: ""
      },
      timeoutMs: 5000
    });

    expect(spy).toHaveBeenCalledOnce();
    const callArgs = spy.mock.calls[0][0];
    expect(callArgs.system).not.toContain("Level A violations");
    expect(callArgs.system).not.toContain("Level A, AA, and AAA");
  });
});
