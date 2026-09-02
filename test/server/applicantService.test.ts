import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import * as svc from '../../src/server/services/applicantService.js';
import { identitySchema } from '../../src/shared/applicant/schemas.js';
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
    identity: { surname: 'Khan', givenNames: 'Aisha' },
    passport: { number: 'A123' },
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

it('a REAL parsed section patch writes only the sent keys and bumps updated_at', async () => {
  // Runs the body through the actual Zod schema rather than hand-building the
  // parsed shape — the whole point is that an omitted key survives parsing as
  // `undefined` and is therefore never written.
  const a = svc.createApplicant(db, {
    displayName: 'D',
    identity: identitySchema.parse({ surname: 'Khan', givenNames: 'Aisha', nationality: 'BD' }),
  });
  await new Promise((r) => setTimeout(r, 5));

  const up = svc.updateApplicant(db, a.id, {
    identity: identitySchema.parse({ surname: 'Rahman' }),
  });
  expect(up?.identity.surname).toBe('Rahman');
  expect(up?.identity.givenNames).toBe('Aisha'); // sibling NOT nulled
  expect(up?.identity.nationality).toBe('BD');
  expect(up?.updatedAt).not.toBe(a.updatedAt);

  const up2 = svc.updateApplicant(db, a.id, {
    identity: identitySchema.parse({ givenNames: 'Nadia' }),
  });
  expect(up2?.identity.surname).toBe('Rahman'); // previous value untouched
  expect(up2?.identity.givenNames).toBe('Nadia');

  // An explicit null still clears — "absent" and "clear me" stay distinguishable.
  const up3 = svc.updateApplicant(db, a.id, {
    identity: identitySchema.parse({ nationality: null }),
  });
  expect(up3?.identity.nationality).toBeNull();
  expect(up3?.identity.surname).toBe('Rahman');
});

it('a partial section patch leaves sibling fields AND their field-meta rows intact', () => {
  const a = svc.createApplicant(db, {
    displayName: 'Meta',
    identity: identitySchema.parse({ surname: 'Khan', givenNames: 'Aisha', placeOfBirth: 'Dhaka' }),
  });
  svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.givenNames', verified: true });
  svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.placeOfBirth', verified: true });

  svc.updateApplicant(db, a.id, { identity: identitySchema.parse({ surname: 'Rahman' }) });

  const after = svc.getApplicantDetail(db, a.id)!;
  expect(after.identity.givenNames).toBe('Aisha');
  expect(after.identity.placeOfBirth).toBe('Dhaka');
  const paths = after.fieldMeta.filter((m) => m.verified).map((m) => m.fieldPath).sort();
  expect(paths).toEqual(['identity.givenNames', 'identity.placeOfBirth']);
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
    identity: { nationality: 'Bangladeshi' },
    passport: { number: 'AB1234567' },
  });
  const [row] = svc.listApplicants(db);
  expect(row.id).toBe(a.id);
  expect(row.nationality).toBe('Bangladeshi');
  expect(row.passportNumberLast4).toBe('4567');
  expect(row as Record<string, unknown>).not.toHaveProperty('dateOfBirth');
  expect(JSON.stringify(row)).not.toContain('AB1234567');
});

