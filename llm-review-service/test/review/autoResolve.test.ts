import { describe, it, expect, vi } from "vitest";
import { autoResolveOldFindings } from "../../src/review/autoResolve";
import pino from "pino";

const logger = pino({ level: "silent" });

function mockDb() {
  const selectResult: unknown[] = [];
  const updateCalled: { table: string; set: unknown; where: unknown }[] = [];

  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(selectResult),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    },
    selectResult,
    updateCalled,
  };
}

describe("autoResolveOldFindings", () => {
  it("returns zero when no previous reviews exist", async () => {
    const { db } = mockDb();
    const adoClient = { updateThreadComment: vi.fn() };

    const result = await autoResolveOldFindings({
      db: db as never,
      adoClient: adoClient as never,
      tenantId: "t1",
      repoId: "repo-1",
      prId: 1,
      currentFindingHashes: new Set(["hash-1"]),
      logger,
    });

    expect(result.resolvedCount).toBe(0);
    expect(result.resolvedHashes).toEqual([]);
  });

  it("resolves findings not in current review (mocked chain)", async () => {
    const previousReviews = [{ id: "rev-1" }];
    const previousFindings = [
      { id: "f1", findingHash: "old-hash-1", status: "posted", adoThreadId: 100, reviewId: "rev-1" },
      { id: "f2", findingHash: "current-hash", status: "posted", adoThreadId: 200, reviewId: "rev-1" },
    ];

    let selectCallCount = 0;
    const adoClient = { updateThreadComment: vi.fn().mockResolvedValue(undefined) };

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            return selectCallCount === 1
              ? Promise.resolve(previousReviews)
              : Promise.resolve(previousFindings);
          }),
        })),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const result = await autoResolveOldFindings({
      db: db as never,
      adoClient: adoClient as never,
      tenantId: "t1",
      repoId: "repo-1",
      prId: 1,
      currentFindingHashes: new Set(["current-hash"]),
      logger,
    });

    expect(result.resolvedCount).toBe(1);
    expect(result.resolvedHashes).toEqual(["old-hash-1"]);
    expect(adoClient.updateThreadComment).toHaveBeenCalledTimes(1);
  });

  it("continues if ADO thread update fails", async () => {
    let selectCallCount = 0;
    const adoClient = {
      updateThreadComment: vi.fn().mockRejectedValue(new Error("ADO error")),
    };

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            return selectCallCount === 1
              ? Promise.resolve([{ id: "rev-1" }])
              : Promise.resolve([{ id: "f1", findingHash: "old", status: "posted", adoThreadId: 100 }]);
          }),
        })),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const result = await autoResolveOldFindings({
      db: db as never,
      adoClient: adoClient as never,
      tenantId: "t1",
      repoId: "repo-1",
      prId: 1,
      currentFindingHashes: new Set(),
      logger,
    });

    expect(result.resolvedCount).toBe(0); // failed to resolve due to ADO error
  });

  it("returns zero when previous reviews have no posted findings", async () => {
    let selectCallCount = 0;
    const adoClient = { updateThreadComment: vi.fn() };

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            return selectCallCount === 1
              ? Promise.resolve([{ id: "rev-1" }]) // previous reviews exist
              : Promise.resolve([]); // but no posted findings
          }),
        })),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const result = await autoResolveOldFindings({
      db: db as never,
      adoClient: adoClient as never,
      tenantId: "t1",
      repoId: "repo-1",
      prId: 1,
      currentFindingHashes: new Set(["hash-1"]),
      logger,
    });

    expect(result.resolvedCount).toBe(0);
    expect(adoClient.updateThreadComment).not.toHaveBeenCalled();
  });

  it("marks finding resolved in DB even when no adoThreadId", async () => {
    let selectCallCount = 0;
    const adoClient = { updateThreadComment: vi.fn() };

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            return selectCallCount === 1
              ? Promise.resolve([{ id: "rev-1" }])
              : Promise.resolve([
                  { id: "f1", findingHash: "old-hash", status: "posted", adoThreadId: null },
                ]);
          }),
        })),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: updateWhere,
        }),
      }),
    };

    const result = await autoResolveOldFindings({
      db: db as never,
      adoClient: adoClient as never,
      tenantId: "t1",
      repoId: "repo-1",
      prId: 1,
      currentFindingHashes: new Set(),
      logger,
    });

    expect(result.resolvedCount).toBe(1);
    expect(result.resolvedHashes).toContain("old-hash");
    expect(adoClient.updateThreadComment).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });

  it("resolves multiple findings in single call", async () => {
    let selectCallCount = 0;
    const adoClient = { updateThreadComment: vi.fn().mockResolvedValue(undefined) };

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            return selectCallCount === 1
              ? Promise.resolve([{ id: "rev-1" }])
              : Promise.resolve([
                  { id: "f1", findingHash: "h1", status: "posted", adoThreadId: 100 },
                  { id: "f2", findingHash: "h2", status: "posted", adoThreadId: 200 },
                  { id: "f3", findingHash: "h3", status: "posted", adoThreadId: 300 },
                ]);
          }),
        })),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const result = await autoResolveOldFindings({
      db: db as never,
      adoClient: adoClient as never,
      tenantId: "t1",
      repoId: "repo-1",
      prId: 1,
      currentFindingHashes: new Set(),
      logger,
    });

    expect(result.resolvedCount).toBe(3);
    expect(adoClient.updateThreadComment).toHaveBeenCalledTimes(3);
  });

  it("resolves all when currentFindingHashes is empty", async () => {
    let selectCallCount = 0;
    const adoClient = { updateThreadComment: vi.fn().mockResolvedValue(undefined) };

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            return selectCallCount === 1
              ? Promise.resolve([{ id: "rev-1" }])
              : Promise.resolve([
                  { id: "f1", findingHash: "h1", status: "posted", adoThreadId: 10 },
                  { id: "f2", findingHash: "h2", status: "posted", adoThreadId: 20 },
                ]);
          }),
        })),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const result = await autoResolveOldFindings({
      db: db as never,
      adoClient: adoClient as never,
      tenantId: "t1",
      repoId: "repo-1",
      prId: 1,
      currentFindingHashes: new Set(), // empty → all are "resolved"
      logger,
    });

    expect(result.resolvedCount).toBe(2);
  });

  it("resolves nothing when all findings still present", async () => {
    let selectCallCount = 0;
    const adoClient = { updateThreadComment: vi.fn() };

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            return selectCallCount === 1
              ? Promise.resolve([{ id: "rev-1" }])
              : Promise.resolve([
                  { id: "f1", findingHash: "h1", status: "posted", adoThreadId: 10 },
                  { id: "f2", findingHash: "h2", status: "posted", adoThreadId: 20 },
                ]);
          }),
        })),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const result = await autoResolveOldFindings({
      db: db as never,
      adoClient: adoClient as never,
      tenantId: "t1",
      repoId: "repo-1",
      prId: 1,
      currentFindingHashes: new Set(["h1", "h2"]), // all present
      logger,
    });

    expect(result.resolvedCount).toBe(0);
    expect(adoClient.updateThreadComment).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("skips failed ADO finding, continues processing rest", async () => {
    let selectCallCount = 0;
    const adoClient = {
      updateThreadComment: vi.fn()
        .mockRejectedValueOnce(new Error("ADO error")) // f1 fails
        .mockResolvedValueOnce(undefined) // f2 succeeds
        .mockResolvedValueOnce(undefined), // f3 succeeds
    };

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            return selectCallCount === 1
              ? Promise.resolve([{ id: "rev-1" }])
              : Promise.resolve([
                  { id: "f1", findingHash: "h1", status: "posted", adoThreadId: 10 },
                  { id: "f2", findingHash: "h2", status: "posted", adoThreadId: 20 },
                  { id: "f3", findingHash: "h3", status: "posted", adoThreadId: 30 },
                ]);
          }),
        })),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    const result = await autoResolveOldFindings({
      db: db as never,
      adoClient: adoClient as never,
      tenantId: "t1",
      repoId: "repo-1",
      prId: 1,
      currentFindingHashes: new Set(),
      logger,
    });

    // f1 fails ADO → skipped via continue; f2 and f3 succeed
    expect(result.resolvedCount).toBe(2);
    expect(result.resolvedHashes).toEqual(["h2", "h3"]);
    expect(result.resolvedHashes).not.toContain("h1");
  });

  it("DB update failure propagates (not caught)", async () => {
    let selectCallCount = 0;
    const adoClient = { updateThreadComment: vi.fn() };

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            return selectCallCount === 1
              ? Promise.resolve([{ id: "rev-1" }])
              : Promise.resolve([
                  { id: "f1", findingHash: "h1", status: "posted", adoThreadId: null },
                ]);
          }),
        })),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error("DB connection lost")),
        }),
      }),
    };

    const promise = autoResolveOldFindings({
      db: db as never,
      adoClient: adoClient as never,
      tenantId: "t1",
      repoId: "repo-1",
      prId: 1,
      currentFindingHashes: new Set(),
      logger,
    });

    await expect(promise).rejects.toThrow("DB connection lost");
  });
});
