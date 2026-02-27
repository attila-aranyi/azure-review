import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

const baseEnv: NodeJS.ProcessEnv = {
  WEBHOOK_SECRET: "secret",
  ADO_ORG: "org",
  ADO_PROJECT: "project",
  ADO_PAT: "pat",
  LLM1_PROVIDER: "mock",
  LLM2_PROVIDER: "mock"
};

describe("config", () => {
  it("throws on missing required env", () => {
    expect(() => loadConfig({ ...baseEnv, WEBHOOK_SECRET: undefined })).toThrow(/WEBHOOK_SECRET/);
  });

  it("applies defaults", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.PORT).toBe(3000);
    expect(config.MAX_FILES).toBe(20);
  });

  it("requires provider-specific settings", () => {
    expect(() => loadConfig({ ...baseEnv, LLM1_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
  });

  it("LLM3_ENABLED=true requires LLM3_PROVIDER", () => {
    expect(() => loadConfig({ ...baseEnv, LLM3_ENABLED: "true" })).toThrow(/LLM3_PROVIDER/);
  });

  it("LLM3_ENABLED=true with openai provider requires model", () => {
    expect(() =>
      loadConfig({ ...baseEnv, LLM3_ENABLED: "true", LLM3_PROVIDER: "openai", OPENAI_API_KEY: "key" })
    ).toThrow(/OPENAI_MODEL_LLM3/);
  });

  it("LLM3_ENABLED=false does not require LLM3 vars", () => {
    const config = loadConfig({ ...baseEnv, LLM3_ENABLED: "false" });
    expect(config.LLM3_ENABLED).toBe(false);
  });

  it("LLM3_ENABLED defaults to false", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.LLM3_ENABLED).toBe(false);
  });

  it("parses A11Y_FILE_EXTENSIONS", () => {
    const config = loadConfig({ ...baseEnv, A11Y_FILE_EXTENSIONS: ".html,.vue" });
    expect(config.A11Y_FILE_EXTENSIONS).toEqual([".html", ".vue"]);
  });

  it("LLM3 with mock provider succeeds", () => {
    const config = loadConfig({ ...baseEnv, LLM3_ENABLED: "true", LLM3_PROVIDER: "mock" });
    expect(config.LLM3_ENABLED).toBe(true);
    expect(config.LLM3_PROVIDER).toBe("mock");
  });

  it("AUDIT_ENABLED defaults to true", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.AUDIT_ENABLED).toBe(true);
  });

  it("AUDIT_ENABLED can be set to false", () => {
    const config = loadConfig({ ...baseEnv, AUDIT_ENABLED: "false" });
    expect(config.AUDIT_ENABLED).toBe(false);
  });

  it("AUDIT_RETENTION_DAYS defaults to 30", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.AUDIT_RETENTION_DAYS).toBe(30);
  });

  it("AUDIT_RETENTION_DAYS can be overridden", () => {
    const config = loadConfig({ ...baseEnv, AUDIT_RETENTION_DAYS: "7" });
    expect(config.AUDIT_RETENTION_DAYS).toBe(7);
  });

  it("AUDIT_ENABLED accepts case-insensitive 'TRUE'", () => {
    const config = loadConfig({ ...baseEnv, AUDIT_ENABLED: "TRUE" });
    expect(config.AUDIT_ENABLED).toBe(true);
  });

  it("AUDIT_ENABLED accepts '1' as truthy", () => {
    const config = loadConfig({ ...baseEnv, AUDIT_ENABLED: "1" });
    expect(config.AUDIT_ENABLED).toBe(true);
  });

  it("AUDIT_ENABLED treats empty string as false", () => {
    const config = loadConfig({ ...baseEnv, AUDIT_ENABLED: "" });
    expect(config.AUDIT_ENABLED).toBe(false);
  });

  it("REVIEW_MIN_SEVERITY defaults to low", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.REVIEW_MIN_SEVERITY).toBe("low");
  });

  it("REVIEW_MIN_SEVERITY accepts valid values", () => {
    for (const val of ["low", "medium", "high", "critical"] as const) {
      const config = loadConfig({ ...baseEnv, REVIEW_MIN_SEVERITY: val });
      expect(config.REVIEW_MIN_SEVERITY).toBe(val);
    }
  });

  it("REVIEW_MIN_SEVERITY rejects invalid values", () => {
    expect(() => loadConfig({ ...baseEnv, REVIEW_MIN_SEVERITY: "none" })).toThrow();
  });

  it("REVIEW_STRICTNESS defaults to balanced", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.REVIEW_STRICTNESS).toBe("balanced");
  });

  it("REVIEW_STRICTNESS accepts valid values", () => {
    for (const val of ["relaxed", "balanced", "strict"] as const) {
      const config = loadConfig({ ...baseEnv, REVIEW_STRICTNESS: val });
      expect(config.REVIEW_STRICTNESS).toBe(val);
    }
  });

  it("REVIEW_STRICTNESS rejects invalid values", () => {
    expect(() => loadConfig({ ...baseEnv, REVIEW_STRICTNESS: "ultra" })).toThrow();
  });
});
