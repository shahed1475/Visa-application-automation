import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  applyField,
  classifyPreFill,
  verifyControl,
} from '../../src/server/automation/engine/fieldActions.js';
import {
  OptionNotFoundError,
  SelectorNotFoundError,
} from '../../src/server/automation/engine/pageActions.js';
import {
  parseDMY,
  parseIso,
} from '../../src/server/automation/adapters/india/transforms.js';
import type { ControlKind, MappedField } from '../../src/shared/automation/types.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

const FIXTURE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Fields</title></head><body>
  <input id="t" type="text">
  <input id="tblur" type="text" oninput="this.value = this.value + 'X'">
  <select id="ns"><option value="a">Alpha</option><option value="b">Bravo</option></select>
  <select id="nsp"><option value="">-- Select --</option><option value="in">India</option><option value="fr">France</option></select>
  <select id="nsd"><option value="x">Ex</option><option value="y" disabled>Why</option></select>
  <input type="radio" name="r" id="r1" value="a">
  <input type="radio" name="r" id="r2" value="b">
  <input id="cb" type="checkbox">
  <input id="d" type="date">
  <input id="dtext" type="text">
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
      usedFallback: false,
      selector: '#t',
    });
  });

  it('short-circuits when the control already holds the expected value', async () => {
    await page.locator('#t').fill('RANA');
    expect(await applyField(page, mf('#t', 'text', 'RANA'))).toEqual({
      filled: false,
      alreadySet: true,
      outcome: 'verified',
      usedFallback: false,
      selector: '#t',
    });
  });

  it('reports usedFallback when the primary selector is gone but the configured fallback resolves', async () => {
    const m = mf('#gone', 'text', 'RANA');
    m.spec = {
      selector: '#gone',
      fallbackSelector: '#t',
      control: 'text',
      selectorConfidence: 'stable',
    };
    const r = await applyField(page, m);
    expect(r.usedFallback).toBe(true);
    expect(r.selector).toBe('#t'); // the RESOLVED selector, for the engine's read-back
    expect(r.outcome).toBe('verified');
    expect(await page.locator('#t').inputValue()).toBe('RANA');
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

  it('applyField throws OptionNotFoundError for an absent select option without touching the control', async () => {
    const before = await page.locator('#ns').inputValue();
    await expect(
      applyField(page, mf('#ns', 'native_select', 'zzz', 'value')),
    ).rejects.toBeInstanceOf(OptionNotFoundError);
    expect(await page.locator('#ns').inputValue()).toBe(before);
  });

  it('applyField throws OptionNotFoundError for a DISABLED select option without touching the control', async () => {
    const before = await page.locator('#nsd').inputValue();
    await expect(
      applyField(page, mf('#nsd', 'native_select', 'y', 'value')),
    ).rejects.toBeInstanceOf(OptionNotFoundError);
    expect(await page.locator('#nsd').inputValue()).toBe(before);
  });

  it('classifyPreFill: a blank control reads as empty', async () => {
    expect(
      await classifyPreFill(
        page,
        { selector: '#t', control: 'text', selectorConfidence: 'stable' },
        'RANA',
      ),
    ).toBe('empty');
  });

  it('classifyPreFill: a control already holding the expected value reads as match', async () => {
    await page.locator('#t').fill('  RANA  ');
    expect(
      await classifyPreFill(
        page,
        { selector: '#t', control: 'text', selectorConfidence: 'stable' },
        'RANA',
      ),
    ).toBe('match');
  });

  it('classifyPreFill: a control holding a different non-empty string reads as conflict', async () => {
    await page.locator('#t').fill('SMITH');
    expect(
      await classifyPreFill(
        page,
        { selector: '#t', control: 'text', selectorConfidence: 'stable' },
        'RANA',
      ),
    ).toBe('conflict');
  });

  it('classifyPreFill: a <select> resting on its empty placeholder option reads as empty, not conflict', async () => {
    expect(
      await classifyPreFill(
        page,
        { selector: '#nsp', control: 'native_select', selectorConfidence: 'stable', optionMatch: 'label' },
        'India',
      ),
    ).toBe('empty');
  });

  it('classifyPreFill: a <select> pre-set to a different option is still a conflict', async () => {
    await page.locator('#nsp').selectOption('fr');
    expect(
      await classifyPreFill(
        page,
        { selector: '#nsp', control: 'native_select', selectorConfidence: 'stable', optionMatch: 'label' },
        'India',
      ),
    ).toBe('conflict');
  });

  it('classifyPreFill: an unchecked checkbox reads as empty when the plan wants it checked', async () => {
    expect(
      await classifyPreFill(
        page,
        { selector: '#cb', control: 'checkbox', selectorConfidence: 'stable' },
        'true',
      ),
    ).toBe('empty');
  });

  it('classifyPreFill: a checked checkbox the plan wants unchecked is a conflict', async () => {
    await page.locator('#cb').check();
    expect(
      await classifyPreFill(
        page,
        { selector: '#cb', control: 'checkbox', selectorConfidence: 'stable' },
        'false',
      ),
    ).toBe('conflict');
  });

  it('classifyPreFill: optionMatch:"value" compares the option value, not its label (match)', async () => {
    // #ns rests on <option value="a">Alpha</option>; label "Alpha" !== value "a".
    expect(
      await classifyPreFill(
        page,
        { selector: '#ns', control: 'native_select', selectorConfidence: 'stable', optionMatch: 'value' },
        'a',
      ),
    ).toBe('match');
  });

  it('classifyPreFill: optionMatch:"value" — a different value is a conflict', async () => {
    expect(
      await classifyPreFill(
        page,
        { selector: '#ns', control: 'native_select', selectorConfidence: 'stable', optionMatch: 'value' },
        'b',
      ),
    ).toBe('conflict');
  });

  it('classifyPreFill: reads the configured fallback when the primary selector is gone', async () => {
    await page.locator('#t').fill('RANA');
    expect(
      await classifyPreFill(
        page,
        { selector: '#gone', fallbackSelector: '#t', control: 'text', selectorConfidence: 'stable' },
        'RANA',
      ),
    ).toBe('match');
  });

  it('classifyPreFill: neither primary nor fallback resolves → empty (never throws)', async () => {
    await expect(
      classifyPreFill(
        page,
        { selector: '#gone-a', fallbackSelector: '#gone-b', control: 'text', selectorConfidence: 'stable' },
        'RANA',
      ),
    ).resolves.toBe('empty');
  });

  it('classifyPreFill: an unreadable control (readControl → null) defers to applyField as empty', async () => {
    expect(
      await classifyPreFill(
        page,
        { selector: 'input[name="r"]', control: 'radio', selectorConfidence: 'stable' },
        'a',
      ),
    ).toBe('empty');
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

  it('verifyControl: a date control with readBackParse compares in ISO (format-independent)', async () => {
    await page.locator('#dtext').fill('15/10/2026'); // portal shows DD/MM/YYYY
    const spec = {
      selector: '#dtext',
      control: 'date' as const,
      selectorConfidence: 'stable' as const,
      readBackParse: parseDMY,
    };
    // `expected` is already the portal-format string (mapFields applied transform)
    expect(await verifyControl(page, spec, '15/10/2026')).toBe('verified');
    expect(await verifyControl(page, spec, '01/01/2020')).toBe('mismatch');
  });

  it('verifyControl: a native date input with parseIso readBackParse verifies an ISO match', async () => {
    await page.locator('#d').fill('2026-10-15');
    const spec = {
      selector: '#d',
      control: 'date' as const,
      selectorConfidence: 'stable' as const,
      readBackParse: parseIso,
    };
    expect(await verifyControl(page, spec, '2026-10-15')).toBe('verified');
    expect(await verifyControl(page, spec, '2020-01-01')).toBe('mismatch');
  });

  it('verifyControl: date read-back that readBackParse cannot parse → unreadable (never a silent pass)', async () => {
    await page.locator('#d').fill('2026-10-15'); // native input reads back ISO
    const spec = {
      selector: '#d',
      control: 'date' as const,
      selectorConfidence: 'stable' as const,
      readBackParse: parseDMY, // wrong parser for this control's format
    };
    expect(await verifyControl(page, spec, '15/10/2026')).toBe('unreadable');
  });

  it('verifyControl: a date control WITHOUT readBackParse falls back to raw trim-equality (unchanged)', async () => {
    await page.locator('#d').fill('2026-10-15');
    expect(
      await verifyControl(
        page,
        { selector: '#d', control: 'date', selectorConfidence: 'stable' },
        '2026-10-15',
      ),
    ).toBe('verified');
  });
});
