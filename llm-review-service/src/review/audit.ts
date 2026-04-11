import fs from "node:fs/promises";
import path from "node:path";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { DrizzleInstance } from "../db/connection";
import { reviews, reviewFindings } from "../db/schema";
import { createUsageRepo } from "../db/repos/usageRepo";

export type AuditFinding = {
  issueType: string;
  severity: string;
  filePath: string;
  startLine: number;
  endLine: number;
  message: string;
  suggestion?: string;
  findingHash: string;
  status: "posted" | "skipped_duplicate" | "filtered";
  postMs?: number;
};

export type AuditHunkResult = {
  filePath: string;
  startLine: number;
  endLine: number;
  llm1: { provider: string; model: string; ms: number };
  llm2: { provider: string; model: string; ms: number };
  llm3?: { provider: string; model: string; ms: number };
  findingsCount: number;
};

export type AuditRecord = {
  id: string;
  requestId?: string;
  repoId: string;
  prId: number;
  sourceCommit?: string;
  targetCommit?: string;
  changedFiles: string[];
  hunksProcessed: number;
  hunkResults: AuditHunkResult[];
  findings: AuditFinding[];
  timings: {
    totalMs: number;
    fetchPrMs: number;
    listChangesMs: number;
    collectDiffsMs: number;
  };
  status: "success" | "failure";
  error?: string;
  startedAt: string;
  completedAt: string;
};

export interface AuditStore {
  append(record: AuditRecord): Promise<void>;
  query(filter: { repoId: string; prId?: number; limit?: number }): Promise<AuditRecord[]>;
}

