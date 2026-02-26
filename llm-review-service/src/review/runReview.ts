import path from "node:path";
import type { Config } from "../config";
import { AdoClient } from "../azure/adoClient";
import { findingToAdoThread } from "../azure/threadBuilder";
import { createLLMClient } from "../llm/types";
import type { Finding } from "../llm/types";
import { runPreprocessor } from "../llm/preprocessor";
import { runReviewer } from "../llm/reviewer";
import { runAccessibilityCheck } from "../llm/accessibilityChecker";
import { createLogger } from "../logger";
import { sha256Hex } from "../util/hash";
import { withTiming } from "../util/timing";
import { collectDiffHunks } from "./diffCollector";
import { createFileIdempotencyStore, createInMemoryIdempotencyStore } from "./idempotency";
import { limitsFromConfig } from "./limits";

export async function runReview(_args: {
  config: Config;
  repoId: string;
  prId: number;
  requestId?: string;
}): Promise<void> {
  const { config, repoId, prId, requestId } = _args;
  const logger = createLogger().child({ repoId, prId, ...(requestId ? { requestId } : {}) });
  const ado = new AdoClient(config);
  const llm1 = createLLMClient(config, "llm1");
  const llm2 = createLLMClient(config, "llm2");

  const llm3Enabled = config.LLM3_ENABLED === true && !!config.LLM3_PROVIDER;
  const llm3 = llm3Enabled ? createLLMClient(config, "llm3") : null;
  const a11yExtensions: string[] = config.A11Y_FILE_EXTENSIONS ?? [".html", ".jsx", ".tsx", ".vue", ".svelte", ".css", ".scss"];

  const idempotency = await createFileIdempotencyStore({
    dataDir: path.join(process.cwd(), ".data")
  }).catch(() => createInMemoryIdempotencyStore());

  logger.info("Review start");

  const { result: pr, ms: prMs } = await withTiming("fetchPR", () =>
    ado.getPullRequest(repoId, prId)
  );
  const { result: changedFilePaths, ms: changesMs } = await withTiming("listChanges", () =>
    ado.listPullRequestChanges(repoId, prId)
  );
  logger.info({ changedFiles: changedFilePaths.length, prMs, changesMs }, "Fetched PR changes");

  const { result: hunks, ms: diffMs } = await withTiming("collectDiffs", () =>
    collectDiffHunks({
      ado,
      repoId,
      pr,
      changedFilePaths,
      limits: limitsFromConfig(config)
    })
  );
  logger.info({ hunks: hunks.length, diffMs }, "Collected diff hunks");

  const iteration = pr.lastMergeSourceCommit?.commitId;
  const codingStandardsText = [
    "Be precise and actionable.",
    "Prefer safe, maintainable changes.",
    "Call out security issues explicitly.",
    "Avoid noisy style-only comments unless important."
  ].join("\n");

  let totalFindings = 0;
  let skippedFindings = 0;

  for (const hunk of hunks) {
    const { result: pre, ms: llm1Ms } = await withTiming("llm1-preprocessor", () =>
      runPreprocessor({
        client: llm1,
        input: {
          hunkText: hunk.hunkText,
          localContext: hunk.localContext,
          candidates: [],
          tokenBudget: config.TOKEN_BUDGET_LLM1
        },
        timeoutMs: 60_000
      })
    );

    const contextBundleText =
      pre.selected.length === 0
        ? hunk.localContext
        : pre.selected
            .map((s) => `### ${s.source}:${s.id}\n${s.text}`)
            .join("\n\n")
            .trim();

    const { result: review, ms: llm2Ms } = await withTiming("llm2-reviewer", () =>
      runReviewer({
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
      })
    );

    logger.info(
      { file: hunk.filePath, startLine: hunk.startLine, llm1Ms, llm2Ms, findings: review.findings.length },
      "Hunk reviewed"
    );

    const allFindings: Finding[] = [...review.findings];

    if (llm3 && a11yExtensions.some((ext) => hunk.filePath.endsWith(ext))) {
      const { result: a11y, ms: llm3Ms } = await withTiming("llm3-accessibility", () =>
        runAccessibilityCheck({
          client: llm3,
          input: {
            filePath: hunk.filePath,
            hunkStartLine: hunk.startLine,
            hunkEndLine: hunk.endLine,
            hunkText: hunk.hunkText,
            localContext: hunk.localContext
          },
          timeoutMs: 60_000
        })
      );
      logger.info(
        { file: hunk.filePath, startLine: hunk.startLine, llm3Ms, a11yFindings: a11y.findings.length },
        "Accessibility check done"
      );
      allFindings.push(...a11y.findings);
    }

    for (const finding of allFindings) {
      totalFindings++;
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
      if (await idempotency.has(key)) {
        skippedFindings++;
        continue;
      }

      const { ms: postMs } = await withTiming("postThread", async () => {
        const thread = findingToAdoThread(finding);
        await ado.createPullRequestThread(repoId, prId, thread);
      });
      await idempotency.put(key);
      logger.info({ findingHash, postMs }, "Published finding");
    }
  }

  logger.info({ totalFindings, skippedFindings, published: totalFindings - skippedFindings }, "Review done");
}
