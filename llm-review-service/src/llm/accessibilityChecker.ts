import { z } from "zod";
import type { LLMClient, Finding } from "./types";
import { accessibilitySystemPrompt, buildAccessibilityPrompt } from "./prompts/accessibilityPrompt";

export type AccessibilityCheckerInput = {
  filePath: string;
  hunkStartLine: number;
  hunkEndLine: number;
  hunkText: string;
  localContext: string;
};

export const accessibilityOutputSchema = z.object({
  findings: z
    .array(
      z.object({
        issueType: z.enum([
          "bug",
          "security",
          "performance",
          "style",
          "correctness",
          "maintainability",
          "testing",
          "docs",
          "accessibility"
        ]),
        severity: z.enum(["low", "medium", "high", "critical"]),
        filePath: z.string().min(1),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
        message: z.string().min(1),
        suggestion: z.string().min(1).optional()
      })
    )
    .optional()
}).transform((value) => ({ findings: value.findings ?? [] }));

export type AccessibilityCheckerOutput = z.infer<typeof accessibilityOutputSchema>;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeFinding(input: AccessibilityCheckerInput, finding: Finding): Finding {
  const hunkStart = Math.min(input.hunkStartLine, input.hunkEndLine);
  const hunkEnd = Math.max(input.hunkStartLine, input.hunkEndLine);

  const startLine = clamp(finding.startLine, hunkStart, hunkEnd);
  const endLine = clamp(finding.endLine, hunkStart, hunkEnd);
  const normalizedStart = Math.min(startLine, endLine);
  const normalizedEnd = Math.max(startLine, endLine);

  return {
    ...finding,
    issueType: "accessibility",
    filePath: input.filePath,
    startLine: normalizedStart,
    endLine: normalizedEnd
  };
}

export async function runAccessibilityCheck(args: {
  client: LLMClient;
  input: AccessibilityCheckerInput;
  timeoutMs: number;
}): Promise<AccessibilityCheckerOutput> {
  const prompt = buildAccessibilityPrompt(args.input);

  const output = await args.client.completeJSON({
    stage: "llm3",
    system: accessibilitySystemPrompt,
    prompt,
    schema: accessibilityOutputSchema,
    timeoutMs: args.timeoutMs
  });

  const normalized = output.findings
    .filter((f) => f.message.trim().length > 0)
    .slice(0, 20)
    .map((f) => normalizeFinding(args.input, f));

  return { findings: normalized };
}
