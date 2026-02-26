import type { ReviewStrictness } from "../types";

const baseAccessibilitySystemPrompt = [
  "You are a WCAG 2.1 accessibility auditor.",
  "Review ONLY the provided diff hunk for accessibility issues.",
  "Focus on: missing alt text, ARIA attributes, semantic HTML, keyboard navigation,",
  "color contrast concerns, form labels, focus management, and screen reader compatibility.",
  "Return structured findings for issues that are actionable and specific.",
  "Do not invent file paths; use the provided FILE_PATH.",
  "Line numbers must be within the provided hunk range.",
  "Return ONLY valid JSON that matches the requested schema."
].join("\n");

const strictnessAddons: Record<ReviewStrictness, string> = {
  relaxed:
    "Focus only on WCAG 2.1 Level A violations. Ignore Level AA and AAA concerns.",
  balanced: "",
  strict:
    "Flag all WCAG 2.1 violations including Level A, AA, and AAA. Be thorough about potential accessibility barriers.",
};

export function getAccessibilitySystemPrompt(strictness: ReviewStrictness): string {
  const addon = strictnessAddons[strictness];
  return addon ? `${baseAccessibilitySystemPrompt}\n${addon}` : baseAccessibilitySystemPrompt;
}

/** @deprecated Use getAccessibilitySystemPrompt("balanced") instead */
export const accessibilitySystemPrompt = baseAccessibilitySystemPrompt;

export function buildAccessibilityPrompt(args: {
  filePath: string;
  hunkStartLine: number;
  hunkEndLine: number;
  hunkText: string;
  localContext: string;
}) {
  return [
    `FILE_PATH: ${args.filePath}`,
    `HUNK_START_LINE: ${args.hunkStartLine}`,
    `HUNK_END_LINE: ${args.hunkEndLine}`,
    "",
    "DIFF_HUNK:",
    "```diff",
    args.hunkText.trim(),
    "```",
    "",
    "LOCAL_CONTEXT:",
    "```",
    args.localContext.trim(),
    "```"
  ].join("\n");
}
