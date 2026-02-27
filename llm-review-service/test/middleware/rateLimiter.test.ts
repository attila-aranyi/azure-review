import { describe, it, expect } from "vitest";
import { tenantRateLimiter } from "../../src/middleware/rateLimiter";

describe("tenantRateLimiter", () => {
  it("exports tenantRateLimiter function", () => {
    expect(typeof tenantRateLimiter).toBe("function");
  });
});
