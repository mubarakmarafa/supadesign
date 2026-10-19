// @effect-diagnostics nodeBuiltinImport:off - Owns Playwright resources outside the Effect runtime.
import * as NodeModule from "node:module";

import { sandboxDisabled } from "../preview/PreviewBrowserHost.ts";

// Playwright needs its files on disk. createRequire also resolves it from a Node SEA executable.
const requirePlaywright = NodeModule.createRequire(import.meta.url);
const loadPlaywright = () =>
  requirePlaywright("playwright-core") as typeof import("playwright-core");

/** Cards show the top of a laptop-sized window; 1x keeps a board of covers light. */
export const PROGRESS_VIEWPORT = { width: 1280, height: 800 } as const;
const LOAD_TIMEOUT_MS = 20_000;
const QUIET_TIMEOUT_MS = 3_000;
const SETTLE_MS = 300;

/**
 * Opens `url` in a fresh headless browser with no stored state, waits for it
 * to load and go quiet, and returns a JPEG of the viewport.
 */
export async function screenshotPage(executablePath: string, url: string): Promise<Uint8Array> {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-gpu", "--hide-scrollbars"],
    // Only an explicit operator opt-out disables sandboxing.
    chromiumSandbox: !sandboxDisabled(process.env),
  });
  try {
    const page = await browser.newPage({ viewport: PROGRESS_VIEWPORT, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
    // Apps that fetch after load get a moment to render their data.
    await page.waitForLoadState("networkidle", { timeout: QUIET_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    return await page.screenshot({ type: "jpeg", quality: 82 });
  } finally {
    await browser.close().catch(() => {});
  }
}

/** A designer-readable reason a capture of `url` failed. */
export function describeScreenshotFailure(url: string, cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(text)) return `Nothing is running at ${url}.`;
  if (/Timeout|timed out/i.test(text)) return `${url} took too long to load.`;
  if (/ERR_NAME_NOT_RESOLVED/i.test(text)) return `${url} could not be found.`;
  return `The page at ${url} could not be captured.`;
}
