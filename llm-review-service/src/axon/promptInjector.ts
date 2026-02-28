/**
 * Formats axon structural context for injection into LLM prompts.
 *
 * The output is a markdown-formatted section that gets appended to
 * the reviewer (LLM2) system prompt to give it architectural awareness.
 */

import type { StructuralContext, BlastRadius, SymbolContext, DeadSymbol } from "./axonTypes";
import type { DiffHunk } from "../review/hunkTypes";

/**
 * Generate structural context text for a specific hunk.
 * Filters the full structural context to symbols relevant to the hunk's file.
 */
export function formatHunkContext(
  structuralContext: StructuralContext,
  hunk: DiffHunk,
): string {
  const sections: string[] = [];

  // Find symbols relevant to this hunk
  const relevantSymbols = structuralContext.changedSymbols.filter(
    (sym) => sym.file === hunk.filePath || sym.file.endsWith(`/${hunk.filePath}`),
  );

  if (relevantSymbols.length === 0) {
    return "";
  }

  sections.push("## Structural Context (from code intelligence)\n");

  for (const sym of relevantSymbols) {
    // Impact analysis
    const impact = structuralContext.impactBySymbol.get(sym.name);
    if (impact && Object.keys(impact).length > 0) {
      sections.push(formatImpactSection(sym.name, impact));
    }

    // Symbol context
    const context = structuralContext.contextBySymbol.get(sym.name);
    if (context) {
      sections.push(formatContextSection(sym.name, context));
    }
  }

  // Dead code relevant to this file
  const deadInFile = structuralContext.deadCode.filter(
    (d) => d.file === hunk.filePath || d.file.endsWith(`/${hunk.filePath}`),
  );
  if (deadInFile.length > 0) {
    sections.push(formatDeadCodeSection(deadInFile));
  }

  return sections.join("\n");
}

/**
 * Generate a review-wide summary of structural context.
 * Used for the summary comment, not per-hunk.
 */
export function formatReviewSummary(structuralContext: StructuralContext): string {
  const lines: string[] = [];

  lines.push(`**Code Intelligence Summary** (${structuralContext.indexStatus.symbols} symbols, ${structuralContext.indexStatus.edges} edges indexed)\n`);

  if (structuralContext.changedSymbols.length > 0) {
    lines.push(`- **${structuralContext.changedSymbols.length}** symbols modified in this PR`);
  }

  const totalImpacted = Array.from(structuralContext.impactBySymbol.values()).reduce(
    (total, br) => total + Object.values(br).reduce((sum, entries) => sum + entries.length, 0),
    0,
  );
  if (totalImpacted > 0) {
    lines.push(`- **${totalImpacted}** symbols in blast radius`);
  }

  if (structuralContext.deadCode.length > 0) {
    lines.push(`- **${structuralContext.deadCode.length}** potential dead code symbols detected`);
  }

  return lines.join("\n");
}

// ── Internal formatters ──

function formatImpactSection(symbolName: string, impact: BlastRadius): string {
  const lines: string[] = [];
  lines.push(`### Impact Analysis: \`${symbolName}\``);

  for (const [depth, entries] of Object.entries(impact)) {
    if (entries.length === 0) continue;
    const label = depth.replace("_", " ").replace("depth ", "Depth ");
    lines.push(`- **${label}** (${entries.length} symbols):`);
    for (const entry of entries.slice(0, 5)) {
      const confidence = entry.confidence ? ` (confidence: ${entry.confidence})` : "";
      lines.push(`  - \`${entry.name}\` in ${entry.file}${confidence}`);
    }
    if (entries.length > 5) {
      lines.push(`  - ... and ${entries.length - 5} more`);
    }
  }

  return lines.join("\n");
}

function formatContextSection(symbolName: string, context: SymbolContext): string {
  const lines: string[] = [];

  if (context.callers.length > 0) {
    lines.push(`### Callers of \`${symbolName}\``);
    for (const caller of context.callers.slice(0, 5)) {
      lines.push(`- \`${caller.name}\`${caller.file ? ` in ${caller.file}` : ""}`);
    }
    if (context.callers.length > 5) {
      lines.push(`- ... and ${context.callers.length - 5} more`);
    }
  }

  if (context.callees.length > 0) {
    lines.push(`### Callees of \`${symbolName}\``);
    for (const callee of context.callees.slice(0, 5)) {
      lines.push(`- \`${callee.name}\`${callee.file ? ` in ${callee.file}` : ""}`);
    }
  }

  if (context.community) {
    lines.push(`### Module: ${context.community.name} (community #${context.community.id})`);
  }

  return lines.join("\n");
}

function formatDeadCodeSection(deadSymbols: DeadSymbol[]): string {
  const lines: string[] = [];
  lines.push("### Dead Code Warning");
  for (const sym of deadSymbols.slice(0, 10)) {
    lines.push(`- \`${sym.name}\` (${sym.type}) in ${sym.file} — appears unreachable`);
  }
  if (deadSymbols.length > 10) {
    lines.push(`- ... and ${deadSymbols.length - 10} more`);
  }
  return lines.join("\n");
}
