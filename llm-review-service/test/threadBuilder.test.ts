import { describe, it, expect } from "vitest";
import { findingToAdoThread } from "../src/azure/threadBuilder";
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
    expect(thread.threadContext.filePath).toBe("/src/app.ts");
    expect(thread.threadContext.rightFileStart.line).toBe(10);
    expect(thread.threadContext.rightFileEnd.line).toBe(12);
    expect(thread.comments[0]?.content).toContain("Severity");
    expect(thread.comments[0]?.content).toContain("security");
  });
});
