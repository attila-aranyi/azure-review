import { describe, it, expect } from "vitest";
import { z } from "zod";
import { preprocessorOutputSchema } from "../src/llm/preprocessor";
import { reviewerOutputSchema } from "../src/llm/reviewer";
import { accessibilityOutputSchema } from "../src/llm/accessibilityChecker";
import { MockLLMProvider } from "../src/llm/providers/mockProvider";

describe("llm schemas", () => {
  it("parses defaults for missing arrays", () => {
    expect(preprocessorOutputSchema.parse({})).toEqual({ selected: [] });
    expect(reviewerOutputSchema.parse({})).toEqual({ findings: [] });
    expect(accessibilityOutputSchema.parse({})).toEqual({ findings: [] });
  });

  it("rejects invalid reviewer output", () => {
    expect(() =>
      reviewerOutputSchema.parse({
        findings: [
          {
            issueType: "bug",
            severity: "nope",
            filePath: "/a.ts",
            startLine: 1,
            endLine: 1,
            message: "x"
          }
        ]
      })
    ).toThrow();
  });

  it("provider output is validated by schema", async () => {
    const client = new MockLLMProvider();
    await expect(
      client.completeJSON({
        stage: "llm2",
        system: "",
        prompt: "TODO",
        schema: z.object({ not: z.string() }),
        timeoutMs: 1000
      })
    ).rejects.toThrow();
  });
});
