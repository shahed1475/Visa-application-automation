import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

async function create(body: Record<string, unknown> = { displayName: 'Aisha' }) {
  const res = await app.inject({ method: 'POST', url: '/api/applicants', payload: body });
  return res;
}

it('POST creates and GET returns the applicant with computed blocks', async () => {
  const res = await create();
  expect(res.statusCode).toBe(201);
  const { applicant } = res.json();
  expect(applicant.displayName).toBe('Aisha');
  expect(applicant.completeness.overall).toBe(0);
  expect(applicant.verification.label).toBe('unverified');
  expect(Array.isArray(applicant.warnings)).toBe(true);

  const get = await app.inject({ method: 'GET', url: `/api/applicants/${applicant.id}` });
  expect(get.statusCode).toBe(200);
  expect(get.json().applicant.id).toBe(applicant.id);
});

it('POST with a blank displayName is 400 VALIDATION_ERROR', async () => {
  const res = await create({ displayName: '   ' });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe('VALIDATION_ERROR');
});

it('POST with a bad nested section value is 400 and reports the path (not the value)', async () => {
  const res = await create({ displayName: 'X', identity: { dateOfBirth: '13/2000' } });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.message).toMatch(/dateOfBirth/);
  expect(res.json().error.message).not.toMatch(/13\/2000/);
});

it('GET list omits sensitive fields; search narrows results', async () => {
  await create({ displayName: 'Aisha Khan', identity: { nationality: 'Bangladeshi' }, passport: { number: 'AB1234567' } });
  await create({ displayName: 'Bob Smith' });

  const all = await app.inject({ method: 'GET', url: '/api/applicants' });
  expect(all.json().applicants).toHaveLength(2);
  const row = all.json().applicants.find((r: { displayName: string }) => r.displayName === 'Aisha Khan');
  expect(row.passportNumberLast4).toBe('4567');
  expect(JSON.stringify(row)).not.toContain('AB1234567');
  expect(row).not.toHaveProperty('identity');

  const q = await app.inject({ method: 'GET', url: '/api/applicants?q=khan' });
  expect(q.json().applicants.map((r: { displayName: string }) => r.displayName)).toEqual(['Aisha Khan']);

  const q2 = await app.inject({ method: 'GET', url: '/api/applicants?q=AB12345' });
  expect(q2.json().applicants).toHaveLength(1);
});

it('PUT patches a section; GET reflects it', async () => {
  const { applicant } = (await create()).json();
  const put = await app.inject({
    method: 'PUT',
    url: `/api/applicants/${applicant.id}`,
    payload: { identity: { surname: 'Rahman' } },
  });
  expect(put.statusCode).toBe(200);
  expect(put.json().applicant.identity.surname).toBe('Rahman');
});

it('GET / PUT / DELETE unknown id is 404 NOT_FOUND', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/applicants/nope' })).statusCode).toBe(404);
  expect((await app.inject({ method: 'PUT', url: '/api/applicants/nope', payload: {} })).statusCode).toBe(404);
  const del = await app.inject({ method: 'DELETE', url: '/api/applicants/nope' });
  expect(del.statusCode).toBe(404);
  expect(del.json().error.code).toBe('NOT_FOUND');
});

it('DELETE removes the applicant', async () => {
  const { applicant } = (await create()).json();
  expect((await app.inject({ method: 'DELETE', url: `/api/applicants/${applicant.id}` })).statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url: '/api/applicants' })).json().applicants).toHaveLength(0);
});

it('POST /:id/duplicate returns a renamed copy', async () => {
  const { applicant } = (await create({ displayName: 'Orig', identity: { surname: 'K' } })).json();
  const dup = await app.inject({ method: 'POST', url: `/api/applicants/${applicant.id}/duplicate` });
  expect(dup.statusCode).toBe(201);
  expect(dup.json().applicant.displayName).toBe('Orig (copy)');
  expect(dup.json().applicant.identity.surname).toBe('K');
  expect((await app.inject({ method: 'GET', url: '/api/applicants' })).json().applicants).toHaveLength(2);
});

it('applicant data survives a server restart on the same db file', async () => {
  const { applicant } = (await create({ displayName: 'Persist', identity: { surname: 'Z' } })).json();
  await app.close();
  app = await buildServer({ dbPath });
  const get = await app.inject({ method: 'GET', url: `/api/applicants/${applicant.id}` });
  expect(get.json().applicant.identity.surname).toBe('Z');
});

describe('child records & field meta', () => {
  async function newApplicant() {
    return (await create({ displayName: 'Child Owner' })).json().applicant.id as string;
  }

  it('travel: POST / PUT / DELETE', async () => {
    const id = await newApplicant();
    const add = await app.inject({
      method: 'POST',
      url: `/api/applicants/${id}/travel`,
      payload: { purpose: 'Tourism', arrivalDate: '2026-05-01' },
    });
    expect(add.statusCode).toBe(201);
    const travelId = add.json().travel.id;

    const edit = await app.inject({
      method: 'PUT',
      url: `/api/applicants/${id}/travel/${travelId}`,
      payload: { purpose: 'Business' },
    });
    expect(edit.json().travel.purpose).toBe('Business');

    const del = await app.inject({ method: 'DELETE', url: `/api/applicants/${id}/travel/${travelId}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/applicants/${id}` })).json().applicant.travel).toEqual([]);
  });

  it('travel: bad body 400, unknown applicant/record 404', async () => {
    const id = await newApplicant();
    expect(
      (await app.inject({ method: 'POST', url: `/api/applicants/${id}/travel`, payload: { arrivalDate: 'nope' } })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: `/api/applicants/missing/travel`, payload: {} })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'PUT', url: `/api/applicants/${id}/travel/missing`, payload: {} })).statusCode,
    ).toBe(404);
  });

  it('references: POST / PUT / DELETE with kind', async () => {
    const id = await newApplicant();
    const add = await app.inject({
      method: 'POST',
      url: `/api/applicants/${id}/references`,
      payload: { kind: 'employer', name: 'ACME' },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().reference.kind).toBe('employer');
    const refId = add.json().reference.id;
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/applicants/${id}/references/${refId}`,
      payload: { kind: 'sponsor', name: 'ACME' },
    });
    expect(edit.json().reference.kind).toBe('sponsor');
    expect((await app.inject({ method: 'DELETE', url: `/api/applicants/${id}/references/${refId}` })).statusCode).toBe(200);
  });

  it('field-meta: PUT upserts and toggles verification', async () => {
    const id = await newApplicant();
    await app.inject({ method: 'PUT', url: `/api/applicants/${id}`, payload: { identity: { surname: 'K' } } });

    const v = await app.inject({
      method: 'PUT',
      url: `/api/applicants/${id}/field-meta`,
      payload: { fieldPath: 'identity.surname', verified: true },
    });
    expect(v.statusCode).toBe(200);
    expect(v.json().fieldMeta.verified).toBe(true);
    expect(v.json().fieldMeta.verifiedAt).not.toBeNull();

    const detail = (await app.inject({ method: 'GET', url: `/api/applicants/${id}` })).json().applicant;
    expect(detail.verification.bySection.identity).toEqual({ verified: 1, total: 1 });

    const bad = await app.inject({
      method: 'PUT',
      url: `/api/applicants/${id}/field-meta`,
      payload: { fieldPath: 'identity.surname', source: 'manual', confidence: 0.9 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('field-meta: 404 for a missing applicant', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/applicants/missing/field-meta`,
      payload: { fieldPath: 'identity.surname' },
    });
    expect(res.statusCode).toBe(404);
  });
});
