import type { Config } from "../config";

export async function runReview(_args: { config: Config; repoId: string; prId: number }): Promise<void> {
  throw new Error("Not implemented");
}

