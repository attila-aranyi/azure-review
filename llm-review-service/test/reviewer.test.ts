import { describe, it, expect, vi } from "vitest";
import { runReviewer } from "../src/llm/reviewer";
import { MockLLMProvider } from "../src/llm/providers/mockProvider";
import { getReviewerSystemPrompt } from "../src/llm/prompts/reviewerPrompt";

describe("getReviewerSystemPrompt", () => {
  it("balanced returns base prompt without addon", () => {
    const prompt = getReviewerSystemPrompt("balanced");
    expect(prompt).toContain("senior code reviewer");
    expect(prompt).not.toContain("Only flag clear bugs");
    expect(prompt).not.toContain("Be thorough");
  });

  it("relaxed appends relaxed addon", () => {
    const prompt = getReviewerSystemPrompt("relaxed");
    expect(prompt).toContain("senior code reviewer");
    expect(prompt).toContain("Only flag clear bugs");
  });

  it("strict appends strict addon", () => {
    const prompt = getReviewerSystemPrompt("strict");
    expect(prompt).toContain("senior code reviewer");
    expect(prompt).toContain("Be thorough");
  });
});

describe("runReviewer strictness", () => {
  it("passes strictness to completeJSON system prompt", async () => {
    const client = new MockLLMProvider();
    const spy = vi.spyOn(client, "completeJSON");

    await runReviewer({
      client,
      input: {
        filePath: "/src/test.ts",
        hunkStartLine: 1,
        hunkEndLine: 5,
        hunkText: "const x = 1;",
        contextBundleText: "",
        codingStandardsText: "",
      },
      strictness: "relaxed",
      timeoutMs: 5000,
    });

    expect(spy).toHaveBeenCalledOnce();
    const callArgs = spy.mock.calls[0][0];
    expect(callArgs.system).toContain("Only flag clear bugs");
  });

  it("defaults to balanced when strictness is omitted", async () => {
    const client = new MockLLMProvider();
    const spy = vi.spyOn(client, "completeJSON");

    await runReviewer({
      client,
      input: {
        filePath: "/src/test.ts",
        hunkStartLine: 1,
        hunkEndLine: 5,
        hunkText: "const x = 1;",
        contextBundleText: "",
        codingStandardsText: "",
      },
      timeoutMs: 5000,
    });

    expect(spy).toHaveBeenCalledOnce();
    const callArgs = spy.mock.calls[0][0];
    expect(callArgs.system).not.toContain("Only flag clear bugs");
    expect(callArgs.system).not.toContain("Be thorough");
  });
});
