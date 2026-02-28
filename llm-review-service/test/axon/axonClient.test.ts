import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AxonClient } from "../../src/axon/axonClient";
import pino from "pino";

const logger = pino({ level: "silent" });

describe("AxonClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let client: AxonClient;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    client = new AxonClient({ baseUrl: "http://localhost:8100", logger });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isHealthy returns true when sidecar responds ok", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    });

    expect(await client.isHealthy()).toBe(true);
  });

  it("isHealthy returns false when sidecar is down", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

    expect(await client.isHealthy()).toBe(false);
  });

  it("indexRepo posts to correct endpoint and returns result", async () => {
    const indexResult = {
      status: "ready",
      symbols: 100,
      edges: 200,
      clusters: 5,
      duration_ms: 3000,
      clone_duration_ms: 1000,
      analyze_duration_ms: 2000,
    };
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => indexResult,
    });

    const result = await client.indexRepo("t1", "r1", "https://clone.url", "token");

    expect(result).toEqual(indexResult);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8100/repos/t1/r1/index",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"clone_url":"https://clone.url"'),
      }),
    );
  });

  it("detectChanges returns changed symbols", async () => {
    const changesResult = {
      changed_symbols: [{ file: "src/main.ts", name: "process", type: "function" }],
    };
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => changesResult,
    });

    const result = await client.detectChanges("t1", "r1", "some diff");

    expect(result?.changed_symbols).toHaveLength(1);
    expect(result?.changed_symbols[0].name).toBe("process");
  });

  it("getImpact returns blast radius", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        blast_radius: { depth_1: [{ name: "caller1", file: "a.ts" }] },
      }),
    });

    const result = await client.getImpact("t1", "r1", "myFunc", 3);

    expect(result?.blast_radius.depth_1).toHaveLength(1);
  });

  it("returns null on non-ok response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not found",
    });

    const result = await client.detectChanges("t1", "r1", "diff");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await client.getDeadCode("t1", "r1");
    expect(result).toBeNull();
  });

  it("getStatus calls correct endpoint", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ indexed: true, graph_size_bytes: 1024 }),
    });

    const result = await client.getStatus("t1", "r1");
    expect(result?.indexed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8100/repos/t1/r1/status",
      expect.any(Object),
    );
  });
});
