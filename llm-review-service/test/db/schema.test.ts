import { describe, it, expect } from "vitest";
import { getTableName } from "drizzle-orm";
import * as schema from "../../src/db/schema";

describe("DB schema", () => {
  it("exports all tables", () => {
    expect(schema.tenants).toBeDefined();
    expect(schema.tenantOauthTokens).toBeDefined();
    expect(schema.tenantConfigs).toBeDefined();
    expect(schema.projectEnrollments).toBeDefined();
    expect(schema.reviews).toBeDefined();
    expect(schema.reviewFindings).toBeDefined();
  });

  it("tables have correct names", () => {
    expect(getTableName(schema.tenants)).toBe("tenants");
    expect(getTableName(schema.tenantOauthTokens)).toBe("tenant_oauth_tokens");
    expect(getTableName(schema.tenantConfigs)).toBe("tenant_configs");
    expect(getTableName(schema.projectEnrollments)).toBe("project_enrollments");
    expect(getTableName(schema.reviews)).toBe("reviews");
    expect(getTableName(schema.reviewFindings)).toBe("review_findings");
  });

  it("tenants table has expected columns", () => {
    const cols = schema.tenants;
    expect(cols.id).toBeDefined();
    expect(cols.adoOrgId).toBeDefined();
    expect(cols.adoOrgName).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.plan).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  it("tenantOauthTokens has tenant_id FK", () => {
    const cols = schema.tenantOauthTokens;
    expect(cols.tenantId).toBeDefined();
    expect(cols.accessTokenEnc).toBeDefined();
    expect(cols.refreshTokenEnc).toBeDefined();
    expect(cols.expiresAt).toBeDefined();
  });

  it("tenantConfigs has tenant_id FK", () => {
    const cols = schema.tenantConfigs;
    expect(cols.tenantId).toBeDefined();
    expect(cols.llmMode).toBeDefined();
    expect(cols.reviewStrictness).toBeDefined();
    expect(cols.maxFiles).toBeDefined();
    expect(cols.maxDiffSize).toBeDefined();
  });

  it("projectEnrollments has tenant_id FK and project fields", () => {
    const cols = schema.projectEnrollments;
    expect(cols.tenantId).toBeDefined();
    expect(cols.adoProjectId).toBeDefined();
    expect(cols.webhookSecretEnc).toBeDefined();
    expect(cols.serviceHookIds).toBeDefined();
    expect(cols.status).toBeDefined();
  });

  it("reviews has tenant_id FK and review fields", () => {
    const cols = schema.reviews;
    expect(cols.tenantId).toBeDefined();
    expect(cols.repoId).toBeDefined();
    expect(cols.prId).toBeDefined();
    expect(cols.idempotencyKey).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.tokenUsage).toBeDefined();
    expect(cols.timings).toBeDefined();
  });

  it("reviewFindings has review_id FK and finding fields", () => {
    const cols = schema.reviewFindings;
    expect(cols.reviewId).toBeDefined();
    expect(cols.issueType).toBeDefined();
    expect(cols.severity).toBeDefined();
    expect(cols.filePath).toBeDefined();
    expect(cols.startLine).toBeDefined();
    expect(cols.endLine).toBeDefined();
    expect(cols.message).toBeDefined();
    expect(cols.findingHash).toBeDefined();
    expect(cols.adoThreadId).toBeDefined();
  });
});
