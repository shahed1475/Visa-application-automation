import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  assertNativeOptionAvailable,
  fillText,
  OptionNotFoundError,
  readControl,
  resolveSelector,
  selectCustom,
  selectNative,
  setCheckbox,
  setDate,
  setRadio,
  SelectorNotFoundError,
  typeAutocomplete,
  waitForPageSettled,
} from '../../src/server/automation/engine/pageActions.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

const FIXTURE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Controls</title>
<style>#cd{border:1px solid #333;padding:6px;min-width:120px}ul{list-style:none;margin:0;padding:0}li{padding:4px}</style>
</head><body>
  <input id="t" type="text">
  <textarea id="ta"></textarea>
  <select id="ns"><option value="a">Alpha</option><option value="b">Bravo</option></select>
  <select id="nsd">
    <option value="x">Ex</option>
    <option value="y" disabled>Why</option>
  </select>

  <div id="cd" role="combobox" tabindex="0"><span id="cd-label">Choose</span></div>
  <ul id="cd-list" role="listbox" hidden>
    <li role="option">First</li>
    <li role="option">Second</li>
    <li role="option">Third</li>
  </ul>

  <div id="ss" role="combobox" tabindex="0"><span id="ss-label">Pick</span></div>
  <ul id="ss-list" role="listbox" hidden>
    <li role="option">One</li>
    <li role="option">Two</li>
    <li role="option">Three</li>
  </ul>

  <label><input type="radio" name="r" value="x">X</label>
  <label><input type="radio" name="r" value="y">Y</label>

  <input type="checkbox" id="cb">
  <input type="date" id="d">
  <input type="number" id="num">

  <input id="ac" type="text" autocomplete="off">
  <ul id="aclist" role="listbox" hidden></ul>

  <script>
    (function () {
      ['cd', 'ss'].forEach(function (id) {
        var trigger = document.getElementById(id);
        var list = document.getElementById(id + '-list');
        var label = document.getElementById(id + '-label');
        trigger.addEventListener('click', function () { list.hidden = !list.hidden; });
        Array.prototype.forEach.call(list.querySelectorAll('li'), function (li) {
          li.addEventListener('click', function () {
            label.textContent = li.textContent;
            list.hidden = true;
          });
        });
      });

      var ac = document.getElementById('ac');
      var aclist = document.getElementById('aclist');
      var OPTIONS = ['Apple', 'Apricot', 'Banana', 'Cherry'];
      ac.addEventListener('input', function () {
        var q = ac.value.toLowerCase();
        var matches = q ? OPTIONS.filter(function (o) { return o.toLowerCase().indexOf(q) !== -1; }) : [];
        aclist.innerHTML = '';
        matches.forEach(function (m) {
          var li = document.createElement('li');
          li.setAttribute('role', 'option');
          li.textContent = m;
          li.addEventListener('click', function () { ac.value = m; aclist.hidden = true; });
          aclist.appendChild(li);
        });
        aclist.hidden = matches.length === 0;
      });
    })();
  </script>
