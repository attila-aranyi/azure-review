export const preprocessorSystemPrompt = [
  "You are a context preprocessor for code review.",
  "Given a diff hunk and multiple context candidates, select the smallest useful set of context blocks.",
  "Stay within the provided token budget.",
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
