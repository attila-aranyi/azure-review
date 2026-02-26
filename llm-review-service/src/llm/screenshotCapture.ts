import type { Logger } from "pino";

export type ScreenshotOptions = {
  viewportWidth: number;
  viewportHeight: number;
  waitMs: number;
  timeoutMs: number;
};

export type CapturedScreenshot = {
  pageUrl: string;
  base64Data: string;
  mediaType: "image/png";
  widthPx: number;
  heightPx: number;
  capturedAt: string;
};

const MAX_BASE64_SIZE = 5 * 1024 * 1024; // 5MB

async function loadPlaywright(): Promise<{
  chromium: {
    launch(opts: { headless: boolean }): Promise<{
      newContext(opts: { viewport: { width: number; height: number } }): Promise<{
        newPage(): Promise<{
          goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>;
          waitForTimeout(ms: number): Promise<void>;
          screenshot(opts: { fullPage: boolean; type: string }): Promise<Buffer>;
          viewportSize(): { width: number; height: number } | null;
          close(): Promise<void>;
        }>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
} | null> {
  try {
    const moduleName = "playwright";
    // Dynamic import to avoid hard dependency — service works without Playwright installed
    return await (new Function("m", "return import(m)")(moduleName) as Promise<unknown>) as Awaited<ReturnType<typeof loadPlaywright>>;
  } catch {
    return null;
  }
}

export async function captureScreenshots(args: {
  baseUrl: string;
  pagePaths: string[];
  options: ScreenshotOptions;
  logger?: Logger;
}): Promise<CapturedScreenshot[]> {
  const { baseUrl, pagePaths, options, logger } = args;
  const pw = await loadPlaywright();
  if (!pw) {
    logger?.warn("Playwright not installed — skipping screenshot capture");
    return [];
  }

  const browser = await pw.chromium.launch({ headless: true });
  const screenshots: CapturedScreenshot[] = [];

  try {
    const context = await browser.newContext({
      viewport: { width: options.viewportWidth, height: options.viewportHeight },
    });

    for (const pagePath of pagePaths) {
      const pageUrl = new URL(pagePath, baseUrl).href;
      try {
        const page = await context.newPage();
        await page.goto(pageUrl, {
          waitUntil: "networkidle",
          timeout: options.timeoutMs,
        });

        if (options.waitMs > 0) {
          await page.waitForTimeout(options.waitMs);
        }

        const buffer = await page.screenshot({ fullPage: true, type: "png" });
        const base64Data = buffer.toString("base64");

        if (base64Data.length > MAX_BASE64_SIZE) {
          logger?.warn({ pageUrl, sizeBytes: base64Data.length }, "Screenshot too large, skipping");
          await page.close();
          continue;
        }

        const viewportSize = page.viewportSize();
        screenshots.push({
          pageUrl,
          base64Data,
          mediaType: "image/png",
          widthPx: viewportSize?.width ?? options.viewportWidth,
          heightPx: viewportSize?.height ?? options.viewportHeight,
          capturedAt: new Date().toISOString(),
        });

        await page.close();
      } catch (err) {
        logger?.warn({ pageUrl, err }, "Failed to capture screenshot for page");
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return screenshots;
}
