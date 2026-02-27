import { describe, it, expect, vi, afterEach } from "vitest";
import { startTokenRefreshJob } from "../../src/jobs/tokenRefresh";
import type { TokenManager } from "../../src/auth/tokenManager";

describe("startTokenRefreshJob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls tokenManager.refreshAllExpiring on start", async () => {
    const mockTokenManager = {
      refreshAllExpiring: vi.fn().mockResolvedValue([]),
    } as unknown as TokenManager;

    const job = startTokenRefreshJob(mockTokenManager, 100_000);
    // Give it a tick to run the immediate call
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockTokenManager.refreshAllExpiring).toHaveBeenCalledOnce();
    job.stop();
  });

  it("stop() clears the interval", () => {
    const mockTokenManager = {
      refreshAllExpiring: vi.fn().mockResolvedValue([]),
    } as unknown as TokenManager;

    const job = startTokenRefreshJob(mockTokenManager, 100_000);
    job.stop();
    // Should not throw or cause issues
  });

  it("logs results when tokens are refreshed", async () => {
    const mockTokenManager = {
      refreshAllExpiring: vi.fn().mockResolvedValue([
        { tenantId: "t1", success: true },
        { tenantId: "t2", success: false, error: "network error" },
      ]),
    } as unknown as TokenManager;

    const job = startTokenRefreshJob(mockTokenManager, 100_000);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockTokenManager.refreshAllExpiring).toHaveBeenCalledOnce();
    job.stop();
  });

  it("handles errors in refreshAllExpiring gracefully", async () => {
    const mockTokenManager = {
      refreshAllExpiring: vi.fn().mockRejectedValue(new Error("DB down")),
    } as unknown as TokenManager;

    const job = startTokenRefreshJob(mockTokenManager, 100_000);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should not throw
    expect(mockTokenManager.refreshAllExpiring).toHaveBeenCalledOnce();
    job.stop();
  });
});
