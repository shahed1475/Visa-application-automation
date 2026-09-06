import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import {
  controlMatchesNode,
  validateAdapterAgainstPage,
  validateIndiaAdapter,
} from '../../src/server/automation/adapters/india/validateAdapter.js';
import {
  indiaPortalMap,
  type IndiaPortalMap,
} from '../../src/server/automation/adapters/india/indiaPortalMap.js';
import { FIXTURE_INDIA_PORTAL_MAP_V2 } from './support/fixtureIndiaAdapter.js';

// A value-shaped option label. The sanitizer (§5.3) must reduce it to '' so it
// never lands in the report.
const PII_OPTION = 'Passport Z1234567';

const HAND_PAGE = `<!doctype html><html><head><title>hand</title></head><body>
<h1>Personal</h1>
<label for="surname">Surname</label><input id="surname" type="text">
<label for="sex">Sex</label>
<select id="sex"><option value="M">Male</option><option value="F">Female</option></select>
<select id="pii-select"><option>${PII_OPTION}</option><option>Clean Option</option></select>
<a class="next" href="/next">Save &amp; Continue</a>
</body></html>`;

// One page carrying every control the populated fixture map (v2) points at, plus
// a single nav control. No fixture-portal page holds all 13 on one screen, so the
// v2 smoke runs against this hand-built page.
const ALL_FIELDS_PAGE = `<!doctype html><html><head><title>all</title></head><body>
<h1>All fields</h1>
<label for="surname">Surname</label><input id="surname" type="text">
<label for="given-names">Given names</label><input id="given-names" type="text">
<label for="sex">Sex</label>
<select id="sex"><option value="M">Male</option><option value="F">Female</option></select>
<label for="passport-number">Passport number</label><input id="passport-number" type="text">
<label for="passport-expiry">Passport expiry</label><input id="passport-expiry" type="date">
<label for="address-line1">Address line 1</label><input id="address-line1" type="text">
<label for="address-city">City</label><input id="address-city" type="text">
<input type="radio" name="marital-status" value="married" id="ms-m"><label for="ms-m">Married</label>
<input type="radio" name="marital-status" value="single" id="ms-s"><label for="ms-s">Single</label>
<label for="spouse-name">Spouse name</label><input id="spouse-name" type="text">
<label for="occupation">Occupation</label><input id="occupation" type="text">
<label for="purpose">Purpose</label>
<select id="purpose"><option value="business">Business</option><option value="recreation">Tourism</option></select>
<label for="arrival-date">Arrival date</label><input id="arrival-date" type="date">
<input type="radio" name="visited-before" value="yes" id="vb-y"><label for="vb-y">Yes</label>
<input type="radio" name="visited-before" value="no" id="vb-n"><label for="vb-n">No</label>
<a class="next" href="/next">Save &amp; Continue</a>
</body></html>`;

interface FixtureServer {
  url: string;
  close(): Promise<void>;
}

