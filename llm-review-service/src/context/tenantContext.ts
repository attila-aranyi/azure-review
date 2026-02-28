import type { Logger } from "pino";
import type { DrizzleInstance } from "../db/connection";
import type { AppConfig } from "../config/appConfig";
import type { TokenManager } from "../auth/tokenManager";
import { AdoClient } from "../azure/adoClient";
import type { AdoAuth } from "../azure/adoClient";
import type { LLMClient } from "../llm/types";
import { createLlmRouter, loadLlmRouterConfig } from "../llm/llmRouter";
import { createTenantRepo } from "../db/repos/tenantRepo";
import { createConfigRepo } from "../db/repos/configRepo";
import { createLogger } from "../logger";

export interface TenantContext {
  tenantId: string;
  orgUrl: string;
  config: EffectiveReviewConfig;
  adoClient: AdoClient;
  llmClients: {
    llm1: LLMClient;
    llm2: LLMClient;
    llm3?: LLMClient;
    llm4?: LLMClient;
  };
  logger: Logger;
}

export interface EffectiveReviewConfig {
  reviewStrictness: "relaxed" | "balanced" | "strict";
  maxFiles: number;
  maxDiffSize: number;
  maxHunks: number;
  hunkContextLines: number;
  tokenBudgetLlm1: number;
  tokenBudgetLlm2: number;
  tokenBudgetLlm3: number;
  tokenBudgetLlm4: number;
  minSeverity: string;
  enableA11yText: boolean;
  enableA11yVisual: boolean;
  enableSecurity: boolean;
  commentStyle: string;
  a11yFileExtensions: string[];
  fileIncludeGlob?: string;
  fileExcludeGlob?: string;
  enableAxon: boolean;
}

export async function buildTenantContext(
  tenantId: string,
  db: DrizzleInstance,
  appConfig: AppConfig,
  tokenManager: TokenManager,
  encryptionKey?: Buffer,
): Promise<TenantContext> {
  const tenantRepo = createTenantRepo(db);
  const configRepo = createConfigRepo(db);
  const logger = createLogger().child({ tenantId });

  const tenant = await tenantRepo.findById(tenantId);
  if (!tenant) {
    // MED-18: Don't leak internal tenant ID in error messages
    throw new Error("Tenant not found");
  }
  if (tenant.status === "inactive" || tenant.status === "suspended") {
    // MED-18: Generic message, log details internally
    logger.warn({ status: tenant.status }, "Tenant unavailable");
    throw new Error("Tenant unavailable");
  }
  if (tenant.status === "needs_reauth") {
    logger.warn("Tenant needs re-authentication");
    throw new Error("Tenant needs re-authentication");
  }

  const tenantConfig = await configRepo.findByTenantId(tenantId);

  const orgUrl = `https://dev.azure.com/${tenant.adoOrgId}`;

  // Build ADO auth
  let adoAuth: AdoAuth;
  if (appConfig.DEPLOYMENT_MODE === "self-hosted" && appConfig.ADO_PAT) {
    adoAuth = { type: "pat", token: appConfig.ADO_PAT };
  } else {
    const accessToken = await tokenManager.getAccessToken(tenantId);
    adoAuth = { type: "oauth", accessToken };
  }

  const adoClient = new AdoClient(adoAuth, orgUrl, undefined, logger);

  // Build effective review config
  const config: EffectiveReviewConfig = {
    reviewStrictness: (tenantConfig?.reviewStrictness as EffectiveReviewConfig["reviewStrictness"]) ?? "balanced",
    maxFiles: tenantConfig?.maxFiles ?? 20,
    maxDiffSize: tenantConfig?.maxDiffSize ?? 2000,
    maxHunks: 80,
    hunkContextLines: 20,
    tokenBudgetLlm1: 3000,
    tokenBudgetLlm2: 6000,
    tokenBudgetLlm3: 4000,
    tokenBudgetLlm4: 8000,
    minSeverity: tenantConfig?.minSeverity ?? "low",
    enableA11yText: tenantConfig?.enableA11yText ?? true,
    enableA11yVisual: tenantConfig?.enableA11yVisual ?? false,
    enableSecurity: tenantConfig?.enableSecurity ?? true,
    commentStyle: tenantConfig?.commentStyle ?? "inline",
    a11yFileExtensions: [".html", ".jsx", ".tsx", ".vue", ".svelte", ".css", ".scss"],
    fileIncludeGlob: tenantConfig?.fileIncludeGlob ?? undefined,
    fileExcludeGlob: tenantConfig?.fileExcludeGlob ?? undefined,
    enableAxon: false, // Resolved per-repo by configResolver
  };

  // Build LLM clients via LLM Router (supports managed + BYOK)
  const routerConfig = await loadLlmRouterConfig(db, tenantId);
  const router = createLlmRouter(appConfig, routerConfig, encryptionKey, logger);
  const llm1 = router.getClient("llm1");
  const llm2 = router.getClient("llm2");
  const llm3 = routerConfig.llmMode === "byok" ? router.getClient("llm3") : undefined;
  const llm4 = routerConfig.llmMode === "byok" ? router.getClient("llm4") : undefined;

  return {
    tenantId,
    orgUrl,
    config,
    adoClient,
    llmClients: { llm1, llm2, llm3, llm4 },
    logger,
  };
}
