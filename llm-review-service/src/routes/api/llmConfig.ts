import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { DrizzleInstance } from "../../db/connection";
import { createConfigRepo } from "../../db/repos/configRepo";
import { encrypt } from "../../auth/encryption";

const llmKeySchema = z.object({
  llmProvider: z.enum(["openai", "anthropic", "azure_openai"]),
  llmApiKey: z.string().min(1),
  llmEndpoint: z.string().url().optional(),
  llmModelReview: z.string().min(1).optional(),
  llmModelA11y: z.string().min(1).optional(),
});

export const registerLlmConfigRoutes: FastifyPluginAsync<{
  db: DrizzleInstance;
  encryptionKey?: Buffer;
}> = async (app, opts) => {
  const { db, encryptionKey } = opts;
  const configRepo = createConfigRepo(db);

  // PUT /api/config/llm-key - Store BYOK API key (write-only)
  app.put("/config/llm-key", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    if (!encryptionKey) {
      return reply.code(500).send({ error: "Encryption not configured" });
    }

    const parsed = llmKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid LLM config", details: parsed.error.issues });
    }

    const { llmApiKey, llmProvider, llmEndpoint, llmModelReview, llmModelA11y } = parsed.data;

    // Encrypt the API key
    const encrypted = encrypt(llmApiKey, encryptionKey);
    const llmApiKeyEnc = encrypted.toString("base64");

    await configRepo.upsert(tenantId, {
      llmMode: "byok",
      llmProvider,
      llmApiKeyEnc,
      llmEndpoint: llmEndpoint ?? null,
      llmModelReview: llmModelReview ?? "gpt-4o",
      llmModelA11y: llmModelA11y ?? "gpt-4o",
    });

    return {
      ok: true,
      llmMode: "byok",
      llmProvider,
      // Never return the actual API key
      llmKeySet: true,
    };
  });

  // DELETE /api/config/llm-key - Revert to managed mode
  app.delete("/config/llm-key", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    await configRepo.upsert(tenantId, {
      llmMode: "managed",
      llmProvider: null,
      llmApiKeyEnc: null,
      llmEndpoint: null,
    });

    return { ok: true, llmMode: "managed" };
  });

  // GET /api/config/llm-status - Check LLM config status (no key returned)
  app.get("/config/llm-status", async (request, reply) => {
    const tenantId = request.tenantId;
    if (!tenantId) return reply.code(401).send({ error: "Unauthorized" });

    const config = await configRepo.findByTenantId(tenantId);
    return {
      llmMode: config?.llmMode ?? "managed",
      llmProvider: config?.llmProvider ?? null,
      llmKeySet: !!config?.llmApiKeyEnc,
      llmEndpoint: config?.llmEndpoint ?? null,
      llmModelReview: config?.llmModelReview ?? "gpt-4o",
      llmModelA11y: config?.llmModelA11y ?? "gpt-4o",
    };
  });
};
