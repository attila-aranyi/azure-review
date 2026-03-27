import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrapSelfHostedTenant, validateSelfHostedLlmKeys } from "../../src/selfHosted/bootstrap";
import type { AppConfig } from "../../src/config/appConfig";

// Mock tenantRepo
const mockFindByAdoOrgId = vi.fn();
const mockCreate = vi.fn();

vi.mock("../../src/db/repos/tenantRepo", () => ({
  createTenantRepo: () => ({
    findByAdoOrgId: mockFindByAdoOrgId,
    create: mockCreate,
  }),
}));

const baseConfig: AppConfig = {
  PORT: 3000,
  LOG_LEVEL: "info",
  CORS_ORIGINS: [],
  RATE_LIMIT_MAX: 30,
  RATE_LIMIT_WINDOW_MS: 60000,
  DATABASE_URL: "postgresql://localhost:5432/test",
  DEPLOYMENT_MODE: "self-hosted",
  AXON_ENABLED: false,
  AUDIT_ENABLED: true,
  AUDIT_RETENTION_DAYS: 30,
};

describe("bootstrapSelfHostedTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates tenant with default org ID when ADO_ORG not set", async () => {
    mockFindByAdoOrgId.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "new-tenant-id", adoOrgId: "self-hosted" });

    const result = await bootstrapSelfHostedTenant({} as never, baseConfig);

    expect(result.created).toBe(true);
    expect(result.adoOrgId).toBe("self-hosted");
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      adoOrgId: "self-hosted",
      plan: "enterprise",
      status: "active",
    }));
  });

  it("uses ADO_ORG when provided", async () => {
    mockFindByAdoOrgId.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "new-id", adoOrgId: "my-org" });

    const config = { ...baseConfig, ADO_ORG: "my-org" };
    const result = await bootstrapSelfHostedTenant({} as never, config);

    expect(result.adoOrgId).toBe("my-org");
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ adoOrgId: "my-org" }));
  });

  it("returns existing tenant without creating", async () => {
    mockFindByAdoOrgId.mockResolvedValue({ id: "existing-id", adoOrgId: "self-hosted" });

    const result = await bootstrapSelfHostedTenant({} as never, baseConfig);

    expect(result.created).toBe(false);
    expect(result.tenantId).toBe("existing-id");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("validateSelfHostedLlmKeys", () => {
  it("returns null when Anthropic key is set", () => {
    const config = { ...baseConfig, ANTHROPIC_API_KEY: "sk-ant-xxx" };
    expect(validateSelfHostedLlmKeys(config)).toBeNull();
  });

  it("returns null when OpenAI key is set", () => {
    const config = { ...baseConfig, OPENAI_API_KEY: "sk-xxx" };
    expect(validateSelfHostedLlmKeys(config)).toBeNull();
  });

  it("returns null when Azure OpenAI is configured", () => {
    const config = {
      ...baseConfig,
      AZURE_OPENAI_API_KEY: "key",
      AZURE_OPENAI_ENDPOINT: "https://endpoint.openai.azure.com",
    };
    expect(validateSelfHostedLlmKeys(config)).toBeNull();
  });

  it("returns error when no LLM keys are set", () => {
    const result = validateSelfHostedLlmKeys(baseConfig);
    expect(result).toContain("requires at least one LLM API key");
  });

  it("returns error when only Azure endpoint without key", () => {
    const config = { ...baseConfig, AZURE_OPENAI_ENDPOINT: "https://endpoint.openai.azure.com" };
    const result = validateSelfHostedLlmKeys(config);
    expect(result).not.toBeNull();
  });
});
