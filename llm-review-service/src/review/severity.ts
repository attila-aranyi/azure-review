import type { Finding } from "../llm/types";

export type Severity = Finding["severity"];

const SEVERITY_RANKS: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function severityRank(s: Severity): number {
  return SEVERITY_RANKS[s];
}

export function meetsMinSeverity(finding: Finding, minSeverity: Severity): boolean {
  return severityRank(finding.severity) >= severityRank(minSeverity);
}

export function filterFindings(
  findings: Finding[],
  minSeverity: Severity
): { passed: Finding[]; filtered: Finding[] } {
  const passed: Finding[] = [];
  const filtered: Finding[] = [];
  for (const f of findings) {
    if (meetsMinSeverity(f, minSeverity)) {
      passed.push(f);
    } else {
      filtered.push(f);
    }
  }
  return { passed, filtered };
}
