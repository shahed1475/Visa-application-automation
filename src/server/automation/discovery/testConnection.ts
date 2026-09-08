import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ConnectionTestResult } from '../../../shared/types.js';
import { BrowserManager, applyEvalNameShim } from '../engine/browserManager.js';
import { inspectPage } from '../engine/pageInspector.js';
import { env } from '../../env.js';

const NAV_TIMEOUT_MS = 30_000;

export interface RunConnectionTestDeps {
  browserManager?: BrowserManager;
  screenshotDir?: string;
}

/**
 * Navigate-only, report-only connection probe. `url` is the ONLY navigation
 * target — it is passed in by the caller (sourced from the DB portal row) and
 * has no default, no fallback constant, no `||`-default.
 */
export async function runConnectionTest(
  url: string,
  deps: RunConnectionTestDeps = {},
): Promise<ConnectionTestResult> {
  const started = Date.now();
  const manager = deps.browserManager ?? new BrowserManager();
  const ownsManager = !deps.browserManager;
  const screenshotDir = deps.screenshotDir ?? env.SCREENSHOT_DIR;

  const base: ConnectionTestResult = {
    success: false,
    url,
    httpStatus: null,
    pageTitle: null,
    finalUrl: null,
    redirected: false,
    redirectChain: [],
    elementCounts: {},
    securityChallengeFlags: {},
    screenshotPath: null,
    durationMs: 0,
  };

  try {
    const browser = await manager.launch();
    const context = await browser.newContext();
    try {
      await applyEvalNameShim(context);
      const page = await context.newPage();
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });

      const inspection = await inspectPage(page);

      const redirectChain: string[] = [];
      let prev = response?.request().redirectedFrom() ?? null;
      while (prev) {
        redirectChain.unshift(prev.url());
        prev = prev.redirectedFrom();
      }

      await mkdir(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `test-${Date.now()}.png`);
      const shotOk = await page
        .screenshot({ path: screenshotPath, fullPage: true })
        .then(() => true)
        .catch(() => false);

      const finalUrl = page.url();
      return {
        ...base,
        success: true,
        httpStatus: response?.status() ?? null,
        pageTitle: inspection.pageTitle,
        finalUrl,
        redirected: finalUrl !== url || redirectChain.length > 0,
        redirectChain,
        elementCounts: inspection.elementCounts,
        securityChallengeFlags: inspection.securityChallengeFlags,
        screenshotPath: shotOk ? screenshotPath : null,
        durationMs: Date.now() - started,
      };
    } finally {
      await context.close();
    }
  } catch (err) {
    return {
      ...base,
      durationMs: Date.now() - started,
      error: sanitizeError(err, url),
    };
  } finally {
    if (ownsManager) await manager.close();
  }
}

function sanitizeError(err: unknown, url: string): { code: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  let host = 'the configured URL';
  try {
    host = new URL(url).host;
  } catch {
    /* keep default */
  }
  let code = 'NAVIGATION_ERROR';
  if (/ENOTFOUND|getaddrinfo|ERR_NAME_NOT_RESOLVED/i.test(raw)) code = 'DNS_LOOKUP_FAILED';
  else if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(raw)) code = 'CONNECTION_REFUSED';
  else if (/timeout/i.test(raw)) code = 'TIMEOUT';
  else if (/certificate|ERR_CERT|SSL|TLS/i.test(raw)) code = 'TLS_ERROR';
  return { code, message: `Could not load ${host} (${code})` };
}

// DESIGN NOTE (do not remove): this module has no `page.fill`, `page.type`,
// `page.click`, `form.submit`, or any CAPTCHA/OTP/MFA handling — by design.
// Test Connection is navigate-and-observe only (spec §7, Global Constraints).
