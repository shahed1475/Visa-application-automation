import { expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';

it('launchPersistentDiscovery opens ONE headed persistent context and closeDiscovery closes it', async () => {
  const spy = vi.spyOn(chromium, 'launchPersistentContext');
  const dir = mkdtempSync(path.join(tmpdir(), 'disco-'));
  const bm = new BrowserManager();
  try {
    const ctx = await bm.launchPersistentDiscovery({ userDataDir: dir });
    expect(ctx.pages().length).toBeGreaterThanOrEqual(1);
    expect(ctx.browser()?.isConnected()).toBe(true);
    expect(ctx.browser()?.browserType().name()).toBe('chromium');
    expect(spy.mock.calls[0]![1]).toMatchObject({ headless: false });

    const again = await bm.launchPersistentDiscovery({ userDataDir: dir });
    expect(again).toBe(ctx);
    expect(spy.mock.calls.length).toBe(1);

    await bm.closeDiscovery();
    expect(spy.mock.calls.length).toBe(1);
  } finally {
    await bm.closeDiscovery().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    spy.mockRestore();
  }
}, 30_000);

it('closeDiscovery is a no-op when nothing is open', async () => {
  const bm = new BrowserManager();
  await expect(bm.closeDiscovery()).resolves.toBeUndefined();
});
