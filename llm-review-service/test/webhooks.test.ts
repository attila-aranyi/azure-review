import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerWebhookRoutes } from "../src/routes/webhooks";
import type { ReviewQueue } from "../src/review/queue";
import type { Config } from "../src/config";
import { validNestedPayload, validFlatPayload, missingPrIdPayload, missingRepoIdPayload } from "./fixtures/webhookPayloads";

vi.mock("../src/review/runReview", () => ({
  runReview: vi.fn(async () => {})
}));

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    PORT: 3000,
    WEBHOOK_SECRET: "test-secret",
    ADO_ORG: "org",
    ADO_PROJECT: "proj",
    ADO_PAT: "pat",
    LLM1_PROVIDER: "mock",
    LLM2_PROVIDER: "mock",
    CORS_ORIGINS: [],
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW_MS: 60_000,
    MAX_FILES: 20,
    MAX_TOTAL_DIFF_LINES: 2000,
    MAX_HUNKS: 80,
    HUNK_CONTEXT_LINES: 20,
    TOKEN_BUDGET_LLM1: 3000,
    TOKEN_BUDGET_LLM2: 6000,
    ...overrides
  } as Config;
}

function makeQueue(): ReviewQueue {
  return {
    enabled: false,
    enqueue: vi.fn(async () => {}),
    ping: vi.fn(async () => true),
    close: vi.fn(async () => {})
  };
}

describe("webhooks route", () => {
  let app: FastifyInstance;
  let queue: ReviewQueue;
  const config = makeConfig();

  beforeEach(async () => {
    queue = makeQueue();
    app = Fastify({ logger: false });
    await app.register(registerWebhookRoutes, { config, queue });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects requests without a secret", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      payload: validNestedPayload
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects requests with wrong secret", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "wrong-secret" },
      payload: validNestedPayload
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a valid nested payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "test-secret" },
      payload: validNestedPayload
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("accepts a valid flat payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "test-secret" },
      payload: validFlatPayload
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("rejects payload missing PR id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "test-secret" },
      payload: missingPrIdPayload
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects payload missing repo id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "test-secret" },
      payload: missingRepoIdPayload
    });
    expect(res.statusCode).toBe(400);
  });

  it("enqueues when queue is enabled", async () => {
    const queueWithEnabled = { ...makeQueue(), enabled: true };
    const qApp = Fastify({ logger: false });
    await qApp.register(registerWebhookRoutes, { config, queue: queueWithEnabled });
    await qApp.ready();

    const res = await qApp.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "test-secret" },
      payload: validNestedPayload
    });
    expect(res.statusCode).toBe(200);
    expect(queueWithEnabled.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: "repo-abc-123", prId: 42 })
    );

    await qApp.close();
  });

  it("rejects invalid JSON structure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "test-secret" },
      payload: { resource: { pullRequestId: -1, repository: { id: "" } } }
    });
    expect(res.statusCode).toBe(400);
  });
});
