import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { startFixtureServer } from '../helpers/fixtureServer.js';

let app: FastifyInstance;
let dbPath: string;

const body = { name: 'Example', url: 'https://example.com', portalType: 'evisa' };

beforeEach(async () => {
  dbPath = makeTempDbPath();
  app = await buildServer({ dbPath });
});
afterEach(async () => {
  await app.close();
  cleanupTempDb(dbPath);
});

async function create(overrides = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/portals',
    payload: { ...body, ...overrides },
  });
  return res.json().portal as { id: string; name: string };
}

it('POST then GET list returns the portal', async () => {
  await create();
  const res = await app.inject({ method: 'GET', url: '/api/portals' });
  expect(res.statusCode).toBe(200);
  expect(res.json().portals).toHaveLength(1);
});

it('POST with a bad URL returns 400 VALIDATION_ERROR', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/portals',
    payload: { ...body, url: 'ftp://example.com' },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe('VALIDATION_ERROR');
});

it('GET /api/portals/:id returns 404 for unknown id', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/portals/nope' });
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe('NOT_FOUND');
});

it('PUT updates, DELETE removes', async () => {
  const p = await create();
  const put = await app.inject({
    method: 'PUT',
    url: `/api/portals/${p.id}`,
    payload: { ...body, name: 'Renamed' },
  });
  expect(put.json().portal.name).toBe('Renamed');
  const del = await app.inject({ method: 'DELETE', url: `/api/portals/${p.id}` });
  expect(del.statusCode).toBe(200);
  const list = await app.inject({ method: 'GET', url: '/api/portals' });
  expect(list.json().portals).toHaveLength(0);
});

it('active-portal: set, get, and reject disabled', async () => {
  const p = await create();
  const put = await app.inject({
    method: 'PUT',
    url: '/api/settings/active-portal',
    payload: { portalId: p.id },
  });
  expect(put.statusCode).toBe(200);
  const get = await app.inject({ method: 'GET', url: '/api/settings/active-portal' });
  expect(get.json().activePortalId).toBe(p.id);
  expect(get.json().portal.id).toBe(p.id);

  const disabled = await create({ enabled: false });
  const bad = await app.inject({
    method: 'PUT',
    url: '/api/settings/active-portal',
    payload: { portalId: disabled.id },
  });
  expect(bad.statusCode).toBe(409);
  expect(bad.json().error.code).toBe('PORTAL_DISABLED');
});

it('active-portal survives a server restart on the same db file', async () => {
  const p = await create();
  await app.inject({
    method: 'PUT',
    url: '/api/settings/active-portal',
    payload: { portalId: p.id },
  });
  await app.close();
  app = await buildServer({ dbPath });
  const get = await app.inject({ method: 'GET', url: '/api/settings/active-portal' });
  expect(get.json().activePortalId).toBe(p.id);
});

it('test-connection targets whatever URL is saved for the portal (spec §9a)', async () => {
  const site = await startFixtureServer({
    html: '<!doctype html><title>Saved Target</title><body>ok</body>',
  });
  try {
    const p = await create({ url: site.url });
    const res = await app.inject({
      method: 'POST',
      url: `/api/portals/${p.id}/test-connection`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.pageTitle).toBe('Saved Target');
    expect(res.json().result.finalUrl).toBe(site.url);
  } finally {
    await site.close();
  }
});

it('a body-less POST carrying content-type: application/json is accepted (no FST_ERR_CTP_EMPTY_JSON_BODY)', async () => {
  const site = await startFixtureServer({
    html: '<!doctype html><title>Empty Body OK</title><body>ok</body>',
  });
  try {
    const p = await create({ url: site.url });
    const res = await app.inject({
      method: 'POST',
      url: `/api/portals/${p.id}/test-connection`,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.pageTitle).toBe('Empty Body OK');
  } finally {
    await site.close();
  }
});

it('an empty JSON body is treated as no body — sanitized VALIDATION_ERROR, not a raw parser error', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/portals',
    headers: { 'content-type': 'application/json' },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe('VALIDATION_ERROR');
  expect(res.json()).not.toHaveProperty('code'); // no leaked Fastify error envelope
});

it('malformed JSON is rejected through the sanitized error envelope (no raw parser error)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/portals',
    headers: { 'content-type': 'application/json' },
    payload: '{ not json',
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe('VALIDATION_ERROR');
  expect(res.json()).not.toHaveProperty('code');
  expect(JSON.stringify(res.json())).not.toMatch(/FST_ERR|SyntaxError|Bad Request|at Object/);
});
