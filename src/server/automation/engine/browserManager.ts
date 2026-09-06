import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { env } from '../../env.js';

export class BrowserManager {
  private browser: Browser | null = null;
  private discoveryContext: BrowserContext | null = null;

  /**
   * `opts.headless` overrides the default, which stays `env.PW_HEADLESS` so
   * `discovery/testConnection.ts` (calls `launch()` with no args) is unchanged.
   * The Phase 5 automation service passes `{ headless: env.AUTOMATION_HEADLESS }`.
   *
   * Connection reuse: if a browser is already connected, it is returned as-is —
   * a differing `headless` in a later call does NOT relaunch it. The automation
   * service owns its own manager instance, so this is a non-issue in practice.
   */
  async launch(opts?: { headless?: boolean }): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: opts?.headless ?? env.PW_HEADLESS,
      });
    }
    return this.browser;
  }

  /** Fresh isolated context + page per call (cookies/storage not shared). */
  async newPage(): Promise<{ page: Page; context: BrowserContext }> {
    const browser = await this.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    return { page, context };
  }

  /** Best-effort foreground; a headless or already-closed page must not throw. */
  async bringToFront(page: Page): Promise<void> {
    await page.bringToFront().catch(() => {});
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Headed, persistent-user-data-dir Chromium context for portal discovery.
   * The user drives discovery by hand, so this is NEVER headless — `headless:
   * false` is passed explicitly and cannot be overridden. The persistent
   * `userDataDir` (default `env.DISCOVERY_PROFILE_DIR`) keeps a portal login
   * alive across discovery sessions.
   *
   * `chromium.launchPersistentContext` returns a `BrowserContext` directly (no
   * `Browser` handle). Idempotent while open: a second call returns the same
   * context. Separate from `launch`/`newPage`/`close`.
   */
  async launchPersistentDiscovery(opts: {
    userDataDir: string;
  }): Promise<BrowserContext> {
    if (this.discoveryContext && this.discoveryContext.browser()?.isConnected()) {
      return this.discoveryContext;
    }
    this.discoveryContext = await chromium.launchPersistentContext(
      opts.userDataDir,
      { headless: false, viewport: null },
    );
    return this.discoveryContext;
  }

  /** Closes the persistent discovery context if one is open. */
  async closeDiscovery(): Promise<void> {
    if (this.discoveryContext) {
      await this.discoveryContext.close();
      this.discoveryContext = null;
    }
  }
}
