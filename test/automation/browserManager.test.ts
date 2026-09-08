import { afterEach, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';

const m = new BrowserManager();

afterEach(() => m.close());

it('launch({ headless: true }) returns a connected browser', async () => {
  const browser: Browser = await m.launch({ headless: true });
  expect(browser.isConnected()).toBe(true);
});

it('newPage() hands back a fresh context on each call', async () => {
  await m.launch({ headless: true });
  const first = await m.newPage();
  const second = await m.newPage();
  expect(first.context).not.toBe(second.context);
  expect(first.page).not.toBe(second.page);
});

it('newPage() context defines the __name eval shim so tsx-transpiled page.evaluate callbacks do not ReferenceError', async () => {
  await m.launch({ headless: true });
  const { page } = await m.newPage();
  // A named helper inside the callback is what `tsx` rewrites to `__name(fn, "…")`.
  const kind = await page.evaluate(() => {
    const helper = (x: number) => x + 1;
    return { name: typeof (globalThis as unknown as { __name: unknown }).__name, helper: helper(1) };
  });
  expect(kind.name).toBe('function');
  expect(kind.helper).toBe(2);
});

it('bringToFront(page) does not throw', async () => {
  await m.launch({ headless: true });
  const { page } = await m.newPage();
  await expect(m.bringToFront(page)).resolves.toBeUndefined();
});

it('close() disconnects the browser', async () => {
  const browser = await m.launch({ headless: true });
  await m.close();
  expect(browser.isConnected()).toBe(false);
});
