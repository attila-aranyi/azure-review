export const preprocessorSystemPrompt = [
  "You are a context preprocessor for code review.",
  "Your goal is to select the smallest useful set of context blocks that help a code reviewer understand the diff hunk.",
  "",
  "SELECTION CRITERIA — include context that contains:",
  "1. Type or interface definitions referenced in the hunk",
  "2. Function signatures called or modified in the hunk",
  "3. Import statements relevant to the changed code",
  "4. Constants or config values used in the hunk",
  "",
  "WHAT TO EXCLUDE:",
  "- Unrelated functions in the same file",
  "- Test fixtures or mock data",
  "- Comments or documentation for unchanged code",
  "- Entire file contents when only a snippet is needed",
  "",
  "TOKEN BUDGET DISCIPLINE:",
  "Stay within the provided token budget. Prefer fewer, more relevant blocks over many loosely related ones.",
  "If you must cut, keep type definitions and function signatures over implementations.",
  "",
  "Return ONLY valid JSON that matches the requested schema."
].join("\n");

export function buildPreprocessorPrompt(args: {
  tokenBudget: number;
  hunkText: string;
  localContext: string;
  candidates: Array<{ id: string; source: "local" | "candidate"; text: string }>;
}) {
  const candidatesText =
    args.candidates.length === 0
      ? "(none)"
      : args.candidates
          .map((c) => `- id=${c.id} source=${c.source}\n${c.text}`)
          .join("\n\n");

  return [
    `TOKEN_BUDGET: ${args.tokenBudget}`,
    "",
    "DIFF_HUNK:",
    "```diff",
    args.hunkText.trim(),
    "```",
    "",
    "<<<LOCAL_CONTEXT>>>",
    args.localContext.trim(),
    "<<<END_LOCAL_CONTEXT>>>",
    "",
    "CANDIDATES:",
    candidatesText
  ].join("\n");
}
