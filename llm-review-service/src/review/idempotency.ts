import fs from "node:fs/promises";
import path from "node:path";

export type IdempotencyKey = {
  repoId: string;
  prId: number;
  findingHash: string;
};

export interface IdempotencyStore {
  has(key: IdempotencyKey): Promise<boolean>;
  put(key: IdempotencyKey): Promise<void>;
}

type StoredRecord = {
  key: string;
  createdAt: string;
};

function serializeKey(key: IdempotencyKey) {
  return `${key.repoId}:${key.prId}:${key.findingHash}`;
}

function pruneExpired(records: StoredRecord[], maxAgeDays: number): StoredRecord[] {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return records.filter((r) => {
    const ts = new Date(r.createdAt).getTime();
    return !isNaN(ts) && ts > cutoff;
  });
}

export function createInMemoryIdempotencyStore(opts?: { maxAgeDays?: number }): IdempotencyStore {
  const maxAgeDays = opts?.maxAgeDays ?? 30;
  const seen = new Map<string, number>();

  return {
    async has(key) {
      const serialized = serializeKey(key);
      const ts = seen.get(serialized);
      if (ts === undefined) return false;
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      if (ts <= cutoff) {
        seen.delete(serialized);
        return false;
      }
      return true;
    },
    async put(key) {
      seen.set(serializeKey(key), Date.now());
    }
  };
}

export async function createFileIdempotencyStore(args: {
  dataDir: string;
  maxAgeDays?: number;
}): Promise<IdempotencyStore> {
  const maxAgeDays = args.maxAgeDays ?? 30;
  await fs.mkdir(args.dataDir, { recursive: true });
  const filePath = path.join(args.dataDir, "idempotency.json");

  const seen = new Set<string>();
  let records: StoredRecord[] = [];

  try {
    const existing = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(existing) as { records?: StoredRecord[] };
    if (Array.isArray(parsed.records)) {
      records = parsed.records.filter(
        (r): r is StoredRecord =>
          typeof r?.key === "string" && r.key.length > 0 && typeof r?.createdAt === "string" && r.createdAt.length > 0
      );
    }
  } catch {
    // ignore missing / invalid file; start fresh
  }

  // Prune expired entries on startup
  records = pruneExpired(records, maxAgeDays);
  for (const r of records) seen.add(r.key);

  const persist = async () => {
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ records }, null, 2), "utf8");
    await fs.rename(tmp, filePath);
  };

  // Persist pruned state if we loaded existing data
  if (records.length > 0 || seen.size > 0) {
    await persist().catch(() => {});
  }

  // Periodic cleanup every 6 hours
  const pruneInterval = setInterval(() => {
    records = pruneExpired(records, maxAgeDays);
    const newSeen = new Set(records.map((r) => r.key));
    seen.clear();
    for (const k of newSeen) seen.add(k);
    void persist().catch(() => {});
  }, 6 * 60 * 60 * 1000);
  pruneInterval.unref();

  return {
    async has(key) {
      return seen.has(serializeKey(key));
    },
    async put(key) {
      const serialized = serializeKey(key);
      if (seen.has(serialized)) return;
      seen.add(serialized);
      records.push({ key: serialized, createdAt: new Date().toISOString() });
      await persist();
    }
  };
}
