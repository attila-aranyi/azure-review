import type { FastifyPluginAsync } from "fastify";
import type { DrizzleInstance } from "../../db/connection";
import { createTenantRepo } from "../../db/repos/tenantRepo";
import { createProjectRepo } from "../../db/repos/projectRepo";
import { createReviewRepo } from "../../db/repos/reviewRepo";

export const registerTenantRoutes: FastifyPluginAsync<{
  db: DrizzleInstance;
}> = async (app, opts) => {
  const { db } = opts;
  const tenantRepo = createTenantRepo(db);
  const projectRepo = createProjectRepo(db);
  const reviewRepo = createReviewRepo(db);

  // GET /api/tenants/me
  app.get("/tenants/me", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const tenant = await tenantRepo.findById(tenantId);
    if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

    return {
      id: tenant.id,
      adoOrgId: tenant.adoOrgId,
      adoOrgName: tenant.adoOrgName,
      status: tenant.status,
      plan: tenant.plan,
      createdAt: tenant.createdAt,
    };
  });

  // GET /api/tenants/me/status
  app.get("/tenants/me/status", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const tenant = await tenantRepo.findById(tenantId);
    if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

    const projects = await projectRepo.findByTenantId(tenantId);
    const reviews = await reviewRepo.listByTenant(tenantId, { limit: 1 });

    return {
      connected: tenant.status === "active",
      status: tenant.status,
      plan: tenant.plan,
      projectCount: projects.length,
      activeProjects: projects.filter((p) => p.status === "active").length,
      totalReviews: reviews.total,
    };
  });
};
