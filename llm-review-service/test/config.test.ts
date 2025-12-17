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
});