it('persists across a reopen of the same db file', () => {
  const a = svc.createApplicant(db, { displayName: 'G', identity: { surname: 'Z' } });
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
    const t1 = svc.addTravel(db, a.id, { purpose: 'Tourism', arrivalDate: '2026-05-01' })!;
    const t2 = svc.addTravel(db, a.id, { purpose: 'Business' })!;
    expect(t1.sortOrder).toBe(0);
    expect(t2.sortOrder).toBe(1);

    const list = svc.getApplicantDetail(db, a.id)!.travel;
    expect(list.map((t) => t.purpose)).toEqual(['Tourism', 'Business']);

    const edited = svc.updateTravel(db, a.id, t1.id, { purpose: 'Family visit', arrivalDate: '2026-05-01' })!;
    expect(edited.purpose).toBe('Family visit');

    expect(svc.deleteTravel(db, a.id, t1.id)).toBe(true);
    expect(svc.deleteTravel(db, a.id, t1.id)).toBe(false);
    expect(svc.getApplicantDetail(db, a.id)!.travel.map((t) => t.purpose)).toEqual(['Business']);
  });

  it('travel ops on a missing applicant / wrong applicant return null / false', () => {
    const a = svc.createApplicant(db, { displayName: 'T2' });
    const b = svc.createApplicant(db, { displayName: 'T3' });
    const t = svc.addTravel(db, a.id, { purpose: 'X' })!;
    expect(svc.addTravel(db, 'missing', {})).toBeNull();
    expect(svc.updateTravel(db, b.id, t.id, {})).toBeNull(); // t belongs to a, not b
    expect(svc.deleteTravel(db, b.id, t.id)).toBe(false);
  });

  it('adds, edits and deletes references with a kind', () => {
    const a = svc.createApplicant(db, { displayName: 'R' });
    const r = svc.addReference(db, a.id, { kind: 'employer', name: 'ACME', organization: 'ACME Ltd' })!;
    expect(r.kind).toBe('employer');
    const list = svc.getApplicantDetail(db, a.id)!.references;
    expect(list).toHaveLength(1);
    const edited = svc.updateReference(db, a.id, r.id, { kind: 'sponsor', name: 'ACME' })!;
    expect(edited.kind).toBe('sponsor');
    expect(svc.deleteReference(db, a.id, r.id)).toBe(true);
    expect(svc.getApplicantDetail(db, a.id)!.references).toEqual([]);
  });

  it('deleting the applicant removes its travel and references (cascade)', () => {
    const a = svc.createApplicant(db, { displayName: 'C' });
    svc.addTravel(db, a.id, { purpose: 'X' });
    svc.addReference(db, a.id, { kind: 'other', name: 'Y' });
    svc.deleteApplicant(db, a.id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM applicant_travel').get() as { n: number };
    const m = db.prepare('SELECT COUNT(*) AS n FROM applicant_reference').get() as { n: number };
    expect(n.n).toBe(0);
    expect(m.n).toBe(0);
  });
});

