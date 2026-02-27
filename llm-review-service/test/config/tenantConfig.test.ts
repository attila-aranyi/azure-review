import { describe, it, expect } from "vitest";
import { parseTenantConfig, parseTenantConfigPartial, defaultTenantConfig } from "../../src/config/tenantConfig";

describe("tenantConfig", () => {
  it("applies default values correctly", () => {
    const config = parseTenantConfig({});
    expect(config.llmMode).toBe("managed");
    expect(config.reviewStrictness).toBe("balanced");
    expect(config.maxFiles).toBe(20);
    expect(config.maxDiffSize).toBe(2000);
    expect(config.enableA11yText).toBe(true);
    expect(config.enableA11yVisual).toBe(false);
    expect(config.enableSecurity).toBe(true);
    expect(config.commentStyle).toBe("inline");
    expect(config.minSeverity).toBe("low");
  });

  it("defaultTenantConfig has all defaults set", () => {
    expect(defaultTenantConfig.llmMode).toBe("managed");
    expect(defaultTenantConfig.reviewStrictness).toBe("balanced");
  });

  it("accepts valid enum values", () => {
    const config = parseTenantConfig({
      llmMode: "byok",
      reviewStrictness: "strict",
      commentStyle: "both",
      minSeverity: "high",
    });
    expect(config.llmMode).toBe("byok");
    expect(config.reviewStrictness).toBe("strict");
    expect(config.commentStyle).toBe("both");
    expect(config.minSeverity).toBe("high");
  });

  it("rejects invalid llmMode value", () => {
    expect(() => parseTenantConfig({ llmMode: "invalid" })).toThrow();
  });

  it("rejects invalid reviewStrictness value", () => {
    expect(() => parseTenantConfig({ reviewStrictness: "ultra" })).toThrow();
  });

  it("rejects invalid commentStyle value", () => {
    expect(() => parseTenantConfig({ commentStyle: "thread" })).toThrow();
  });

  it("rejects invalid minSeverity value", () => {
    expect(() => parseTenantConfig({ minSeverity: "none" })).toThrow();
  });

  it("rejects negative maxFiles", () => {
    expect(() => parseTenantConfig({ maxFiles: -1 })).toThrow();
  });

  it("rejects non-integer maxFiles", () => {
    expect(() => parseTenantConfig({ maxFiles: 1.5 })).toThrow();
  });

  it("accepts optional fields", () => {
    const config = parseTenantConfig({
      llmProvider: "anthropic",
      llmEndpoint: "https://api.example.com",
      fileIncludeGlob: "**/*.ts",
      fileExcludeGlob: "**/node_modules/**",
    });
    expect(config.llmProvider).toBe("anthropic");
    expect(config.llmEndpoint).toBe("https://api.example.com");
    expect(config.fileIncludeGlob).toBe("**/*.ts");
    expect(config.fileExcludeGlob).toBe("**/node_modules/**");
  });

  it("parseTenantConfigPartial allows partial updates", () => {
    const partial = parseTenantConfigPartial({ reviewStrictness: "relaxed" });
    expect(partial.reviewStrictness).toBe("relaxed");
    expect(partial.maxFiles).toBeUndefined();
  });

  it("parseTenantConfigPartial rejects invalid values", () => {
    expect(() => parseTenantConfigPartial({ reviewStrictness: "invalid" })).toThrow();
  });
});
