import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let app: FastifyInstance;
let dbPath: string;

beforeEach(async () => {
  dbPath = makeTempDbPath();
  app = await buildServer({ dbPath });
});

afterEach(async () => {
  await app.close();
  cleanupTempDb(dbPath);
});

it('GET /api/health returns ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
});
