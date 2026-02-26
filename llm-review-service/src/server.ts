import "dotenv/config";
import { loadConfig } from "./config";
import { buildApp } from "./app";
import { createLogger } from "./logger";

async function main() {
  const config = loadConfig(process.env);
  const app = await buildApp({ config });
  const logger = createLogger();

  const shutdownTimeoutMs = 30_000;
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutdown signal received, draining connections…");

    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExit.unref();

    try {
      await app.close();
      logger.info("Server closed gracefully");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Startup banner
  logger.info(
    {
      port: config.PORT,
      llm1Provider: config.LLM1_PROVIDER,
      llm2Provider: config.LLM2_PROVIDER,
      queueEnabled: !!config.REDIS_URL,
      maxFiles: config.MAX_FILES,
      maxHunks: config.MAX_HUNKS,
      maxTotalDiffLines: config.MAX_TOTAL_DIFF_LINES
    },
    "Starting llm-review-service"
  );

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
