import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { PageInspection } from '../../src/server/automation/engine/pageInspector.js';
import { indiaAdapter } from '../../src/server/automation/adapters/india/indiaAdapter.js';
import { indiaPortalMap } from '../../src/server/automation/adapters/india/indiaPortalMap.js';
import { resolveAdapter } from '../../src/server/automation/adapters/registry.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

const fakePage = {} as unknown as Page;
const fakeInspection = { pageTitle: null, elementCounts: {}, securityChallengeFlags: {} } as PageInspection;

describe('indiaAdapter — scaffold', () => {
  it('has no submit affordance (literal null in both places)', () => {
    expect(indiaAdapter.submitSelector).toBeNull();
    expect(indiaPortalMap.submitSelector).toBeNull();
  });

  it('every field selector is the literal placeholder, confidence fragile', () => {
    const fields = Object.values(indiaAdapter.getFieldMap());
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.selector === 'TODO:discover')).toBe(true);
    expect(fields.every((f) => f.selectorConfidence === 'fragile')).toBe(true);
    expect(Object.values(indiaPortalMap.fields).every((f) => f.selector === 'TODO:discover')).toBe(true);
  });

  it('isFinalReview true only for FINAL_REVIEW', () => {
    expect(indiaAdapter.isFinalReview('FINAL_REVIEW')).toBe(true);
    expect(indiaAdapter.isFinalReview('REVIEW')).toBe(false);
    expect(indiaAdapter.isFinalReview('PERSONAL_DETAILS')).toBe(false);
    expect(indiaAdapter.isFinalReview('UNKNOWN')).toBe(false);
  });

  it('sectionIdsForState maps known states and is empty for unknown', () => {
    expect(indiaAdapter.sectionIdsForState('PASSPORT_DETAILS')).toEqual(['passport_details']);
    expect(indiaAdapter.sectionIdsForState('VISA_DETAILS')).toEqual(['visa_details', 'previous_visits']);
    expect(indiaAdapter.sectionIdsForState('UNKNOWN')).toEqual([]);
  });

  it('documentIdsForState is empty until discovery', () => {
    expect(indiaAdapter.documentIdsForState('DOCUMENTS')).toEqual([]);
  });

  it('entryUrl echoes the configured portal URL (never a constant)', () => {
    expect(indiaAdapter.entryUrl('https://example.test/some/configured/path')).toBe(
      'https://example.test/some/configured/path',
    );
  });

  it('matches only on the hostname of a known India visa portal', () => {
    // known hosts, with and without www / a path
    expect(indiaAdapter.matches('https://indianvisaonline.gov.in/visa/apply')).toBe(true);
    expect(indiaAdapter.matches('https://www.indianvisaonline.gov.in/')).toBe(true);
    expect(indiaAdapter.matches('https://indianvisaonline.gov.in/visa/')).toBe(true);
    expect(indiaAdapter.matches('https://www.ivacbd.com/')).toBe(true);
    // over-match guards: the token must be at a hostname boundary
    expect(indiaAdapter.matches('https://myivac.com/service')).toBe(false);
    expect(indiaAdapter.matches('https://portal.example/service/ivac.aspx')).toBe(false);
    // hostname-only: a token in the path or query must never trip it
    expect(indiaAdapter.matches('https://ivac.example.org/apply?ref=ivac.gov.in')).toBe(false);
    expect(indiaAdapter.matches('https://example.com/')).toBe(false);
    // not a URL → the try/catch returns false
    expect(indiaAdapter.matches('not a url')).toBe(false);
  });

  it('resolveAdapter picks india first, generic as the fallback', () => {
    expect(resolveAdapter('https://indianvisaonline.gov.in/x').id).toBe('india');
    expect(resolveAdapter('https://example.com/x').id).toBe('generic');
    expect(resolveAdapter('https://myivac.com/x').id).toBe('generic');
  });

  it('clickNext rejects while selectors are not yet discovered', async () => {
    await expect(indiaAdapter.clickNext(fakePage)).rejects.toThrow(/not yet discovered/i);
  });

  it('getPageIdentity on a fake page yields UNKNOWN / 0', async () => {
    const id = await indiaAdapter.getPageIdentity(fakePage, fakeInspection);
    expect(id.state).toBe('UNKNOWN');
    expect(id.confidence).toBe(0);
  });
});

describe('indiaAdapter.getPageIdentity — against real pages', () => {
  let browser: Browser;
  let fixture: FixtureServer | null = null;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser.close();
    if (fixture) await fixture.close();
  });

  it('identifies PASSPORT_DETAILS from the page heading', async () => {
    fixture = await startFixtureServer({
      html: '<!doctype html><html><body><h1>Passport Details</h1></body></html>',
    });
    const page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    const id = await indiaAdapter.getPageIdentity(page, fakeInspection);
    expect(id.state).toBe('PASSPORT_DETAILS');
    expect(id.confidence).toBeGreaterThan(0);
    expect(id.signals[0]).toMatchObject({ kind: 'heading', matched: true });
    await page.close();
    await fixture.close();
    fixture = null;
  });

  it('returns UNKNOWN / 0 when no heading pattern matches', async () => {
    fixture = await startFixtureServer({
      html: '<!doctype html><html><body><h1>Nothing</h1></body></html>',
    });
    const page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    const id = await indiaAdapter.getPageIdentity(page, fakeInspection);
    expect(id.state).toBe('UNKNOWN');
    expect(id.confidence).toBe(0);
    expect(id.signals[0]).toMatchObject({ kind: 'heading', matched: false });
    await page.close();
    await fixture.close();
    fixture = null;
  });
});
