import { describe, it, expect } from "vitest";
import { loadAppConfig } from "../../src/config/appConfig";

describe("self-hosted deployment mode config", () => {
  it("accepts self-hosted mode with PAT auth", () => {
    const config = loadAppConfig({
      DEPLOYMENT_MODE: "self-hosted",
      DATABASE_URL: "postgresql://localhost:5432/test",
      ADO_PAT: "my-pat-token",
    });
    expect(config.DEPLOYMENT_MODE).toBe("self-hosted");
    expect(config.ADO_PAT).toBe("my-pat-token");
  });

  it("accepts self-hosted mode with OAuth auth", () => {
    const config = loadAppConfig({
      DEPLOYMENT_MODE: "self-hosted",
      DATABASE_URL: "postgresql://localhost:5432/test",
      OAUTH_CLIENT_ID: "client-id",
      OAUTH_CLIENT_SECRET: "client-secret",
      OAUTH_REDIRECT_URI: "https://localhost/callback",
      TOKEN_ENCRYPTION_KEY: "a".repeat(32),
    });
    expect(config.DEPLOYMENT_MODE).toBe("self-hosted");
  });

  it("rejects self-hosted mode without PAT or OAuth", () => {
    expect(() =>
      loadAppConfig({
        DEPLOYMENT_MODE: "self-hosted",
        DATABASE_URL: "postgresql://localhost:5432/test",
      })
    ).toThrow();
  });

  it("does not require OAuth fields in self-hosted mode", () => {
    const config = loadAppConfig({
      DEPLOYMENT_MODE: "self-hosted",
      DATABASE_URL: "postgresql://localhost:5432/test",
      ADO_PAT: "my-pat",
    });
    expect(config.OAUTH_CLIENT_ID).toBeUndefined();
    expect(config.OAUTH_CLIENT_SECRET).toBeUndefined();
  });

  it("defaults to saas mode", () => {
    const config = loadAppConfig({
      DATABASE_URL: "postgresql://localhost:5432/test",
      OAUTH_CLIENT_ID: "id",
      OAUTH_CLIENT_SECRET: "secret",
      OAUTH_REDIRECT_URI: "https://localhost/callback",
      TOKEN_ENCRYPTION_KEY: "a".repeat(32),
    });
    expect(config.DEPLOYMENT_MODE).toBe("saas");
  });
});
