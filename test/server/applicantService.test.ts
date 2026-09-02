import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('travel & references', () => {
  it('adds, orders, edits and deletes travel records', () => {
    const a = svc.createApplicant(db, { displayName: 'T' });
    const t1 = svc.addTravel(db, a.id, { purpose: 'Tourism', arrivalDate: '2026-05-01' } as any)!;
    const t2 = svc.addTravel(db, a.id, { purpose: 'Business' } as any)!;
    expect(t1.sortOrder).toBe(0);
    expect(t2.sortOrder).toBe(1);

    const list = svc.getApplicantDetail(db, a.id)!.travel;
    expect(list.map((t) => t.purpose)).toEqual(['Tourism', 'Business']);

    const edited = svc.updateTravel(db, a.id, t1.id, { purpose: 'Family visit', arrivalDate: '2026-05-01' } as any)!;
    expect(edited.purpose).toBe('Family visit');

    expect(svc.deleteTravel(db, a.id, t1.id)).toBe(true);
    expect(svc.deleteTravel(db, a.id, t1.id)).toBe(false);
    expect(svc.getApplicantDetail(db, a.id)!.travel.map((t) => t.purpose)).toEqual(['Business']);
  });

  it('travel ops on a missing applicant / wrong applicant return null / false', () => {
    const a = svc.createApplicant(db, { displayName: 'T2' });
    const b = svc.createApplicant(db, { displayName: 'T3' });
    const t = svc.addTravel(db, a.id, { purpose: 'X' } as any)!;
    expect(svc.addTravel(db, 'missing', {} as any)).toBeNull();
    expect(svc.updateTravel(db, b.id, t.id, {} as any)).toBeNull(); // t belongs to a, not b
    expect(svc.deleteTravel(db, b.id, t.id)).toBe(false);
  });

  it('adds, edits and deletes references with a kind', () => {
    const a = svc.createApplicant(db, { displayName: 'R' });
    const r = svc.addReference(db, a.id, { kind: 'employer', name: 'ACME', organization: 'ACME Ltd' } as any)!;
    expect(r.kind).toBe('employer');
    const list = svc.getApplicantDetail(db, a.id)!.references;
    expect(list).toHaveLength(1);
    const edited = svc.updateReference(db, a.id, r.id, { kind: 'sponsor', name: 'ACME' } as any)!;
    expect(edited.kind).toBe('sponsor');
    expect(svc.deleteReference(db, a.id, r.id)).toBe(true);
    expect(svc.getApplicantDetail(db, a.id)!.references).toEqual([]);
  });

  it('deleting the applicant removes its travel and references (cascade)', () => {
    const a = svc.createApplicant(db, { displayName: 'C' });
    svc.addTravel(db, a.id, { purpose: 'X' } as any);
    svc.addReference(db, a.id, { name: 'Y' } as any);
    svc.deleteApplicant(db, a.id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM applicant_travel').get() as { n: number };
    const m = db.prepare('SELECT COUNT(*) AS n FROM applicant_reference').get() as { n: number };
    expect(n.n).toBe(0);
    expect(m.n).toBe(0);
  });
});

describe('field meta', () => {
  it('upserts one row per (applicant, field_path); default source manual, confidence null', () => {
    const a = svc.createApplicant(db, { displayName: 'M', identity: { surname: 'K' } as any });
    const m1 = svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true } as any)!;
    expect(m1.source).toBe('manual');
    expect(m1.confidence).toBeNull();
    expect(m1.verified).toBe(true);
    expect(m1.verifiedAt).not.toBeNull();

    const m2 = svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: false } as any)!;
    expect(m2.id).toBe(m1.id); // same row
    expect(m2.verified).toBe(false);
    expect(m2.verifiedAt).toBeNull();

    const all = svc.getApplicantDetail(db, a.id)!.fieldMeta.filter((m) => m.fieldPath === 'identity.surname');
    expect(all).toHaveLength(1);
  });

  it('accepts Phase 3 OCR source values with a numeric confidence and raw value', () => {
    const a = svc.createApplicant(db, { displayName: 'O', passport: { number: 'A1' } as any });
    const m = svc.upsertFieldMeta(db, a.id, {
      fieldPath: 'passport.number',
      source: 'passport_mrz',
      confidence: 0.97,
      rawValue: 'A1<<<<',
    } as any)!;
    expect(m.source).toBe('passport_mrz');
    expect(m.confidence).toBeCloseTo(0.97, 5);
    expect(m.rawValue).toBe('A1<<<<');
    expect(m.verified).toBe(false); // OCR is never auto-verified
  });

  it('returns null for a missing applicant', () => {
    expect(svc.upsertFieldMeta(db, 'missing', { fieldPath: 'identity.surname' } as any)).toBeNull();
  });

  it('multiple field paths coexist for one applicant', () => {
    const a = svc.createApplicant(db, { displayName: 'M2' });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname' } as any);
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'passport.number' } as any);
    expect(svc.getApplicantDetail(db, a.id)!.fieldMeta.map((m) => m.fieldPath).sort()).toEqual([
      'identity.surname',
      'passport.number',
    ]);
  });

  it('editing a verified value via updateApplicant un-verifies it and marks source manual', () => {
    const a = svc.createApplicant(db, { displayName: 'RC', passport: { number: 'OLD' } as any });
    svc.upsertFieldMeta(db, a.id, {
      fieldPath: 'passport.number',
      source: 'passport_mrz',
      confidence: 0.9,
    } as any);
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'passport.number', verified: true } as any);

    svc.updateApplicant(db, a.id, { passport: { number: 'NEW' } as any });

    const meta = svc.getApplicantDetail(db, a.id)!.fieldMeta.find((m) => m.fieldPath === 'passport.number')!;
    expect(meta.source).toBe('manual');
    expect(meta.confidence).toBeNull();
    expect(meta.verified).toBe(false);
    expect(meta.verifiedAt).toBeNull();
  });

  it('clearing a value to null via updateApplicant deletes its meta row', () => {
    const a = svc.createApplicant(db, { displayName: 'RC2', identity: { surname: 'Z' } as any });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true } as any);
    svc.updateApplicant(db, a.id, { identity: { surname: null } as any });
    expect(svc.getApplicantDetail(db, a.id)!.fieldMeta.find((m) => m.fieldPath === 'identity.surname')).toBeUndefined();
  });

  it('field meta is removed when the applicant is deleted (cascade)', () => {
    const a = svc.createApplicant(db, { displayName: 'D' });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname' } as any);
    svc.deleteApplicant(db, a.id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM applicant_field_meta').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('field meta persists across a reopen', () => {
    const a = svc.createApplicant(db, { displayName: 'P' });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true } as any);
    db.close();
    // Reassign the shared handle so afterEach closes it exactly once
    // (node:sqlite's DatabaseSync throws on a double close()).
    db = openDatabase(dbPath);
    runMigrations(db);
    const m = svc.getApplicantDetail(db, a.id)!.fieldMeta[0];
    expect(m.fieldPath).toBe('identity.surname');
    expect(m.verified).toBe(true);
  });
});
