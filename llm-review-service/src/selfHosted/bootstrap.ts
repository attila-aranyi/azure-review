import type { DrizzleInstance } from "../db/connection";
import { createTenantRepo } from "../db/repos/tenantRepo";
import { createProjectRepo } from "../db/repos/projectRepo";
import { encrypt } from "../auth/encryption";
import type { AppConfig } from "../config/appConfig";

export interface BootstrapResult {
  tenantId: string;
  adoOrgId: string;
  created: boolean;
}

/**
 * In self-hosted mode, auto-creates a single tenant on startup if none exists.
 * Also creates a project enrollment with the webhook secret so webhooks can authenticate.
 * Uses ADO_ORG env var or defaults to "self-hosted".
 */
export async function bootstrapSelfHostedTenant(
  db: DrizzleInstance,
  appConfig: AppConfig,
  encryptionKey?: Buffer,
): Promise<BootstrapResult> {
  const tenantRepo = createTenantRepo(db);
  const projectRepo = createProjectRepo(db);
  const adoOrgId = appConfig.ADO_ORG ?? "self-hosted";
  const adoProjectId = appConfig.ADO_PROJECT ?? "default";

  // Check if tenant already exists
  const existing = await tenantRepo.findByAdoOrgId(adoOrgId);
  if (existing) {
    // Ensure project enrollment exists with current webhook secret
    if (appConfig.WEBHOOK_SECRET && encryptionKey) {
      const enrollments = await projectRepo.findByTenantId(existing.id);
      if (enrollments.length === 0) {
        const encSecret = encrypt(appConfig.WEBHOOK_SECRET, encryptionKey).toString("base64");
        await projectRepo.create({
          tenantId: existing.id,
          adoProjectId,
          adoProjectName: adoProjectId,
          webhookSecretEnc: encSecret,
          status: "active",
        });
      }
    }
    return { tenantId: existing.id, adoOrgId, created: false };
  }

  // Create auto-provisioned tenant with enterprise plan (no limits)
  const tenant = await tenantRepo.create({
    adoOrgId,
    adoOrgName: adoOrgId,
    status: "active",
    plan: "enterprise",
  });

  // Create project enrollment with webhook secret
  if (appConfig.WEBHOOK_SECRET && encryptionKey) {
    const encSecret = encrypt(appConfig.WEBHOOK_SECRET, encryptionKey).toString("base64");
    await projectRepo.create({
      tenantId: tenant.id,
      adoProjectId,
      adoProjectName: adoProjectId,
      webhookSecretEnc: encSecret,
      status: "active",
    });
  }

  return { tenantId: tenant.id, adoOrgId, created: true };
}

/**
 * Validates that self-hosted mode has required LLM keys (BYOK mandatory).
 * Returns an error message if validation fails, null if OK.
 */
export function validateSelfHostedLlmKeys(appConfig: AppConfig): string | null {
  const hasAnthropicKey = !!appConfig.ANTHROPIC_API_KEY;
  const hasOpenAIKey = !!appConfig.OPENAI_API_KEY;
  const hasAzureOpenAIKey = !!appConfig.AZURE_OPENAI_API_KEY && !!appConfig.AZURE_OPENAI_ENDPOINT;

  if (!hasAnthropicKey && !hasOpenAIKey && !hasAzureOpenAIKey) {
    return "Self-hosted mode requires at least one LLM API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT)";
  }

  return null;
}