describe('field meta', () => {
  it('upserts one row per (applicant, field_path); default source manual, confidence null', () => {
    const a = svc.createApplicant(db, { displayName: 'M', identity: { surname: 'K' } });
    const m1 = svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true })!;
    expect(m1.source).toBe('manual');
    expect(m1.confidence).toBeNull();
    expect(m1.verified).toBe(true);
    expect(m1.verifiedAt).not.toBeNull();

    const m2 = svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: false })!;
    expect(m2.id).toBe(m1.id); // same row
    expect(m2.verified).toBe(false);
    expect(m2.verifiedAt).toBeNull();

    const all = svc.getApplicantDetail(db, a.id)!.fieldMeta.filter((m) => m.fieldPath === 'identity.surname');
    expect(all).toHaveLength(1);
  });

  it('accepts Phase 3 OCR source values with a numeric confidence and raw value', () => {
    const a = svc.createApplicant(db, { displayName: 'O', passport: { number: 'A1' } });
    const m = svc.upsertFieldMeta(db, a.id, {
      fieldPath: 'passport.number',
      source: 'passport_mrz',
      confidence: 0.97,
      rawValue: 'A1<<<<',
    })!;
    expect(m.source).toBe('passport_mrz');
    expect(m.confidence).toBeCloseTo(0.97, 5);
    expect(m.rawValue).toBe('A1<<<<');
    expect(m.verified).toBe(false); // OCR is never auto-verified
  });

  it('a verify-only upsert preserves the row source and confidence', () => {
    const a = svc.createApplicant(db, { displayName: 'Prov', passport: { number: 'A1' } });
    svc.upsertFieldMeta(db, a.id, {
      fieldPath: 'passport.number',
      source: 'passport_mrz',
      confidence: 0.97,
      rawValue: 'A1<<<<',
    });

    // What the Confirm button sends: no source, no confidence.
    const m = svc.upsertFieldMeta(db, a.id, { fieldPath: 'passport.number', verified: true })!;
    expect(m.source).toBe('passport_mrz'); // NOT reset to 'manual'
    expect(m.confidence).toBeCloseTo(0.97, 5);
    expect(m.rawValue).toBe('A1<<<<');
    expect(m.verified).toBe(true);
    expect(m.verifiedAt).not.toBeNull();

    // Un-confirming keeps the provenance too.
    const m2 = svc.upsertFieldMeta(db, a.id, { fieldPath: 'passport.number', verified: false })!;
    expect(m2.source).toBe('passport_mrz');
    expect(m2.confidence).toBeCloseTo(0.97, 5);
    expect(m2.verified).toBe(false);
  });

  it('an explicit source change drops a confidence that no longer applies', () => {
    const a = svc.createApplicant(db, { displayName: 'Prov2', passport: { number: 'A1' } });
    svc.upsertFieldMeta(db, a.id, {
      fieldPath: 'passport.number',
      source: 'passport_ocr',
      confidence: 0.5,
    });
    const m = svc.upsertFieldMeta(db, a.id, { fieldPath: 'passport.number', source: 'manual' })!;
    expect(m.source).toBe('manual');
    expect(m.confidence).toBeNull();
  });

  it('returns null for a missing applicant', () => {
    expect(svc.upsertFieldMeta(db, 'missing', { fieldPath: 'identity.surname' })).toBeNull();
  });

  it('multiple field paths coexist for one applicant', () => {
    const a = svc.createApplicant(db, { displayName: 'M2' });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname' });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'passport.number' });
    expect(svc.getApplicantDetail(db, a.id)!.fieldMeta.map((m) => m.fieldPath).sort()).toEqual([
      'identity.surname',
      'passport.number',
    ]);
  });

  it('editing a verified value via updateApplicant un-verifies it and marks source manual', () => {
    const a = svc.createApplicant(db, { displayName: 'RC', passport: { number: 'OLD' } });
    svc.upsertFieldMeta(db, a.id, {
      fieldPath: 'passport.number',
      source: 'passport_mrz',
      confidence: 0.9,
    });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'passport.number', verified: true });

    svc.updateApplicant(db, a.id, { passport: { number: 'NEW' } });

    const meta = svc.getApplicantDetail(db, a.id)!.fieldMeta.find((m) => m.fieldPath === 'passport.number')!;
    expect(meta.source).toBe('manual');
    expect(meta.confidence).toBeNull();
    expect(meta.verified).toBe(false);
    expect(meta.verifiedAt).toBeNull();
  });

  it('clearing a value to null via updateApplicant deletes its meta row', () => {
    const a = svc.createApplicant(db, { displayName: 'RC2', identity: { surname: 'Z' } });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true });
    svc.updateApplicant(db, a.id, { identity: { surname: null } });
    expect(svc.getApplicantDetail(db, a.id)!.fieldMeta.find((m) => m.fieldPath === 'identity.surname')).toBeUndefined();
  });

  it('field meta is removed when the applicant is deleted (cascade)', () => {
    const a = svc.createApplicant(db, { displayName: 'D' });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname' });
    svc.deleteApplicant(db, a.id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM applicant_field_meta').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('field meta persists across a reopen', () => {
    const a = svc.createApplicant(db, { displayName: 'P' });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true });
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

describe('duplicate', () => {
  it('deep-copies sections, travel, references and meta; resets verification; renames', () => {
    const a = svc.createApplicant(db, {
      displayName: 'Original',
      identity: { surname: 'Khan', givenNames: 'Aisha' },
      passport: { number: 'A999' },
    });
    const t = svc.addTravel(db, a.id, { purpose: 'Tourism', arrivalDate: '2026-05-01' })!;
    const r = svc.addReference(db, a.id, { kind: 'employer', name: 'ACME' })!;
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true });
    svc.upsertFieldMeta(db, a.id, { fieldPath: `travel.${t.id}.arrival_date`, source: 'passport_ocr', confidence: 0.8 });

    const copy = svc.duplicateApplicant(db, a.id)!;

    expect(copy.id).not.toBe(a.id);
    expect(copy.displayName).toBe('Original (copy)');
    expect(copy.status).toBe('draft');
    expect(copy.identity.surname).toBe('Khan');
    expect(copy.passport.number).toBe('A999');
    expect(copy.travel).toHaveLength(1);
    expect(copy.travel[0].id).not.toBe(t.id);
    expect(copy.travel[0].purpose).toBe('Tourism');
    expect(copy.references[0].kind).toBe('employer');
    expect(copy.references[0].id).not.toBe(r.id);

    // meta: verified reset, source/confidence kept, travel id remapped
    const surnameMeta = copy.fieldMeta.find((m) => m.fieldPath === 'identity.surname')!;
    expect(surnameMeta.verified).toBe(false);
    expect(surnameMeta.verifiedAt).toBeNull();

    const travelMeta = copy.fieldMeta.find((m) => m.fieldPath.startsWith('travel.'))!;
    expect(travelMeta.fieldPath).toBe(`travel.${copy.travel[0].id}.arrival_date`);
    expect(travelMeta.source).toBe('passport_ocr');
    expect(travelMeta.confidence).toBeCloseTo(0.8, 5);
    expect(travelMeta.verified).toBe(false);
  });

  it('does not modify the original', () => {
    const a = svc.createApplicant(db, { displayName: 'Keep', identity: { surname: 'X' } });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true });
    svc.duplicateApplicant(db, a.id);
    const again = svc.getApplicantDetail(db, a.id)!;
    expect(again.displayName).toBe('Keep');
    expect(again.fieldMeta.find((m) => m.fieldPath === 'identity.surname')!.verified).toBe(true);
    expect(svc.listApplicants(db)).toHaveLength(2);
  });

  it('returns null for a missing applicant', () => {
    expect(svc.duplicateApplicant(db, 'missing')).toBeNull();
  });
});
