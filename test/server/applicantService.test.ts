import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import * as svc from '../../src/server/services/applicantService.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let db: DatabaseSync;
let dbPath: string;

beforeEach(() => {
  dbPath = makeTempDbPath();
  db = openDatabase(dbPath);
  runMigrations(db);
});
afterEach(() => {
  db.close();
  cleanupTempDb(dbPath);
});

it('creates an applicant with four empty satellite sections', () => {
  const a = svc.createApplicant(db, { displayName: 'Aisha' });
  expect(a.id).toMatch(/[0-9a-f-]{36}/);
  expect(a.displayName).toBe('Aisha');
  expect(a.status).toBe('draft');
  expect(a.identity.surname).toBeNull();
  expect(a.passport.number).toBeNull();
  expect(a.contact.email).toBeNull();
  expect(a.address.city).toBeNull();
  expect(a.travel).toEqual([]);
  expect(a.references).toEqual([]);
  expect(a.fieldMeta).toEqual([]);
  expect(a.completeness.overall).toBe(0);
  expect(a.verification.label).toBe('unverified');
});

it('accepts nested sections at create time', () => {
  const a = svc.createApplicant(db, {
    displayName: 'B',
    identity: { surname: 'Khan', givenNames: 'Aisha' } as any,
    passport: { number: 'A123' } as any,
  });
  expect(a.identity.surname).toBe('Khan');
  expect(a.passport.number).toBe('A123');
});

it('reads a detail back with computed completeness / verification / warnings', () => {
  const a = svc.createApplicant(db, { displayName: 'C' });
  const got = svc.getApplicantDetail(db, a.id);
  expect(got?.displayName).toBe('C');
  expect(got?.completeness.bySection.identity).toBe(0);
  expect(Array.isArray(got?.warnings)).toBe(true);
  expect(svc.getApplicantDetail(db, 'missing')).toBeNull();
});

it('updates a section patch (only provided keys) and bumps updated_at', async () => {
  const a = svc.createApplicant(db, { displayName: 'D' });
  await new Promise((r) => setTimeout(r, 5));
  const up = svc.updateApplicant(db, a.id, {
    identity: { surname: 'Rahman' } as any,
  });
  expect(up?.identity.surname).toBe('Rahman');
  expect(up?.identity.givenNames).toBeNull();
  expect(up?.updatedAt).not.toBe(a.updatedAt);

  const up2 = svc.updateApplicant(db, a.id, { identity: { givenNames: 'Nadia' } as any });
  expect(up2?.identity.surname).toBe('Rahman'); // previous value untouched
  expect(up2?.identity.givenNames).toBe('Nadia');
});

it('updates display name and status', () => {
  const a = svc.createApplicant(db, { displayName: 'E' });
  const up = svc.updateApplicant(db, a.id, { displayName: 'E2', status: 'archived' });
  expect(up?.displayName).toBe('E2');
  expect(up?.status).toBe('archived');
});

it('returns null updating a missing applicant', () => {
  expect(svc.updateApplicant(db, 'nope', { displayName: 'x' })).toBeNull();
});

it('lists newest-updated first and deletes', async () => {
  const a = svc.createApplicant(db, { displayName: 'first' });
  await new Promise((r) => setTimeout(r, 5));
  const b = svc.createApplicant(db, { displayName: 'second' });
  expect(svc.listApplicants(db).map((x) => x.displayName)).toEqual(['second', 'first']);

  expect(svc.deleteApplicant(db, a.id)).toBe(true);
  expect(svc.deleteApplicant(db, a.id)).toBe(false);
  expect(svc.listApplicants(db).map((x) => x.displayName)).toEqual(['second']);
  void b;
});

it('summary omits sensitive fields but exposes last-4 of passport number', () => {
  const a = svc.createApplicant(db, {
    displayName: 'F',
    identity: { nationality: 'Bangladeshi' } as any,
    passport: { number: 'AB1234567' } as any,
  });
  const [row] = svc.listApplicants(db);
  expect(row.id).toBe(a.id);
  expect(row.nationality).toBe('Bangladeshi');
  expect(row.passportNumberLast4).toBe('4567');
  expect(row as Record<string, unknown>).not.toHaveProperty('dateOfBirth');
  expect(JSON.stringify(row)).not.toContain('AB1234567');
});

it('persists across a reopen of the same db file', () => {
  const a = svc.createApplicant(db, { displayName: 'G', identity: { surname: 'Z' } as any });
  db.close();
  // Reassign the shared handle so afterEach closes it exactly once
  // (node:sqlite's DatabaseSync throws on a double close()).
  db = openDatabase(dbPath);
  runMigrations(db);
  expect(svc.getApplicantDetail(db, a.id)?.identity.surname).toBe('Z');
});
