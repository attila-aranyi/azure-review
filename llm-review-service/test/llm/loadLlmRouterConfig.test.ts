import { describe, it, expect, vi } from "vitest";
import { loadLlmRouterConfig } from "../../src/llm/llmRouter";

vi.mock("../../src/db/repos/configRepo", () => ({
  createConfigRepo: () => ({
    findByTenantId: vi.fn().mockResolvedValue(null),
  }),
}));

describe("loadLlmRouterConfig", () => {
  it("returns managed mode with defaults when no tenant config", async () => {
    const config = await loadLlmRouterConfig({} as never, "t1");

    expect(config.tenantId).toBe("t1");
    expect(config.llmMode).toBe("managed");
    expect(config.llmModelReview).toBe("gpt-4o");
    expect(config.llmModelA11y).toBe("gpt-4o");
    expect(config.llmProvider).toBeUndefined();
    expect(config.llmApiKeyEnc).toBeUndefined();
    expect(config.llmEndpoint).toBeUndefined();
  });
});
