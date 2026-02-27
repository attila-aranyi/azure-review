import type { TokenManager } from "../auth/tokenManager";
import { createLogger } from "../logger";

export function startTokenRefreshJob(
  tokenManager: TokenManager,
  intervalMs: number = 10 * 60 * 1000, // 10 minutes default
): { stop: () => void } {
  const logger = createLogger().child({ component: "token-refresh-job" });

  const run = async () => {
    try {
      const results = await tokenManager.refreshAllExpiring();
      if (results.length > 0) {
        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        logger.info({ total: results.length, succeeded, failed }, "Token refresh batch completed");
        for (const r of results.filter((r) => !r.success)) {
          logger.warn({ tenantId: r.tenantId, error: r.error }, "Token refresh failed for tenant");
        }
      }
    } catch (err) {
      logger.error({ err }, "Token refresh job error");
    }
  };

  const interval = setInterval(() => void run(), intervalMs);
  interval.unref();

  // Run immediately on start
  void run();

  return {
    stop() {
      clearInterval(interval);
    },
  };
}