</body></html>`;

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

describe('pageActions', () => {
  it('round-trips a text input', async () => {
    await fillText(page, '#t', 'hello');
    expect(await readControl(page, '#t', 'text')).toBe('hello');
  });

  it('round-trips a textarea', async () => {
    await fillText(page, '#ta', 'multi\nline');
    expect(await readControl(page, '#ta', 'textarea')).toBe('multi\nline');
  });

  it('round-trips a number input', async () => {
    await fillText(page, '#num', '42');
    expect(await readControl(page, '#num', 'number')).toBe('42');
  });

  it('selects a native option by label and reads the selected label', async () => {
    await selectNative(page, '#ns', 'Bravo', 'label');
    expect(await readControl(page, '#ns', 'native_select')).toBe('Bravo');
  });

  it('selects a native option by value', async () => {
    await selectNative(page, '#ns', 'b', 'value');
    expect(await readControl(page, '#ns', 'native_select')).toBe('Bravo');
  });

  it('rejects with OptionNotFoundError for a missing native option', async () => {
    await expect(selectNative(page, '#ns', 'NoSuchOption', 'label')).rejects.toBeInstanceOf(
      OptionNotFoundError,
    );
  });

  it('opens a custom dropdown and picks an option', async () => {
    await selectCustom(page, '#cd', 'Second');
    expect(await readControl(page, '#cd', 'custom_select')).toContain('Second');
  });

  it('opens a searchable-select widget and picks an option', async () => {
    await selectCustom(page, '#ss', 'Two');
    expect(await readControl(page, '#ss', 'searchable_select')).toContain('Two');
  });

  it('sets a radio in a group and reads the checked value', async () => {
    await setRadio(page, 'input[name="r"]', 'y');
    expect(await readControl(page, 'input[name="r"]', 'radio')).toBe('y');
  });

  it('checks and unchecks a checkbox', async () => {
    await setCheckbox(page, '#cb', true);
    expect(await readControl(page, '#cb', 'checkbox')).toBe('true');
    await setCheckbox(page, '#cb', false);
    expect(await readControl(page, '#cb', 'checkbox')).toBe('false');
  });

  it('fills a date input', async () => {
    await setDate(page, '#d', '2027-01-15');
    expect(await readControl(page, '#d', 'date')).toBe('2027-01-15');
  });

  it('types into an autocomplete and picks the exact suggestion', async () => {
    await typeAutocomplete(page, '#ac', 'Apple');
    expect(await readControl(page, '#ac', 'autocomplete')).toBe('Apple');
  });

  it('rejects with SelectorNotFoundError for a missing selector', async () => {
    await expect(fillText(page, '#nope', 'x')).rejects.toBeInstanceOf(SelectorNotFoundError);
  });

  it('rejects with OptionNotFoundError for a missing dropdown option', async () => {
    await expect(selectCustom(page, '#cd', 'NoSuchOption')).rejects.toBeInstanceOf(
      OptionNotFoundError,
    );
  });

  it('waitForPageSettled resolves once the anchor is visible', async () => {
    await expect(waitForPageSettled(page, '#t')).resolves.toBeUndefined();
  });

  describe('resolveSelector (Phase 7 fallback resolution)', () => {
    it('returns the primary selector when it is attached', async () => {
      expect(await resolveSelector(page, { selector: '#t' })).toEqual({
        selector: '#t',
        usedFallback: false,
      });
    });

    it('falls back to an explicitly configured fallbackSelector and flags it', async () => {
      expect(await resolveSelector(page, { selector: '#missing', fallbackSelector: '#t' })).toEqual({
        selector: '#t',
        usedFallback: true,
      });
    });

    it('throws SelectorNotFoundError when neither the primary nor the fallback matches', async () => {
      await expect(
        resolveSelector(page, { selector: '#nope-a', fallbackSelector: '#nope-b' }),
      ).rejects.toBeInstanceOf(SelectorNotFoundError);
    });

    it('never invents a fallback — a missing primary with no fallbackSelector throws', async () => {
      await expect(resolveSelector(page, { selector: '#nope-c' })).rejects.toBeInstanceOf(
        SelectorNotFoundError,
      );
    });
  });

  describe('assertNativeOptionAvailable (Phase 7 pre-fill check)', () => {
    it('is silent for a present option, by value or by label', async () => {
      await expect(assertNativeOptionAvailable(page, '#ns', 'a', 'value')).resolves.toBeUndefined();
      await expect(assertNativeOptionAvailable(page, '#ns', 'Alpha', 'label')).resolves.toBeUndefined();
      await expect(assertNativeOptionAvailable(page, '#ns', 'Alpha', 'exact')).resolves.toBeUndefined();
    });

    it('throws OptionNotFoundError for an absent option (no fuzzy match)', async () => {
      await expect(assertNativeOptionAvailable(page, '#ns', 'zzz', 'value')).rejects.toBeInstanceOf(
        OptionNotFoundError,
      );
      await expect(assertNativeOptionAvailable(page, '#ns', 'Alp', 'label')).rejects.toBeInstanceOf(
        OptionNotFoundError,
      );
    });

    it('treats a disabled option as unavailable', async () => {
      await expect(assertNativeOptionAvailable(page, '#nsd', 'x', 'value')).resolves.toBeUndefined();
      await expect(assertNativeOptionAvailable(page, '#nsd', 'y', 'value')).rejects.toBeInstanceOf(
        OptionNotFoundError,
      );
    });
  });
});
