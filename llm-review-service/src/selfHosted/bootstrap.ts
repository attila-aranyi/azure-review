import type { DrizzleInstance } from "../db/connection";
import { createTenantRepo } from "../db/repos/tenantRepo";
import type { AppConfig } from "../config/appConfig";

export interface BootstrapResult {
  tenantId: string;
  adoOrgId: string;
  created: boolean;
}

/**
 * In self-hosted mode, auto-creates a single tenant on startup if none exists.
 * Uses ADO_ORG env var or defaults to "self-hosted".
 */
export async function bootstrapSelfHostedTenant(
  db: DrizzleInstance,
  appConfig: AppConfig,
): Promise<BootstrapResult> {
  const tenantRepo = createTenantRepo(db);
  const adoOrgId = appConfig.ADO_ORG ?? "self-hosted";

  // Check if tenant already exists
  const existing = await tenantRepo.findByAdoOrgId(adoOrgId);
  if (existing) {
    return { tenantId: existing.id, adoOrgId, created: false };
  }

  // Create auto-provisioned tenant with enterprise plan (no limits)
  const tenant = await tenantRepo.create({
    adoOrgId,
    adoOrgName: adoOrgId,
    status: "active",
    plan: "enterprise",
  });

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
