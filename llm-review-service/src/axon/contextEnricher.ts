/**
 * Orchestrates axon queries to build structural context for a review.
 *
 * Steps:
 * 1. Ensure repo is indexed (index or reindex)
 * 2. Detect changed symbols from the diff
 * 3. Get impact analysis for each changed symbol
 * 4. Get full context for key symbols
 * 5. Detect dead code
 */

import type { Logger } from "pino";
import type { AxonClient } from "./axonClient";
import type {
  StructuralContext,
  BlastRadius,
  SymbolContext,
  ChangedSymbol,
  IndexResult,
} from "./axonTypes";

export interface EnrichReviewOpts {
  tenantId: string;
  repoId: string;
  cloneUrl: string;
  accessToken: string;
  targetBranch: string;
  diff: string;
  logger: Logger;
  /** Max symbols to query for impact/context (controls API calls) */
  maxSymbolQueries?: number;
}

const DEFAULT_MAX_SYMBOL_QUERIES = 20;

/**
 * Enrich a review with structural context from axon.
 * Returns null if axon is unavailable or indexing fails.
 */
export async function enrichReview(
  client: AxonClient,
  opts: EnrichReviewOpts,
): Promise<StructuralContext | null> {
  const { tenantId, repoId, cloneUrl, accessToken, targetBranch, diff, logger } = opts;
  const maxQueries = opts.maxSymbolQueries ?? DEFAULT_MAX_SYMBOL_QUERIES;

  // Step 1: Check if healthy
  const healthy = await client.isHealthy();
  if (!healthy) {
    logger.info("Axon sidecar not available, skipping enrichment");
    return null;
  }

  // Step 2: Ensure indexed
  const status = await client.getStatus(tenantId, repoId);
  let indexResult: IndexResult | null;

  if (status?.indexed) {
    // Reindex for latest changes
    indexResult = await client.reindexRepo(tenantId, repoId, accessToken, targetBranch);
  } else {
    // First time: full index
    indexResult = await client.indexRepo(tenantId, repoId, cloneUrl, accessToken, targetBranch);
  }

  if (!indexResult || indexResult.status === "failed") {
    logger.warn({ error: indexResult?.error }, "Axon indexing failed, proceeding without structural context");
    return null;
  }

  logger.info(
    { symbols: indexResult.symbols, edges: indexResult.edges, duration_ms: indexResult.duration_ms },
    "Axon index ready",
  );

  // Step 3: Detect changed symbols
  const changesResult = await client.detectChanges(tenantId, repoId, diff);
  const changedSymbols: ChangedSymbol[] = changesResult?.changed_symbols ?? [];

  if (changedSymbols.length === 0) {
    logger.info("No changed symbols detected by axon");
    return {
      changedSymbols: [],
      impactBySymbol: new Map(),
      contextBySymbol: new Map(),
      deadCode: [],
      indexStatus: indexResult,
    };
  }

  logger.info({ changedSymbolCount: changedSymbols.length }, "Detected changed symbols");

  // Step 4: Get impact + context for top symbols (bounded)
  const symbolsToQuery = changedSymbols.slice(0, maxQueries);
  const impactBySymbol = new Map<string, BlastRadius>();
  const contextBySymbol = new Map<string, SymbolContext>();

  // Query in parallel for speed
  await Promise.all(
    symbolsToQuery.map(async (sym) => {
      const [impact, context] = await Promise.all([
        client.getImpact(tenantId, repoId, sym.name),
        client.getContext(tenantId, repoId, sym.name),
      ]);

      if (impact?.blast_radius) {
        impactBySymbol.set(sym.name, impact.blast_radius);
      }
      if (context) {
        contextBySymbol.set(sym.name, context);
      }
    }),
  );

  // Step 5: Detect dead code
  const deadCodeResult = await client.getDeadCode(tenantId, repoId);
  const deadCode = deadCodeResult?.dead_symbols ?? [];

  logger.info(
    {
      changedSymbols: changedSymbols.length,
      impactQueried: impactBySymbol.size,
      contextQueried: contextBySymbol.size,
      deadCodeFound: deadCode.length,
    },
    "Axon enrichment complete",
  );

  return {
    changedSymbols,
    impactBySymbol,
    contextBySymbol,
    deadCode,
    indexStatus: indexResult,
  };
}
