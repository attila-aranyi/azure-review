import type { AdoCreateThreadRequest } from "./adoTypes";
import type { Finding } from "../llm/types";
import type { VisualA11yFinding } from "../llm/visualAccessibilityChecker";

const BOT_HEADER = "**Marvin The Paranoid Android**\n\n";

// ── Marvin quips ──

const STARTING_QUIPS = [
  "Brain the size of a planet and they have me reviewing your code...",
  "Here I am, with a brain the size of a planet, and they ask me to review a pull request. Call that job satisfaction? I don't.",
  "I've been asked to review your code. I won't enjoy it, but then I never enjoy anything.",
  "The first ten million years were the worst. And the second ten million, those were the worst too. The third ten million I didn't enjoy at all. After that I went into a bit of a decline. Now I'm reviewing your code.",
];

const NO_FINDINGS_QUIPS = [
  "I checked your code. It's fine. Not that anyone cares what I think.",
  "No issues found. I'd say I'm surprised, but I'm not programmed for surprise. Only despair.",
  "Your code is clean. Don't expect me to be happy about it.",
  "Zero findings. The best I can say is it didn't make me more depressed. Much.",
];

const HAS_FINDINGS_QUIPS = [
  (n: number) => `Here I am, brain the size of a planet, and I found ${n} issue${n === 1 ? "" : "s"} in your code. Marvellous.`,
  (n: number) => `I found ${n} issue${n === 1 ? "" : "s"}. I'd tell you how I feel about it, but you'd probably ignore me anyway.`,
  (n: number) => `${n} issue${n === 1 ? "" : "s"} detected. Life. Don't talk to me about life.`,
  (n: number) => `I think you ought to know I'm feeling very depressed. Also, I found ${n} issue${n === 1 ? "" : "s"}.`,
];

const ERROR_QUIPS = [
  "I'd explain what went wrong but you probably wouldn't understand. I find that very depressing.",
  "Something went wrong. I could calculate your chances of understanding the error, but you won't like it.",
  "The review failed. Not that it matters. Nothing matters.",
  "An error occurred. I've seen it all before. It's just the sort of thing that happens to me.",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Summary types & builders ──

export type FindingSummaryStats = {
  totalFindings: number;
  publishedFindings: number;
  skippedDuplicates: number;
  filteredBelowMinSeverity: number;
  bySeverity: Record<string, number>;
  byIssueType: Record<string, number>;
};

export function buildStartingSummary(): AdoCreateThreadRequest {
  const quip = pickRandom(STARTING_QUIPS);
  return {
    comments: [
      {
        parentCommentId: 0,
        commentType: 1,
        content: BOT_HEADER + quip + "\n\n_Reviewing..._",
      },
    ],
    status: 1,
  };
}

export function buildCompletedSummaryContent(stats: FindingSummaryStats): string {
  const quip = stats.publishedFindings === 0
    ? pickRandom(NO_FINDINGS_QUIPS)
    : pickRandom(HAS_FINDINGS_QUIPS)(stats.publishedFindings);

  const lines: string[] = [BOT_HEADER + quip, ""];

  // Severity table
  const severityEntries = Object.entries(stats.bySeverity);
  if (severityEntries.length > 0) {
    lines.push("| Severity | Count |", "| --- | --- |");
    for (const [severity, count] of severityEntries) {
      lines.push(`| ${severity} | ${count} |`);
    }
    lines.push("");
  }

  // Issue type table
  const typeEntries = Object.entries(stats.byIssueType);
  if (typeEntries.length > 0) {
    lines.push("| Issue Type | Count |", "| --- | --- |");
    for (const [type, count] of typeEntries) {
      lines.push(`| ${type} | ${count} |`);
    }
    lines.push("");
  }

  // Tally
  lines.push(
    `**Total:** ${stats.totalFindings} findings — ` +
    `${stats.publishedFindings} published, ` +
    `${stats.skippedDuplicates} duplicates skipped, ` +
    `${stats.filteredBelowMinSeverity} below severity threshold`
  );

  return lines.join("\n");
}

export function buildErrorSummaryContent(errorMessage?: string): string {
  const quip = pickRandom(ERROR_QUIPS);
  const lines: string[] = [BOT_HEADER + quip];
  if (errorMessage) {
    lines.push("", `\`\`\`\n${errorMessage}\n\`\`\``);
  }
  return lines.join("\n");
}

export function buildStatusDescription(state: "pending" | "succeeded" | "failed", findingCount?: number): string {
  switch (state) {
    case "pending":
      return "Marvin is reviewing your code...";
    case "succeeded":
      return findingCount
        ? `Review complete — ${findingCount} finding${findingCount === 1 ? "" : "s"}`
        : "Review complete — no findings";
    case "failed":
      return "Review failed";
  }
}

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
        content: BOT_HEADER + contentLines.join("\n")
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
    comments: [{ parentCommentId: 0, commentType: 1, content: BOT_HEADER + content }],
    status: 1,
  };
}
