import type { FastifyPluginAsync } from "fastify";
import type { DrizzleInstance } from "../../db/connection";
import type { AppConfig } from "../../config/appConfig";
import { AxonClient } from "../../axon/axonClient";

export const registerGraphRoutes: FastifyPluginAsync<{
  db: DrizzleInstance;
  appConfig?: AppConfig;
}> = async (app, opts) => {
  const { appConfig } = opts;
  const axonUrl = appConfig?.AXON_SIDECAR_URL ?? process.env.AXON_SIDECAR_URL;

  if (!axonUrl) {
    app.get("/repos/:repoId/graph", async (_req, reply) => {
      return reply.code(503).send({ error: "Axon sidecar not configured" });
    });
    app.get("/repos/:repoId/graph/impact/:symbol", async (_req, reply) => {
      return reply.code(503).send({ error: "Axon sidecar not configured" });
    });
    app.get("/repos/:repoId/graph/dead-code", async (_req, reply) => {
      return reply.code(503).send({ error: "Axon sidecar not configured" });
    });
    return;
  }

  function getClient() {
    return new AxonClient({ baseUrl: axonUrl!, logger: app.log as never });
  }

  // GET /api/repos/:repoId/graph — Get repo status + context for graph visualization
  app.get<{ Params: { repoId: string } }>("/repos/:repoId/graph", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const client = getClient();
    try {
      const status = await client.getStatus(tenantId, request.params.repoId);
      if (!status?.indexed) {
        return reply.code(404).send({ error: "Repository not indexed. Trigger a review first." });
      }

      // Return status info — full graph data comes from individual symbol queries
      return {
        indexed: true,
        graphSizeBytes: status.graph_size_bytes,
      };
    } catch (err) {
      app.log.warn({ err, repoId: request.params.repoId }, "Axon graph fetch failed");
      return reply.code(502).send({ error: "Failed to fetch graph from Axon sidecar" });
    }
  });

  // GET /api/repos/:repoId/graph/impact/:symbol — Get impact analysis for a symbol
  app.get<{ Params: { repoId: string; symbol: string } }>("/repos/:repoId/graph/impact/:symbol", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const client = getClient();
    try {
      const impact = await client.getImpact(tenantId, request.params.repoId, request.params.symbol);
      if (!impact) {
        return reply.code(404).send({ error: "Symbol not found or not indexed" });
      }

      // Flatten blast_radius from { depth: entries[] } to flat array with depth
      const blastRadius: { id: string; label: string; depth: number }[] = [];
      for (const [depth, entries] of Object.entries(impact.blast_radius)) {
        for (const entry of entries) {
          blastRadius.push({
            id: `${entry.file}::${entry.name}`,
            label: entry.name,
            depth: parseInt(depth, 10),
          });
        }
      }

      return { symbol: request.params.symbol, blastRadius };
    } catch (err) {
      app.log.warn({ err, symbol: request.params.symbol }, "Axon impact fetch failed");
      return reply.code(502).send({ error: "Failed to fetch impact data" });
    }
  });

  // GET /api/repos/:repoId/graph/dead-code — Get dead code analysis
  app.get<{ Params: { repoId: string } }>("/repos/:repoId/graph/dead-code", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const client = getClient();
    try {
      const result = await client.getDeadCode(tenantId, request.params.repoId);
      return {
        deadSymbols: result?.dead_symbols?.map((s) => ({
          file: s.file,
          name: s.name,
          type: s.type,
        })) ?? [],
      };
    } catch (err) {
      app.log.warn({ err }, "Axon dead code fetch failed");
      return reply.code(502).send({ error: "Failed to fetch dead code data" });
    }
  });
};
