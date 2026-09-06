import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { captureDiscovery } from '../../src/server/automation/discovery/portalDiscovery.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

const FIXTURE_HTML = `<!doctype html><html><head><title>Discovery Fixture</title></head>
<body>
  <form>
    <label for="a">Surname</label><input id="a">
    <label for="b">City</label><select id="b"><option>X</option></select>
  </form>
</body></html>`;

describe('captureDiscovery — read-only portal discovery', () => {
  let browser: Browser;
  let fixture: FixtureServer;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    fixture = await startFixtureServer({ html: FIXTURE_HTML });
  });
  afterAll(async () => {
    await browser.close();
    await fixture.close();
  });

  it('enumerates form controls, ranks selectors, and reports the fingerprint', async () => {
    const page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    const report = await captureDiscovery(page);
    await page.close();

    expect(report.candidates).toHaveLength(2);
    expect(report.candidates[0]).toMatchObject({
      label: 'Surname',
      primarySelector: '#a',
      control: 'text',
    });
    expect(report.candidates[1]).toMatchObject({
      label: 'City',
      primarySelector: '#b',
      control: 'native_select',
    });

    expect(report.url).toContain('127.0.0.1');
    expect(report.pageTitle).toBe('Discovery Fixture');
    expect(typeof report.fingerprint).toBe('object');
    expect(report.fingerprint).not.toBeNull();
    expect(report).toHaveProperty('signals');
  });

  it('the module source contains no page-mutating call (read-only by construction)', () => {
    const src = readFileSync(
      path.join('src', 'server', 'automation', 'discovery', 'portalDiscovery.ts'),
      'utf8',
    )
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const banned of ['.fill(', '.click(', '.type(', '.press(', '.goto(', 'form.submit']) {
      expect(src, `portalDiscovery.ts must not contain ${banned}`).not.toContain(banned);
    }
  });
});
