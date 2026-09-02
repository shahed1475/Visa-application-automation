import { afterEach, beforeEach, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runConnectionTest } from '../../src/server/automation/discovery/testConnection.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

const pageA = `<!doctype html><title>Portal A</title><body><form>
<input name="x"><button type="submit">submit</button></form></body>`;
const pageB = `<!doctype html><title>Portal B</title><body><p>hi</p></body>`;

let shotDir: string;
const servers: FixtureServer[] = [];

beforeEach(() => {
  shotDir = path.join(tmpdir(), `visa-shots-${randomUUID()}`);
});
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  rmSync(shotDir, { recursive: true, force: true });
});

it('navigates to the exact URL it is given and reports basics', async () => {
  const a = await startFixtureServer({ html: pageA });
  servers.push(a);
  const result = await runConnectionTest(a.url, { screenshotDir: shotDir });
  expect(result.success).toBe(true);
  expect(result.pageTitle).toBe('Portal A');
  expect(result.finalUrl).toBe(a.url);
  expect(result.httpStatus).toBe(200);
  expect(result.elementCounts.forms).toBe(1);
  expect(result.screenshotPath && existsSync(result.screenshotPath)).toBe(true);
});

it('changing the URL changes the target with no code change (spec §9a)', async () => {
  const a = await startFixtureServer({ html: pageA });
  const b = await startFixtureServer({ html: pageB });
  servers.push(a, b);
  const ra = await runConnectionTest(a.url, { screenshotDir: shotDir });
  const rb = await runConnectionTest(b.url, { screenshotDir: shotDir });
  expect(ra.pageTitle).toBe('Portal A');
  expect(rb.pageTitle).toBe('Portal B');
});

it('never issues a POST / never submits a form', async () => {
  const a = await startFixtureServer({ html: pageA });
  servers.push(a);
  await runConnectionTest(a.url, { screenshotDir: shotDir });
  expect(a.requests.every((r) => r.method === 'GET')).toBe(true);
});

it('follows redirects and records the final URL', async () => {
  const dest = await startFixtureServer({ html: pageB });
  const entry = await startFixtureServer({ html: '', redirectTo: dest.url });
  servers.push(dest, entry);
  const result = await runConnectionTest(entry.url, { screenshotDir: shotDir });
  expect(result.redirected).toBe(true);
  expect(result.finalUrl).toBe(dest.url);
  expect(result.pageTitle).toBe('Portal B');
});

it('reports a sanitized failure for an unreachable host', async () => {
  const result = await runConnectionTest('http://127.0.0.1:1/', { screenshotDir: shotDir });
  expect(result.success).toBe(false);
  expect(result.error?.code).toBeDefined();
  expect(result.error?.message).not.toMatch(/stack|ECONNREFUSED.*at /i);
});