export function createInMemoryAuditStore(opts?: {
  retentionDays?: number;
}): AuditStore {
  const retentionMs = (opts?.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
  const records: AuditRecord[] = [];

  function prune() {
    const cutoff = Date.now() - retentionMs;
    for (let i = records.length - 1; i >= 0; i--) {
      if (new Date(records[i].startedAt).getTime() <= cutoff) {
        records.splice(i, 1);
      }
    }
  }

  return {
    async append(record) {
      records.push(record);
    },
    async query(filter) {
      prune();
      const limit = filter.limit ?? 50;
      return records
        .filter(
          (r) =>
            r.repoId === filter.repoId &&
            (filter.prId === undefined || r.prId === filter.prId)
        )
        .slice(-limit)
        .reverse();
    },
  };
}

export function createDbAuditStore(
  db: DrizzleInstance,
  tenantId: string,
): AuditStore {

  return {
    async append(record) {
      await db.transaction(async (tx) => {
        const reviewRow = await tx.insert(reviews).values({
          tenantId,
          repoId: record.repoId,
          prId: record.prId,
          status: record.status === "success" ? "completed" : "failed",
          sourceCommit: record.sourceCommit,
          targetCommit: record.targetCommit,
          changedFiles: record.changedFiles,
          hunksProcessed: record.hunksProcessed,
          timings: record.timings,
          error: record.error,
          startedAt: new Date(record.startedAt),
          completedAt: new Date(record.completedAt),
        }).returning({ id: reviews.id });

        const reviewId = reviewRow[0].id;

        if (record.findings.length > 0) {
          await tx.insert(reviewFindings).values(
            record.findings.map((f) => ({
              reviewId,
              issueType: f.issueType,
              severity: f.severity,
              filePath: f.filePath,
              startLine: f.startLine,
              endLine: f.endLine,
              message: f.message,
              suggestion: f.suggestion,
              findingHash: f.findingHash,
              status: f.status,
            })),
          );
        }
      });

      // Record usage for KPI dashboard
      const postedFindings = record.findings.filter((f) => f.status === "posted").length;
      try {
        const usageRepo = createUsageRepo(db);
        await usageRepo.recordUsage(tenantId, {
          reviewCount: 1,
          findingsCount: postedFindings,
        });
      } catch {
        // Non-critical — don't fail the audit if usage recording fails
      }
    },

    async query(filter) {
      const conditions = [
        eq(reviews.tenantId, tenantId),
        eq(reviews.repoId, filter.repoId),
      ];
      if (filter.prId !== undefined) {
        conditions.push(eq(reviews.prId, filter.prId));
      }

      const limit = filter.limit ?? 50;
      const rows = await db
        .select()
        .from(reviews)
        .where(and(...conditions))
        .orderBy(desc(reviews.createdAt))
        .limit(limit);

      if (rows.length === 0) return [];

      // Batch-fetch all findings for returned reviews (HIGH-1: avoid N+1)
      const reviewIds = rows.map((r) => r.id);
      const allFindings = await db
        .select()
        .from(reviewFindings)
        .where(inArray(reviewFindings.reviewId, reviewIds));

      const findingsByReview = new Map<string, typeof allFindings>();
      for (const f of allFindings) {
        const list = findingsByReview.get(f.reviewId) ?? [];
        list.push(f);
        findingsByReview.set(f.reviewId, list);
      }

      return rows.map((row) => {
        const findings = findingsByReview.get(row.id) ?? [];
        return {
          id: row.id,
          requestId: undefined,
          repoId: row.repoId,
          prId: row.prId,
          sourceCommit: row.sourceCommit ?? undefined,
          targetCommit: row.targetCommit ?? undefined,
          changedFiles: (row.changedFiles as string[]) ?? [],
          hunksProcessed: row.hunksProcessed ?? 0,
          hunkResults: [],
          findings: findings.map((f) => ({
            issueType: f.issueType,
            severity: f.severity,
            filePath: f.filePath,
            startLine: f.startLine,
            endLine: f.endLine,
            message: f.message,
            suggestion: f.suggestion ?? undefined,
            findingHash: f.findingHash,
            status: f.status as AuditFinding["status"],
          })),
          timings: (row.timings as AuditRecord["timings"]) ?? { totalMs: 0, fetchPrMs: 0, listChangesMs: 0, collectDiffsMs: 0 },
          status: row.status === "completed" ? "success" : "failure",
          error: row.error ?? undefined,
          startedAt: row.startedAt?.toISOString() ?? row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? row.createdAt.toISOString(),
        };
      });
    },
  };
}

export async function createFileAuditStore(args: {
  dataDir: string;
  retentionDays?: number;
}): Promise<AuditStore> {
  const retentionMs = (args.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
  await fs.mkdir(args.dataDir, { recursive: true });
  const filePath = path.join(args.dataDir, "audit.jsonl");

  let records: AuditRecord[] = [];

  // Simple async mutex to serialize file writes
  let writeLock: Promise<void> = Promise.resolve();
  function withWriteLock(fn: () => Promise<void>): Promise<void> {
    const next = writeLock.then(fn, fn);
    writeLock = next.then(() => {}, () => {});
    return next;
  }

  try {
    const content = await fs.readFile(filePath, "utf8");
    for (const line of content.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        records.push(JSON.parse(line) as AuditRecord);
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file doesn't exist yet
  }

  function pruneExpired() {
    const cutoff = Date.now() - retentionMs;
    records = records.filter(
      (r) => new Date(r.startedAt).getTime() > cutoff
    );
  }

  async function rewriteFile() {
    const tmp = `${filePath}.tmp`;
    const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, filePath);
  }

  pruneExpired();
  if (records.length > 0) {
    await rewriteFile().catch(() => {});
  }

  const interval = setInterval(() => {
    void withWriteLock(async () => {
      pruneExpired();
      await rewriteFile().catch(() => {});
    });
  }, 6 * 60 * 60 * 1000);
  interval.unref();

  return {
    async append(record) {
      await withWriteLock(async () => {
        records.push(record);
        await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
      });
    },
    async query(filter) {
      pruneExpired();
      const limit = filter.limit ?? 50;
      return records
        .filter(
          (r) =>
            r.repoId === filter.repoId &&
            (filter.prId === undefined || r.prId === filter.prId)
        )
        .slice(-limit)
        .reverse();
    },
  };
}
