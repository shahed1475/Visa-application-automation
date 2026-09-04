import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { applyExtractedField } from '../../src/server/documents/documentApply.js';
import type { ExtractedField } from '../../src/shared/documents/index.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

const NOW = '2026-02-02T00:00:00Z';

interface MetaRow {
  id: string;
  field_path: string;
  source: string;
  confidence: number | null;
  raw_value: string | null;
  verified: number;
  verified_at: string | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
}

function makeApplicant(db: DatabaseSync): string {
  const id = randomUUID();
  const now = '2026-01-01T00:00:00Z';
  db.prepare(
    `INSERT INTO applicants (id, display_name, status, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?)`,
  ).run(id, 'Test Applicant', now, now);
  db.prepare('INSERT INTO applicant_identity (applicant_id) VALUES (?)').run(id);
  db.prepare('INSERT INTO applicant_passport (applicant_id) VALUES (?)').run(id);
  db.prepare('INSERT INTO applicant_contact (applicant_id) VALUES (?)').run(id);
  db.prepare('INSERT INTO applicant_address (applicant_id) VALUES (?)').run(id);
  return id;
}

function makeDocument(db: DatabaseSync, id = 'doc1'): string {
  const now = '2026-01-01T00:00:00Z';
  db.prepare(
    `INSERT INTO documents (id, kind, mime_type, byte_size, sha256, storage_path, status, created_at, updated_at)
     VALUES (?, 'passport', 'image/png', 10, 'deadbeef', '/tmp/doc1.png', 'uploaded', ?, ?)`,
  ).run(id, now, now);
  return id;
}

