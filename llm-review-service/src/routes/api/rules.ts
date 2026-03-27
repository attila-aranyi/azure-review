import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { DrizzleInstance } from "../../db/connection";
import { createRulesRepo } from "../../db/repos/rulesRepo";
import { reviewRuleSchema, validateRuleContent } from "../../review/reviewRules";

const ruleUpdateSchema = z.object({
  name: reviewRuleSchema.shape.name.optional(),
  description: reviewRuleSchema.shape.description.optional(),
  category: reviewRuleSchema.shape.category.optional(),
  severity: reviewRuleSchema.shape.severity.optional(),
  fileGlob: z.string().max(200).nullable().optional(),
  instruction: reviewRuleSchema.shape.instruction.optional(),
  exampleGood: z.string().max(1000).nullable().optional(),
  exampleBad: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const registerRulesRoutes: FastifyPluginAsync<{
  db: DrizzleInstance;
}> = async (app, opts) => {
  const { db } = opts;
  const rulesRepo = createRulesRepo(db);

  // ── Tenant-level rules ──

  // GET /rules — list tenant-level rules
  app.get("/rules", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const rules = await rulesRepo.listTenantRules(tenantId);
    return { rules };
  });

  // POST /rules — create tenant-level rule
  app.post("/rules", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = reviewRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid rule", details: parsed.error.issues });
    }

    const contentCheck = validateRuleContent(parsed.data);
    if (!contentCheck.valid) {
      return reply.code(400).send({
        error: "Rule contains blocked keywords that could indicate prompt injection",
        blockedFields: contentCheck.blockedFields,
      });
    }

    try {
      const rule = await rulesRepo.create({ tenantId, ...parsed.data });
      return reply.code(201).send({ rule });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Maximum of")) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  // PUT /rules/:ruleId — update tenant-level rule
  app.put<{ Params: { ruleId: string } }>("/rules/:ruleId", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = ruleUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid rule update", details: parsed.error.issues });
    }

    // Validate blocked keywords on text fields being updated
    const contentCheck = validateRuleContent({
      name: "no-check",
      description: parsed.data.description ?? "",
      category: "style",
      severity: "medium",
      instruction: parsed.data.instruction ?? "",
      exampleGood: parsed.data.exampleGood,
      exampleBad: parsed.data.exampleBad,
      enabled: true,
    });
    if (!contentCheck.valid) {
      return reply.code(400).send({
        error: "Rule contains blocked keywords that could indicate prompt injection",
        blockedFields: contentCheck.blockedFields,
      });
    }

    const updated = await rulesRepo.update(tenantId, request.params.ruleId, parsed.data);
    if (!updated) {
      return reply.code(404).send({ error: "Rule not found" });
    }
    return { rule: updated };
  });

  // DELETE /rules/:ruleId — delete tenant-level rule
  app.delete<{ Params: { ruleId: string } }>("/rules/:ruleId", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const removed = await rulesRepo.remove(tenantId, request.params.ruleId);
    if (!removed) {
      return reply.code(404).send({ error: "Rule not found" });
    }
    return { ok: true };
  });

  // ── Repo-level rules ──

  // GET /repos/:repoId/rules — list repo-level rules
  app.get<{ Params: { repoId: string } }>("/repos/:repoId/rules", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const rules = await rulesRepo.listRepoRules(tenantId, request.params.repoId);
    return { rules };
  });

  // POST /repos/:repoId/rules — create repo-level rule
  app.post<{ Params: { repoId: string } }>("/repos/:repoId/rules", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = reviewRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid rule", details: parsed.error.issues });
    }

    const contentCheck = validateRuleContent(parsed.data);
    if (!contentCheck.valid) {
      return reply.code(400).send({
        error: "Rule contains blocked keywords that could indicate prompt injection",
        blockedFields: contentCheck.blockedFields,
      });
    }

    try {
      const rule = await rulesRepo.create({ tenantId, adoRepoId: request.params.repoId, ...parsed.data });
      return reply.code(201).send({ rule });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Maximum of")) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  // GET /repos/:repoId/rules/effective — list effective rules (tenant + repo)
  app.get<{ Params: { repoId: string } }>("/repos/:repoId/rules/effective", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const rules = await rulesRepo.listEffectiveRules(tenantId, request.params.repoId);
    return { rules };
  });
};
