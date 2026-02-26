import crypto from "node:crypto";
import path from "node:path";
import type { Config } from "../config";
import { AdoClient } from "../azure/adoClient";
import type { AdoPullRequest } from "../azure/adoTypes";
import { findingToAdoThread, visualFindingToAdoThread } from "../azure/threadBuilder";
import { createLLMClient } from "../llm/types";
import type { Finding } from "../llm/types";
import { runPreprocessor } from "../llm/preprocessor";
import { runReviewer } from "../llm/reviewer";
import { runAccessibilityCheck } from "../llm/accessibilityChecker";
import { runVisualAccessibilityCheck } from "../llm/visualAccessibilityChecker";
import { createLogger } from "../logger";
import { sha256Hex } from "../util/hash";
import { withTiming } from "../util/timing";
import { collectDiffHunks } from "./diffCollector";
import type { DiffHunk } from "./hunkTypes";
import { createFileIdempotencyStore, createInMemoryIdempotencyStore } from "./idempotency";
import { limitsFromConfig } from "./limits";
import { filterFindings } from "./severity";
import type { AuditStore, AuditRecord, AuditFinding, AuditHunkResult } from "./audit";

export async function runReview(_args: {
  config: Config;
  repoId: string;
  prId: number;
  requestId?: string;
  auditStore?: AuditStore;
  previewUrl?: string;
}): Promise<void> {
  const { config, repoId, prId, requestId, previewUrl } = _args;
  const logger = createLogger().child({ repoId, prId, ...(requestId ? { requestId } : {}) });
  const ado = new AdoClient(config, logger);
  const llm1 = createLLMClient(config, "llm1");
  const llm2 = createLLMClient(config, "llm2");

  const llm3Enabled = config.LLM3_ENABLED === true && !!config.LLM3_PROVIDER;
  const llm3 = llm3Enabled ? createLLMClient(config, "llm3") : null;
  const a11yExtensions: string[] = config.A11Y_FILE_EXTENSIONS ?? [".html", ".jsx", ".tsx", ".vue", ".svelte", ".css", ".scss"];

  logger.debug({ stage: "llm1", provider: llm1.providerName, model: llm1.modelName }, "LLM client");
  logger.debug({ stage: "llm2", provider: llm2.providerName, model: llm2.modelName }, "LLM client");
  if (llm3) {
    logger.debug({ stage: "llm3", provider: llm3.providerName, model: llm3.modelName }, "LLM client");
  }

  const idempotency = await createFileIdempotencyStore({
    dataDir: path.join(process.cwd(), ".data")
  }).catch(() => createInMemoryIdempotencyStore());

  // ── Audit state ──
  const startedAt = new Date().toISOString();
  const reviewStartMs = Date.now();
  let reviewStatus: "success" | "failure" = "success";
  let reviewError: string | undefined;
  const auditTimings = { totalMs: 0, fetchPrMs: 0, listChangesMs: 0, collectDiffsMs: 0 };
  const auditHunkResults: AuditHunkResult[] = [];
  const auditFindings: AuditFinding[] = [];

  let pr: AdoPullRequest | undefined;
  let changedFilePaths: string[] = [];
  let hunks: DiffHunk[] = [];

  try {
    logger.info("Review start");

    const { result: prResult, ms: prMs } = await withTiming("fetchPR", () =>
      ado.getPullRequest(repoId, prId)
    );
    pr = prResult;
    auditTimings.fetchPrMs = prMs;

    const { result: changedResult, ms: changesMs } = await withTiming("listChanges", () =>
      ado.listPullRequestChanges(repoId, prId)
    );
    changedFilePaths = changedResult;
    auditTimings.listChangesMs = changesMs;
    logger.info({ changedFiles: changedFilePaths.length, prMs, changesMs }, "Fetched PR changes");

    const { result: hunksResult, ms: diffMs } = await withTiming("collectDiffs", () =>
      collectDiffHunks({
        ado,
        repoId,
        pr: pr!,
        changedFilePaths,
        limits: limitsFromConfig(config)
      })
    );
    hunks = hunksResult;
    auditTimings.collectDiffsMs = diffMs;
    logger.info({ hunks: hunks.length, diffMs }, "Collected diff hunks");

    const minSeverity = config.REVIEW_MIN_SEVERITY ?? "low";
    const strictness = config.REVIEW_STRICTNESS ?? "balanced";

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
          strictness,
          timeoutMs: 90_000
        })
      );

      logger.info(
        { file: hunk.filePath, startLine: hunk.startLine, llm1Ms, llm2Ms, findings: review.findings.length },
        "Hunk reviewed"
      );

      const allFindings: Finding[] = [...review.findings];

      let llm3Result: { provider: string; model: string; ms: number } | undefined;
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
            strictness,
            timeoutMs: 60_000
          })
        );
        logger.info(
          { file: hunk.filePath, startLine: hunk.startLine, llm3Ms, a11yFindings: a11y.findings.length },
          "Accessibility check done"
        );
        allFindings.push(...a11y.findings);
        llm3Result = { provider: llm3.providerName, model: llm3.modelName, ms: llm3Ms };
      }

      const { passed: passedFindings, filtered: filteredByMinSev } = filterFindings(allFindings, minSeverity);

      auditHunkResults.push({
        filePath: hunk.filePath,
        startLine: hunk.startLine,
        endLine: hunk.endLine,
        llm1: { provider: llm1.providerName, model: llm1.modelName, ms: llm1Ms },
        llm2: { provider: llm2.providerName, model: llm2.modelName, ms: llm2Ms },
        ...(llm3Result ? { llm3: llm3Result } : {}),
        findingsCount: allFindings.length,
      });

      for (const finding of filteredByMinSev) {
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
        auditFindings.push({
          issueType: finding.issueType,
          severity: finding.severity,
          filePath: finding.filePath,
          startLine: finding.startLine,
          endLine: finding.endLine,
          message: finding.message,
          suggestion: finding.suggestion,
          findingHash,
          status: "filtered",
        });
      }

      for (const finding of passedFindings) {
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

        logger.debug(
          {
            findingHash,
            severity: finding.severity,
            issueType: finding.issueType,
            filePath: finding.filePath,
            lines: `${finding.startLine}-${finding.endLine}`,
            message: finding.message.slice(0, 200),
          },
          "Finding detail"
        );

        const key = { repoId, prId, iteration, findingHash };
        const isDuplicate = await idempotency.has(key);
        if (isDuplicate) {
          skippedFindings++;
          auditFindings.push({
            issueType: finding.issueType,
            severity: finding.severity,
            filePath: finding.filePath,
            startLine: finding.startLine,
            endLine: finding.endLine,
            message: finding.message,
            suggestion: finding.suggestion,
            findingHash,
            status: "skipped_duplicate",
          });
          continue;
        }

        const { ms: postMs } = await withTiming("postThread", async () => {
          const thread = findingToAdoThread(finding);
          await ado.createPullRequestThread(repoId, prId, thread);
        });
        await idempotency.put(key);
        logger.info({ findingHash, postMs }, "Published finding");

        auditFindings.push({
          issueType: finding.issueType,
          severity: finding.severity,
          filePath: finding.filePath,
          startLine: finding.startLine,
          endLine: finding.endLine,
          message: finding.message,
          suggestion: finding.suggestion,
          findingHash,
          status: "posted",
          postMs,
        });
      }
    }

    const filteredCount = auditFindings.filter((f) => f.status === "filtered").length;
    logger.info({ totalFindings, skippedFindings, filteredCount, published: totalFindings - skippedFindings - filteredCount }, "Review done");

    // ── LLM4: Visual Accessibility ──
    const llm4Enabled = config.LLM4_ENABLED === true && !!config.LLM4_PROVIDER;
    if (llm4Enabled && previewUrl) {
      const llm4 = createLLMClient(config, "llm4");
      logger.info({ previewUrl }, "Starting visual accessibility check");

      const { result: visualResult, ms: llm4Ms } = await withTiming(
        "llm4-visual-a11y",
        () => runVisualAccessibilityCheck({
          client: llm4,
          config,
          previewUrl,
          changedFiles: changedFilePaths,
          logger,
        })
      );

      const { findings: visualFindings, screenshots } = visualResult;

      logger.info({
        screenshots: screenshots.length,
        visualFindings: visualFindings.length,
        llm4Ms,
      }, "Visual accessibility check done");

      for (const finding of visualFindings) {
        totalFindings++;
        const findingHash = sha256Hex(JSON.stringify({
          issueType: finding.issueType,
          severity: finding.severity,
          message: finding.message,
          pageUrl: finding.pageUrl ?? "",
        }));

        const key = { repoId, prId, iteration, findingHash };
        if (await idempotency.has(key)) {
          skippedFindings++;
          continue;
        }

        const thread = visualFindingToAdoThread(finding);
        const { ms: postMs } = await withTiming("postVisualThread", () =>
          ado.createPullRequestThread(repoId, prId, thread)
        );
        await idempotency.put(key);
        logger.info({ findingHash, postMs }, "Published visual a11y finding");
      }
    }
  } catch (err) {
    reviewStatus = "failure";
    reviewError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    auditTimings.totalMs = Date.now() - reviewStartMs;

    if (_args.auditStore) {
      const record: AuditRecord = {
        id: crypto.randomUUID(),
        requestId,
        repoId,
        prId,
        sourceCommit: pr?.lastMergeSourceCommit?.commitId,
        targetCommit: pr?.lastMergeTargetCommit?.commitId,
        changedFiles: changedFilePaths,
        hunksProcessed: hunks.length,
        hunkResults: auditHunkResults,
        findings: auditFindings,
        timings: auditTimings,
        status: reviewStatus,
        error: reviewError,
        startedAt,
        completedAt: new Date().toISOString(),
      };

      await _args.auditStore.append(record).catch((appendErr) => {
        logger.warn({ err: appendErr }, "Failed to persist audit record");
      });
    }
  }
}
