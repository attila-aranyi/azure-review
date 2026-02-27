import { describe, it, expect } from "vitest";
import { loadAppConfig } from "../../src/config/appConfig";

function saasEnv(overrides?: Record<string, string>): Record<string, string> {
  return {
    DATABASE_URL: "postgresql://localhost:5432/test",
    OAUTH_CLIENT_ID: "test-client-id",
    OAUTH_CLIENT_SECRET: "test-client-secret",
    OAUTH_REDIRECT_URI: "https://example.com/callback",
    TOKEN_ENCRYPTION_KEY: "a".repeat(32),
    ...overrides,
  };
}

function selfHostedEnv(overrides?: Record<string, string>): Record<string, string> {
  return {
    DATABASE_URL: "postgresql://localhost:5432/test",
    DEPLOYMENT_MODE: "self-hosted",
    ADO_PAT: "test-pat-token",
    ...overrides,
  };
}

describe("loadAppConfig", () => {
  it("validates required fields (DATABASE_URL)", () => {
    expect(() => loadAppConfig({})).toThrow();
  });

  it("applies defaults for PORT, LOG_LEVEL, DEPLOYMENT_MODE", () => {
    const config = loadAppConfig(saasEnv());
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.DEPLOYMENT_MODE).toBe("saas");
  });

  it("applies custom PORT", () => {
    const config = loadAppConfig(saasEnv({ PORT: "8080" }));
    expect(config.PORT).toBe(8080);
  });

  it("rejects missing OAUTH_CLIENT_ID in saas mode", () => {
    expect(() =>
      loadAppConfig({
        DATABASE_URL: "postgresql://localhost:5432/test",
        OAUTH_CLIENT_SECRET: "secret",
        OAUTH_REDIRECT_URI: "https://example.com/callback",
        TOKEN_ENCRYPTION_KEY: "a".repeat(32),
      })
    ).toThrow(/OAUTH_CLIENT_ID/);
  });

  it("rejects missing OAUTH_CLIENT_SECRET in saas mode", () => {
    expect(() =>
      loadAppConfig({
        DATABASE_URL: "postgresql://localhost:5432/test",
        OAUTH_CLIENT_ID: "id",
        OAUTH_REDIRECT_URI: "https://example.com/callback",
        TOKEN_ENCRYPTION_KEY: "a".repeat(32),
      })
    ).toThrow(/OAUTH_CLIENT_SECRET/);
  });

  it("rejects missing TOKEN_ENCRYPTION_KEY in saas mode", () => {
    expect(() =>
      loadAppConfig({
        DATABASE_URL: "postgresql://localhost:5432/test",
        OAUTH_CLIENT_ID: "id",
        OAUTH_CLIENT_SECRET: "secret",
        OAUTH_REDIRECT_URI: "https://example.com/callback",
      })
    ).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("self-hosted mode allows ADO_PAT instead of OAuth fields", () => {
    const config = loadAppConfig(selfHostedEnv());
    expect(config.DEPLOYMENT_MODE).toBe("self-hosted");
    expect(config.ADO_PAT).toBe("test-pat-token");
  });

  it("self-hosted mode rejects missing ADO_PAT and OAUTH_CLIENT_ID", () => {
    expect(() =>
      loadAppConfig({
        DATABASE_URL: "postgresql://localhost:5432/test",
        DEPLOYMENT_MODE: "self-hosted",
      })
    ).toThrow(/ADO_PAT/);
  });

  it("parses CORS_ORIGINS as comma-separated list", () => {
    const config = loadAppConfig(saasEnv({ CORS_ORIGINS: "https://a.com, https://b.com" }));
    expect(config.CORS_ORIGINS).toEqual(["https://a.com", "https://b.com"]);
  });

  it("defaults CORS_ORIGINS to empty array", () => {
    const config = loadAppConfig(saasEnv());
    expect(config.CORS_ORIGINS).toEqual([]);
  });

  it("defaults RATE_LIMIT_MAX to 30", () => {
    const config = loadAppConfig(saasEnv());
    expect(config.RATE_LIMIT_MAX).toBe(30);
  });

  it("defaults AUDIT_ENABLED to true", () => {
    const config = loadAppConfig(saasEnv());
    expect(config.AUDIT_ENABLED).toBe(true);
  });

  it("parses AUDIT_ENABLED=false", () => {
    const config = loadAppConfig(saasEnv({ AUDIT_ENABLED: "false" }));
    expect(config.AUDIT_ENABLED).toBe(false);
  });

  it("strips unknown env vars (MED-19 fix)", () => {
    const config = loadAppConfig(saasEnv({ CUSTOM_VAR: "hello" }));
    expect((config as Record<string, unknown>).CUSTOM_VAR).toBeUndefined();
  });
});
