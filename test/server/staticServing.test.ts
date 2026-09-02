import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let app: FastifyInstance;
let dbPath: string;

beforeEach(async () => {
  vi.resetModules();
  process.env.NODE_ENV = 'production';
  mkdirSync(path.resolve('dist/web'), { recursive: true });
  writeFileSync(path.resolve('dist/web/index.html'), '<!doctype html><title>App</title>');
  dbPath = makeTempDbPath();
  const { buildServer } = await import('../../src/server/app.js');
  app = await buildServer({ dbPath });
});

afterEach(async () => {
  await app.close();
  cleanupTempDb(dbPath);
  process.env.NODE_ENV = 'test';
  rmSync(path.resolve('dist/web/index.html'), { force: true });
  vi.resetModules();
});

it('serves index.html at the root in production', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('<title>App</title>');
});

it('returns SPA fallback for an unknown non-api route', async () => {
  const res = await app.inject({ method: 'GET', url: '/settings/portals' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('App');
});

it('still returns JSON 404 for unknown /api routes', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/nope' });
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe('NOT_FOUND');
});
