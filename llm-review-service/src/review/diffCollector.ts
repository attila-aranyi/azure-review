import { structuredPatch } from "diff";
import type { AdoClient } from "../azure/adoClient";
import type { AdoPullRequest } from "../azure/adoTypes";
import type { ReviewLimits } from "./limits";
import type { DiffHunk } from "./hunkTypes";

export async function collectDiffHunks(_args: {
  ado: AdoClient;
  repoId: string;
  pr: AdoPullRequest;
  changedFilePaths: string[];
  limits: ReviewLimits;
}): Promise<DiffHunk[]> {
  const { ado, repoId, pr, changedFilePaths, limits } = _args;

  const sourceCommit = pr.lastMergeSourceCommit?.commitId;
  const targetCommit = pr.lastMergeTargetCommit?.commitId;
  if (!sourceCommit || !targetCommit) {
    throw new Error("Pull request is missing commit ids (lastMergeSourceCommit/lastMergeTargetCommit)");
  }

  const maxFileChars = 200_000;
  const hunks: DiffHunk[] = [];
  let totalDiffLines = 0;

  const limitedPaths = changedFilePaths.slice(0, limits.maxFiles);
  for (const filePath of limitedPaths) {
    if (hunks.length >= limits.maxHunks) break;
    if (totalDiffLines >= limits.maxTotalDiffLines) break;

    const before = await ado
      .getItemContent(repoId, filePath, { version: targetCommit, versionType: "commit" })
      .catch(() => "");
    const after = await ado
      .getItemContent(repoId, filePath, { version: sourceCommit, versionType: "commit" })
      .catch(() => undefined);

    if (typeof after !== "string") continue;
    if (before.length > maxFileChars || after.length > maxFileChars) continue;
    if (before.includes("\u0000") || after.includes("\u0000")) continue;

    const patch = structuredPatch(filePath, filePath, before, after, "", "", { context: 3 });

    const afterLines = after.split(/\r?\n/);
    for (const hunk of patch.hunks) {
      if (hunks.length >= limits.maxHunks) break;
      if (totalDiffLines >= limits.maxTotalDiffLines) break;
      if (hunk.newLines <= 0) continue;

      const startLine = hunk.newStart;
      const endLine = hunk.newStart + hunk.newLines - 1;

      const contextStartLine = Math.max(1, startLine - limits.hunkContextLines);
      const contextEndLine = Math.min(afterLines.length, endLine + limits.hunkContextLines);
      const localContext = afterLines
        .slice(contextStartLine - 1, contextEndLine)
        .map((line, idx) => {
          const lineNumber = contextStartLine + idx;
          return `${lineNumber.toString().padStart(5, " ")} | ${line}`;
        })
        .join("\n");

      const hunkText = [
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        ...hunk.lines
      ].join("\n");

      const diffLineCount = hunk.lines.length + 1;
      if (totalDiffLines + diffLineCount > limits.maxTotalDiffLines) break;
      totalDiffLines += diffLineCount;

      hunks.push({
        filePath,
        startLine,
        endLine,
        hunkText,
        localContext
      });
    }
  }

  return hunks;
}
