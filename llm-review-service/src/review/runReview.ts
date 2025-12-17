import path from "node:path";
import type { Config } from "../config";
import { AdoClient } from "../azure/adoClient";
import { findingToAdoThread } from "../azure/threadBuilder";
import { createLLMClient } from "../llm/types";
import { runPreprocessor } from "../llm/preprocessor";
import { runReviewer } from "../llm/reviewer";
import { createLogger } from "../logger";
import { sha256Hex } from "../util/hash";
import { collectDiffHunks } from "./diffCollector";
import { createFileIdempotencyStore, createInMemoryIdempotencyStore } from "./idempotency";
import { limitsFromConfig } from "./limits";

export async function runReview(_args: { config: Config; repoId: string; prId: number }): Promise<void> {
  const { config, repoId, prId } = _args;
  const logger = createLogger().child({ repoId, prId });
  const ado = new AdoClient(config);
  const llm1 = createLLMClient(config, "llm1");
  const llm2 = createLLMClient(config, "llm2");

  const idempotency = await createFileIdempotencyStore({
    dataDir: path.join(process.cwd(), ".data")
  }).catch(() => createInMemoryIdempotencyStore());

  logger.info("Review start");

  const pr = await ado.getPullRequest(repoId, prId);
  const changedFilePaths = await ado.listPullRequestChanges(repoId, prId);
  logger.info({ changedFiles: changedFilePaths.length }, "Fetched PR changes");

  const hunks = await collectDiffHunks({
    ado,
    repoId,
    pr,
    changedFilePaths,
    limits: limitsFromConfig(config)
  });
  logger.info({ hunks: hunks.length }, "Collected diff hunks");

  const iteration = pr.lastMergeSourceCommit?.commitId;
  const codingStandardsText = [
    "Be precise and actionable.",
    "Prefer safe, maintainable changes.",
    "Call out security issues explicitly.",
    "Avoid noisy style-only comments unless important."
  ].join("\n");

  for (const hunk of hunks) {
    const pre = await runPreprocessor({
      client: llm1,
      input: {
        hunkText: hunk.hunkText,
        localContext: hunk.localContext,
        candidates: [],
        tokenBudget: config.TOKEN_BUDGET_LLM1
      },
      timeoutMs: 60_000
    });

    const contextBundleText =
      pre.selected.length === 0
        ? hunk.localContext
        : pre.selected
            .map((s) => `### ${s.source}:${s.id}\n${s.text}`)
            .join("\n\n")
            .trim();

    const review = await runReviewer({
      client: llm2,
      input: {
        filePath: hunk.filePath,
        hunkStartLine: hunk.startLine,
        hunkEndLine: hunk.endLine,
        hunkText: hunk.hunkText,
        contextBundleText,
        codingStandardsText
      },
      timeoutMs: 90_000
    });

    for (const finding of review.findings) {
      const findingHash = sha256Hex(
        JSON.stringify({
          issueType: finding.issueType,
          severity: finding.severity,
          filePath: finding.filePath,
          startLine: finding.startLine,
          endLine: finding.endLine,
          message: finding.message,
          suggestion: finding.suggestion ?? ""
        })
      );

      const key = { repoId, prId, iteration, findingHash };
      if (await idempotency.has(key)) continue;

      const thread = findingToAdoThread(finding);
      await ado.createPullRequestThread(repoId, prId, thread);
      await idempotency.put(key);
      logger.info({ findingHash }, "Published finding");
    }
  }

  logger.info("Review done");
}
