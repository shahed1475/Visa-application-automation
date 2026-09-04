import { afterEach, beforeEach, expect, it } from 'vitest';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';
import { inspectPage } from '../../src/server/automation/engine/pageInspector.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

const HTML = `<!doctype html><html><head><title>Fake Portal A</title></head>
<body>
  <form><input type="text" name="a"><input type="date" name="b">
  <select><option>x</option></select><input type="file"><input type="checkbox">
  <button type="submit">Go</button></form>
  <div class="g-recaptcha"></div>
  <a href="/next">next</a>
</body></html>`;

let bm: BrowserManager;
let fixture: FixtureServer;

beforeEach(async () => {
  bm = new BrowserManager();
  fixture = await startFixtureServer({ html: HTML });
});
afterEach(async () => {
  await bm.close();
  await fixture.close();
});

it('reports title, element counts, and recaptcha flag', async () => {
  const browser = await bm.launch();
  const page = await browser.newPage();
  await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
  const info = await inspectPage(page);
  expect(info.pageTitle).toBe('Fake Portal A');
  expect(info.elementCounts.forms).toBe(1);
  expect(info.elementCounts.dateInputs).toBe(1);
  expect(info.elementCounts.fileInputs).toBe(1);
  expect(info.elementCounts.selects).toBe(1);
  expect(info.securityChallengeFlags.recaptcha).toBe(true);
});