function insertMeta(
  db: DatabaseSync,
  applicantId: string,
  patch: Partial<MetaRow> & { field_path: string },
): void {
  db.prepare(
    `INSERT INTO applicant_field_meta
       (id, applicant_id, field_path, source, confidence, raw_value, verified, verified_at, document_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    applicantId,
    patch.field_path,
    patch.source ?? 'manual',
    patch.confidence ?? null,
    patch.raw_value ?? null,
    patch.verified ?? 0,
    patch.verified_at ?? null,
    patch.document_id ?? null,
    patch.created_at ?? '2026-01-01T00:00:00Z',
    patch.updated_at ?? '2026-01-01T00:00:00Z',
  );
}

function getMeta(db: DatabaseSync, applicantId: string, fieldPath: string): MetaRow | undefined {
  return db
    .prepare('SELECT * FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
    .get(applicantId, fieldPath) as MetaRow | undefined;
}

function field(
  partial: Partial<ExtractedField> & Pick<ExtractedField, 'fieldPath'>,
): ExtractedField {
  return {
    value: null,
    raw: null,
    source: 'passport_mrz',
    confidence: 0.99,
    checkDigitOk: null,
    normalizationNote: null,
    ...partial,
  };
}

describe('applyExtractedField — spec §10 case table', () => {
  let db: DatabaseSync;
  let dbPath: string;
  let applicantId: string;

  beforeEach(() => {
    dbPath = makeTempDbPath();
    db = openDatabase(dbPath);
    runMigrations(db);
    applicantId = makeApplicant(db);
    makeDocument(db);
  });
  afterEach(() => {
    db.close();
    cleanupTempDb(dbPath);
  });

  it('EMPTY — auto-fills the section column and creates an unverified meta row', () => {
    const result = applyExtractedField(
      db,
      applicantId,
      'doc1',
      field({
        fieldPath: 'passport.number',
        value: 'A01234567',
        raw: 'A01234567<<',
        source: 'passport_mrz',
        confidence: 0.99,
        checkDigitOk: true,
      }),
      NOW,
    );
    expect(result).toEqual({ fieldPath: 'passport.number', status: 'applied', reason: 'empty' });

    const num = db
      .prepare('SELECT number FROM applicant_passport WHERE applicant_id = ?')
      .get(applicantId) as { number: string | null };
    expect(num.number).toBe('A01234567');

    const meta = getMeta(db, applicantId, 'passport.number')!;
    expect(meta.source).toBe('passport_mrz');
    expect(meta.confidence).toBe(0.99);
    expect(meta.raw_value).toBe('A01234567<<');
    expect(meta.document_id).toBe('doc1');
    expect(meta.verified).toBe(0);
    expect(meta.verified_at).toBeNull();
  });

  it('SAME, no meta — leaves the column, creates an unverified meta row', () => {
    db.prepare('UPDATE applicant_identity SET sex = ? WHERE applicant_id = ?').run('M', applicantId);

    const result = applyExtractedField(
      db,
      applicantId,
      'doc1',
      field({ fieldPath: 'identity.sex', value: 'M', source: 'passport_mrz', confidence: 0.99 }),
      NOW,
    );
    expect(result).toEqual({ fieldPath: 'identity.sex', status: 'applied', reason: 'same_value' });

    const sex = db
      .prepare('SELECT sex FROM applicant_identity WHERE applicant_id = ?')
      .get(applicantId) as { sex: string };
    expect(sex.sex).toBe('M');

    const meta = getMeta(db, applicantId, 'identity.sex')!;
    expect(meta.verified).toBe(0);
    expect(meta.source).toBe('passport_mrz');
    expect(meta.document_id).toBe('doc1');
  });

  it('SAME, manual unverified meta — upgrades provenance to the OCR source', () => {
    db.prepare('UPDATE applicant_identity SET date_of_birth = ? WHERE applicant_id = ?').run(
      '1990-01-15',
      applicantId,
    );
    insertMeta(db, applicantId, {
      field_path: 'identity.dateOfBirth',
      source: 'manual',
      confidence: null,
      verified: 0,
    });

    const result = applyExtractedField(
      db,
      applicantId,
      'doc1',
      field({
        fieldPath: 'identity.dateOfBirth',
        value: '1990-01-15',
        raw: '900115',
        source: 'passport_mrz',
        confidence: 0.99,
      }),
      NOW,
    );
    expect(result).toEqual({
      fieldPath: 'identity.dateOfBirth',
      status: 'applied',
      reason: 'same_value',
    });

    const meta = getMeta(db, applicantId, 'identity.dateOfBirth')!;
    expect(meta.source).toBe('passport_mrz');
    expect(meta.confidence).toBe(0.99);
    expect(meta.document_id).toBe('doc1');
    expect(meta.verified).toBe(0);
  });

  it('SAME, verified meta — leaves the meta row completely untouched', () => {
    db.prepare('UPDATE applicant_passport SET expiry_date = ? WHERE applicant_id = ?').run(
      '2030-01-14',
      applicantId,
    );
    insertMeta(db, applicantId, {
      field_path: 'passport.expiryDate',
      source: 'manual',
      confidence: null,
      verified: 1,
      verified_at: '2026-01-01T00:00:00Z',
      document_id: null,
    });

    const result = applyExtractedField(
      db,
      applicantId,
      'doc1',
      field({
        fieldPath: 'passport.expiryDate',
        value: '2030-01-14',
        source: 'passport_mrz',
        confidence: 0.99,
      }),
      NOW,
    );
    expect(result).toEqual({
      fieldPath: 'passport.expiryDate',
      status: 'applied',
      reason: 'same_value',
    });

    const meta = getMeta(db, applicantId, 'passport.expiryDate')!;
    expect(meta.source).toBe('manual');
    expect(meta.verified).toBe(1);
    expect(meta.verified_at).toBe('2026-01-01T00:00:00Z');
    expect(meta.document_id).toBeNull();
    expect(meta.updated_at).toBe('2026-01-01T00:00:00Z');
  });

  it('SAME, existing OCR meta — refreshes confidence/raw/document_id, keeps source + verified', () => {
    db.prepare('UPDATE applicant_passport SET number = ? WHERE applicant_id = ?').run(
      'A01234567',
      applicantId,
    );
    insertMeta(db, applicantId, {
      field_path: 'passport.number',
      source: 'passport_ocr',
      confidence: 0.5,
      raw_value: 'old-raw',
      verified: 0,
    });

    applyExtractedField(
      db,
      applicantId,
      'doc1',
      field({
        fieldPath: 'passport.number',
        value: 'A01234567',
        raw: 'A01234567<<',
        source: 'passport_mrz',
        confidence: 0.99,
      }),
      NOW,
    );

    const meta = getMeta(db, applicantId, 'passport.number')!;
    expect(meta.confidence).toBe(0.99);
    expect(meta.raw_value).toBe('A01234567<<');
    expect(meta.document_id).toBe('doc1');
    expect(meta.source).toBe('passport_ocr');
    expect(meta.verified).toBe(0);
  });

  it('DIFFERENT, unverified — holds; section + meta untouched', () => {
    db.prepare('UPDATE applicant_identity SET surname = ? WHERE applicant_id = ?').run(
      'SMITH',
      applicantId,
    );

    const result = applyExtractedField(
      db,
      applicantId,
      'doc1',
      field({ fieldPath: 'identity.surname', value: 'JONES', source: 'passport_mrz' }),
      NOW,
    );
    expect(result).toEqual({ fieldPath: 'identity.surname', status: 'held', reason: 'different' });

    const row = db
      .prepare('SELECT surname FROM applicant_identity WHERE applicant_id = ?')
      .get(applicantId) as { surname: string };
    expect(row.surname).toBe('SMITH');
    expect(getMeta(db, applicantId, 'identity.surname')).toBeUndefined();
  });

  it('DIFFERENT, verified — holds with reason verified; section + meta untouched', () => {
    db.prepare('UPDATE applicant_identity SET given_names = ? WHERE applicant_id = ?').run(
      'ANNA',
      applicantId,
    );
    insertMeta(db, applicantId, {
      field_path: 'identity.givenNames',
      source: 'manual',
      verified: 1,
      verified_at: '2026-01-01T00:00:00Z',
    });

    const result = applyExtractedField(
      db,
      applicantId,
      'doc1',
      field({ fieldPath: 'identity.givenNames', value: 'BETTY', source: 'passport_mrz' }),
      NOW,
    );
    expect(result).toEqual({
      fieldPath: 'identity.givenNames',
      status: 'held',
      reason: 'verified',
    });

    const row = db
      .prepare('SELECT given_names FROM applicant_identity WHERE applicant_id = ?')
      .get(applicantId) as { given_names: string };
    expect(row.given_names).toBe('ANNA');

    const meta = getMeta(db, applicantId, 'identity.givenNames')!;
    expect(meta.source).toBe('manual');
    expect(meta.verified).toBe(1);
    expect(meta.document_id).toBeNull();
  });

  it('UNNORMALIZABLE — value null; nothing written anywhere', () => {
    const result = applyExtractedField(
      db,
      applicantId,
      'doc1',
      field({
        fieldPath: 'identity.dateOfBirth',
        value: null,
        raw: '999999',
        source: 'passport_mrz',
        confidence: 0.495,
        normalizationNote: 'MRZ date could not be parsed',
      }),
      NOW,
    );
    expect(result).toEqual({
      fieldPath: 'identity.dateOfBirth',
      status: 'held',
      reason: 'unnormalizable',
    });

    const row = db
      .prepare('SELECT date_of_birth FROM applicant_identity WHERE applicant_id = ?')
      .get(applicantId) as { date_of_birth: string | null };
    expect(row.date_of_birth).toBeNull();
    expect(getMeta(db, applicantId, 'identity.dateOfBirth')).toBeUndefined();
  });

  it('defensive fallback — an unmappable field path holds and touches nothing', () => {
    const before = db
      .prepare('SELECT count(*) AS n FROM applicant_field_meta WHERE applicant_id = ?')
      .get(applicantId) as { n: number };

    const result = applyExtractedField(
      db,
      applicantId,
      'doc1',
      field({ fieldPath: 'identity.notAColumn', value: 'x', source: 'passport_mrz' }),
      NOW,
    );
    expect(result).toEqual({ fieldPath: 'identity.notAColumn', status: 'held', reason: 'different' });

    const after = db
      .prepare('SELECT count(*) AS n FROM applicant_field_meta WHERE applicant_id = ?')
      .get(applicantId) as { n: number };
    expect(after.n).toBe(before.n);

    const result2 = applyExtractedField(
      db,
      applicantId,
      'doc1',
      field({ fieldPath: 'nosuchsection', value: 'x', source: 'passport_mrz' }),
      NOW,
    );
    expect(result2).toEqual({ fieldPath: 'nosuchsection', status: 'held', reason: 'different' });
  });

  it('never writes verified = 1 — the guard', () => {
    // 1: DIFFERENT verified fixture, 2: SAME verified fixture (pre-inserted verified rows).
    db.prepare('UPDATE applicant_identity SET given_names = ? WHERE applicant_id = ?').run(
      'ANNA',
      applicantId,
    );
    insertMeta(db, applicantId, {
      field_path: 'identity.givenNames',
      source: 'manual',
      verified: 1,
      verified_at: '2026-01-01T00:00:00Z',
    });
    db.prepare('UPDATE applicant_passport SET expiry_date = ? WHERE applicant_id = ?').run(
      '2030-01-14',
      applicantId,
    );
    insertMeta(db, applicantId, {
      field_path: 'passport.expiryDate',
      source: 'manual',
      verified: 1,
      verified_at: '2026-01-01T00:00:00Z',
    });

    // Run every case through applyExtractedField.
    db.prepare('UPDATE applicant_identity SET sex = ?, surname = ?, date_of_birth = ? WHERE applicant_id = ?').run(
      'M',
      'SMITH',
      '1990-01-15',
      applicantId,
    );
    insertMeta(db, applicantId, {
      field_path: 'identity.dateOfBirth',
      source: 'manual',
      confidence: null,
      verified: 0,
    });

    applyExtractedField(db, applicantId, 'doc1', field({ fieldPath: 'passport.number', value: 'A01234567', raw: 'r', source: 'passport_mrz' }), NOW);
    applyExtractedField(db, applicantId, 'doc1', field({ fieldPath: 'identity.sex', value: 'M', source: 'passport_mrz' }), NOW);
    applyExtractedField(db, applicantId, 'doc1', field({ fieldPath: 'identity.dateOfBirth', value: '1990-01-15', source: 'passport_mrz' }), NOW);
    applyExtractedField(db, applicantId, 'doc1', field({ fieldPath: 'passport.expiryDate', value: '2030-01-14', source: 'passport_mrz' }), NOW);
    applyExtractedField(db, applicantId, 'doc1', field({ fieldPath: 'identity.surname', value: 'JONES', source: 'passport_mrz' }), NOW);
    applyExtractedField(db, applicantId, 'doc1', field({ fieldPath: 'identity.givenNames', value: 'BETTY', source: 'passport_mrz' }), NOW);
    applyExtractedField(db, applicantId, 'doc1', field({ fieldPath: 'identity.dateOfBirth', value: null, source: 'passport_mrz' }), NOW);

    const verifiedCount = db
      .prepare('SELECT count(*) AS n FROM applicant_field_meta WHERE verified = 1')
      .get() as { n: number };
    expect(verifiedCount.n).toBe(2);
  });
});
