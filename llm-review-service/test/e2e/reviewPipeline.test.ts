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
  let statusPostCalls: unknown[];
  let commentPatchCalls: Array<{ url: string; body: unknown }>;

  beforeEach(async () => {
    threadPostCalls = [];
    statusPostCalls = [];
    commentPatchCalls = [];
    mockRequest.mockReset();

    // Setup mock ADO responses
    mockRequest.mockImplementation(async (url: string | URL, opts?: unknown) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = (opts as { method?: string })?.method ?? "GET";

      // getPullRequest
      if (urlStr.includes("/pullRequests/42") && !urlStr.includes("/iterations") && !urlStr.includes("/threads") && !urlStr.includes("/statuses")) {
        return mockResponse(200, {
          pullRequestId: 42,
          lastMergeSourceCommit: { commitId: "source-abc" },
          lastMergeTargetCommit: { commitId: "target-def" }
        });
      }

      // createPullRequestStatus
      if (urlStr.includes("/statuses") && method === "POST") {
        const body = (opts as { body?: string })?.body;
        statusPostCalls.push(body ? JSON.parse(body) : null);
        return mockResponse(200, { id: statusPostCalls.length });
      }

      // updateThreadComment (PATCH)
      if (urlStr.includes("/comments/") && method === "PATCH") {
        const body = (opts as { body?: string })?.body;
        commentPatchCalls.push({ url: urlStr, body: body ? JSON.parse(body) : null });
        return mockResponse(200, { id: 1 });
      }

      // listPullRequestChanges — iterations list
      if (urlStr.includes("/pullRequests/42/iterations") && !urlStr.includes("/changes")) {
        return mockResponse(200, { value: [{ id: 1 }] });
      }

      // listPullRequestChanges — iteration changes
      if (urlStr.includes("/iterations/1/changes")) {
        return mockResponse(200, {
          changeEntries: [{ item: { path: "/src/greet.ts" } }]
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
        return mockResponse(200, {
          id: threadPostCalls.length,
          comments: [{ id: 1, content: "test", commentType: 1 }],
        });
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
          repository: { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
        }
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Wait for the async review to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // The mock provider should detect "TODO" and post a finding
    // First thread is the summary, subsequent ones are findings
    expect(threadPostCalls.length).toBeGreaterThanOrEqual(2);
    const summaryThread = threadPostCalls[0] as { comments?: Array<{ content?: string }> };
    expect(summaryThread.comments?.[0]?.content).toContain("Marvin The Paranoid Android");
    expect(summaryThread.comments?.[0]?.content).toContain("Reviewing...");

    const findingThread = threadPostCalls[1] as { comments?: Array<{ content?: string }> };
    expect(findingThread.comments?.[0]?.content).toContain("Severity");

    // Status should have been posted twice: pending + succeeded
    expect(statusPostCalls).toHaveLength(2);
    expect((statusPostCalls[0] as { state: string }).state).toBe("pending");
    expect((statusPostCalls[1] as { state: string }).state).toBe("succeeded");

    // Summary comment should have been patched with completed content
    expect(commentPatchCalls).toHaveLength(1);
    expect((commentPatchCalls[0].body as { content: string }).content).toContain("Marvin The Paranoid Android");
    expect((commentPatchCalls[0].body as { content: string }).content).toContain("published");
  });

  it("LLM3 accessibility findings are posted for HTML files", async () => {
    await app.close();

    const a11yConfig = {
      ...makeConfig(),
      LLM3_ENABLED: true,
      LLM3_PROVIDER: "mock" as const,
      TOKEN_BUDGET_LLM3: 4000,
      A11Y_FILE_EXTENSIONS: [".html", ".jsx", ".tsx"]
    } as Config;

    const htmlBefore = "<div>Hello</div>";
    const htmlAfter = '<div><img src="photo.jpg"></div>';

    threadPostCalls = [];
    statusPostCalls = [];
    commentPatchCalls = [];
    mockRequest.mockReset();
    mockRequest.mockImplementation(async (url: string | URL, opts?: unknown) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = (opts as { method?: string })?.method ?? "GET";

      if (urlStr.includes("/pullRequests/43") && !urlStr.includes("/iterations") && !urlStr.includes("/threads") && !urlStr.includes("/statuses")) {
        return mockResponse(200, {
          pullRequestId: 43,
          lastMergeSourceCommit: { commitId: "src-a11y" },
          lastMergeTargetCommit: { commitId: "tgt-a11y" }
        });
      }
      if (urlStr.includes("/statuses") && method === "POST") {
        const body = (opts as { body?: string })?.body;
        statusPostCalls.push(body ? JSON.parse(body) : null);
        return mockResponse(200, { id: statusPostCalls.length });
      }
      if (urlStr.includes("/comments/") && method === "PATCH") {
        const body = (opts as { body?: string })?.body;
        commentPatchCalls.push({ url: urlStr, body: body ? JSON.parse(body) : null });
        return mockResponse(200, { id: 1 });
      }
      if (urlStr.includes("/pullRequests/43/iterations") && !urlStr.includes("/changes")) {
        return mockResponse(200, { value: [{ id: 1 }] });
      }
      if (urlStr.includes("/iterations/1/changes")) {
        return mockResponse(200, {
          changeEntries: [{ item: { path: "/src/page.html" } }]
        });
      }
      if (urlStr.includes("/items") && urlStr.includes("tgt-a11y")) {
        return mockResponse(200, htmlBefore);
      }
      if (urlStr.includes("/items") && urlStr.includes("src-a11y")) {
        return mockResponse(200, htmlAfter);
      }
      if (urlStr.includes("/threads") && method === "POST") {
        const body = (opts as { body?: string })?.body;
        threadPostCalls.push(body ? JSON.parse(body) : null);
        return mockResponse(200, {
          id: threadPostCalls.length,
          comments: [{ id: 1, content: "test", commentType: 1 }],
        });
      }
      return mockResponse(404, "Not found");
    });

    app = await buildApp({ config: a11yConfig });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "e2e-secret" },
      payload: {
        resource: {
          pullRequestId: 43,
          repository: { id: "b2c3d4e5-f6a7-8901-bcde-f12345678901" }
        }
      }
    });

    expect(res.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have at least one accessibility finding (missing alt on img)
    // First thread is summary, rest are findings
    expect(threadPostCalls.length).toBeGreaterThan(1);
    const hasA11yFinding = threadPostCalls.slice(1).some((call) => {
      const thread = call as { comments?: Array<{ content?: string }> };
      return thread.comments?.[0]?.content?.includes("accessibility") ||
             thread.comments?.[0]?.content?.includes("alt");
    });
    expect(hasA11yFinding).toBe(true);
  });

  it("REVIEW_MIN_SEVERITY=critical filters out medium findings", async () => {
    await app.close();

    const filteredConfig = {
      ...makeConfig(),
      REVIEW_MIN_SEVERITY: "critical" as const,
    } as Config;

    threadPostCalls = [];
    statusPostCalls = [];
    commentPatchCalls = [];
    mockRequest.mockReset();
    mockRequest.mockImplementation(async (url: string | URL, opts?: unknown) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = (opts as { method?: string })?.method ?? "GET";

      if (urlStr.includes("/pullRequests/44") && !urlStr.includes("/iterations") && !urlStr.includes("/threads") && !urlStr.includes("/statuses")) {
        return mockResponse(200, {
          pullRequestId: 44,
          lastMergeSourceCommit: { commitId: "source-filter" },
          lastMergeTargetCommit: { commitId: "target-filter" }
        });
      }
      if (urlStr.includes("/statuses") && method === "POST") {
        const body = (opts as { body?: string })?.body;
        statusPostCalls.push(body ? JSON.parse(body) : null);
        return mockResponse(200, { id: statusPostCalls.length });
      }
      if (urlStr.includes("/comments/") && method === "PATCH") {
        const body = (opts as { body?: string })?.body;
        commentPatchCalls.push({ url: urlStr, body: body ? JSON.parse(body) : null });
        return mockResponse(200, { id: 1 });
      }
      if (urlStr.includes("/pullRequests/44/iterations") && !urlStr.includes("/changes")) {
        return mockResponse(200, { value: [{ id: 1 }] });
      }
      if (urlStr.includes("/iterations/1/changes")) {
        return mockResponse(200, {
          changeEntries: [{ item: { path: "/src/greet.ts" } }]
        });
      }
      if (urlStr.includes("/items") && urlStr.includes("target-filter")) {
        return mockResponse(200, beforeContent);
      }
      if (urlStr.includes("/items") && urlStr.includes("source-filter")) {
        return mockResponse(200, afterContent);
      }
      if (urlStr.includes("/threads") && method === "POST") {
        const body = (opts as { body?: string })?.body;
        threadPostCalls.push(body ? JSON.parse(body) : null);
        return mockResponse(200, {
          id: threadPostCalls.length,
          comments: [{ id: 1, content: "test", commentType: 1 }],
        });
      }
      return mockResponse(404, "Not found");
    });

    app = await buildApp({ config: filteredConfig });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/azure-devops/pr",
      headers: { "x-webhook-secret": "e2e-secret" },
      payload: {
        resource: {
          pullRequestId: 44,
          repository: { id: "c3d4e5f6-a7b8-9012-cdef-123456789012" }
        }
      }
    });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // The mock provider produces "medium" severity for TODO — should be filtered out
    // Only the summary thread should be posted (no finding threads)
    expect(threadPostCalls).toHaveLength(1);
    const summaryThread = threadPostCalls[0] as { comments?: Array<{ content?: string }> };
    expect(summaryThread.comments?.[0]?.content).toContain("Reviewing...");
  });

  it("health endpoints work alongside webhook routes", async () => {
    const healthRes = await app.inject({ method: "GET", url: "/health" });
    expect(healthRes.statusCode).toBe(200);

    const readyRes = await app.inject({ method: "GET", url: "/ready" });
    expect(readyRes.statusCode).toBe(200);
  });
});
