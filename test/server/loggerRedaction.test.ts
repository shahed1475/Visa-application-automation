import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import pino from 'pino';
import { REDACT_PATHS, loggerOptions } from '../../src/server/logger.js';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

const MUST_INCLUDE = [
  'rawValue',
  'raw_value',
  'surname',
  'givenNames',
  'given_names',
  'dateOfBirth',
  'date_of_birth',
  'passportNumber',
  'email',
  'phone',
  'line1',
  'line2',
  'postalCode',
  'postal_code',
  '*.rawValue',
  '*.surname',
  '*.passportNumber',
];

it('redacts every applicant PII key we care about', () => {
  for (const key of MUST_INCLUDE) {
    expect(REDACT_PATHS, `REDACT_PATHS should contain ${key}`).toContain(key);
  }
});

it('does not use a bare over-broad "number" key', () => {
  // a top-level `number` would redact unrelated numeric fields (counts, ports…)
  expect(REDACT_PATHS).not.toContain('number');
});

/**
 * The search box accepts a passport number or an email address, and it travels as
 * `GET /api/applicants?q=…`. `redact` cannot reach a substring of `req.url`, so the
 * only defence is the `req` serializer — assert on the real captured log bytes.
 */
let app: FastifyInstance;
let dbPath: string;
let captured: string[];

beforeEach(async () => {
  captured = [];
  const stream = {
    write(chunk: string) {
      captured.push(chunk);
    },
  };
  // Same options the production logger uses, forced to a level that actually emits.
  const testLogger = pino(
    { ...loggerOptions, level: 'info', transport: undefined },
    stream,
  ) as unknown as FastifyBaseLogger;
  dbPath = makeTempDbPath();
  app = await buildServer({ dbPath, loggerInstance: testLogger });
});

afterEach(async () => {
  await app.close();
  cleanupTempDb(dbPath);
});

it('never writes a request query string to the log', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/applicants?q=AB1234567' });
  expect(res.statusCode).toBe(200);

  const log = captured.join('');
  expect(log.length).toBeGreaterThan(0);
  expect(log).not.toContain('AB1234567');
  expect(log).not.toContain('q=');
  expect(log).toContain('/api/applicants');
});

it('still logs the request path for a query-less request', async () => {
  await app.inject({ method: 'GET', url: '/api/applicants' });
  const log = captured.join('');
  expect(log).toContain('/api/applicants');
  expect(log).toContain('GET');
  expect(log).not.toContain('[REDACTED]');
});

it('does not leak an email address searched for through the query string', async () => {
  await app.inject({
    method: 'GET',
    url: `/api/applicants?q=${encodeURIComponent('aisha@example.com')}`,
  });
  const log = captured.join('');
  expect(log).not.toContain('aisha');
  expect(log).not.toContain('example.com');
  expect(log).toContain('/api/applicants?[REDACTED]');
});
