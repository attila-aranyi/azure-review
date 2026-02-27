import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  adoOrgId: varchar("ado_org_id", { length: 255 }).notNull(),
  adoOrgName: varchar("ado_org_name", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  plan: varchar("plan", { length: 50 }).notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tenants_ado_org_id_unique").on(table.adoOrgId),
]);

export const tenantOauthTokens = pgTable("tenant_oauth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tenant_oauth_tokens_tenant_id_idx").on(table.tenantId),
]);

export const tenantConfigs = pgTable("tenant_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  llmMode: varchar("llm_mode", { length: 50 }).notNull().default("managed"),
  llmProvider: varchar("llm_provider", { length: 100 }),
  llmApiKeyEnc: text("llm_api_key_enc"),
  llmEndpoint: text("llm_endpoint"),
  llmModelReview: varchar("llm_model_review", { length: 100 }).notNull().default("gpt-4o"),
  llmModelA11y: varchar("llm_model_a11y", { length: 100 }).notNull().default("gpt-4o"),
  reviewStrictness: varchar("review_strictness", { length: 50 }).notNull().default("balanced"),
  maxFiles: integer("max_files").notNull().default(20),
  maxDiffSize: integer("max_diff_size").notNull().default(2000),
  fileIncludeGlob: text("file_include_glob"),
  fileExcludeGlob: text("file_exclude_glob"),
  enableA11yText: boolean("enable_a11y_text").notNull().default(true),
  enableA11yVisual: boolean("enable_a11y_visual").notNull().default(false),
  enableSecurity: boolean("enable_security").notNull().default(true),
  commentStyle: varchar("comment_style", { length: 50 }).notNull().default("inline"),
  minSeverity: varchar("min_severity", { length: 50 }).notNull().default("low"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tenant_configs_tenant_id_unique").on(table.tenantId),
]);

export const projectEnrollments = pgTable("project_enrollments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  adoProjectId: varchar("ado_project_id", { length: 255 }).notNull(),
  adoProjectName: varchar("ado_project_name", { length: 255 }),
  webhookSecretEnc: text("webhook_secret_enc"),
  serviceHookIds: jsonb("service_hook_ids").$type<string[]>().default([]),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_enrollments_tenant_project_unique").on(table.tenantId, table.adoProjectId),
  index("project_enrollments_tenant_id_idx").on(table.tenantId),
]);

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  adoProjectId: varchar("ado_project_id", { length: 255 }),
  repoId: varchar("repo_id", { length: 255 }).notNull(),
  prId: integer("pr_id").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  sourceCommit: varchar("source_commit", { length: 64 }),
  targetCommit: varchar("target_commit", { length: 64 }),
  changedFiles: jsonb("changed_files").$type<string[]>().default([]),
  hunksProcessed: integer("hunks_processed").default(0),
  tokenUsage: jsonb("token_usage").$type<Record<string, number>>().default({}),
  timings: jsonb("timings").$type<Record<string, number>>().default({}),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("reviews_idempotency_key_unique").on(table.idempotencyKey),
  index("reviews_tenant_id_idx").on(table.tenantId),
  index("reviews_repo_pr_idx").on(table.repoId, table.prId),
]);

export const reviewFindings = pgTable("review_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
  issueType: varchar("issue_type", { length: 50 }).notNull(),
  severity: varchar("severity", { length: 50 }).notNull(),
  filePath: text("file_path").notNull(),
  startLine: integer("start_line").notNull(),
  endLine: integer("end_line").notNull(),
  message: text("message").notNull(),
  suggestion: text("suggestion"),
  findingHash: varchar("finding_hash", { length: 64 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("posted"),
  adoThreadId: integer("ado_thread_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("review_findings_review_id_idx").on(table.reviewId),
]);
