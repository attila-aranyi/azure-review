import { z } from "zod";
import type { LLMClient, Finding, ReviewStrictness } from "./types";
import { getReviewerSystemPrompt, buildReviewerPrompt } from "./prompts/reviewerPrompt";

export type ReviewerInput = {
  filePath: string;
  hunkStartLine: number;
  hunkEndLine: number;
  hunkText: string;
  contextBundleText: string;
  codingStandardsText: string;
};

export const reviewerOutputSchema = z.object({
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

export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeFinding(input: ReviewerInput, finding: Finding): Finding {
  const hunkStart = Math.min(input.hunkStartLine, input.hunkEndLine);
  const hunkEnd = Math.max(input.hunkStartLine, input.hunkEndLine);

  const startLine = clamp(finding.startLine, hunkStart, hunkEnd);
  const endLine = clamp(finding.endLine, hunkStart, hunkEnd);
  const normalizedStart = Math.min(startLine, endLine);
  const normalizedEnd = Math.max(startLine, endLine);

  return {
    ...finding,
    filePath: input.filePath,
    startLine: normalizedStart,
    endLine: normalizedEnd
  };
}

export async function runReviewer(args: {
  client: LLMClient;
  input: ReviewerInput;
  strictness?: ReviewStrictness;
  timeoutMs: number;
}): Promise<ReviewerOutput> {
  const prompt = buildReviewerPrompt(args.input);

  const output = await args.client.completeJSON({
    stage: "llm2",
    system: getReviewerSystemPrompt(args.strictness ?? "balanced"),
    prompt,
    schema: reviewerOutputSchema,
    timeoutMs: args.timeoutMs
  });

  const normalized = output.findings
    .filter((f) => f.message.trim().length > 0)
    .slice(0, 20)
    .map((f) => normalizeFinding(args.input, f));

  return { findings: normalized };
}
