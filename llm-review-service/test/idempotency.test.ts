import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createInMemoryIdempotencyStore,
  createFileIdempotencyStore,
  type IdempotencyKey
} from "../src/review/idempotency";

function makeKey(hash = "abc123"): IdempotencyKey {
  return { repoId: "repo-1", prId: 42, iteration: "commit-xyz", findingHash: hash };
}

describe("InMemoryIdempotencyStore", () => {
  it("returns false for unseen keys", async () => {
    const store = createInMemoryIdempotencyStore();
    expect(await store.has(makeKey())).toBe(false);
  });

  it("returns true after put", async () => {
    const store = createInMemoryIdempotencyStore();
    await store.put(makeKey());
    expect(await store.has(makeKey())).toBe(true);
  });

  it("distinguishes different keys", async () => {
    const store = createInMemoryIdempotencyStore();
    await store.put(makeKey("a"));
    expect(await store.has(makeKey("a"))).toBe(true);
    expect(await store.has(makeKey("b"))).toBe(false);
  });

  it("handles missing iteration", async () => {
    const store = createInMemoryIdempotencyStore();
    const key: IdempotencyKey = { repoId: "r", prId: 1, findingHash: "h" };
    await store.put(key);
    expect(await store.has(key)).toBe(true);
  });

  it("expires entries based on maxAgeDays", async () => {
    const store = createInMemoryIdempotencyStore({ maxAgeDays: 0 });
    await store.put(makeKey());
    // With maxAgeDays=0, the entry should be expired immediately
    // (cutoff = now - 0 days = now, so anything at or before now is expired)
    expect(await store.has(makeKey())).toBe(false);
  });
});

describe("FileIdempotencyStore", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("persists entries to disk", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "idem-test-"));
    const store = await createFileIdempotencyStore({ dataDir: tmpDir });
    await store.put(makeKey());

    // Read the file to verify persistence
    const filePath = path.join(tmpDir, "idempotency.json");
    const content = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(content.records).toHaveLength(1);
    expect(content.records[0].key).toContain("repo-1:42:commit-xyz:abc123");
  });

  it("loads existing entries on creation", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "idem-test-"));
    const filePath = path.join(tmpDir, "idempotency.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        records: [{ key: "repo-1:42:commit-xyz:abc123", createdAt: new Date().toISOString() }]
      }),
      "utf8"
    );

    const store = await createFileIdempotencyStore({ dataDir: tmpDir });
    expect(await store.has(makeKey())).toBe(true);
  });

  it("handles missing data file gracefully", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "idem-test-"));
    const store = await createFileIdempotencyStore({ dataDir: tmpDir });
    expect(await store.has(makeKey())).toBe(false);
  });

  it("does not duplicate entries on repeated put", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "idem-test-"));
    const store = await createFileIdempotencyStore({ dataDir: tmpDir });
    await store.put(makeKey());
    await store.put(makeKey());

    const filePath = path.join(tmpDir, "idempotency.json");
    const content = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(content.records).toHaveLength(1);
  });

  it("prunes expired entries on startup", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "idem-test-"));
    const filePath = path.join(tmpDir, "idempotency.json");

    // Write an old entry (31 days ago)
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      filePath,
      JSON.stringify({
        records: [{ key: "repo-1:42:commit-xyz:old-hash", createdAt: oldDate }]
      }),
      "utf8"
    );

    const store = await createFileIdempotencyStore({ dataDir: tmpDir, maxAgeDays: 30 });
    expect(await store.has({ repoId: "repo-1", prId: 42, iteration: "commit-xyz", findingHash: "old-hash" })).toBe(false);
  });
});
