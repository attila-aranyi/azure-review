import { describe, it, expect } from "vitest";
import { severityRank, meetsMinSeverity, filterFindings } from "../src/review/severity";
import type { Finding } from "../src/llm/types";

function makeFinding(severity: Finding["severity"]): Finding {
  return {
    issueType: "bug",
    severity,
    filePath: "/src/app.ts",
    startLine: 1,
    endLine: 5,
    message: `A ${severity} finding`,
  };
}

describe("severityRank", () => {
  it("ranks low as 0", () => {
    expect(severityRank("low")).toBe(0);
  });

  it("ranks medium as 1", () => {
    expect(severityRank("medium")).toBe(1);
  });

  it("ranks high as 2", () => {
    expect(severityRank("high")).toBe(2);
  });

  it("ranks critical as 3", () => {
    expect(severityRank("critical")).toBe(3);
  });

  it("maintains ordering low < medium < high < critical", () => {
    expect(severityRank("low")).toBeLessThan(severityRank("medium"));
    expect(severityRank("medium")).toBeLessThan(severityRank("high"));
    expect(severityRank("high")).toBeLessThan(severityRank("critical"));
  });
});

describe("meetsMinSeverity", () => {
  it("low meets low threshold", () => {
    expect(meetsMinSeverity(makeFinding("low"), "low")).toBe(true);
  });

  it("low does not meet medium threshold", () => {
    expect(meetsMinSeverity(makeFinding("low"), "medium")).toBe(false);
  });

  it("critical meets any threshold", () => {
    expect(meetsMinSeverity(makeFinding("critical"), "low")).toBe(true);
    expect(meetsMinSeverity(makeFinding("critical"), "medium")).toBe(true);
    expect(meetsMinSeverity(makeFinding("critical"), "high")).toBe(true);
    expect(meetsMinSeverity(makeFinding("critical"), "critical")).toBe(true);
  });

  it("medium meets medium threshold", () => {
    expect(meetsMinSeverity(makeFinding("medium"), "medium")).toBe(true);
  });

  it("medium does not meet high threshold", () => {
    expect(meetsMinSeverity(makeFinding("medium"), "high")).toBe(false);
  });
});

describe("filterFindings", () => {
  const findings: Finding[] = [
    makeFinding("low"),
    makeFinding("medium"),
    makeFinding("high"),
    makeFinding("critical"),
  ];

  it("with min=low passes all findings", () => {
    const { passed, filtered } = filterFindings(findings, "low");
    expect(passed).toHaveLength(4);
    expect(filtered).toHaveLength(0);
  });

  it("with min=medium filters out low", () => {
    const { passed, filtered } = filterFindings(findings, "medium");
    expect(passed).toHaveLength(3);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].severity).toBe("low");
  });

  it("with min=high filters out low and medium", () => {
    const { passed, filtered } = filterFindings(findings, "high");
    expect(passed).toHaveLength(2);
    expect(filtered).toHaveLength(2);
    expect(passed.map((f) => f.severity)).toEqual(["high", "critical"]);
  });

  it("with min=critical filters everything except critical", () => {
    const { passed, filtered } = filterFindings(findings, "critical");
    expect(passed).toHaveLength(1);
    expect(filtered).toHaveLength(3);
    expect(passed[0].severity).toBe("critical");
  });

  it("returns empty arrays for empty input", () => {
    const { passed, filtered } = filterFindings([], "low");
    expect(passed).toHaveLength(0);
    expect(filtered).toHaveLength(0);
  });
});
