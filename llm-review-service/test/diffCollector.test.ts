import { describe, it, expect, vi } from "vitest";
import { collectDiffHunks } from "../src/review/diffCollector";
import type { AdoClient } from "../src/azure/adoClient";
import type { AdoPullRequest } from "../src/azure/adoTypes";
import type { ReviewLimits } from "../src/review/limits";
import {
  simpleDiffBefore,
  simpleDiffAfter,
  binaryContentBefore,
  binaryContentAfter,
  identicalContent,
  multiHunkBefore,
  multiHunkAfter
} from "./fixtures/diffs";

function makePR(): AdoPullRequest {
  return {
    pullRequestId: 1,
    lastMergeSourceCommit: { commitId: "source-abc" },
    lastMergeTargetCommit: { commitId: "target-def" }
  };
}

function makeAdoMock(files: Record<string, { before: string; after: string | undefined }>): AdoClient {
  return {
    getPullRequest: vi.fn(),
    listPullRequestChanges: vi.fn(),
    createPullRequestThread: vi.fn(),
    getItemContent: vi.fn(async (_repoId: string, filePath: string, desc: { version: string }) => {
      const file = files[filePath];
      if (!file) throw new Error(`File not found: ${filePath}`);
      if (desc.version === "target-def") return file.before;
      if (desc.version === "source-abc") {
        if (file.after === undefined) throw new Error("File deleted");
        return file.after;
      }
      throw new Error("Unknown version");
    })
  } as unknown as AdoClient;
}

const defaultLimits: ReviewLimits = {
  maxFiles: 20,
  maxTotalDiffLines: 2000,
  maxHunks: 80,
  hunkContextLines: 3
};

describe("collectDiffHunks", () => {
  it("extracts hunks from a simple diff", async () => {
    const ado = makeAdoMock({ "/src/greet.ts": { before: simpleDiffBefore, after: simpleDiffAfter } });
    const hunks = await collectDiffHunks({
      ado,
      repoId: "repo",
      pr: makePR(),
      changedFilePaths: ["/src/greet.ts"],
      limits: defaultLimits
    });

    expect(hunks.length).toBeGreaterThan(0);
    expect(hunks[0].filePath).toBe("/src/greet.ts");
    expect(hunks[0].hunkText).toContain("@@");
    expect(hunks[0].localContext).toBeTruthy();
  });

  it("skips binary files (null bytes)", async () => {
    const ado = makeAdoMock({
      "/bin/file": { before: binaryContentBefore, after: binaryContentAfter }
    });
    const hunks = await collectDiffHunks({
      ado,
      repoId: "repo",
      pr: makePR(),
      changedFilePaths: ["/bin/file"],
      limits: defaultLimits
    });

    expect(hunks).toHaveLength(0);
  });

  it("skips identical files", async () => {
    const ado = makeAdoMock({ "/same.ts": { before: identicalContent, after: identicalContent } });
    const hunks = await collectDiffHunks({
      ado,
      repoId: "repo",
      pr: makePR(),
      changedFilePaths: ["/same.ts"],
      limits: defaultLimits
    });

    expect(hunks).toHaveLength(0);
  });

  it("skips files that could not be fetched (deleted)", async () => {
    const ado = makeAdoMock({ "/deleted.ts": { before: simpleDiffBefore, after: undefined } });
    const hunks = await collectDiffHunks({
      ado,
      repoId: "repo",
      pr: makePR(),
      changedFilePaths: ["/deleted.ts"],
      limits: defaultLimits
    });

    expect(hunks).toHaveLength(0);
  });

  it("respects maxFiles limit", async () => {
    const files: Record<string, { before: string; after: string }> = {};
    for (let i = 0; i < 5; i++) {
      files[`/file${i}.ts`] = { before: simpleDiffBefore, after: simpleDiffAfter };
    }
    const ado = makeAdoMock(files);
    const hunks = await collectDiffHunks({
      ado,
      repoId: "repo",
      pr: makePR(),
      changedFilePaths: Object.keys(files),
      limits: { ...defaultLimits, maxFiles: 2 }
    });

    const uniqueFiles = new Set(hunks.map((h) => h.filePath));
    expect(uniqueFiles.size).toBeLessThanOrEqual(2);
  });

  it("respects maxHunks limit", async () => {
    const ado = makeAdoMock({ "/multi.ts": { before: multiHunkBefore, after: multiHunkAfter } });
    const hunks = await collectDiffHunks({
      ado,
      repoId: "repo",
      pr: makePR(),
      changedFilePaths: ["/multi.ts"],
      limits: { ...defaultLimits, maxHunks: 1 }
    });

    expect(hunks.length).toBeLessThanOrEqual(1);
  });

  it("respects maxTotalDiffLines limit", async () => {
    const ado = makeAdoMock({ "/multi.ts": { before: multiHunkBefore, after: multiHunkAfter } });
    const hunks = await collectDiffHunks({
      ado,
      repoId: "repo",
      pr: makePR(),
      changedFilePaths: ["/multi.ts"],
      limits: { ...defaultLimits, maxTotalDiffLines: 1 }
    });

    expect(hunks.length).toBeLessThanOrEqual(1);
  });

  it("throws when PR is missing commit ids", async () => {
    const ado = makeAdoMock({});
    const pr: AdoPullRequest = { pullRequestId: 1 };

    await expect(
      collectDiffHunks({
        ado,
        repoId: "repo",
        pr,
        changedFilePaths: ["/test.ts"],
        limits: defaultLimits
      })
    ).rejects.toThrow("missing commit ids");
  });

  it("includes line numbers in local context", async () => {
    const ado = makeAdoMock({ "/src/greet.ts": { before: simpleDiffBefore, after: simpleDiffAfter } });
    const hunks = await collectDiffHunks({
      ado,
      repoId: "repo",
      pr: makePR(),
      changedFilePaths: ["/src/greet.ts"],
      limits: defaultLimits
    });

    expect(hunks.length).toBeGreaterThan(0);
    // Local context should contain line numbers like "    1 |"
    expect(hunks[0].localContext).toMatch(/\d+\s*\|/);
  });
});
