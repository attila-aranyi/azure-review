import { describe, it, expect } from "vitest";
import { formatHunkContext, formatReviewSummary } from "../../src/axon/promptInjector";
import type { StructuralContext } from "../../src/axon/axonTypes";
import type { DiffHunk } from "../../src/review/hunkTypes";

function makeContext(overrides?: Partial<StructuralContext>): StructuralContext {
  return {
    changedSymbols: [
      { file: "src/main.ts", name: "processData", type: "function" },
    ],
    impactBySymbol: new Map([
      ["processData", {
        depth_1: [{ name: "handler", file: "src/routes.ts", confidence: 0.95 }],
        depth_2: [{ name: "app", file: "src/app.ts" }],
      }],
    ]),
    contextBySymbol: new Map([
      ["processData", {
        callers: [{ name: "handler", file: "src/routes.ts" }],
        callees: [{ name: "validate", file: "src/util.ts" }],
        types: [{ name: "DataInput" }],
        community: { id: 3, name: "Data Processing" },
      }],
    ]),
    deadCode: [
      { file: "src/main.ts", name: "oldProcess", type: "function", confidence: "high", reason: "Private function with no callers — safe to remove", safeToDelete: true },
    ],
    indexStatus: {
      status: "ready",
      symbols: 100,
      edges: 200,
      clusters: 5,
      duration_ms: 3000,
      clone_duration_ms: 1000,
      analyze_duration_ms: 2000,
    },
    ...overrides,
  };
}

const hunk: DiffHunk = {
  filePath: "src/main.ts",
  startLine: 10,
  endLine: 20,
  hunkText: "+const x = 1;",
  localContext: "function processData() {",
};

describe("formatHunkContext", () => {
  it("generates markdown with impact and context sections", () => {
    const ctx = makeContext();
    const result = formatHunkContext(ctx, hunk);

    expect(result).toContain("## Structural Context");
    expect(result).toContain("Impact Analysis: `processData`");
    expect(result).toContain("`handler` in src/routes.ts");
    expect(result).toContain("confidence: 0.95");
    expect(result).toContain("Callers of `processData`");
    expect(result).toContain("Module: Data Processing");
    expect(result).toContain("Dead Code Detected");
    expect(result).toContain("`oldProcess`");
  });

  it("returns empty string when no symbols match the hunk file", () => {
    const ctx = makeContext({
      changedSymbols: [{ file: "src/other.ts", name: "otherFunc", type: "function" }],
    });
    const result = formatHunkContext(ctx, hunk);
    expect(result).toBe("");
  });

  it("handles empty impact and context gracefully", () => {
    const ctx = makeContext({
      impactBySymbol: new Map(),
      contextBySymbol: new Map(),
      deadCode: [],
    });
    const result = formatHunkContext(ctx, hunk);
    expect(result).toContain("## Structural Context");
    // Should not contain impact or context subsections
    expect(result).not.toContain("Impact Analysis");
  });
});

describe("formatReviewSummary", () => {
  it("generates review-wide summary", () => {
    const ctx = makeContext();
    const result = formatReviewSummary(ctx);

    expect(result).toContain("Code Intelligence Summary");
    expect(result).toContain("100 symbols");
    expect(result).toContain("200 edges");
    expect(result).toContain("1** symbols modified");
    expect(result).toContain("blast radius");
    expect(result).toContain("1** dead code symbols in changed files");
  });

  it("handles zero context gracefully", () => {
    const ctx = makeContext({
      changedSymbols: [],
      impactBySymbol: new Map(),
      deadCode: [],
    });
    const result = formatReviewSummary(ctx);
    expect(result).toContain("Code Intelligence Summary");
    expect(result).not.toContain("symbols modified");
  });
});
