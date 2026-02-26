import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import * as undici from "undici";
import { buildApp } from "../../src/app";
import type { Config } from "../../src/config";

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof undici>("undici");
  return {
    ...actual,
    request: vi.fn()
  };
});

// Use a fresh in-memory store for each test instead of the file-based store
vi.mock("../../src/review/idempotency", async () => {
  const actual = await vi.importActual<typeof import("../../src/review/idempotency")>("../../src/review/idempotency");
  return {
    ...actual,
    createFileIdempotencyStore: vi.fn(async () => actual.createInMemoryIdempotencyStore())
  };
});

const mockRequest = vi.mocked(undici.request);

function mockResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {},
    body: { text: vi.fn(async () => typeof body === "string" ? body : JSON.stringify(body)) }
  } as unknown as undici.Dispatcher.ResponseData;
}

function makeConfig(): Config {
  return {
    PORT: 0,
    WEBHOOK_SECRET: "e2e-secret",
    ADO_ORG: "testorg",
    ADO_PROJECT: "testproject",
    ADO_PAT: "testpat",
    LLM1_PROVIDER: "mock",
    LLM2_PROVIDER: "mock",
    CORS_ORIGINS: [],
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW_MS: 60_000,
    MAX_FILES: 20,
    MAX_TOTAL_DIFF_LINES: 2000,
    MAX_HUNKS: 80,
    HUNK_CONTEXT_LINES: 3,
    TOKEN_BUDGET_LLM1: 3000,
    TOKEN_BUDGET_LLM2: 6000
  } as Config;
}

const beforeContent = `function greet(name) {
  return "Hello, " + name;
}
`;

const afterContent = `function greet(name: string) {
  // TODO: fix this later
  return \`Hello, \${name}\`;
}
`;

describe("E2E review pipeline", () => {
  let app: FastifyInstance;
  let threadPostCalls: unknown[];

  beforeEach(async () => {
    threadPostCalls = [];
    mockRequest.mockReset();

    // Setup mock ADO responses
    mockRequest.mockImplementation(async (url: string | URL, opts?: unknown) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = (opts as { method?: string })?.method ?? "GET";

      // getPullRequest
      if (urlStr.includes("/pullRequests/42") && !urlStr.includes("/changes") && !urlStr.includes("/threads")) {
        return mockResponse(200, {
          pullRequestId: 42,
          lastMergeSourceCommit: { commitId: "source-abc" },
          lastMergeTargetCommit: { commitId: "target-def" }
        });
      }

      // listPullRequestChanges
      if (urlStr.includes("/pullRequests/42/changes")) {
        return mockResponse(200, {
          changes: [{ item: { path: "/src/greet.ts" } }]
        });
      }

      // getItemContent (target/before)
      if (urlStr.includes("/items") && urlStr.includes("target-def")) {
        return mockResponse(200, beforeContent);
      }

      // getItemContent (source/after)
      if (urlStr.includes("/items") && urlStr.includes("source-abc")) {
        return mockResponse(200, afterContent);
      }

      // createPullRequestThread
      if (urlStr.includes("/threads") && method === "POST") {
        const body = (opts as { body?: string })?.body;
        threadPostCalls.push(body ? JSON.parse(body) : null);
        return mockResponse(200, { id: threadPostCalls.length });
      }

      return mockResponse(404, "Not found");
    });

    app = await buildApp({ config: makeConfig() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("processes a webhook and posts findings to ADO", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "e2e-secret" },
      payload: {
        resource: {
          pullRequestId: 42,
          repository: { id: "repo-e2e" }
        }
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Wait for the async review to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // The mock provider should detect "TODO" and post a finding
    expect(threadPostCalls.length).toBeGreaterThan(0);
    const thread = threadPostCalls[0] as { comments?: Array<{ content?: string }> };
    expect(thread.comments?.[0]?.content).toContain("Severity");
  });

  it("health endpoints work alongside webhook routes", async () => {
    const healthRes = await app.inject({ method: "GET", url: "/health" });
    expect(healthRes.statusCode).toBe(200);

    const readyRes = await app.inject({ method: "GET", url: "/ready" });
    expect(readyRes.statusCode).toBe(200);
  });
});
