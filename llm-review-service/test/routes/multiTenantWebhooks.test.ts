import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerWebhookRoutes } from "../../src/routes/webhooks";
import type { ReviewQueue } from "../../src/review/queue";
import type { Config } from "../../src/config";
import type { DrizzleInstance } from "../../src/db/connection";
import { createTenantRepo } from "../../src/db/repos/tenantRepo";
import { createProjectRepo } from "../../src/db/repos/projectRepo";
import { encrypt, generateKey } from "../../src/auth/encryption";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../db/testDbHelper";

vi.mock("../../src/review/runReview", () => ({
  runReview: vi.fn(async () => {}),
}));

function makeConfig(): Config {
  return {
    PORT: 3000,
    WEBHOOK_SECRET: "legacy-secret",
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
  } as Config;
}

function makeQueue(): ReviewQueue {
  return {
    enabled: true,
    enqueue: vi.fn(async () => {}),
    ping: vi.fn(async () => true),
    close: vi.fn(async () => {}),
  };
}

const validPayload = {
  resource: {
    pullRequestId: 42,
    repository: {
      id: "repo-abc-123",
      project: { id: "proj-1" },
    },
  },
};

describe.skipIf(!isDbAvailable())("Multi-tenant webhook route (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;
  let webhookSecret: string;
  let encryptionKey: Buffer;
  let app: FastifyInstance;
  let queue: ReviewQueue;

  beforeAll(async () => {
    db = await setupTestDb();
    encryptionKey = generateKey();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: `org-${Date.now()}` });
    tenantId = tenant.id;

    // Create project enrollment with webhook secret
    webhookSecret = "test-webhook-secret-" + Date.now();
    const projectRepo = createProjectRepo(db);
    await projectRepo.create({
      tenantId,
      adoProjectId: "proj-1",
      webhookSecretEnc: encrypt(webhookSecret, encryptionKey).toString("base64"),
      status: "active",
    });

    queue = makeQueue();
    app = Fastify({ logger: false });
    await app.register(registerWebhookRoutes, {
      config: makeConfig(),
      queue,
      db,
      encryptionKey,
    });
    await app.ready();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it("accepts valid request with Basic Auth → 202", async () => {
    const basicAuth = Buffer.from(`ado:${webhookSecret}`).toString("base64");
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/ado/${tenantId}`,
      headers: { authorization: `Basic ${basicAuth}` },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().ok).toBe(true);
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: "repo-abc-123", prId: 42, tenantId }),
    );
  });

  it("accepts valid request with x-webhook-secret header → 202", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/ado/${tenantId}`,
      headers: { "x-webhook-secret": webhookSecret },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 401 for unknown tenantId (anti-enumeration)", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/ado/${fakeId}`,
      headers: { "x-webhook-secret": webhookSecret },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for inactive tenant (anti-enumeration)", async () => {
    const tenantRepo = createTenantRepo(db);
    await tenantRepo.updateStatus(tenantId, "inactive");

    const res = await app.inject({
      method: "POST",
      url: `/webhooks/ado/${tenantId}`,
      headers: { "x-webhook-secret": webhookSecret },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with wrong secret", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/ado/${tenantId}`,
      headers: { "x-webhook-secret": "wrong-secret" },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with no credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/ado/${tenantId}`,
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/ado/${tenantId}`,
      headers: { "x-webhook-secret": webhookSecret },
      payload: { resource: { pullRequestId: -1, repository: { id: "" } } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enqueues with tenantId and adoProjectId", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/ado/${tenantId}`,
      headers: { "x-webhook-secret": webhookSecret },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(202);
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        adoProjectId: "proj-1",
        repoId: "repo-abc-123",
        prId: 42,
      }),
    );
  });

  it("legacy route still works", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "legacy-secret" },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(200);
  });
});
