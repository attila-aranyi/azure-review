export const reviewerSystemPrompt = [
  "You are a senior code reviewer.",
  "Review ONLY the provided diff hunk using the provided context bundle.",
  "Return structured findings for issues that are actionable and specific.",
  "Do not invent file paths; use the provided FILE_PATH.",
  "Line numbers must be within the provided hunk range.",
  "Return ONLY valid JSON that matches the requested schema."
].join("\n");

export function buildReviewerPrompt(args: {
  filePath: string;
  hunkStartLine: number;
  hunkEndLine: number;
  hunkText: string;
  contextBundleText: string;
  codingStandardsText: string;
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
    "CONTEXT_BUNDLE:",
    "```",
    args.contextBundleText.trim(),
    "```",
    "",
    "CODING_STANDARDS:",
    "```",
    args.codingStandardsText.trim(),
    "```"
  ].join("\n");
}
