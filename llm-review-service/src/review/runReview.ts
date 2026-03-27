import crypto from "node:crypto";
import path from "node:path";
import type { Config } from "../config";
import { AdoClient } from "../azure/adoClient";
import type { AdoPullRequest } from "../azure/adoTypes";
import { findingToAdoThread, visualFindingToAdoThread, buildStartingSummary, buildCompletedSummaryContent, buildErrorSummaryContent, buildStatusDescription } from "../azure/threadBuilder";
import type { FindingSummaryStats } from "../azure/threadBuilder";
import { createLLMClient } from "../llm/types";
import type { LLMClient, Finding } from "../llm/types";
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
import type { IdempotencyStore } from "./idempotency";
import { limitsFromConfig } from "./limits";
import type { ReviewLimits } from "./limits";
import { filterFindings } from "./severity";
import type { AuditStore, AuditRecord, AuditFinding, AuditHunkResult } from "./audit";
import type { TenantContext } from "../context/tenantContext";
import { AxonClient } from "../axon/axonClient";
import { enrichReview } from "../axon/contextEnricher";
import { formatHunkContext } from "../axon/promptInjector";
import type { StructuralContext } from "../axon/axonTypes";

async function safeAdoCall<T>(fn: () => Promise<T>, logger: ReturnType<typeof createLogger>, label: string): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err, label }, "Non-critical ADO call failed");
    return undefined;
  }
}

