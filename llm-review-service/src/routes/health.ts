import type { FastifyPluginAsync } from "fastify";
import type { ReviewQueue } from "../review/queue";

export const registerHealthRoutes: FastifyPluginAsync<{ queue: ReviewQueue }> = async (app, opts) => {
  app.get("/health", async (_request, reply) => {
    return reply.send({ status: "ok" });
  });

  app.get("/ready", async (_request, reply) => {
    if (opts.queue.enabled) {
      const ok = await opts.queue.ping().catch(() => false);
      if (!ok) {
        return reply.code(503).send({ status: "not ready", reason: "redis unreachable" });
      }
    }
    return reply.send({ status: "ready" });
  });
};