async function startServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    req.resume();
    const pathname = (req.url ?? '/').split('?')[0];
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(pathname === '/all' ? ALL_FIELDS_PAGE : HAND_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// A hand-built map for the Step 1 cases: one clean text field, one select, one
// missing selector, one control-kind mismatch, plus one validated state.
const handMap = {
  adapterVersion: '6.0.0',
  mappingRevision: 'test',
  fields: {
    'identity.surname': {
      selector: '#surname',
      control: 'text',
      selectorConfidence: 'stable',
      status: 'validated',
      discoverySessionRef: 'test',
      validatedAt: '2026-09-06T00:00:00.000Z',
    },
    'identity.sex': {
      selector: '#sex',
      control: 'native_select',
      selectorConfidence: 'stable',
      status: 'validated',
      discoverySessionRef: 'test',
      validatedAt: '2026-09-06T00:00:00.000Z',
      optionMatch: 'value',
    },
    'pii.select': {
      selector: '#pii-select',
      control: 'native_select',
      selectorConfidence: 'stable',
      status: 'validated',
      discoverySessionRef: 'test',
      validatedAt: '2026-09-06T00:00:00.000Z',
    },
    'missing.field': {
      selector: '#missing',
      control: 'text',
      selectorConfidence: 'stable',
      status: 'validated',
      discoverySessionRef: 'test',
      validatedAt: '2026-09-06T00:00:00.000Z',
    },
    'mismatch.field': {
      selector: '#surname',
      control: 'native_select',
      selectorConfidence: 'stable',
      status: 'validated',
      discoverySessionRef: 'test',
      validatedAt: '2026-09-06T00:00:00.000Z',
    },
  },
  states: {
    ...indiaPortalMap.states,
    PERSONAL_DETAILS: {
      ...indiaPortalMap.states.PERSONAL_DETAILS,
      nextSelector: '.next',
      nextSelectorStatus: 'validated',
    },
  },
} satisfies Pick<IndiaPortalMap, 'adapterVersion' | 'mappingRevision' | 'fields' | 'states'>;

describe('controlMatchesNode', () => {
  it('applies the brief Step 3 control-matching rules', () => {
    expect(controlMatchesNode('text', 'input', 'text')).toBe(true);
    expect(controlMatchesNode('text', 'input', null)).toBe(true);
    expect(controlMatchesNode('text', 'select', null)).toBe(false);
    expect(controlMatchesNode('textarea', 'textarea', null)).toBe(true);
    expect(controlMatchesNode('textarea', 'input', 'text')).toBe(false);
    expect(controlMatchesNode('native_select', 'select', null)).toBe(true);
    expect(controlMatchesNode('native_select', 'input', 'text')).toBe(false);
    expect(controlMatchesNode('radio', 'input', 'radio')).toBe(true);
    expect(controlMatchesNode('radio', 'input', 'checkbox')).toBe(false);
    expect(controlMatchesNode('checkbox', 'input', 'checkbox')).toBe(true);
    expect(controlMatchesNode('date', 'input', 'date')).toBe(true);
    expect(controlMatchesNode('date', 'input', 'text')).toBe(false);
    expect(controlMatchesNode('number', 'input', 'number')).toBe(true);
    expect(controlMatchesNode('custom_select', 'div', null)).toBe(true);
  });
});

describe('validateAdapterAgainstPage', () => {
  let browser: Browser;
  let fixture: FixtureServer;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    fixture = await startServer();
  });
  afterAll(async () => {
    await browser.close();
    await fixture.close();
  });

  it('resolves fields/states, dumps sanitized option labels, and flags failures', async () => {
    const page = await browser.newPage();
    await page.goto(`${fixture.url}/hand`, { waitUntil: 'domcontentloaded' });
    const urlBefore = page.url();

    const report = await validateAdapterAgainstPage(page, handMap);

    // Read-only: navigation did not change.
    expect(page.url()).toBe(urlBefore);
    await page.close();

    const byPath = (p: string) => report.fields.find((f) => f.fieldPath === p);

    expect(byPath('identity.surname')).toMatchObject({ resolvable: true, controlMatches: true });
    expect(byPath('identity.sex')?.optionLabels).toEqual(['Male', 'Female']);
    expect(byPath('missing.field')).toMatchObject({ resolvable: false, controlMatches: false });
    expect(byPath('mismatch.field')).toMatchObject({ resolvable: true, controlMatches: false });

    const personal = report.states.find((s) => s.state === 'PERSONAL_DETAILS');
    expect(personal).toEqual({ state: 'PERSONAL_DETAILS', nextResolvable: true });

    // Only the one promoted state is validated; the rest stay placeholder → skipped.
    expect(report.states).toHaveLength(1);

    expect(report.ok).toBe(false);

    // The value-shaped option label was scrubbed; no value shape survives.
    expect(byPath('pii.select')?.optionLabels).toEqual(['Clean Option']);
    const serialized = JSON.stringify(report.fields);
    expect(serialized).not.toContain('Z1234567');
    expect(serialized).not.toMatch(/\d{4,}/);
  });

  it('runs green against the populated fixture map v2', async () => {
    const page = await browser.newPage();
    await page.goto(`${fixture.url}/all`, { waitUntil: 'domcontentloaded' });

    const report = await validateAdapterAgainstPage(page, FIXTURE_INDIA_PORTAL_MAP_V2);
    await page.close();

    expect(report.fields.length).toBeGreaterThanOrEqual(13);
    for (const f of report.fields) {
      expect(f, f.fieldPath).toMatchObject({ resolvable: true, controlMatches: true });
    }
    expect(report.states.length).toBeGreaterThan(0);
    for (const s of report.states) {
      expect(s.nextResolvable, s.state).toBe(true);
    }
    expect(report.ok).toBe(true);
  });

  it('validateIndiaAdapter validates zero mappings vacuously (all placeholder)', async () => {
    const page = await browser.newPage();
    await page.goto(`${fixture.url}/hand`, { waitUntil: 'domcontentloaded' });

    const report = await validateIndiaAdapter(page);
    await page.close();

    expect(report.adapterVersion).toBe(indiaPortalMap.adapterVersion);
    expect(report.fields).toEqual([]);
    expect(report.states).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
