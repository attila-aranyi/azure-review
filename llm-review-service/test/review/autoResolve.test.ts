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
});
