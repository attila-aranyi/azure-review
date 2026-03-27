import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";
import type { Config } from "../config";
import type { AppConfig } from "../config/appConfig";
import type { DrizzleInstance } from "../db/connection";
import type { TokenManager } from "../auth/tokenManager";
import { createLogger } from "../logger";
import { runReview } from "./runReview";
import { createDbAuditStore } from "./audit";
import { createDbIdempotencyStore } from "./idempotency";
import type { AuditStore } from "./audit";
import { buildTenantContext } from "../context/tenantContext";
import { createConfigResolver } from "../config/configResolver";

export type ReviewJobPayload = {
  repoId: string;
  prId: number;
  requestId?: string;
  previewUrl?: string;
  tenantId?: string;
  adoProjectId?: string;
};

export type ReviewQueue = {
  enabled: boolean;
  enqueue(payload: ReviewJobPayload): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
};

export type ReviewQueueDeps = {
  config: Config;
  auditStore?: AuditStore;
  db?: DrizzleInstance;
  appConfig?: AppConfig;
  tokenManager?: TokenManager;
};

export function createReviewQueue(config: Config, auditStore?: AuditStore, deps?: { db?: DrizzleInstance; appConfig?: AppConfig; tokenManager?: TokenManager }): ReviewQueue {
  if (!config.REDIS_URL) {
    return {
      enabled: false,
      enqueue: async () => {},
      ping: async () => true,
      close: async () => {}
    };
  }

  const logger = createLogger().child({ component: "review-queue" });
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

  const queue = new Queue<ReviewJobPayload>("llm-review", { connection });
  const worker = new Worker<ReviewJobPayload>(
    "llm-review",
    async (job) => {
      const { repoId, prId, requestId, previewUrl, tenantId } = job.data;

      // Multi-tenant: hydrate TenantContext when tenantId is present
      if (tenantId && deps?.db && deps.appConfig && deps.tokenManager) {
        const context = await buildTenantContext(tenantId, deps.db, deps.appConfig, deps.tokenManager);
        // Resolve per-repo config overrides (e.g. enableAxon)
        const resolver = createConfigResolver(deps.db);
        context.config = await resolver.resolve(tenantId, repoId);
        const tenantAuditStore = createDbAuditStore(deps.db, tenantId);
        const idempotencyStore = createDbIdempotencyStore(deps.db, { tenantId });
        await runReview({ config, repoId, prId, requestId, auditStore: tenantAuditStore, previewUrl, context, idempotencyStore });
      } else {
        // Legacy single-tenant path
        await runReview({ config, repoId, prId, requestId, auditStore, previewUrl });
      }
    },
    { connection, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Review job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error(
      { err, jobId: job?.id, repoId: job?.data?.repoId, prId: job?.data?.prId, attemptsMade: job?.attemptsMade },
      "Review job failed"
    );
  });

  return {
    enabled: true,
    enqueue: async (payload) => {
      await queue.add("review", payload, {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 }
      });
    },
    ping: async () => {
      const result = await connection.ping();
      return result === "PONG";
    },
    close: async () => {
      await worker.close();
      await queue.close();
      await connection.quit();
    }
  };
}

