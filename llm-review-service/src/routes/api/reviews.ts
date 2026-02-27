import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { DrizzleInstance } from "../../db/connection";
import type { ReviewQueue } from "../../review/queue";
import { createReviewRepo } from "../../db/repos/reviewRepo";

// HIGH-7: Pagination bounds with Zod
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  projectId: z.string().uuid().optional(),
});

export const registerReviewRoutes: FastifyPluginAsync<{
  db: DrizzleInstance;
  queue: ReviewQueue;
}> = async (app, opts) => {
  const { db, queue } = opts;
  const reviewRepo = createReviewRepo(db);

  // GET /api/reviews
  app.get<{
    Querystring: { page?: string; limit?: string; projectId?: string };
  }>("/reviews", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = paginationSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters" });
    }

    const { page, limit, projectId } = parsed.data;
    const result = await reviewRepo.listByTenant(tenantId, { page, limit, projectId });
    return result;
  });

  // GET /api/reviews/:id
  app.get<{ Params: { id: string } }>("/reviews/:id", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const review = await reviewRepo.findById(request.params.id);
    if (!review || review.tenantId !== tenantId) {
      return reply.code(404).send({ error: "Review not found" });
    }

    const findings = await reviewRepo.findFindingsByReviewId(review.id);
    return { ...review, findings };
  });

  // POST /api/reviews/:id/retrigger
  app.post<{ Params: { id: string } }>("/reviews/:id/retrigger", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const review = await reviewRepo.findById(request.params.id);
    if (!review || review.tenantId !== tenantId) {
      return reply.code(404).send({ error: "Review not found" });
    }

    if (!queue.enabled) {
      return reply.code(503).send({ error: "Queue not available" });
    }

    await queue.enqueue({
      repoId: review.repoId,
      prId: review.prId,
      requestId: `retrigger-${review.id}`,
    });

    return { ok: true, reviewId: review.id };
  });
};
