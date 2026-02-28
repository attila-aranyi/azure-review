import { eq, and, inArray } from "drizzle-orm";
import type { DrizzleInstance } from "../db/connection";
import { reviewFindings, reviews } from "../db/schema";
import type { AdoClient } from "../azure/adoClient";
import type { Logger } from "pino";

export interface AutoResolveResult {
  resolvedCount: number;
  resolvedHashes: string[];
}

/**
 * Auto-resolve old findings that are no longer present in the new review.
 * Finds previous findings for the same repo/PR that have ADO thread IDs,
 * checks if their finding hash exists in the new review's findings, and
 * marks absent ones as "resolved" by updating the thread status in ADO.
 */
export async function autoResolveOldFindings(opts: {
  db: DrizzleInstance;
  adoClient: AdoClient;
  tenantId: string;
  repoId: string;
  prId: number;
  currentFindingHashes: Set<string>;
  logger: Logger;
}): Promise<AutoResolveResult> {
  const { db, adoClient, tenantId, repoId, prId, currentFindingHashes, logger } = opts;

  // Find all previous findings for this PR that were posted (have thread IDs)
  const previousReviews = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(
      and(
        eq(reviews.tenantId, tenantId),
        eq(reviews.repoId, repoId),
        eq(reviews.prId, prId),
        eq(reviews.status, "completed"),
      )
    );

  if (previousReviews.length === 0) {
    return { resolvedCount: 0, resolvedHashes: [] };
  }

  const reviewIds = previousReviews.map((r) => r.id);
  const previousFindings = await db
    .select()
    .from(reviewFindings)
    .where(
      and(
        inArray(reviewFindings.reviewId, reviewIds),
        eq(reviewFindings.status, "posted"),
      )
    );

  const resolvedHashes: string[] = [];

  for (const finding of previousFindings) {
    // If the finding hash is not in the current review, the issue was fixed
    if (!currentFindingHashes.has(finding.findingHash)) {
      if (finding.adoThreadId) {
        try {
          // Set thread status to "closed" (4) in ADO
          await adoClient.updateThreadComment(repoId, prId, finding.adoThreadId, 1, {
            content: "This issue appears to be resolved in the latest changes.",
          });
        } catch (err) {
          logger.warn({ err, findingHash: finding.findingHash, threadId: finding.adoThreadId }, "Failed to auto-resolve ADO thread");
          continue;
        }
      }

      // Update finding status in DB
      await db
        .update(reviewFindings)
        .set({ status: "resolved" })
        .where(eq(reviewFindings.id, finding.id));

      resolvedHashes.push(finding.findingHash);
    }
  }

  if (resolvedHashes.length > 0) {
    logger.info({ resolvedCount: resolvedHashes.length, prId, repoId }, "Auto-resolved old findings");
  }

  return { resolvedCount: resolvedHashes.length, resolvedHashes };
}
