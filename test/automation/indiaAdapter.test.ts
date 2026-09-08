import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { PageInspection } from '../../src/server/automation/engine/pageInspector.js';
import { indiaAdapter, INDIA_ADAPTER_VERSION } from '../../src/server/automation/adapters/india/indiaAdapter.js';
import { indiaPortalMap } from '../../src/server/automation/adapters/india/indiaPortalMap.js';

/**
 * Minimal fake `Page` for identity scoring: only `url()` + `locator().first().innerText()`
 * and `locator().count()` are exercised by `getIndiaPageIdentity`.
 */
function makeScoringPage(opts: { url?: string; heading?: string; anchors?: Record<string, number> }): Page {
  return {
    url: () => opts.url ?? '',
    locator: (sel: string) => ({
      first: () => ({
        innerText: async () => {
          if (opts.heading === undefined) throw new Error('no heading');
          return opts.heading;
        },
      }),
      count: async () => opts.anchors?.[sel] ?? 0,
    }),
  } as unknown as Page;
}
import { resolveAdapter } from '../../src/server/automation/adapters/registry.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

const fakePage = {} as unknown as Page;
const fakeInspection = { pageTitle: null, elementCounts: {}, securityChallengeFlags: {} } as PageInspection;

describe('indiaAdapter — scaffold', () => {
  it('has no submit affordance (literal null in both places)', () => {
    expect(indiaAdapter.submitSelector).toBeNull();
    expect(indiaPortalMap.submitSelector).toBeNull();
  });

  it('getFieldMap() is empty — no mapping is production-usable yet', () => {
    // Phase 7: the engine only ever receives `validated` + current-revision
    // mappings. Every real mapping is still a `'TODO:discover'` placeholder, so
    // the production field map is empty.
    expect(Object.keys(indiaAdapter.getFieldMap())).toHaveLength(0);
    expect(Object.values(indiaPortalMap.fields).every((f) => f.selector === 'TODO:discover')).toBe(true);
    expect(Object.values(indiaPortalMap.fields).every((f) => f.selectorConfidence === 'fragile')).toBe(true);
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

  it('clickNext rejects while the next-page selector is not production-ready', async () => {
    await expect(indiaAdapter.clickNext(fakePage)).rejects.toThrow(/not production-ready/i);
  });

  it('getPageIdentity on a fake page yields UNKNOWN / 0', async () => {
    const id = await indiaAdapter.getPageIdentity(fakePage, fakeInspection);
    expect(id.state).toBe('UNKNOWN');
    expect(id.confidence).toBe(0);
  });

  it('exposes the adapter/map contract version', () => {
    expect(INDIA_ADAPTER_VERSION).toBe(indiaPortalMap.adapterVersion);
    expect(INDIA_ADAPTER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('indiaAdapter — production field map + mappingReadiness (Phase 7)', () => {
  it('mappingReadiness reports unvalidated for a known placeholder path, unmapped for a nonsense path', () => {
    expect(indiaAdapter.mappingReadiness!('identity.surname')).toBe('unvalidated');
    expect(indiaAdapter.mappingReadiness!('not.a.real.path')).toBe('unmapped');
  });

  it('nextSelectorReadiness is unmapped while every state nextSelector is a TODO:discover / null placeholder', () => {
    expect(indiaAdapter.nextSelectorReadiness!('PERSONAL_DETAILS')).toBe('unmapped');
    expect(indiaAdapter.nextSelectorReadiness!('REGISTRATION')).toBe('unmapped'); // nextSelector: null
    expect(indiaAdapter.nextSelectorReadiness!('not-a-real-state')).toBe('unmapped');
  });

  it('nextSelectorReadiness classifies a promoted nextSelector by revision parity', () => {
    const original = indiaPortalMap.states.PERSONAL_DETAILS;
    indiaPortalMap.states.PERSONAL_DETAILS = {
      ...original,
      nextSelector: 'a.next',
      nextSelectorStatus: 'validated',
      nextSelectorValidatedAgainstRevision: indiaPortalMap.mappingRevision,
    };
    try {
      expect(indiaAdapter.nextSelectorReadiness!('PERSONAL_DETAILS')).toBe('production');
      indiaPortalMap.states.PERSONAL_DETAILS = {
        ...indiaPortalMap.states.PERSONAL_DETAILS,
        nextSelectorValidatedAgainstRevision: 'an-old-revision',
      };
      expect(indiaAdapter.nextSelectorReadiness!('PERSONAL_DETAILS')).toBe('stale');
      indiaPortalMap.states.PERSONAL_DETAILS = {
        ...indiaPortalMap.states.PERSONAL_DETAILS,
        nextSelectorStatus: 'discovered',
        nextSelectorValidatedAgainstRevision: undefined,
      };
      expect(indiaAdapter.nextSelectorReadiness!('PERSONAL_DETAILS')).toBe('unvalidated');
    } finally {
      indiaPortalMap.states.PERSONAL_DETAILS = original;
    }
  });

  it('getFieldMap() exposes a mapping ONLY when it is validated against the current revision', () => {
    const path = 'identity.surname';
    const original = indiaPortalMap.fields[path];
    indiaPortalMap.fields[path] = {
      selector: '#surname',
      control: 'text',
      selectorConfidence: 'stable',
      status: 'validated',
      discoverySessionRef: 's',
      validatedAt: 't',
      validatedAgainstRevision: indiaPortalMap.mappingRevision,
    };
    try {
      expect(indiaAdapter.getFieldMap()[path]?.selector).toBe('#surname');
      expect(indiaAdapter.mappingReadiness!(path)).toBe('production');

      // Make it stale — it must drop out of the production map.
      indiaPortalMap.fields[path] = {
        ...indiaPortalMap.fields[path]!,
        validatedAgainstRevision: 'an-old-revision',
      };
      expect(indiaAdapter.getFieldMap()[path]).toBeUndefined();
      expect(indiaAdapter.mappingReadiness!(path)).toBe('stale');
    } finally {
      indiaPortalMap.fields[path] = original!;
    }
  });
});

describe('indiaAdapter.getPageIdentity — URL + heading + anchor scoring', () => {
  it('URL-only match scores 0.5 and names the state honestly (below detectPage floor)', async () => {
    const page = makeScoringPage({ url: 'https://indianvisaonline.gov.in/apply/personal-details' });
    const id = await indiaAdapter.getPageIdentity(page, fakeInspection);
    expect(id.state).toBe('PERSONAL_DETAILS');
    expect(id.confidence).toBe(0.5);
    expect(id.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'url', matched: true })]),
    );
  });

  it('URL + heading match scores 0.8 and resolves the state', async () => {
    const page = makeScoringPage({
      url: 'https://indianvisaonline.gov.in/apply/personal-details',
      heading: 'Personal Details',
    });
    const id = await indiaAdapter.getPageIdentity(page, fakeInspection);
    expect(id.state).toBe('PERSONAL_DETAILS');
    expect(id.confidence).toBeCloseTo(0.8, 5);
  });

  it('heading-only match scores 0.3 (fail-closed: below the 0.6 detectPage floor)', async () => {
    const page = makeScoringPage({
      url: 'https://indianvisaonline.gov.in/apply/step',
      heading: 'Passport Details',
    });
    const id = await indiaAdapter.getPageIdentity(page, fakeInspection);
    expect(id.state).toBe('PASSPORT_DETAILS');
    expect(id.confidence).toBeCloseTo(0.3, 5);
  });

  it('no signal match → UNKNOWN / 0', async () => {
    const page = makeScoringPage({ url: 'https://indianvisaonline.gov.in/dashboard', heading: 'Welcome' });
    const id = await indiaAdapter.getPageIdentity(page, fakeInspection);
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
