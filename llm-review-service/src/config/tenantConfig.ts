import { z } from "zod";

export const tenantConfigSchema = z.object({
  llmMode: z.enum(["managed", "byok"]).default("managed"),
  llmProvider: z.string().optional(),
  llmApiKeyEnc: z.instanceof(Buffer).optional(),
  llmEndpoint: z.string().optional(),
  llmModelReview: z.string().default("gpt-4o"),
  llmModelA11y: z.string().default("gpt-4o"),
  reviewStrictness: z.enum(["relaxed", "balanced", "strict"]).default("balanced"),
  maxFiles: z.number().int().positive().default(20),
  maxDiffSize: z.number().int().positive().default(2000),
  fileIncludeGlob: z.string().optional(),
  fileExcludeGlob: z.string().optional(),
  enableA11yText: z.boolean().default(true),
  enableA11yVisual: z.boolean().default(false),
  enableSecurity: z.boolean().default(true),
  commentStyle: z.enum(["inline", "summary", "both"]).default("inline"),
  minSeverity: z.enum(["low", "medium", "high", "critical"]).default("low"),
});

export type TenantConfig = z.infer<typeof tenantConfigSchema>;

export const defaultTenantConfig: TenantConfig = tenantConfigSchema.parse({});

export function parseTenantConfig(data: unknown): TenantConfig {
  return tenantConfigSchema.parse(data);
}

export function parseTenantConfigPartial(data: unknown): Partial<TenantConfig> {
  return tenantConfigSchema.partial().parse(data);
}
