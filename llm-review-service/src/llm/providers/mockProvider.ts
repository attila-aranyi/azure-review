import type { LLMClient, LLMCompleteJSONArgs } from "../types";

function extractBetween(haystack: string, startMarker: string, endMarker: string): string | undefined {
  const startIdx = haystack.indexOf(startMarker);
  if (startIdx === -1) return undefined;
  const from = startIdx + startMarker.length;
  const endIdx = haystack.indexOf(endMarker, from);
  if (endIdx === -1) return undefined;
  return haystack.slice(from, endIdx);
}

function extractLineValue(haystack: string, key: string): string | undefined {
  const match = haystack.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

export class MockLLMProvider implements LLMClient {
  readonly providerName = "mock";
  readonly modelName = "mock";

  async completeJSON<T>(args: LLMCompleteJSONArgs<T>): Promise<T> {
    if (args.stage === "llm1") {
      const localContext =
        extractBetween(args.prompt, "<<<LOCAL_CONTEXT>>>", "<<<END_LOCAL_CONTEXT>>>") ??
        extractLineValue(args.prompt, "LOCAL_CONTEXT") ??
        "";

      const output = {
        selected: [
          {
            id: "local",
            source: "local",
            reason: "Mock provider selects local context only",
            text: localContext.trim()
          }
        ]
      };
      return args.schema.parse(output);
    }

    if (args.stage === "llm3") {
      const filePath = extractLineValue(args.prompt, "FILE_PATH") ?? "unknown";
      const startLine = Number(extractLineValue(args.prompt, "HUNK_START_LINE") ?? "1");
      const endLine = Number(extractLineValue(args.prompt, "HUNK_END_LINE") ?? String(startLine));

      const a11yFindings: Array<{
        issueType: string; severity: string; filePath: string;
        startLine: number; endLine: number; message: string; suggestion: string;
      }> = [];

      if (/<img\b(?![^>]*\balt\s*=)/i.test(args.prompt)) {
        a11yFindings.push({
          issueType: "accessibility", severity: "high", filePath, startLine, endLine,
          message: "Image element is missing an alt attribute.",
          suggestion: "Add a descriptive alt attribute, or alt=\"\" for decorative images."
        });
      }

      if (/<div\b/i.test(args.prompt) && !/<(nav|main|header|footer|section|article|aside)\b/i.test(args.prompt)) {
        a11yFindings.push({
          issueType: "accessibility", severity: "medium", filePath, startLine, endLine,
          message: "Non-semantic <div> used where a semantic element may be more appropriate.",
          suggestion: "Consider using <nav>, <main>, <header>, <footer>, <section>, or <article> instead."
        });
      }

      if (/onClick/i.test(args.prompt) && !/onKey(Down|Press|Up)/i.test(args.prompt)) {
        a11yFindings.push({
          issueType: "accessibility", severity: "high", filePath, startLine, endLine,
          message: "onClick handler without corresponding keyboard event handler.",
          suggestion: "Add onKeyDown or onKeyPress to ensure keyboard accessibility."
        });
      }

      if (/<(input|textarea|select)\b/i.test(args.prompt) &&
          !/aria-label/i.test(args.prompt) && !/\bfor\s*=/i.test(args.prompt) && !/htmlFor/i.test(args.prompt)) {
        a11yFindings.push({
          issueType: "accessibility", severity: "high", filePath, startLine, endLine,
          message: "Form element missing an associated label.",
          suggestion: "Add a <label> with for/htmlFor or an aria-label attribute."
        });
      }

      return args.schema.parse({ findings: a11yFindings });
    }

    const suspiciousKeywords = ["TODO", "FIXME", "eval(", ": any", " as any", "any)", "password", "secret"];
    const hasSuspicious = suspiciousKeywords.some((kw) => args.prompt.includes(kw));
    const filePath = extractLineValue(args.prompt, "FILE_PATH") ?? "unknown";
    const startLine = Number(extractLineValue(args.prompt, "HUNK_START_LINE") ?? "1");
    const endLine = Number(extractLineValue(args.prompt, "HUNK_END_LINE") ?? String(startLine));

    const findings = hasSuspicious
      ? [
          {
            issueType: args.prompt.includes("eval(") ? "security" : "maintainability",
            severity: args.prompt.includes("eval(") ? "high" : "medium",
            filePath,
            startLine,
            endLine,
            message: "Mock review: suspicious pattern detected in this hunk.",
            suggestion: "Consider removing the suspicious construct or replacing it with a safer alternative."
          }
        ]
      : [];

    return args.schema.parse({ findings });
  }
}
