import { describe, it, expect } from "vitest";
import {
  findingToAdoThread,
  buildStartingSummary,
  buildCompletedSummaryContent,
  buildErrorSummaryContent,
  buildStatusDescription,
} from "../src/azure/threadBuilder";
import type { FindingSummaryStats } from "../src/azure/threadBuilder";
import type { Finding } from "../src/llm/types";

describe("threadBuilder", () => {
  it("maps a finding into an inline ADO thread payload", () => {
    const finding: Finding = {
      issueType: "security",
      severity: "high",
      filePath: "src/app.ts",
      startLine: 10,
      endLine: 12,
      message: "Do not use eval().",
      suggestion: "Replace eval() with a safe parser."
    };

    const thread = findingToAdoThread(finding);
    expect(thread.threadContext!.filePath).toBe("/src/app.ts");
    expect(thread.threadContext!.rightFileStart.line).toBe(10);
    expect(thread.threadContext!.rightFileEnd.line).toBe(12);
    expect(thread.comments[0]?.content).toContain("Severity");
    expect(thread.comments[0]?.content).toContain("security");
  });
});

describe("summary builders", () => {
  describe("buildStartingSummary", () => {
    it("returns a PR-level thread with no threadContext", () => {
      const thread = buildStartingSummary();
      expect(thread.status).toBe(1);
      expect(thread.threadContext).toBeUndefined();
      expect(thread.comments).toHaveLength(1);
      expect(thread.comments[0].commentType).toBe(1);
    });

    it("contains the bot header and reviewing indicator", () => {
      const thread = buildStartingSummary();
      expect(thread.comments[0].content).toContain("Marvin The Paranoid Android");
      expect(thread.comments[0].content).toContain("Reviewing...");
    });
  });

  describe("buildCompletedSummaryContent", () => {
    it("contains bot header and total tally", () => {
      const stats: FindingSummaryStats = {
        totalFindings: 5,
        publishedFindings: 3,
        skippedDuplicates: 1,
        filteredBelowMinSeverity: 1,
        bySeverity: { high: 2, medium: 1 },
        byIssueType: { security: 2, style: 1 },
      };
      const content = buildCompletedSummaryContent(stats);
      expect(content).toContain("Marvin The Paranoid Android");
      expect(content).toContain("3 published");
      expect(content).toContain("1 duplicates skipped");
      expect(content).toContain("1 below severity threshold");
    });

    it("includes severity and issue type tables", () => {
      const stats: FindingSummaryStats = {
        totalFindings: 2,
        publishedFindings: 2,
        skippedDuplicates: 0,
        filteredBelowMinSeverity: 0,
        bySeverity: { critical: 1, high: 1 },
        byIssueType: { security: 2 },
      };
      const content = buildCompletedSummaryContent(stats);
      expect(content).toContain("| Severity | Count |");
      expect(content).toContain("| critical | 1 |");
      expect(content).toContain("| high | 1 |");
      expect(content).toContain("| Issue Type | Count |");
      expect(content).toContain("| security | 2 |");
    });

    it("omits tables when no published findings", () => {
      const stats: FindingSummaryStats = {
        totalFindings: 0,
        publishedFindings: 0,
        skippedDuplicates: 0,
        filteredBelowMinSeverity: 0,
        bySeverity: {},
        byIssueType: {},
      };
      const content = buildCompletedSummaryContent(stats);
      expect(content).toContain("Marvin The Paranoid Android");
      expect(content).not.toContain("| Severity | Count |");
      expect(content).toContain("0 published");
    });
  });

  describe("buildErrorSummaryContent", () => {
    it("contains the bot header", () => {
      const content = buildErrorSummaryContent();
      expect(content).toContain("Marvin The Paranoid Android");
    });

    it("includes error message in a code block when provided", () => {
      const content = buildErrorSummaryContent("Connection timeout");
      expect(content).toContain("```");
      expect(content).toContain("Connection timeout");
    });

    it("omits code block when no error message", () => {
      const content = buildErrorSummaryContent();
      expect(content).not.toContain("```");
    });
  });

  describe("buildStatusDescription", () => {
    it("returns pending description", () => {
      expect(buildStatusDescription("pending")).toContain("reviewing");
    });

    it("returns succeeded with count", () => {
      const desc = buildStatusDescription("succeeded", 3);
      expect(desc).toContain("3 findings");
    });

    it("returns succeeded with no findings", () => {
      const desc = buildStatusDescription("succeeded", 0);
      expect(desc).toContain("no findings");
    });

    it("returns failed description", () => {
      expect(buildStatusDescription("failed")).toContain("failed");
    });
  });
});
