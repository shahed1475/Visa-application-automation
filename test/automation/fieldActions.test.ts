import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { applyField, verifyControl } from '../../src/server/automation/engine/fieldActions.js';
import { SelectorNotFoundError } from '../../src/server/automation/engine/pageActions.js';
import type { ControlKind, MappedField } from '../../src/shared/automation/types.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

const FIXTURE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Fields</title></head><body>
  <input id="t" type="text">
  <input id="tblur" type="text" oninput="this.value = this.value + 'X'">
  <select id="ns"><option value="a">Alpha</option><option value="b">Bravo</option></select>
</body></html>`;

function mf(
  selector: string,
  control: ControlKind,
  expected: string,
  optionMatch?: 'exact' | 'label' | 'value',
): MappedField {
  return {
    fieldPath: 'x',
    label: 'X',
    sectionId: 's',
    required: true,
    present: true,
    verified: false,
    spec: {
      selector,
      control,
      selectorConfidence: 'stable',
      ...(optionMatch ? { optionMatch } : {}),
    },
    expected,
  };
}

let browser: Browser;
let fixture: FixtureServer;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  fixture = await startFixtureServer({ html: FIXTURE_HTML });
});
afterAll(async () => {
  await browser.close();
  await fixture.close();
});
beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(fixture.url);
  await page.waitForLoadState('domcontentloaded');
});
afterEach(async () => {
  await context.close();
});

describe('fieldActions', () => {
  it('fills a blank control and verifies by read-back', async () => {
    expect(await applyField(page, mf('#t', 'text', 'RANA'))).toEqual({
      filled: true,
      outcome: 'verified',
      alreadySet: false,
    });
  });

  it('short-circuits when the control already holds the expected value', async () => {
    await page.locator('#t').fill('RANA');
    expect(await applyField(page, mf('#t', 'text', 'RANA'))).toEqual({
      filled: false,
      alreadySet: true,
      outcome: 'verified',
    });
  });

  it('retries once then reports mismatch when read-back never matches', async () => {
    const result = await applyField(page, mf('#tblur', 'text', 'RANA'));
    expect(result.filled).toBe(true);
    expect(result.alreadySet).toBe(false);
    expect(result.outcome).toBe('mismatch');
  });

  it('selects a native option by label and verifies', async () => {
    const result = await applyField(page, mf('#ns', 'native_select', 'Bravo', 'label'));
    expect(result.outcome).toBe('verified');
    expect(result.filled).toBe(true);
  });

  it('propagates SelectorNotFoundError for a missing selector', async () => {
    await expect(applyField(page, mf('#nope', 'text', 'x'))).rejects.toBeInstanceOf(
      SelectorNotFoundError,
    );
  });

  it('verifyControl returns verified / mismatch against the live control', async () => {
    await page.locator('#t').fill('RANA');
    expect(
      await verifyControl(
        page,
        { selector: '#t', control: 'text', selectorConfidence: 'stable' },
        'RANA',
      ),
    ).toBe('verified');
    await page.locator('#t').fill('RAN');
    expect(
      await verifyControl(
        page,
        { selector: '#t', control: 'text', selectorConfidence: 'stable' },
        'RANA',
      ),
    ).toBe('mismatch');
  });
});
