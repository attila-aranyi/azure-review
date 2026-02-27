import type { AdoCreateThreadRequest } from "./adoTypes";
import type { Finding } from "../llm/types";
import type { VisualA11yFinding } from "../llm/visualAccessibilityChecker";

function ensureLeadingSlash(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

export function findingToAdoThread(finding: Finding): AdoCreateThreadRequest {
  const startLine = Math.min(finding.startLine, finding.endLine);
  const endLine = Math.max(finding.startLine, finding.endLine);

  const contentLines: string[] = [
    `**Severity:** ${finding.severity}`,
    `**Issue type:** ${finding.issueType}`,
    "",
    finding.message.trim()
  ];

  if (finding.suggestion && finding.suggestion.trim().length > 0) {
    contentLines.push("", "**Suggestion**", "```", finding.suggestion.trim(), "```");
  }

  return {
    status: 1,
    comments: [
      {
        parentCommentId: 0,
        commentType: 1,
        content: contentLines.join("\n")
      }
    ],
    threadContext: {
      filePath: ensureLeadingSlash(finding.filePath),
      rightFileStart: { line: startLine, offset: 1 },
      rightFileEnd: { line: endLine, offset: 1 }
    }
  };
}

export function visualFindingToAdoThread(finding: VisualA11yFinding): AdoCreateThreadRequest {
  const content = [
    `**Severity:** ${finding.severity}`,
    `**Issue type:** visual accessibility`,
    finding.wcagCriterion ? `**WCAG:** ${finding.wcagCriterion}` : "",
    finding.pageUrl ? `**Page:** ${finding.pageUrl}` : "",
    finding.pageRegion ? `**Location:** ${finding.pageRegion}` : "",
    "",
    finding.message.trim(),
    finding.suggestion ? `**Suggestion:** ${finding.suggestion}` : "",
  ].filter(Boolean).join("\n");

  return {
    comments: [{ parentCommentId: 0, commentType: 1, content }],
    status: 1,
  };
}
