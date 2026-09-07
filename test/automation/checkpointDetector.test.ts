import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { PageInspection } from '../../src/server/automation/engine/pageInspector.js';
import type { CheckpointHints } from '../../src/server/automation/adapters/baseAdapter.js';
import { detectCheckpoint } from '../../src/server/automation/engine/checkpointDetector.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

function mkInspection(flags: Partial<Record<string, boolean>>): PageInspection {
  return { pageTitle: null, elementCounts: {}, securityChallengeFlags: flags as Record<string, boolean> };
}

const fakePage = {} as Page;

describe('detectCheckpoint — flags only', () => {
  it('detects reCAPTCHA as captcha', async () => {
    const out = await detectCheckpoint(mkInspection({ recaptcha: true }), fakePage);
    expect(out?.kind).toBe('captcha');
  });
  it('detects hCaptcha as captcha', async () => {
    expect((await detectCheckpoint(mkInspection({ hcaptcha: true }), fakePage))?.kind).toBe('captcha');
  });
  it('detects Turnstile as captcha', async () => {
    expect((await detectCheckpoint(mkInspection({ turnstile: true }), fakePage))?.kind).toBe('captcha');
  });
  it('detects a Cloudflare interstitial as anti_bot', async () => {
    expect(
      (await detectCheckpoint(mkInspection({ cloudflareInterstitial: true }), fakePage))?.kind,
    ).toBe('anti_bot');
  });
  it('detects an MFA mention as mfa', async () => {
    expect((await detectCheckpoint(mkInspection({ mentionsMfa: true }), fakePage))?.kind).toBe('mfa');
  });
  it('detects an OTP mention as otp', async () => {
    expect((await detectCheckpoint(mkInspection({ mentionsOtp: true }), fakePage))?.kind).toBe('otp');
  });
  it('returns null for a clean page with no hints', async () => {
    expect(await detectCheckpoint(mkInspection({}), fakePage)).toBeNull();
  });
});

describe('detectCheckpoint — precedence', () => {
  it('captcha beats otp', async () => {
    const out = await detectCheckpoint(mkInspection({ recaptcha: true, mentionsOtp: true }), fakePage);
    expect(out?.kind).toBe('captcha');
  });
  it('anti_bot beats mfa', async () => {
    const out = await detectCheckpoint(
      mkInspection({ cloudflareInterstitial: true, mentionsMfa: true }),
      fakePage,
    );
    expect(out?.kind).toBe('anti_bot');
  });
});

describe('detectCheckpoint — signals hygiene', () => {
  it('signals are short reason strings, never a numeric code or raw page text', async () => {
    const out = await detectCheckpoint(mkInspection({ mentionsOtp: true }), fakePage);
    expect(out?.signals.length).toBeGreaterThan(0);
    for (const s of out?.signals ?? []) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeLessThan(100);
      expect(s).not.toMatch(/\d{4,}/);
    }
  });
});

describe('detectCheckpoint — real page (hints + OTP-input heuristic)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let fixture: FixtureServer | undefined;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser.close();
  });
  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
  });
  afterEach(async () => {
    await context.close();
    await fixture?.close();
    fixture = undefined;
  });

  it('matches a captcha selector hint present on the page', async () => {
    fixture = await startFixtureServer({ html: '<!doctype html><div id="cap"></div>' });
    await page.goto(fixture.url);
    const hints: CheckpointHints = { captchaSelectors: ['#cap'] };
    const out = await detectCheckpoint(mkInspection({}), page, hints);
    expect(out?.kind).toBe('captcha');
  });

  it('detects a visible OTP-looking input via its associated label', async () => {
    fixture = await startFixtureServer({
      html: '<!doctype html><label for="o">Enter the OTP</label><input id="o" type="text">',
    });
    await page.goto(fixture.url);
    const out = await detectCheckpoint(mkInspection({}), page);
    expect(out?.kind).toBe('otp');
    expect(out?.signals.join(' ').toLowerCase()).toContain('otp');
  });

  it('returns null for a real page with no challenge markers', async () => {
    fixture = await startFixtureServer({
      html: '<!doctype html><label for="n">Full name</label><input id="n" type="text">',
    });
    await page.goto(fixture.url);
    expect(await detectCheckpoint(mkInspection({}), page)).toBeNull();
  });
});

describe('checkpointDetector — detect-only source guard (local smoke)', () => {
  it('contains no page-interaction calls', () => {
    const src = readFileSync(
      fileURLToPath(
        new URL('../../src/server/automation/engine/checkpointDetector.ts', import.meta.url),
      ),
      'utf8',
    );
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const forbidden of ['.fill(', '.click(', '.type(', '.press(', '.check(']) {
      expect(stripped).not.toContain(forbidden);
    }
  });
});
