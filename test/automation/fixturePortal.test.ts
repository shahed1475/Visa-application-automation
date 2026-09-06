import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { PageInspection } from '../../src/server/automation/engine/pageInspector.js';
import { startFixturePortal, type FixturePortal } from '../helpers/fixturePortal.js';
import { makeFixtureIndiaAdapter } from './support/fixtureIndiaAdapter.js';

let browser: Browser;
let portal: FixturePortal;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  portal = await startFixturePortal();
});
afterAll(async () => {
  await browser.close();
  await portal.close();
});

describe('fixture portal (plain HTTP)', () => {
  it('serves /personal as HTML with an <h1>', async () => {
    const res = await fetch(portal.url + '/personal');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<h1>');
  });

  it('renders the OTP challenge by default', async () => {
    const body = await (await fetch(portal.url + '/challenge')).text();
    expect(body).toContain('Enter the OTP');
    expect(body).toContain('id="otp"');
  });

  it('renders the captcha challenge for ?challenge=captcha', async () => {
    const body = await (await fetch(portal.url + '/challenge?challenge=captcha')).text();
    expect(body).toContain('g-recaptcha');
  });

  it('renders the ok challenge for ?challenge=ok', async () => {
    const body = await (await fetch(portal.url + '/challenge?challenge=ok')).text();
    expect(body).toContain('Verified');
  });

  it('honours setChallenge for subsequent requests', async () => {
    portal.setChallenge('captcha');
    let body = await (await fetch(portal.url + '/challenge')).text();
    expect(body).toContain('g-recaptcha');
    // query wins for a single request
    body = await (await fetch(portal.url + '/challenge?challenge=ok')).text();
    expect(body).toContain('Verified');
    // ...then reverts to the setting
    body = await (await fetch(portal.url + '/challenge')).text();
    expect(body).toContain('g-recaptcha');
    portal.setChallenge('otp');
  });

  it('404s an unknown path', async () => {
    const res = await fetch(portal.url + '/nonsense');
    expect(res.status).toBe(404);
  });

  it('tracks POST /__fixture/submit', async () => {
    const before = portal.submitCount;
    const res = await fetch(portal.url + '/__fixture/submit', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(portal.submitCount).toBe(before + 1);
  });

  it('records every request', async () => {
    expect(portal.requests.some((r) => r.url === '/personal')).toBe(true);
  });
});

describe('fixture India adapter', () => {
  it('identifies the personal page from a real browser page', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(portal.url + '/personal');
    const adapter = makeFixtureIndiaAdapter(portal.url);
    const identity = await adapter.getPageIdentity(page, {} as PageInspection);
    expect(identity.state).toBe('PERSONAL_DETAILS');
    expect(identity.confidence).toBe(0.95);
    await context.close();
  });

  it('returns UNKNOWN for an unrecognised path', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(portal.url + '/nonsense').catch(() => {});
    const adapter = makeFixtureIndiaAdapter(portal.url);
    const identity = await adapter.getPageIdentity(page, {} as PageInspection);
    expect(identity.state).toBe('UNKNOWN');
    expect(identity.confidence).toBe(0);
    await context.close();
  });

  it('exposes the field map with stable selectors', () => {
    const adapter = makeFixtureIndiaAdapter(portal.url);
    const map = adapter.getFieldMap();
    expect(map['identity.surname']?.selector).toBe('#surname');
    expect(map['family.maritalStatus']?.selector).toBe('input[name="marital-status"]');
    expect(Object.keys(map)).toHaveLength(13);
  });

  it('implements the remaining contract members', () => {
    const adapter = makeFixtureIndiaAdapter(portal.url);
    expect(adapter.id).toBe('fixture-india');
    expect(adapter.submitSelector).toBeNull();
    expect(adapter.isFinalReview('FINAL_REVIEW')).toBe(true);
    expect(adapter.isFinalReview('REVIEW')).toBe(false);
    expect(adapter.isFinalReview('PERSONAL_DETAILS')).toBe(false);
    expect(adapter.matches(portal.url + '/personal')).toBe(true);
    expect(adapter.matches('https://example.com')).toBe(false);
    expect(adapter.entryUrl(portal.url)).toBe(portal.url.replace(/\/$/, '') + '/personal');
    expect(adapter.entryUrl(portal.url + '/')).toBe(portal.url.replace(/\/$/, '') + '/personal');
    expect(adapter.sectionIdsForState('VISA_DETAILS')).toEqual(['visa_details', 'previous_visits']);
    expect(adapter.sectionIdsForState('PERSONAL_DETAILS')).toEqual(['personal_particulars']);
    expect(adapter.sectionIdsForState('REVIEW')).toEqual([]);
    expect(adapter.documentIdsForState('DOCUMENTS')).toEqual(['invitation_letter_indian_company']);
    expect(adapter.documentIdsForState('REVIEW')).toEqual([]);
    expect(adapter.checkpointHints?.captchaSelectors).toEqual(['.g-recaptcha']);
  });

  it('honours opts.documentIds', () => {
    const adapter = makeFixtureIndiaAdapter(portal.url, {
      documentIds: { DOCUMENTS: ['a', 'b'], REVIEW: ['c'] },
    });
    expect(adapter.documentIdsForState('DOCUMENTS')).toEqual(['a', 'b']);
    expect(adapter.documentIdsForState('REVIEW')).toEqual(['c']);
    expect(adapter.documentIdsForState('ADDRESS')).toEqual([]);
  });

  it('canContinue reflects a visible validation error', async () => {
    const adapter = makeFixtureIndiaAdapter(portal.url);
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(portal.url + '/personal');
    expect(await adapter.canContinue(page)).toEqual({ ok: true });

    await page.goto(portal.url + '/personal?invalid=1');
    expect(await adapter.canContinue(page)).toEqual({
      ok: false,
      reason: 'the page shows a validation error',
    });

    await context.close();
  });

  it('clickNext walks the page chain', async () => {
    const adapter = makeFixtureIndiaAdapter(portal.url);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(portal.url + '/personal');
    await adapter.clickNext(page);
    await page.waitForLoadState('domcontentloaded');
    expect(new URL(page.url()).pathname).toBe('/passport');
    await context.close();
  });
});
