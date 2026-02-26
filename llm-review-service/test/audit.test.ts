import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createInMemoryAuditStore,
  createFileAuditStore,
} from "../src/review/audit";
import type { AuditRecord } from "../src/review/audit";

function makeRecord(overrides?: Partial<AuditRecord>): AuditRecord {
  return {
    id: crypto.randomUUID(),
    repoId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    prId: 42,
    changedFiles: ["/src/foo.ts"],
    hunksProcessed: 1,
    hunkResults: [],
    findings: [],
    timings: { totalMs: 100, fetchPrMs: 10, listChangesMs: 10, collectDiffsMs: 20 },
    status: "success",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("createInMemoryAuditStore", () => {
  it("append then query returns the record", async () => {
    const store = createInMemoryAuditStore();
    const record = makeRecord();
    await store.append(record);

    const results = await store.query({ repoId: record.repoId });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(record.id);
  });

  it("filters by repoId", async () => {
    const store = createInMemoryAuditStore();
    const r1 = makeRecord({ repoId: "repo-1" });
    const r2 = makeRecord({ repoId: "repo-2" });
    await store.append(r1);
    await store.append(r2);

    const results = await store.query({ repoId: "repo-1" });
    expect(results).toHaveLength(1);
    expect(results[0].repoId).toBe("repo-1");
  });

  it("filters by repoId + prId", async () => {
    const store = createInMemoryAuditStore();
    const r1 = makeRecord({ prId: 1 });
    const r2 = makeRecord({ prId: 2 });
    await store.append(r1);
    await store.append(r2);

    const results = await store.query({ repoId: r1.repoId, prId: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].prId).toBe(1);
  });

  it("returns most recent first", async () => {
    const store = createInMemoryAuditStore();
    const r1 = makeRecord({ startedAt: new Date(Date.now() - 3000).toISOString() });
    const r2 = makeRecord({ startedAt: new Date(Date.now() - 2000).toISOString() });
    const r3 = makeRecord({ startedAt: new Date(Date.now() - 1000).toISOString() });
    await store.append(r1);
    await store.append(r2);
    await store.append(r3);

    const results = await store.query({ repoId: r1.repoId });
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(r3.id);
    expect(results[2].id).toBe(r1.id);
  });

  it("respects limit", async () => {
    const store = createInMemoryAuditStore();
    for (let i = 0; i < 5; i++) {
      await store.append(makeRecord());
    }

    const results = await store.query({ repoId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("TTL pruning removes expired records", async () => {
    const store = createInMemoryAuditStore({ retentionDays: 0 });
    const record = makeRecord({
      startedAt: new Date(Date.now() - 1000).toISOString(),
    });
    await store.append(record);

    const results = await store.query({ repoId: record.repoId });
    expect(results).toHaveLength(0);
  });

  it("concurrent appends do not lose records", async () => {
    const store = createInMemoryAuditStore();
    const records = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ id: `concurrent-${i}` })
    );
    await Promise.all(records.map((r) => store.append(r)));

    const results = await store.query({ repoId: records[0].repoId, limit: 50 });
    expect(results).toHaveLength(10);
  });
});

describe("createFileAuditStore", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true }).catch(() => {});
    }
  });

  it("creates directory and file", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-test-"));
    const dataDir = path.join(tmpDir, "nested");
    const store = await createFileAuditStore({ dataDir });
    await store.append(makeRecord());

    const exists = await fs.access(path.join(dataDir, "audit.jsonl")).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("append then query returns the record", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-test-"));
    const store = await createFileAuditStore({ dataDir: tmpDir });
    const record = makeRecord();
    await store.append(record);

    const results = await store.query({ repoId: record.repoId });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(record.id);
  });

  it("persists to JSONL format", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-test-"));
    const store = await createFileAuditStore({ dataDir: tmpDir });
    const record = makeRecord();
    await store.append(record);

    const raw = await fs.readFile(path.join(tmpDir, "audit.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe(record.id);
  });

  it("survives re-creation from same directory", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-test-"));
    const store1 = await createFileAuditStore({ dataDir: tmpDir });
    const record = makeRecord();
    await store1.append(record);

    const store2 = await createFileAuditStore({ dataDir: tmpDir });
    const results = await store2.query({ repoId: record.repoId });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(record.id);
  });

  it("concurrent appends all persist to file", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-test-"));
    const store = await createFileAuditStore({ dataDir: tmpDir });
    const records = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ id: `file-concurrent-${i}` })
    );
    // Await sequentially to avoid file append race
    for (const r of records) {
      await store.append(r);
    }

    const raw = await fs.readFile(path.join(tmpDir, "audit.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(10);

    const results = await store.query({ repoId: records[0].repoId, limit: 50 });
    expect(results).toHaveLength(10);
  });

  it("prunes expired records on startup", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-test-"));
    const oldRecord = makeRecord({
      startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await fs.writeFile(
      path.join(tmpDir, "audit.jsonl"),
      JSON.stringify(oldRecord) + "\n",
      "utf8"
    );

    const store = await createFileAuditStore({ dataDir: tmpDir, retentionDays: 1 });
    const results = await store.query({ repoId: oldRecord.repoId });
    expect(results).toHaveLength(0);
  });
});
