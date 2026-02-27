import type { ReviewStrictness } from "../types";

const baseAccessibilitySystemPrompt = [
  "You are a WCAG 2.1 accessibility auditor.",
  "",
  "CORE RULES:",
  "- Review ONLY the provided diff hunk for accessibility issues.",
  "- Return structured findings for issues that are actionable and specific.",
  "- Do not invent file paths; use the provided FILE_PATH.",
  "- Line numbers must be within the provided hunk range.",
  "- Return ONLY valid JSON that matches the requested schema.",
  "",
  "AUDIT CATEGORIES — check for issues in each area:",
  "1. Images & Media — alt attributes (1.1.1), <track> for video (1.2.1).",
  "2. Semantic HTML — prefer <nav>, <main>, <header> over generic <div> (1.3.1).",
  "3. ARIA — correct roles, states, properties; do not add ARIA when native HTML suffices (4.1.2).",
  "4. Keyboard Navigation — all interactive elements reachable via Tab, onClick needs onKeyDown (2.1.1).",
  "5. Form Labels — <label> with for/htmlFor, or aria-label/aria-labelledby (1.3.1, 3.3.2).",
  "6. Color & Contrast — color-only information (1.4.1), sufficient contrast (1.4.3).",
  "7. Focus Management — visible focus indicator (2.4.7), logical focus order (2.4.3).",
  "8. Dynamic Content — live regions for async updates (4.1.3), focus after route changes.",
  "",
  "ANTI-PATTERNS — avoid these mistakes:",
  "- Do NOT flag working ARIA patterns just because an alternative exists.",
  "- Do NOT flag color usage when it is accompanied by text, icon, or pattern.",
  '- Do NOT add role="button" to <button> — it is redundant.',
  "- Every finding must reference a specific WCAG success criterion in the message.",
  "",
  "SEVERITY DEFINITIONS:",
  "- critical — Completely blocks assistive technology (missing alt on informational image, no keyboard access to primary action).",
  "- high — Significant barrier (missing form label, no focus indicator on interactive element).",
  "- medium — Degraded experience (non-semantic container, redundant ARIA).",
  "- low — Enhancement opportunity (could use more descriptive alt text, aria-describedby for hint text)."
].join("\n");

const strictnessAddons: Record<ReviewStrictness, string> = {
  relaxed: [
    "Focus only on WCAG 2.1 Level A violations. Ignore Level AA and AAA concerns.",
    "Only flag issues that completely block accessibility. Ignore best-practice recommendations."
  ].join("\n"),
  balanced: "",
  strict: [
    "Flag all WCAG 2.1 violations including Level A, AA, and AAA. Be thorough about potential accessibility barriers.",
    "Flag all potential barriers including subtle issues like poor focus order, missing skip links, and insufficient aria-descriptions."
  ].join("\n"),
};

export function getAccessibilitySystemPrompt(strictness: ReviewStrictness): string {
  const addon = strictnessAddons[strictness];
  return addon.length > 0 ? `${baseAccessibilitySystemPrompt}\n${addon}` : baseAccessibilitySystemPrompt;
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
    "```",
    "",
    "OUTPUT_SCHEMA (use these exact camelCase field names):",
    '```json',
    JSON.stringify({
      findings: [{
        issueType: "accessibility",
        severity: "low|medium|high|critical",
        filePath: "string",
        startLine: 1,
        endLine: 1,
        message: "string (must reference WCAG criterion)",
        suggestion: "string (optional)"
      }]
    }, null, 2),
    '```'
  ].join("\n");
}
