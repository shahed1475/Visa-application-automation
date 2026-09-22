import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';

// `src/server/env.ts` parses `process.env` at import time, so every case
// re-imports it in isolation after stubbing the relevant vars.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function importEnv() {
  vi.resetModules();
  return (await import('../../src/server/env.js')).env;
}

it('defaults AUTOMATION_HEADLESS to false and AUTOMATION_EVIDENCE to off when unset', async () => {
  const env = await importEnv();
  expect(env.AUTOMATION_HEADLESS).toBe(false);
  expect(env.AUTOMATION_EVIDENCE).toBe('off');
});

it('parses AUTOMATION_HEADLESS="true" to boolean true', async () => {
  vi.stubEnv('AUTOMATION_HEADLESS', 'true');
  const env = await importEnv();
  expect(env.AUTOMATION_HEADLESS).toBe(true);
});

it('parses AUTOMATION_HEADLESS="false" to boolean false', async () => {
  vi.stubEnv('AUTOMATION_HEADLESS', 'false');
  const env = await importEnv();
  expect(env.AUTOMATION_HEADLESS).toBe(false);
});

it('passes AUTOMATION_EVIDENCE="screenshots" through unchanged', async () => {
  vi.stubEnv('AUTOMATION_EVIDENCE', 'screenshots');
  const env = await importEnv();
  expect(env.AUTOMATION_EVIDENCE).toBe('screenshots');
});

it('derives AUTOMATION_DIR as an absolute path ending in "automation"', async () => {
  const env = await importEnv();
  expect(path.isAbsolute(env.AUTOMATION_DIR)).toBe(true);
  expect(path.basename(env.AUTOMATION_DIR)).toBe('automation');
});

it('throws (Zod) on an invalid AUTOMATION_EVIDENCE value', async () => {
  vi.stubEnv('AUTOMATION_EVIDENCE', 'bogus');
  vi.resetModules();
  await expect(import('../../src/server/env.js')).rejects.toThrow();
});

it('defaults AUTOMATION_TIMING_PROFILE to normal when unset', async () => {
  const env = await importEnv();
  expect(env.AUTOMATION_TIMING_PROFILE).toBe('normal');
});

it('passes AUTOMATION_TIMING_PROFILE="careful" through unchanged', async () => {
  vi.stubEnv('AUTOMATION_TIMING_PROFILE', 'careful');
  const env = await importEnv();
  expect(env.AUTOMATION_TIMING_PROFILE).toBe('careful');
});
