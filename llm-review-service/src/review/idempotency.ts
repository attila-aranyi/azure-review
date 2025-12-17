import fs from "node:fs/promises";
import path from "node:path";

export type IdempotencyKey = {
  repoId: string;
  prId: number;
  iteration?: string;
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
  return `${key.repoId}:${key.prId}:${key.iteration ?? "na"}:${key.findingHash}`;
}

export function createInMemoryIdempotencyStore(): IdempotencyStore {
  const seen = new Set<string>();

  return {
    async has(key) {
      return seen.has(serializeKey(key));
    },
    async put(key) {
      seen.add(serializeKey(key));
    }
  };
}

export async function createFileIdempotencyStore(args: { dataDir: string }): Promise<IdempotencyStore> {
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
      for (const r of records) seen.add(r.key);
    }
  } catch {
    // ignore missing / invalid file; start fresh
  }

  const persist = async () => {
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ records }, null, 2), "utf8");
    await fs.rename(tmp, filePath);
  };

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
