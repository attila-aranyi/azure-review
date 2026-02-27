import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDbAuditStore } from "../../src/review/audit";
import type { AuditRecord, AuditStore } from "../../src/review/audit";
import type { DrizzleInstance } from "../../src/db/connection";
import { createTenantRepo } from "../../src/db/repos/tenantRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../db/testDbHelper";

function makeAuditRecord(overrides?: Partial<AuditRecord>): AuditRecord {
  return {
    id: crypto.randomUUID(),
    repoId: "repo-1",
    prId: 1,
    sourceCommit: "abc123",
    targetCommit: "def456",
    changedFiles: ["/src/a.ts"],
    hunksProcessed: 2,
    hunkResults: [],
    findings: [
      {
        issueType: "bug",
        severity: "high",
        filePath: "/src/a.ts",
        startLine: 10,
        endLine: 15,
        message: "Potential null reference",
        findingHash: "hash1",
        status: "posted",
        postMs: 50,
      },
    ],
    timings: { totalMs: 1000, fetchPrMs: 100, listChangesMs: 200, collectDiffsMs: 300 },
    status: "success",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe.skipIf(!isDbAvailable())("createDbAuditStore (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;
  let store: AuditStore;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: `org-${Date.now()}` });
    tenantId = tenant.id;
    store = createDbAuditStore(db, tenantId);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("append() inserts into reviews + review_findings tables", async () => {
    const record = makeAuditRecord();
    await store.append(record);

    const results = await store.query({ repoId: "repo-1" });
    expect(results).toHaveLength(1);
    expect(results[0].repoId).toBe("repo-1");
    expect(results[0].prId).toBe(1);
    expect(results[0].findings).toHaveLength(1);
    expect(results[0].findings[0].findingHash).toBe("hash1");
  });

  it("query() filters by repoId", async () => {
    await store.append(makeAuditRecord({ repoId: "repo-1" }));
    await store.append(makeAuditRecord({ repoId: "repo-2" }));

    const results = await store.query({ repoId: "repo-1" });
    expect(results).toHaveLength(1);
    expect(results[0].repoId).toBe("repo-1");
  });

  it("query() filters by prId", async () => {
    await store.append(makeAuditRecord({ prId: 1 }));
    await store.append(makeAuditRecord({ prId: 2 }));

    const results = await store.query({ repoId: "repo-1", prId: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].prId).toBe(1);
  });

  it("query() scoped by tenantId (no cross-tenant leakage)", async () => {
    const tenantRepo = createTenantRepo(db);
    const otherTenant = await tenantRepo.create({ adoOrgId: `other-${Date.now()}` });
    const otherStore = createDbAuditStore(db, otherTenant.id);

    await store.append(makeAuditRecord({ repoId: "repo-1" }));
    await otherStore.append(makeAuditRecord({ repoId: "repo-1" }));

    const myResults = await store.query({ repoId: "repo-1" });
    expect(myResults).toHaveLength(1);

    const otherResults = await otherStore.query({ repoId: "repo-1" });
    expect(otherResults).toHaveLength(1);
  });

  it("query() respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.append(makeAuditRecord({ prId: i + 1 }));
    }

    const results = await store.query({ repoId: "repo-1", limit: 3 });
    expect(results).toHaveLength(3);
  });

  it("append() with multiple findings", async () => {
    const record = makeAuditRecord({
      findings: [
        { issueType: "bug", severity: "high", filePath: "/a.ts", startLine: 1, endLine: 5, message: "Bug", findingHash: "h1", status: "posted" },
        { issueType: "style", severity: "low", filePath: "/b.ts", startLine: 10, endLine: 12, message: "Style", findingHash: "h2", status: "filtered" },
      ],
    });
    await store.append(record);

    const results = await store.query({ repoId: "repo-1" });
    expect(results[0].findings).toHaveLength(2);
  });

  it("append() with no findings", async () => {
    await store.append(makeAuditRecord({ findings: [] }));

    const results = await store.query({ repoId: "repo-1" });
    expect(results).toHaveLength(1);
    expect(results[0].findings).toHaveLength(0);
  });

  it("maps status correctly (success → completed → success)", async () => {
    await store.append(makeAuditRecord({ status: "success" }));
    await store.append(makeAuditRecord({ status: "failure", error: "timeout", prId: 2 }));

    const results = await store.query({ repoId: "repo-1" });
    const success = results.find((r) => r.prId === 1);
    const failure = results.find((r) => r.prId === 2);
    expect(success?.status).toBe("success");
    expect(failure?.status).toBe("failure");
    expect(failure?.error).toBe("timeout");
  });
});
