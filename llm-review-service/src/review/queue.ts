import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";
import type { Config } from "../config";
import { createLogger } from "../logger";
import { runReview } from "./runReview";

export type ReviewJobPayload = {
  repoId: string;
  prId: number;
};

export type ReviewQueue = {
  enabled: boolean;
  enqueue(payload: ReviewJobPayload): Promise<void>;
  close(): Promise<void>;
};

export function createReviewQueue(config: Config): ReviewQueue {
  if (!config.REDIS_URL) {
    return {
      enabled: false,
      enqueue: async () => {},
      close: async () => {}
    };
  }

  const logger = createLogger().child({ component: "review-queue" });
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

  const queue = new Queue<ReviewJobPayload>("llm-review", { connection });
  const worker = new Worker<ReviewJobPayload>(
    "llm-review",
    async (job) => {
      await runReview({ config, repoId: job.data.repoId, prId: job.data.prId });
    },
    { connection, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Review job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "Review job failed");
  });

  return {
    enabled: true,
    enqueue: async (payload) => {
      await queue.add("review", payload, { removeOnComplete: true, removeOnFail: 100 });
    },
    close: async () => {
      await worker.close();
      await queue.close();
      await connection.quit();
    }
  };
}

