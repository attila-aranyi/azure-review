import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as undici from "undici";
import { AdoClient, AdoClientError } from "../src/azure/adoClient";
import type { Config } from "../src/config";

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof undici>("undici");
  return {
    ...actual,
    request: vi.fn()
  };
});

const mockRequest = vi.mocked(undici.request);

function makeConfig(): Config {
  return {
    PORT: 3000,
    WEBHOOK_SECRET: "secret",
    ADO_ORG: "myorg",
    ADO_PROJECT: "myproject",
    ADO_PAT: "mypat",
    LLM1_PROVIDER: "mock",
    LLM2_PROVIDER: "mock",
    CORS_ORIGINS: [],
    RATE_LIMIT_MAX: 30,
    RATE_LIMIT_WINDOW_MS: 60_000,
    MAX_FILES: 20,
    MAX_TOTAL_DIFF_LINES: 2000,
    MAX_HUNKS: 80,
    HUNK_CONTEXT_LINES: 20,
    TOKEN_BUDGET_LLM1: 3000,
    TOKEN_BUDGET_LLM2: 6000
  } as Config;
}

function mockResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {},
    body: { text: vi.fn(async () => typeof body === "string" ? body : JSON.stringify(body)) }
  } as unknown as undici.Dispatcher.ResponseData;
}

describe("AdoClient", () => {
  let client: AdoClient;

  beforeEach(() => {
    client = new AdoClient(makeConfig());
    mockRequest.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getPullRequest", () => {
    it("returns parsed PR data", async () => {
      const prData = { pullRequestId: 42, sourceRefName: "refs/heads/feature" };
      mockRequest.mockResolvedValueOnce(mockResponse(200, prData));

      const result = await client.getPullRequest("repo-1", 42);
      expect(result).toEqual(prData);
      expect(mockRequest).toHaveBeenCalledTimes(1);
      const [url] = mockRequest.mock.calls[0];
      expect(url).toContain("/repositories/repo-1/pullRequests/42");
    });

    it("throws AdoClientError on 404", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(404, "Not found"));

      await expect(client.getPullRequest("repo-1", 999)).rejects.toThrow(AdoClientError);
    });
  });

  describe("listPullRequestChanges", () => {
    it("extracts file paths from changes", async () => {
      mockRequest.mockResolvedValueOnce(
        mockResponse(200, {
          changes: [
            { item: { path: "/src/a.ts" } },
            { item: { path: "/src/b.ts" } },
            { item: { path: "/src/a.ts" } },
            { item: {} }
          ]
        })
      );

      const paths = await client.listPullRequestChanges("repo-1", 42);
      expect(paths).toEqual(["/src/a.ts", "/src/b.ts"]);
    });

    it("returns empty array when no changes", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(200, { changes: [] }));
      const paths = await client.listPullRequestChanges("repo-1", 42);
      expect(paths).toEqual([]);
    });
  });

  describe("getItemContent", () => {
    it("returns text content", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(200, "file contents here"));

      const content = await client.getItemContent("repo-1", "/src/app.ts", {
        version: "abc123",
        versionType: "commit"
      });
      expect(content).toBe("file contents here");
    });

    it("throws on server error", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(500, "Internal Server Error"));

      await expect(
        client.getItemContent("repo-1", "/src/app.ts", {
          version: "abc123",
          versionType: "commit"
        })
      ).rejects.toThrow(AdoClientError);
    });
  });

  describe("createPullRequestThread", () => {
    it("posts thread successfully", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(200, { id: 1 }));

      await expect(
        client.createPullRequestThread("repo-1", 42, {
          status: 1,
          comments: [{ parentCommentId: 0, commentType: 1, content: "test" }],
          threadContext: {
            filePath: "/src/app.ts",
            rightFileStart: { line: 1, offset: 1 },
            rightFileEnd: { line: 5, offset: 1 }
          }
        })
      ).resolves.not.toThrow();
    });
  });
});
