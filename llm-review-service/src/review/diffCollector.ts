import type { AdoClient } from "../azure/adoClient";
import type { ReviewLimits } from "./limits";
import type { DiffHunk } from "./hunkTypes";

export async function collectDiffHunks(_args: {
  ado: AdoClient;
  repoId: string;
  prId: number;
  changedFilePaths: string[];
  limits: ReviewLimits;
}): Promise<DiffHunk[]> {
  throw new Error("Not implemented");
}

