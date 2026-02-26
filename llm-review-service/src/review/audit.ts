import fs from "node:fs/promises";
import path from "node:path";

export type AuditFinding = {
  issueType: string;
  severity: string;
  filePath: string;
  startLine: number;
  endLine: number;
  message: string;
  suggestion?: string;
  findingHash: string;
  status: "posted" | "skipped_duplicate";
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

export async function createFileAuditStore(args: {
  dataDir: string;
  retentionDays?: number;
}): Promise<AuditStore> {
  const retentionMs = (args.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
  await fs.mkdir(args.dataDir, { recursive: true });
  const filePath = path.join(args.dataDir, "audit.jsonl");

  let records: AuditRecord[] = [];

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
    pruneExpired();
    void rewriteFile().catch(() => {});
  }, 6 * 60 * 60 * 1000);
  interval.unref();

  return {
    async append(record) {
      records.push(record);
      await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
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
