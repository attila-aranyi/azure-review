import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { DrizzleInstance } from "../../db/connection";
import type { AppConfig } from "../../config/appConfig";
import type { TokenManager } from "../../auth/tokenManager";
import { createProjectRepo } from "../../db/repos/projectRepo";
import { encrypt } from "../../auth/encryption";

export const registerProjectRoutes: FastifyPluginAsync<{
  db: DrizzleInstance;
  appConfig: AppConfig;
  tokenManager: TokenManager;
}> = async (app, opts) => {
  const { db, appConfig } = opts;
  const projectRepo = createProjectRepo(db);

  // GET /api/projects
  app.get("/projects", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const enrollments = await projectRepo.findByTenantId(tenantId);
    return enrollments.map((e) => ({
      id: e.id,
      adoProjectId: e.adoProjectId,
      adoProjectName: e.adoProjectName,
      status: e.status,
      createdAt: e.createdAt,
    }));
  });

  // POST /api/projects/:projectId/enable
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/enable", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const { projectId } = request.params;

    // Check if already enrolled
    const existing = await projectRepo.findByTenantAndProject(tenantId, projectId);
    if (existing && existing.status === "active") {
      return reply.code(409).send({ error: "Project already enabled" });
    }

    // Generate webhook secret
    const webhookSecret = crypto.randomBytes(32).toString("hex");
    let webhookSecretEnc: string | undefined;
    if (appConfig.TOKEN_ENCRYPTION_KEY) {
      const key = Buffer.from(appConfig.TOKEN_ENCRYPTION_KEY, "utf8").subarray(0, 32);
      webhookSecretEnc = encrypt(webhookSecret, key).toString("base64");
    }

    if (existing) {
      // Re-activate
      await projectRepo.update(tenantId, projectId, {
        status: "active",
        webhookSecretEnc,
      });
    } else {
      await projectRepo.create({
        tenantId,
        adoProjectId: projectId,
        webhookSecretEnc,
        status: "active",
      });
    }

    return {
      projectId,
      status: "active",
      webhookUrl: `/webhooks/ado/${tenantId}`,
      webhookSecret,
    };
  });

  // POST /api/projects/:projectId/disable
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/disable", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const { projectId } = request.params;

    const existing = await projectRepo.findByTenantAndProject(tenantId, projectId);
    if (!existing) {
      return reply.code(404).send({ error: "Project enrollment not found" });
    }

    await projectRepo.deactivate(tenantId, projectId);
    return { projectId, status: "inactive" };
  });
};
