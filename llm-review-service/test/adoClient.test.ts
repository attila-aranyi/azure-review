import { Buffer } from "node:buffer";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as undici from "undici";
import { AdoClient, AdoClientError } from "../src/azure/adoClient";
import type { Config } from "../src/config";
import type { Logger } from "pino";

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof undici>("undici");
  return {
    ...actual,
    request: vi.fn()
  };
});

const mockRequest = vi.mocked(undici.request);

const VALID_REPO_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

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

  describe("GUID validation", () => {
    it("throws AdoClientError on invalid repoId", async () => {
      await expect(client.getPullRequest("not-a-guid", 42)).rejects.toThrow(AdoClientError);
      await expect(client.listPullRequestChanges("not-a-guid", 42)).rejects.toThrow(AdoClientError);
      await expect(
        client.getItemContent("not-a-guid", "/src/app.ts", { version: "abc", versionType: "commit" })
      ).rejects.toThrow(AdoClientError);
      await expect(
        client.createPullRequestThread("not-a-guid", 42, {
          status: 1,
          comments: [{ parentCommentId: 0, commentType: 1, content: "test" }],
          threadContext: {
            filePath: "/src/app.ts",
            rightFileStart: { line: 1, offset: 1 },
            rightFileEnd: { line: 5, offset: 1 }
          }
        })
      ).rejects.toThrow(AdoClientError);
    });

    it("accepts valid GUID repoId", async () => {
      const prData = { pullRequestId: 42, sourceRefName: "refs/heads/feature" };
      mockRequest.mockResolvedValueOnce(mockResponse(200, prData));

      const result = await client.getPullRequest(VALID_REPO_ID, 42);
      expect(result).toEqual(prData);
    });
  });

  describe("getPullRequest", () => {
    it("returns parsed PR data", async () => {
      const prData = { pullRequestId: 42, sourceRefName: "refs/heads/feature" };
      mockRequest.mockResolvedValueOnce(mockResponse(200, prData));

      const result = await client.getPullRequest(VALID_REPO_ID, 42);
      expect(result).toEqual(prData);
      expect(mockRequest).toHaveBeenCalledTimes(1);
      const [url] = mockRequest.mock.calls[0];
      expect(url).toContain(`/repositories/${VALID_REPO_ID}/pullRequests/42`);
    });

    it("throws AdoClientError on 404", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(404, "Not found"));

      await expect(client.getPullRequest(VALID_REPO_ID, 999)).rejects.toThrow(AdoClientError);
    });
  });

  describe("listPullRequestChanges", () => {
    it("extracts file paths from iteration changes", async () => {
      // First call: iterations
      mockRequest.mockResolvedValueOnce(
        mockResponse(200, { value: [{ id: 1 }, { id: 2 }] })
      );
      // Second call: iteration changes
      mockRequest.mockResolvedValueOnce(
        mockResponse(200, {
          changeEntries: [
            { item: { path: "/src/a.ts" } },
            { item: { path: "/src/b.ts" } },
            { item: { path: "/src/a.ts" } },
            { item: {} }
          ]
        })
      );

      const paths = await client.listPullRequestChanges(VALID_REPO_ID, 42);
      expect(paths).toEqual(["/src/a.ts", "/src/b.ts"]);
      expect(mockRequest).toHaveBeenCalledTimes(2);
      const [secondUrl] = mockRequest.mock.calls[1];
      expect(secondUrl).toContain("/iterations/2/changes");
    });

    it("returns empty array when no change entries", async () => {
      mockRequest.mockResolvedValueOnce(
        mockResponse(200, { value: [{ id: 1 }] })
      );
      mockRequest.mockResolvedValueOnce(
        mockResponse(200, { changeEntries: [] })
      );

      const paths = await client.listPullRequestChanges(VALID_REPO_ID, 42);
      expect(paths).toEqual([]);
    });

    it("throws AdoClientError when iterations are empty", async () => {
      mockRequest.mockResolvedValueOnce(
        mockResponse(200, { value: [] })
      );

      await expect(client.listPullRequestChanges(VALID_REPO_ID, 42)).rejects.toThrow(
        /No iterations found/
      );
    });

    it("falls back to originalPath when item.path is missing (rename scenario)", async () => {
      mockRequest.mockResolvedValueOnce(
        mockResponse(200, { value: [{ id: 1 }] })
      );
      mockRequest.mockResolvedValueOnce(
        mockResponse(200, {
          changeEntries: [
            { item: { path: "/src/new-name.ts" } },
            { originalPath: "/src/old-name.ts", item: {} }
          ]
        })
      );

      const paths = await client.listPullRequestChanges(VALID_REPO_ID, 42);
      expect(paths).toEqual(["/src/new-name.ts", "/src/old-name.ts"]);
    });
  });

  describe("getItemContent", () => {
    it("returns text content", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(200, "file contents here"));

      const content = await client.getItemContent(VALID_REPO_ID, "/src/app.ts", {
        version: "abc123",
        versionType: "commit"
      });
      expect(content).toBe("file contents here");
    });

    it("throws on server error", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(500, "Internal Server Error"));

      await expect(
        client.getItemContent(VALID_REPO_ID, "/src/app.ts", {
          version: "abc123",
          versionType: "commit"
        })
      ).rejects.toThrow(AdoClientError);
    });
  });

  describe("debug logging", () => {
    it("logs response status at debug level for requestJson", async () => {
      const debugFn = vi.fn();
      const mockLogger = { debug: debugFn } as unknown as Logger;
      const logClient = new AdoClient(makeConfig(), mockLogger);

      mockRequest.mockResolvedValueOnce(mockResponse(200, { pullRequestId: 42 }));
      await logClient.getPullRequest(VALID_REPO_ID, 42);

      expect(debugFn).toHaveBeenCalledWith(
        expect.objectContaining({ method: "GET", statusCode: 200 }),
        "ADO API response"
      );
    });

    it("logs response status at debug level for requestText", async () => {
      const debugFn = vi.fn();
      const mockLogger = { debug: debugFn } as unknown as Logger;
      const logClient = new AdoClient(makeConfig(), mockLogger);

      mockRequest.mockResolvedValueOnce(mockResponse(200, "file contents"));
      await logClient.getItemContent(VALID_REPO_ID, "/src/app.ts", {
        version: "abc123",
        versionType: "commit"
      });

      expect(debugFn).toHaveBeenCalledWith(
        expect.objectContaining({ method: "GET", statusCode: 200 }),
        "ADO API response"
      );
    });

    it("works without logger (optional parameter)", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(200, { pullRequestId: 42 }));
      await expect(client.getPullRequest(VALID_REPO_ID, 42)).resolves.not.toThrow();
    });
  });

  describe("createPullRequestThread", () => {
    it("posts thread and returns response with IDs", async () => {
      const threadResponse = {
        id: 77,
        comments: [{ id: 1, content: "test", commentType: 1 }],
      };
      mockRequest.mockResolvedValueOnce(mockResponse(200, threadResponse));

      const result = await client.createPullRequestThread(VALID_REPO_ID, 42, {
        status: 1,
        comments: [{ parentCommentId: 0, commentType: 1, content: "test" }],
        threadContext: {
          filePath: "/src/app.ts",
          rightFileStart: { line: 1, offset: 1 },
          rightFileEnd: { line: 5, offset: 1 }
        }
      });
      expect(result).toEqual(threadResponse);
      expect(result.id).toBe(77);
      expect(result.comments[0].id).toBe(1);
    });
  });

  describe("createPullRequestStatus", () => {
    it("posts status successfully", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(200, { id: 1 }));

      await expect(
        client.createPullRequestStatus(VALID_REPO_ID, 42, {
          state: "pending",
          description: "Reviewing...",
          context: { name: "marvin-code-review", genre: "llm-review" },
        })
      ).resolves.not.toThrow();

      const [url] = mockRequest.mock.calls[0];
      expect(url).toContain(`/pullRequests/42/statuses`);
    });

    it("throws AdoClientError on invalid repoId", async () => {
      await expect(
        client.createPullRequestStatus("not-a-guid", 42, {
          state: "pending",
          description: "Reviewing...",
          context: { name: "marvin-code-review", genre: "llm-review" },
        })
      ).rejects.toThrow(AdoClientError);
    });

    it("throws AdoClientError on server error", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(500, "Internal Server Error"));

      await expect(
        client.createPullRequestStatus(VALID_REPO_ID, 42, {
          state: "succeeded",
          description: "Done",
          context: { name: "marvin-code-review", genre: "llm-review" },
        })
      ).rejects.toThrow(AdoClientError);
    });
  });

  describe("updateThreadComment", () => {
    it("patches comment successfully", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(200, { id: 1 }));

      await expect(
        client.updateThreadComment(VALID_REPO_ID, 42, 77, 1, { content: "Updated content" })
      ).resolves.not.toThrow();

      const [url, opts] = mockRequest.mock.calls[0];
      expect(url).toContain(`/threads/77/comments/1`);
      expect((opts as { method: string }).method).toBe("PATCH");
    });

    it("throws AdoClientError on invalid repoId", async () => {
      await expect(
        client.updateThreadComment("not-a-guid", 42, 77, 1, { content: "test" })
      ).rejects.toThrow(AdoClientError);
    });

    it("throws AdoClientError on server error", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(500, "Internal Server Error"));

      await expect(
        client.updateThreadComment(VALID_REPO_ID, 42, 77, 1, { content: "test" })
      ).rejects.toThrow(AdoClientError);
    });
  });

  describe("ADO_BOT_PAT", () => {
    it("uses bot PAT for write operations when configured", async () => {
      const botConfig = { ...makeConfig(), ADO_BOT_PAT: "bot-secret-pat" } as Config;
      const botClient = new AdoClient(botConfig);

      mockRequest.mockResolvedValueOnce(mockResponse(200, {
        id: 1,
        comments: [{ id: 1, content: "test", commentType: 1 }],
      }));

      await botClient.createPullRequestThread(VALID_REPO_ID, 42, {
        status: 1,
        comments: [{ parentCommentId: 0, commentType: 1, content: "test" }],
      });

      const [, opts] = mockRequest.mock.calls[0];
      const headers = (opts as { headers: Record<string, string> }).headers;
      const expected = `Basic ${Buffer.from(":bot-secret-pat").toString("base64")}`;
      expect(headers.Authorization).toBe(expected);
    });

    it("uses bot PAT for status posts when configured", async () => {
      const botConfig = { ...makeConfig(), ADO_BOT_PAT: "bot-secret-pat" } as Config;
      const botClient = new AdoClient(botConfig);

      mockRequest.mockResolvedValueOnce(mockResponse(200, { id: 1 }));

      await botClient.createPullRequestStatus(VALID_REPO_ID, 42, {
        state: "pending",
        description: "Reviewing...",
        context: { name: "marvin-code-review", genre: "llm-review" },
      });

      const [, opts] = mockRequest.mock.calls[0];
      const headers = (opts as { headers: Record<string, string> }).headers;
      const expected = `Basic ${Buffer.from(":bot-secret-pat").toString("base64")}`;
      expect(headers.Authorization).toBe(expected);
    });

    it("uses main PAT for read operations even when bot PAT is set", async () => {
      const botConfig = { ...makeConfig(), ADO_BOT_PAT: "bot-secret-pat" } as Config;
      const botClient = new AdoClient(botConfig);

      mockRequest.mockResolvedValueOnce(mockResponse(200, { pullRequestId: 42 }));

      await botClient.getPullRequest(VALID_REPO_ID, 42);

      const [, opts] = mockRequest.mock.calls[0];
      const headers = (opts as { headers: Record<string, string> }).headers;
      const mainExpected = `Basic ${Buffer.from(":mypat").toString("base64")}`;
      expect(headers.Authorization).toBe(mainExpected);
    });

    it("falls back to main PAT for writes when bot PAT is not set", async () => {
      mockRequest.mockResolvedValueOnce(mockResponse(200, {
        id: 1,
        comments: [{ id: 1, content: "test", commentType: 1 }],
      }));

      await client.createPullRequestThread(VALID_REPO_ID, 42, {
        status: 1,
        comments: [{ parentCommentId: 0, commentType: 1, content: "test" }],
      });

      const [, opts] = mockRequest.mock.calls[0];
      const headers = (opts as { headers: Record<string, string> }).headers;
      const mainExpected = `Basic ${Buffer.from(":mypat").toString("base64")}`;
      expect(headers.Authorization).toBe(mainExpected);
    });
  });
});
