import { describe, it, expect, vi } from "vitest";
import { enrichReview } from "../../src/axon/contextEnricher";
import type { AxonClient } from "../../src/axon/axonClient";
import pino from "pino";

const logger = pino({ level: "silent" });

function mockAxonClient(overrides: Partial<AxonClient> = {}): AxonClient {
  return {
    isHealthy: vi.fn().mockResolvedValue(true),
    getStatus: vi.fn().mockResolvedValue({ indexed: false, graph_size_bytes: 0 }),
    indexRepo: vi.fn().mockResolvedValue({
      status: "ready",
      symbols: 100,
      edges: 200,
      clusters: 5,
      duration_ms: 3000,
      clone_duration_ms: 1000,
      analyze_duration_ms: 2000,
    }),
    reindexRepo: vi.fn().mockResolvedValue({
      status: "ready",
      symbols: 110,
      edges: 220,
      clusters: 5,
      duration_ms: 1500,
      clone_duration_ms: 500,
      analyze_duration_ms: 1000,
    }),
    detectChanges: vi.fn().mockResolvedValue({
      changed_symbols: [
        { file: "src/main.ts", name: "processData", type: "function" },
        { file: "src/util.ts", name: "formatOutput", type: "function" },
      ],
    }),
    getImpact: vi.fn().mockResolvedValue({
      blast_radius: { depth_1: [{ name: "caller1", file: "a.ts" }] },
    }),
    getContext: vi.fn().mockResolvedValue({
      callers: [{ name: "main" }],
      callees: [{ name: "helper" }],
      types: [],
      community: { id: 1, name: "Core" },
    }),
    getDeadCode: vi.fn().mockResolvedValue({
      dead_symbols: [{ file: "src/old.ts", name: "unused", type: "function" }],
    }),
    ...overrides,
  } as unknown as AxonClient;
}

const baseOpts = {
  tenantId: "t1",
  repoId: "r1",
  cloneUrl: "https://dev.azure.com/org/proj/_git/repo",
  accessToken: "token",
  targetBranch: "main",
  diff: "--- a/src/main.ts\n+++ b/src/main.ts",
  logger,
};

describe("enrichReview", () => {
  it("returns null when sidecar is unhealthy", async () => {
    const client = mockAxonClient({ isHealthy: vi.fn().mockResolvedValue(false) as never });
    const result = await enrichReview(client, baseOpts);
    expect(result).toBeNull();
  });

  it("indexes new repo and returns structural context", async () => {
    const client = mockAxonClient();
    const result = await enrichReview(client, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.changedSymbols).toHaveLength(2);
    expect(result!.impactBySymbol.size).toBe(2);
    expect(result!.contextBySymbol.size).toBe(2);
    expect(result!.deadCode).toHaveLength(1);
    expect(result!.indexStatus.status).toBe("ready");

    // Should have called indexRepo (not reindexRepo) since not indexed
    expect(client.indexRepo).toHaveBeenCalled();
    expect(client.reindexRepo).not.toHaveBeenCalled();
  });

  it("reindexes already-indexed repo", async () => {
    const client = mockAxonClient({
      getStatus: vi.fn().mockResolvedValue({ indexed: true, graph_size_bytes: 1024 }) as never,
    });
    const result = await enrichReview(client, baseOpts);

    expect(result).not.toBeNull();
    expect(client.reindexRepo).toHaveBeenCalled();
    expect(client.indexRepo).not.toHaveBeenCalled();
  });

  it("returns null when indexing fails", async () => {
    const client = mockAxonClient({
      indexRepo: vi.fn().mockResolvedValue({ status: "failed", error: "unsupported" }) as never,
    });
    const result = await enrichReview(client, baseOpts);
    expect(result).toBeNull();
  });

  it("returns empty context when no changed symbols detected", async () => {
    const client = mockAxonClient({
      detectChanges: vi.fn().mockResolvedValue({ changed_symbols: [] }) as never,
    });
    const result = await enrichReview(client, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.changedSymbols).toHaveLength(0);
    expect(result!.impactBySymbol.size).toBe(0);
  });

  it("limits symbol queries to maxSymbolQueries", async () => {
    const manySymbols = Array.from({ length: 50 }, (_, i) => ({
      file: `src/f${i}.ts`,
      name: `func${i}`,
      type: "function",
    }));
    const client = mockAxonClient({
      detectChanges: vi.fn().mockResolvedValue({ changed_symbols: manySymbols }) as never,
    });

    await enrichReview(client, { ...baseOpts, maxSymbolQueries: 5 });

    // Should only query impact/context for 5 symbols
    expect(client.getImpact).toHaveBeenCalledTimes(5);
    expect(client.getContext).toHaveBeenCalledTimes(5);
  });

  it("skips impact when getImpact returns null", async () => {
    const client = mockAxonClient({
      getImpact: vi.fn().mockResolvedValue(null) as never,
    });
    const result = await enrichReview(client, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.impactBySymbol.size).toBe(0);
    // context should still be populated
    expect(result!.contextBySymbol.size).toBe(2);
  });

  it("skips context when getContext returns null", async () => {
    const client = mockAxonClient({
      getContext: vi.fn().mockResolvedValue(null) as never,
    });
    const result = await enrichReview(client, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.contextBySymbol.size).toBe(0);
    // impact should still be populated
    expect(result!.impactBySymbol.size).toBe(2);
  });

  it("skips impact when blast_radius is missing", async () => {
    const client = mockAxonClient({
      getImpact: vi.fn().mockResolvedValue({ /* no blast_radius */ }) as never,
    });
    const result = await enrichReview(client, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.impactBySymbol.size).toBe(0);
  });

  it("defaults deadCode to [] when getDeadCode returns null", async () => {
    const client = mockAxonClient({
      getDeadCode: vi.fn().mockResolvedValue(null) as never,
    });
    const result = await enrichReview(client, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.deadCode).toEqual([]);
  });

  it("includes dead symbols from getDeadCode", async () => {
    const client = mockAxonClient({
      getDeadCode: vi.fn().mockResolvedValue({
        dead_symbols: [{ file: "src/dead.ts", name: "unusedFn", type: "function" }],
      }) as never,
    });
    const result = await enrichReview(client, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.deadCode).toHaveLength(1);
    expect(result!.deadCode[0].name).toBe("unusedFn");
  });

  it("returns null when reindex returns null", async () => {
    const client = mockAxonClient({
      getStatus: vi.fn().mockResolvedValue({ indexed: true, graph_size_bytes: 1024 }) as never,
      reindexRepo: vi.fn().mockResolvedValue(null) as never,
    });
    const result = await enrichReview(client, baseOpts);

    expect(result).toBeNull();
  });

  it("returns null when reindex returns status 'failed'", async () => {
    const client = mockAxonClient({
      getStatus: vi.fn().mockResolvedValue({ indexed: true, graph_size_bytes: 1024 }) as never,
      reindexRepo: vi.fn().mockResolvedValue({ status: "failed", error: "timeout" }) as never,
    });
    const result = await enrichReview(client, baseOpts);

    expect(result).toBeNull();
  });

  it("rejects when one symbol query fails in Promise.all", async () => {
    const client = mockAxonClient({
      getImpact: vi.fn().mockRejectedValue(new Error("network")) as never,
    });

    await expect(enrichReview(client, baseOpts)).rejects.toThrow("network");
  });
});
