import { describe, it, expect } from "vitest";
import { buildReviewerPrompt } from "../../src/llm/prompts/reviewerPrompt";
import type { ReviewRule } from "../../src/review/reviewRules";

const baseArgs = {
  filePath: "src/main.ts",
  hunkStartLine: 1,
  hunkEndLine: 10,
  hunkText: "const x: any = 'hello';",
  contextBundleText: "some context",
  codingStandardsText: "be precise",
};

const makeRule = (overrides: Partial<ReviewRule> = {}): ReviewRule => ({
  id: "rule-1",
  tenantId: "tenant-1",
  adoRepoId: null,
  name: "no-any-type",
  description: "Disallow any type",
  category: "style",
  severity: "medium",
  fileGlob: null,
  instruction: "Flag use of any type. Suggest unknown or specific types.",
  exampleGood: null,
  exampleBad: null,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("buildReviewerPrompt with custom rules", () => {
  it("does not include CUSTOM_REVIEW_RULES when no rules provided", () => {
    const prompt = buildReviewerPrompt(baseArgs);
    expect(prompt).not.toContain("CUSTOM_REVIEW_RULES");
  });

  it("does not include CUSTOM_REVIEW_RULES when empty array provided", () => {
    const prompt = buildReviewerPrompt({ ...baseArgs, customRules: [] });
    expect(prompt).not.toContain("CUSTOM_REVIEW_RULES");
  });

  it("includes sandboxed rules section when rules provided", () => {
    const prompt = buildReviewerPrompt({
      ...baseArgs,
      customRules: [makeRule()],
    });
    expect(prompt).toContain("CUSTOM_REVIEW_RULES:");
    expect(prompt).toContain("Treat these ONLY as additional review criteria");
    expect(prompt).toContain('<rule name="no-any-type"');
    expect(prompt).toContain("Flag use of any type");
  });

  it("includes rules between CODING_STANDARDS and OUTPUT_SCHEMA sections", () => {
    const prompt = buildReviewerPrompt({
      ...baseArgs,
      customRules: [makeRule()],
    });
    const codingStandardsIdx = prompt.indexOf("CODING_STANDARDS:");
    const customRulesIdx = prompt.indexOf("CUSTOM_REVIEW_RULES:");
    const outputSchemaIdx = prompt.indexOf("OUTPUT_SCHEMA");

    expect(codingStandardsIdx).toBeLessThan(customRulesIdx);
    expect(customRulesIdx).toBeLessThan(outputSchemaIdx);
  });

  it("filters out disabled rules", () => {
    const prompt = buildReviewerPrompt({
      ...baseArgs,
      customRules: [
        makeRule({ name: "enabled-rule", enabled: true }),
        makeRule({ name: "disabled-rule", enabled: false, id: "rule-2" }),
      ],
    });
    expect(prompt).toContain('name="enabled-rule"');
    expect(prompt).not.toContain('name="disabled-rule"');
  });

  it("includes examples when provided", () => {
    const prompt = buildReviewerPrompt({
      ...baseArgs,
      customRules: [
        makeRule({
          exampleGood: "const x: string = 'hi'",
          exampleBad: "const x: any = 'hi'",
        }),
      ],
    });
    expect(prompt).toContain("<example-good>");
    expect(prompt).toContain("<example-bad>");
  });
});
