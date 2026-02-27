import { z } from "zod";
import type { Logger } from "pino";
import type { LLMClient, Finding, ImageInput } from "./types";
import type { Config } from "../config";
import type { CapturedScreenshot } from "./screenshotCapture";
import { captureScreenshots } from "./screenshotCapture";
import {
  visualAccessibilitySystemPrompt,
  buildVisualAccessibilityPrompt,
} from "./prompts/visualAccessibilityPrompt";

export type VisualA11yFinding = Finding & {
  pageUrl?: string;
  pageRegion?: string;
  wcagCriterion?: string;
};

export const visualA11yOutputSchema = z
  .object({
    findings: z
      .array(
        z.object({
          issueType: z.string().default("accessibility"),
          severity: z.enum(["low", "medium", "high", "critical"]),
          message: z.string().min(1),
          suggestion: z.string().optional(),
          pageUrl: z.string().optional(),
          pageRegion: z.string().optional(),
          wcagCriterion: z.string().optional(),
        })
      )
      .optional(),
  })
  .transform((value) => ({ findings: value.findings ?? [] }));

export async function runVisualAccessibilityCheck(args: {
  client: LLMClient;
  config: Config;
  previewUrl: string;
  changedFiles: string[];
  logger?: Logger;
}): Promise<{
  findings: VisualA11yFinding[];
  screenshots: CapturedScreenshot[];
  ms: number;
}> {
  const { client, config, previewUrl, changedFiles, logger } = args;
  const start = Date.now();

  if (!client.supportsVision) {
    logger?.warn(
      { provider: client.providerName },
      "LLM4 provider does not support vision — skipping visual accessibility check"
    );
    return { findings: [], screenshots: [], ms: Date.now() - start };
  }

  const pagePaths =
    config.VISUAL_A11Y_PAGES && config.VISUAL_A11Y_PAGES.length > 0
      ? config.VISUAL_A11Y_PAGES
      : ["/"];

  const maxScreenshots = config.VISUAL_A11Y_MAX_SCREENSHOTS ?? 5;
  const pathsToCapture = pagePaths.slice(0, maxScreenshots);

  const screenshots = await captureScreenshots({
    baseUrl: previewUrl,
    pagePaths: pathsToCapture,
    options: {
      viewportWidth: config.VISUAL_A11Y_VIEWPORT_WIDTH ?? 1280,
      viewportHeight: config.VISUAL_A11Y_VIEWPORT_HEIGHT ?? 900,
      waitMs: config.VISUAL_A11Y_WAIT_MS ?? 3000,
      timeoutMs: 30_000,
    },
    logger,
  });

  if (screenshots.length === 0) {
    logger?.warn("No screenshots captured — skipping visual accessibility check");
    return { findings: [], screenshots: [], ms: Date.now() - start };
  }

  const images: ImageInput[] = screenshots.map((s) => ({
    base64Data: s.base64Data,
    mediaType: s.mediaType,
  }));

  const prompt = buildVisualAccessibilityPrompt({
    screenshotCount: screenshots.length,
    pageUrls: screenshots.map((s) => s.pageUrl),
    changedFiles,
  });

  const tokenBudget = config.TOKEN_BUDGET_LLM4 ?? 8000;

  const output = await client.completeVisionJSON({
    stage: "llm4",
    system: visualAccessibilitySystemPrompt,
    prompt,
    images,
    schema: visualA11yOutputSchema,
    timeoutMs: 120_000,
    maxTokens: tokenBudget,
  });

  const findings: VisualA11yFinding[] = output.findings
    .filter((f) => f.message.trim().length > 0)
    .slice(0, 30)
    .map((f) => ({
      issueType: "accessibility" as const,
      severity: f.severity,
      filePath: "visual-audit",
      startLine: 0,
      endLine: 0,
      message: f.message,
      suggestion: f.suggestion,
      pageUrl: f.pageUrl,
      pageRegion: f.pageRegion,
      wcagCriterion: f.wcagCriterion,
    }));

  return { findings, screenshots, ms: Date.now() - start };
}
