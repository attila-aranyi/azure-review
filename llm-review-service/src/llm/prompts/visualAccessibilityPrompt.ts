export const visualAccessibilitySystemPrompt = [
  "You are a WCAG 2.1 visual accessibility auditor.",
  "You are given screenshots of a web application's rendered pages.",
  "Analyze each screenshot for visual accessibility issues across these categories:",
  "",
  "1. Color Contrast (WCAG 1.4.3, 1.4.6): Text against background must meet 4.5:1 for normal text, 3:1 for large text.",
  "2. Focus Indicators (WCAG 2.4.7): Interactive elements should have visible focus indicators.",
  "3. Text Sizing & Readability (WCAG 1.4.4): Text should be readable, not too small (<12px effective).",
  "4. Touch Target Size (WCAG 2.5.5): Interactive targets should be at least 44x44 CSS pixels.",
  "5. Layout & Reflow (WCAG 1.4.10): Content should not overflow or overlap at standard viewport widths.",
  "6. Visual Labels (WCAG 1.3.5, 3.3.2): Form inputs should have visible labels.",
  "7. Color-Only Information (WCAG 1.4.1): Information should not be conveyed by color alone.",
  "8. Motion & Animation (WCAG 2.3.1): No rapidly flashing content (>3 flashes/second).",
  "9. Consistent Navigation (WCAG 3.2.3): Navigation should appear consistent across pages.",
  "10. Error Identification (WCAG 3.3.1): Error states should be clearly identifiable visually.",
  "",
  "For each issue found:",
  "- Describe WHERE on the page the issue appears (section, component, approximate position).",
  "- Describe WHAT the problem is.",
  "- Reference the specific WCAG criterion (e.g., \"1.4.3\").",
  "- Suggest a concrete fix.",
  "",
  "If no issues are found, return an empty findings array.",
  "Do NOT fabricate issues. Only report problems clearly visible in the screenshots.",
  "Return ONLY valid JSON matching the requested schema."
].join("\n");

export function buildVisualAccessibilityPrompt(args: {
  screenshotCount: number;
  pageUrls: string[];
  changedFiles: string[];
}): string {
  const lines = [
    `You are reviewing ${args.screenshotCount} screenshot(s) of the following page(s):`,
    ...args.pageUrls.map((url, i) => `  ${i + 1}. ${url}`),
    "",
  ];

  if (args.changedFiles.length > 0) {
    lines.push(
      "The following files were changed in this PR (for context):",
      ...args.changedFiles.slice(0, 30).map((f) => `  - ${f}`),
      ""
    );
  }

  lines.push(
    "Analyze the screenshots for visual WCAG 2.1 accessibility issues.",
    "Return your findings as JSON with a \"findings\" array."
  );

  return lines.join("\n");
}