export async function runReview(_args: {
  config: Config;
  repoId: string;
  prId: number;
  requestId?: string;
  auditStore?: AuditStore;
  previewUrl?: string;
  context?: TenantContext;
  idempotencyStore?: IdempotencyStore;
}): Promise<void> {
  const { config, repoId, prId, requestId, previewUrl, context } = _args;

  // Resolve dependencies from TenantContext or legacy Config
  const logger = context?.logger.child({ repoId, prId, ...(requestId ? { requestId } : {}) })
    ?? createLogger().child({ repoId, prId, ...(requestId ? { requestId } : {}) });
  const ado = context?.adoClient ?? new AdoClient(config, logger);
  const llm1: LLMClient = context?.llmClients.llm1 ?? createLLMClient(config, "llm1");
  const llm2: LLMClient = context?.llmClients.llm2 ?? createLLMClient(config, "llm2");

  const llm3Enabled = context
    ? !!context.llmClients.llm3
    : config.LLM3_ENABLED === true && !!config.LLM3_PROVIDER;
  const llm3: LLMClient | null = context?.llmClients.llm3 ?? (llm3Enabled ? createLLMClient(config, "llm3") : null);
  const a11yExtensions: string[] = context?.config.a11yFileExtensions
    ?? config.A11Y_FILE_EXTENSIONS
    ?? [".html", ".jsx", ".tsx", ".vue", ".svelte", ".css", ".scss"];

  logger.debug({ stage: "llm1", provider: llm1.providerName, model: llm1.modelName }, "LLM client");
  logger.debug({ stage: "llm2", provider: llm2.providerName, model: llm2.modelName }, "LLM client");
  if (llm3) {
    logger.debug({ stage: "llm3", provider: llm3.providerName, model: llm3.modelName }, "LLM client");
  }

  const idempotency: IdempotencyStore = _args.idempotencyStore
    ?? await createFileIdempotencyStore({ dataDir: path.join(process.cwd(), ".data") }).catch(() => createInMemoryIdempotencyStore());

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

  const statusContext = { name: "marvin-code-review", genre: "llm-review" };
  let summaryThreadId: number | undefined;
  let summaryCommentId: number | undefined;

  try {
    // ── Post initial status + summary comment ──
    await safeAdoCall(
      () => ado.createPullRequestStatus(repoId, prId, {
        state: "pending",
        description: buildStatusDescription("pending"),
        context: statusContext,
      }),
      logger,
      "post-pending-status"
    );

    const summaryThread = await safeAdoCall(
      () => ado.createPullRequestThread(repoId, prId, buildStartingSummary()),
      logger,
      "post-summary-thread"
    );
    summaryThreadId = summaryThread?.id;
    summaryCommentId = summaryThread?.comments?.[0]?.id;

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
        limits: context
          ? { maxFiles: context.config.maxFiles, maxTotalDiffLines: context.config.maxDiffSize, maxHunks: context.config.maxHunks, hunkContextLines: context.config.hunkContextLines } as ReviewLimits
          : limitsFromConfig(config),
      })
    );
    hunks = hunksResult;
    auditTimings.collectDiffsMs = diffMs;
    logger.info({ hunks: hunks.length, diffMs }, "Collected diff hunks");

    const minSeverity = (context?.config.minSeverity ?? config.REVIEW_MIN_SEVERITY ?? "low") as "low" | "medium" | "high" | "critical";
    const strictness = (context?.config.reviewStrictness ?? config.REVIEW_STRICTNESS ?? "balanced") as "relaxed" | "balanced" | "strict";

    // ── Axon code intelligence (optional) ──
    let structuralContext: StructuralContext | null = null;
    const axonEnabled = context?.config.enableAxon && config.AXON_ENABLED !== false;
    const axonUrl = process.env.AXON_SIDECAR_URL;

    if (axonEnabled && axonUrl && pr) {
      logger.info("Running Axon code intelligence enrichment");
      try {
        const axonClient = new AxonClient({ baseUrl: axonUrl, logger: logger as never });
        const adoOrgUrl = context?.orgUrl ?? `https://dev.azure.com/${config.ADO_ORG}`;
        const adoProject = config.ADO_PROJECT ?? "";
        const cloneUrl = `${adoOrgUrl}/${adoProject}/_git/${repoId}`;
        const targetBranch = pr.targetRefName?.replace("refs/heads/", "") ?? "main";
        const fullDiff = hunks.map((h) => h.hunkText).join("\n");
        const accessToken = config.ADO_PAT ?? "";

        const { result: enrichResult, ms: axonMs } = await withTiming("axon-enrich", () =>
          enrichReview(axonClient, {
            tenantId: context?.tenantId ?? "default",
            repoId,
            cloneUrl,
            accessToken,
            targetBranch,
            diff: fullDiff,
            logger,
          })
        );

        structuralContext = enrichResult;
        if (structuralContext) {
          logger.info(
            { axonMs, changedSymbols: structuralContext.changedSymbols.length, deadCode: structuralContext.deadCode.length },
            "Axon enrichment complete"
          );
        } else {
          logger.info({ axonMs }, "Axon enrichment returned no data");
        }
      } catch (err) {
        logger.warn({ err }, "Axon enrichment failed, proceeding without structural context");
      }
    }

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
            tokenBudget: context?.config.tokenBudgetLlm1 ?? config.TOKEN_BUDGET_LLM1
          },
          timeoutMs: 60_000
        })
      );

      let contextBundleText =
        pre.selected.length === 0
          ? hunk.localContext
          : pre.selected
              .map((s) => `### ${s.source}:${s.id}\n${s.text}`)
              .join("\n\n")
              .trim();

      // Inject Axon structural context for this hunk
      if (structuralContext) {
        const hunkAxonContext = formatHunkContext(structuralContext, hunk);
        if (hunkAxonContext) {
          contextBundleText = `${contextBundleText}\n\n${hunkAxonContext}`;
        }
      }

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
    const llm4Enabled = context
      ? !!context.llmClients.llm4
      : config.LLM4_ENABLED === true && !!config.LLM4_PROVIDER;
    if (llm4Enabled && previewUrl) {
      const llm4 = context?.llmClients.llm4 ?? createLLMClient(config, "llm4");
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

        const thread = visualFindingToAdoThread(finding);
        const { ms: postMs } = await withTiming("postVisualThread", () =>
          ado.createPullRequestThread(repoId, prId, thread)
        );
        await idempotency.put(key);
        logger.info({ findingHash, postMs }, "Published visual a11y finding");

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

    // ── Update summary + status on success ──
    const summaryStats: FindingSummaryStats = {
      totalFindings: auditFindings.length,
      publishedFindings: auditFindings.filter((f) => f.status === "posted").length,
      skippedDuplicates: auditFindings.filter((f) => f.status === "skipped_duplicate").length,
      filteredBelowMinSeverity: auditFindings.filter((f) => f.status === "filtered").length,
      bySeverity: {},
      byIssueType: {},
    };
    for (const f of auditFindings.filter((f) => f.status === "posted")) {
      summaryStats.bySeverity[f.severity] = (summaryStats.bySeverity[f.severity] ?? 0) + 1;
      summaryStats.byIssueType[f.issueType] = (summaryStats.byIssueType[f.issueType] ?? 0) + 1;
    }

    if (summaryThreadId != null && summaryCommentId != null) {
      await safeAdoCall(
        () => ado.updateThreadComment(repoId, prId, summaryThreadId!, summaryCommentId!, {
          content: buildCompletedSummaryContent(summaryStats),
        }),
        logger,
        "update-summary-completed"
      );
    }

    await safeAdoCall(
      () => ado.createPullRequestStatus(repoId, prId, {
        state: "succeeded",
        description: buildStatusDescription("succeeded", summaryStats.publishedFindings),
        context: statusContext,
      }),
      logger,
      "post-succeeded-status"
    );
  } catch (err) {
    reviewStatus = "failure";
    reviewError = err instanceof Error ? err.message : String(err);

    // ── Update summary + status on error ──
    if (summaryThreadId != null && summaryCommentId != null) {
      await safeAdoCall(
        () => ado.updateThreadComment(repoId, prId, summaryThreadId!, summaryCommentId!, {
          content: buildErrorSummaryContent(reviewError),
        }),
        logger,
        "update-summary-error"
      );
    }

    await safeAdoCall(
      () => ado.createPullRequestStatus(repoId, prId, {
        state: "failed",
        description: buildStatusDescription("failed"),
        context: statusContext,
      }),
      logger,
      "post-failed-status"
    );

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
