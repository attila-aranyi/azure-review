import type { Config } from "../config";

export type ReviewLimits = {
  maxFiles: number;
  maxTotalDiffLines: number;
  maxHunks: number;
  hunkContextLines: number;
};

export function limitsFromConfig(config: Config): ReviewLimits {
  return {
    maxFiles: config.MAX_FILES,
    maxTotalDiffLines: config.MAX_TOTAL_DIFF_LINES,
    maxHunks: config.MAX_HUNKS,
    hunkContextLines: config.HUNK_CONTEXT_LINES
  };
}

