import { z } from "zod";

const optionalNonEmpty = () =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    z.string().min(1).optional()
  );

const commaSeparatedList = () =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return [];
      return value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    },
    z.array(z.string())
  );

export const appConfigSchema = z
  .object({
    // Server
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    CORS_ORIGINS: commaSeparatedList().default([]),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

    // Database
    DATABASE_URL: z.string().min(1),

    // Redis (optional)
    REDIS_URL: optionalNonEmpty(),

    // OAuth
    OAUTH_CLIENT_ID: z.string().min(1).optional(),
    OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    OAUTH_REDIRECT_URI: z.string().min(1).optional(),

    // Encryption (prefer 64-char hex string = 32 bytes)
    TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),

    // Deployment mode
    DEPLOYMENT_MODE: z.enum(["saas", "self-hosted"]).default("saas"),

    // Self-hosted fallback fields
    ADO_ORG: optionalNonEmpty(),
    ADO_PROJECT: optionalNonEmpty(),
    ADO_PAT: optionalNonEmpty(),
    ADO_BOT_PAT: optionalNonEmpty(),
    WEBHOOK_SECRET: optionalNonEmpty(),

    // LLM provider keys (for managed/self-hosted)
    ANTHROPIC_API_KEY: optionalNonEmpty(),
    OPENAI_API_KEY: optionalNonEmpty(),
    AZURE_OPENAI_ENDPOINT: optionalNonEmpty(),
    AZURE_OPENAI_API_KEY: optionalNonEmpty(),

    // Audit
    AUDIT_ENABLED: z.preprocess(
      (v) => {
        if (v === undefined) return true;
        if (typeof v === "boolean") return v;
        if (typeof v === "string") {
          const lower = v.trim().toLowerCase();
          if (lower === "" || lower === "false" || lower === "0" || lower === "no") return false;
          return true;
        }
        return Boolean(v);
      },
      z.boolean().default(true)
    ),
    AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  })
  .strip()
  .superRefine((data, ctx) => {
    if (data.DEPLOYMENT_MODE === "saas") {
      if (!data.OAUTH_CLIENT_ID) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "OAUTH_CLIENT_ID is required in saas mode", path: ["OAUTH_CLIENT_ID"] });
      }
      if (!data.OAUTH_CLIENT_SECRET) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "OAUTH_CLIENT_SECRET is required in saas mode", path: ["OAUTH_CLIENT_SECRET"] });
      }
      if (!data.OAUTH_REDIRECT_URI) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "OAUTH_REDIRECT_URI is required in saas mode", path: ["OAUTH_REDIRECT_URI"] });
      }
      if (!data.TOKEN_ENCRYPTION_KEY) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "TOKEN_ENCRYPTION_KEY is required in saas mode", path: ["TOKEN_ENCRYPTION_KEY"] });
      }
    }
    if (data.DEPLOYMENT_MODE === "self-hosted") {
      if (!data.ADO_PAT && !data.OAUTH_CLIENT_ID) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ADO_PAT or OAUTH_CLIENT_ID is required in self-hosted mode", path: ["ADO_PAT"] });
      }
    }
  });

export type AppConfig = z.infer<typeof appConfigSchema>;

export function loadAppConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return appConfigSchema.parse(env) as AppConfig;
}
