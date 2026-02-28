import type { DrizzleInstance } from "../db/connection";
import { createConfigRepo } from "../db/repos/configRepo";
import { createRepoConfigRepo } from "../db/repos/repoConfigRepo";
import type { EffectiveReviewConfig } from "../context/tenantContext";

const SYSTEM_DEFAULTS: EffectiveReviewConfig = {
  reviewStrictness: "balanced",
  maxFiles: 20,
  maxDiffSize: 2000,
  maxHunks: 80,
  hunkContextLines: 20,
  tokenBudgetLlm1: 3000,
  tokenBudgetLlm2: 6000,
  tokenBudgetLlm3: 4000,
  tokenBudgetLlm4: 8000,
  minSeverity: "low",
  enableA11yText: true,
  enableA11yVisual: false,
  enableSecurity: true,
  commentStyle: "inline",
  a11yFileExtensions: [".html", ".jsx", ".tsx", ".vue", ".svelte", ".css", ".scss"],
  enableAxon: false,
};

// Plan-level caps for config values
const PLAN_CAPS: Record<string, { maxFiles: number; maxDiffSize: number }> = {
  free: { maxFiles: 20, maxDiffSize: 2000 },
  pro: { maxFiles: 50, maxDiffSize: 5000 },
  enterprise: { maxFiles: 200, maxDiffSize: 20000 },
};

export interface ConfigResolver {
  resolve(tenantId: string, repoId?: string, plan?: string): Promise<EffectiveReviewConfig>;
}

export function createConfigResolver(db: DrizzleInstance): ConfigResolver {
  const configRepo = createConfigRepo(db);
  const repoConfigRepo = createRepoConfigRepo(db);

  return {
    async resolve(tenantId, repoId, plan) {
      const tenantConfig = await configRepo.findByTenantId(tenantId);
      const repoConfig = repoId ? await repoConfigRepo.findByTenantAndRepo(tenantId, repoId) : null;

      // Start with system defaults
      const config: EffectiveReviewConfig = { ...SYSTEM_DEFAULTS };

      // Layer 1: Apply tenant config (non-null fields)
      if (tenantConfig) {
        if (tenantConfig.reviewStrictness) config.reviewStrictness = tenantConfig.reviewStrictness as EffectiveReviewConfig["reviewStrictness"];
        if (tenantConfig.maxFiles != null) config.maxFiles = tenantConfig.maxFiles;
        if (tenantConfig.maxDiffSize != null) config.maxDiffSize = tenantConfig.maxDiffSize;
        if (tenantConfig.minSeverity) config.minSeverity = tenantConfig.minSeverity;
        if (tenantConfig.enableA11yText != null) config.enableA11yText = tenantConfig.enableA11yText;
        if (tenantConfig.enableA11yVisual != null) config.enableA11yVisual = tenantConfig.enableA11yVisual;
        if (tenantConfig.enableSecurity != null) config.enableSecurity = tenantConfig.enableSecurity;
        if (tenantConfig.commentStyle) config.commentStyle = tenantConfig.commentStyle;
        if (tenantConfig.fileIncludeGlob) config.fileIncludeGlob = tenantConfig.fileIncludeGlob;
        if (tenantConfig.fileExcludeGlob) config.fileExcludeGlob = tenantConfig.fileExcludeGlob;
      }

      // Layer 2: Apply repo config overrides (only non-null fields)
      if (repoConfig) {
        if (repoConfig.reviewStrictness) config.reviewStrictness = repoConfig.reviewStrictness as EffectiveReviewConfig["reviewStrictness"];
        if (repoConfig.maxFiles != null) config.maxFiles = repoConfig.maxFiles;
        if (repoConfig.maxDiffSize != null) config.maxDiffSize = repoConfig.maxDiffSize;
        if (repoConfig.minSeverity) config.minSeverity = repoConfig.minSeverity;
        if (repoConfig.enableA11yText != null) config.enableA11yText = repoConfig.enableA11yText;
        if (repoConfig.enableA11yVisual != null) config.enableA11yVisual = repoConfig.enableA11yVisual;
        if (repoConfig.enableSecurity != null) config.enableSecurity = repoConfig.enableSecurity;
        if (repoConfig.commentStyle) config.commentStyle = repoConfig.commentStyle;
        if (repoConfig.fileIncludeGlob) config.fileIncludeGlob = repoConfig.fileIncludeGlob;
        if (repoConfig.fileExcludeGlob) config.fileExcludeGlob = repoConfig.fileExcludeGlob;
        if (repoConfig.enableAxon != null) config.enableAxon = repoConfig.enableAxon;
      }

      // Layer 3: Apply plan caps
      const caps = PLAN_CAPS[plan ?? "free"] ?? PLAN_CAPS.free;
      config.maxFiles = Math.min(config.maxFiles, caps.maxFiles);
      config.maxDiffSize = Math.min(config.maxDiffSize, caps.maxDiffSize);

      return config;
    },
  };
}
