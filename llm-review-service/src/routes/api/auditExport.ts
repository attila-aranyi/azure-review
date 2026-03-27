import type { FastifyPluginAsync } from "fastify";
import type { DrizzleInstance } from "../../db/connection";
import { createAuditExportRepo, type AuditExportRow } from "../../db/repos/auditExportRepo";

const MAX_RANGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const CSV_HEADERS = [
  "reviewId",
  "repoId",
  "prId",
  "reviewStatus",
  "reviewCreatedAt",
  "reviewCompletedAt",
  "findingId",
  "issueType",
  "severity",
  "filePath",
  "startLine",
  "endLine",
  "message",
  "suggestion",
  "findingStatus",
];

function escapeCSV(value: string | number | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCSV(row: AuditExportRow): string {
  return [
    escapeCSV(row.reviewId),
    escapeCSV(row.repoId),
    escapeCSV(row.prId),
    escapeCSV(row.reviewStatus),
    escapeCSV(row.reviewCreatedAt?.toISOString()),
    escapeCSV(row.reviewCompletedAt?.toISOString()),
    escapeCSV(row.findingId),
    escapeCSV(row.issueType),
    escapeCSV(row.severity),
    escapeCSV(row.filePath),
    escapeCSV(row.startLine),
    escapeCSV(row.endLine),
    escapeCSV(row.message),
    escapeCSV(row.suggestion),
    escapeCSV(row.findingStatus),
  ].join(",");
}

type ReviewJSON = {
  reviewId: string;
  repoId: string;
  prId: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  findings: {
    findingId: string;
    issueType: string;
    severity: string;
    filePath: string;
    startLine: number;
    endLine: number;
    message: string;
    suggestion: string | null;
    status: string;
  }[];
};

function rowsToJSON(rows: AuditExportRow[]): { reviews: ReviewJSON[] } {
  const reviewMap = new Map<string, ReviewJSON>();

  for (const row of rows) {
    if (!reviewMap.has(row.reviewId)) {
      reviewMap.set(row.reviewId, {
        reviewId: row.reviewId,
        repoId: row.repoId,
        prId: row.prId,
        status: row.reviewStatus,
        createdAt: row.reviewCreatedAt?.toISOString(),
        completedAt: row.reviewCompletedAt?.toISOString() ?? null,
        findings: [],
      });
    }

    if (row.findingId) {
      reviewMap.get(row.reviewId)!.findings.push({
        findingId: row.findingId,
        issueType: row.issueType!,
        severity: row.severity!,
        filePath: row.filePath!,
        startLine: row.startLine!,
        endLine: row.endLine!,
        message: row.message!,
        suggestion: row.suggestion ?? null,
        status: row.findingStatus!,
      });
    }
  }

  return { reviews: Array.from(reviewMap.values()) };
}

export const registerAuditExportRoutes: FastifyPluginAsync<{
  db: DrizzleInstance;
}> = async (app, opts) => {
  const { db } = opts;
  const auditExportRepo = createAuditExportRepo(db);

  app.get("/export/audit", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const query = request.query as Record<string, string>;
    const { from, to, format = "json" } = query;

    if (!from || !to) {
      return reply.code(400).send({ error: "Both 'from' and 'to' query parameters are required (YYYY-MM-DD)" });
    }

    if (format !== "json" && format !== "csv") {
      return reply.code(400).send({ error: "Format must be 'json' or 'csv'" });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return reply.code(400).send({ error: "Invalid date format. Use YYYY-MM-DD." });
    }

    if (fromDate > toDate) {
      return reply.code(400).send({ error: "'from' date must be before 'to' date" });
    }

    const rangeDays = (toDate.getTime() - fromDate.getTime()) / MS_PER_DAY;
    if (rangeDays > MAX_RANGE_DAYS) {
      return reply.code(400).send({ error: `Date range must not exceed ${MAX_RANGE_DAYS} days` });
    }

    // Set to end of day for 'to' date
    toDate.setHours(23, 59, 59, 999);

    const rows = await auditExportRepo.exportReviewsWithFindings(tenantId, fromDate, toDate);

    if (format === "csv") {
      const csvLines = [CSV_HEADERS.join(","), ...rows.map(rowToCSV)];
      const csvBody = csvLines.join("\n");

      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="audit-${from}-to-${to}.csv"`)
        .send(csvBody);
    }

    // JSON format (default)
    const result = rowsToJSON(rows);
    return result;
  });
};
