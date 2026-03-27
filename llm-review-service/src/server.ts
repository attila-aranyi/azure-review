import "dotenv/config";
import { loadConfig } from "./config";
import { loadAppConfig } from "./config/appConfig";
import { buildApp } from "./app";
import { createLogger } from "./logger";
import { initializeDb, getDb, closeDb } from "./db/connection";
import { runMigrations } from "./db/migrate";
import { TokenManager } from "./auth/tokenManager";
import { deriveEncryptionKey } from "./auth/encryption";
import { startTokenRefreshJob } from "./jobs/tokenRefresh";
import { bootstrapSelfHostedTenant, validateSelfHostedLlmKeys } from "./selfHosted/bootstrap";

async function main() {
  const config = loadConfig(process.env);
  const logger = createLogger();

  let appConfig;
  let db;
  let tokenManager;
  let tokenRefreshJob: { stop: () => void } | undefined;

  // Multi-tenant mode: requires DATABASE_URL
  if (process.env.DATABASE_URL) {
    appConfig = loadAppConfig(process.env);

    logger.info("Running database migrations…");
    await runMigrations(appConfig.DATABASE_URL);

    await initializeDb(appConfig.DATABASE_URL);
    db = getDb();

    // Derive encryption key early (needed for both bootstrap and token manager)
    let encryptionKey: Buffer | undefined;
    if (appConfig.TOKEN_ENCRYPTION_KEY) {
      encryptionKey = deriveEncryptionKey(appConfig.TOKEN_ENCRYPTION_KEY);
    }

    // Self-hosted: validate LLM keys and auto-provision tenant
    if (appConfig.DEPLOYMENT_MODE === "self-hosted") {
      const llmError = validateSelfHostedLlmKeys(appConfig);
      if (llmError) {
        logger.error(llmError);
        process.exit(1);
      }

      const bootstrap = await bootstrapSelfHostedTenant(db, appConfig, encryptionKey);
      if (bootstrap.created) {
        logger.info({ tenantId: bootstrap.tenantId, adoOrgId: bootstrap.adoOrgId }, "Auto-provisioned self-hosted tenant");
      } else {
        logger.info({ tenantId: bootstrap.tenantId, adoOrgId: bootstrap.adoOrgId }, "Using existing self-hosted tenant");
      }
    }

    if (encryptionKey) {
      tokenManager = new TokenManager(
        db,
        encryptionKey,
        undefined,
        appConfig.OAUTH_CLIENT_ID,
        appConfig.OAUTH_CLIENT_SECRET,
        appConfig.OAUTH_REDIRECT_URI,
      );

      tokenRefreshJob = startTokenRefreshJob(tokenManager);
    }
  }

  const app = await buildApp({ config, appConfig, db, tokenManager });

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
      tokenRefreshJob?.stop();
      await app.close();
      await closeDb();
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
      multiTenant: !!db,
      deploymentMode: appConfig?.DEPLOYMENT_MODE ?? "legacy",
      maxFiles: config.MAX_FILES,
      maxHunks: config.MAX_HUNKS,
      maxTotalDiffLines: config.MAX_TOTAL_DIFF_LINES,
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
