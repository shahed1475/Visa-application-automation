import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import {
  captureDiscoveryV2,
  DISCOVERY_VERSION,
  sanitizeReport,
} from '../../src/server/automation/discovery/observe.js';

const FIXTURE_HTML = readFileSync(
  new URL('../fixtures/discovery/prefilled-personal.html', import.meta.url),
  'utf8',
);

// Fake PII seeded into the fixture's control values. The observer must never
// read a value, so none of these may appear in a persisted report.
const SEEDED_PII = ['Z1234567', '1990-04-12', 'john.doe@example.com'];

interface FixtureServer {
  url: string;
  close(): Promise<void>;
}

async function startServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    req.resume(); // drain, never act on a body
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(FIXTURE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('captureDiscoveryV2 — read-only structural discovery', () => {
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

  it('captures headings, groups, buttons, selects and required indicators without clicking', async () => {
    const page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    const urlBefore = page.url();

    const report = await captureDiscoveryV2(page);

    // No side effects: URL unchanged and the click marker never flipped.
    expect(page.url()).toBe(urlBefore);
    expect(await page.locator('#clicked').textContent()).toBe('no');
    await page.close();

    expect(report.discoveryVersion).toBe(DISCOVERY_VERSION);

    expect(report.headings).toContain('Personal Details');

    expect(report.groups).toContainEqual({
      name: 'sex',
      kind: 'radio',
      options: ['Male', 'Female'],
    });

    const nav = report.buttons.find((b) => b.text === 'Save & Continue');
    expect(nav).toBeDefined();
    expect(nav?.isNavCandidate).toBe(true);

    const nationality = report.selectCatalogue.find((s) => s.optionLabels.includes('India'));
    expect(nationality).toBeDefined();
    expect(nationality?.optionLabels).toEqual(
      expect.arrayContaining(['India', 'United States', 'United Kingdom']),
    );

    const passport = report.candidates.find((c) => c.label === 'Passport Number');
    expect(passport).toBeDefined();
    expect(passport?.control).toBe('text');

    expect(report.requiredIndicators).toEqual(
      expect.arrayContaining(['Surname', 'Passport Number']),
    );
  });

  it('never persists a seeded field value', async () => {
    const page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    const report = await captureDiscoveryV2(page);
    await page.close();

    const serialized = JSON.stringify(sanitizeReport(report));
    for (const pii of SEEDED_PII) {
      expect(serialized).not.toContain(pii);
    }
  });
});
