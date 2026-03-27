import { eq, and, gte, lte } from "drizzle-orm";
import type { DrizzleInstance } from "../connection";
import { reviews, reviewFindings } from "../schema";

export type AuditExportRow = {
  reviewId: string;
  repoId: string;
  prId: number;
  reviewStatus: string;
  reviewCreatedAt: Date;
  reviewCompletedAt: Date | null;
  findingId: string | null;
  issueType: string | null;
  severity: string | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  message: string | null;
  suggestion: string | null;
  findingStatus: string | null;
};

export interface AuditExportRepo {
  exportReviewsWithFindings(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<AuditExportRow[]>;
}

export function createAuditExportRepo(db: DrizzleInstance): AuditExportRepo {
  return {
    async exportReviewsWithFindings(tenantId, from, to) {
      const rows = await db
        .select({
          reviewId: reviews.id,
          repoId: reviews.repoId,
          prId: reviews.prId,
          reviewStatus: reviews.status,
          reviewCreatedAt: reviews.createdAt,
          reviewCompletedAt: reviews.completedAt,
          findingId: reviewFindings.id,
          issueType: reviewFindings.issueType,
          severity: reviewFindings.severity,
          filePath: reviewFindings.filePath,
          startLine: reviewFindings.startLine,
          endLine: reviewFindings.endLine,
          message: reviewFindings.message,
          suggestion: reviewFindings.suggestion,
          findingStatus: reviewFindings.status,
        })
        .from(reviews)
        .leftJoin(reviewFindings, eq(reviews.id, reviewFindings.reviewId))
        .where(
          and(
            eq(reviews.tenantId, tenantId),
            gte(reviews.createdAt, from),
            lte(reviews.createdAt, to),
          )
        )
        .orderBy(reviews.createdAt, reviewFindings.createdAt);

      return rows;
    },
  };
}
