import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { env } from '../../src/server/env.js';
import {
  DocumentServiceError,
  applyHeldField,
  createDocument,
  deleteDocument,
  dismissField,
  getDocument,
  listDocuments,
  runExtraction,
} from '../../src/server/documents/documentService.js';
import { duplicateApplicant } from '../../src/server/services/applicantService.js';
import type { OcrEngine, OcrResult } from '../../src/server/documents/ocrEngine.js';
import { ocrResultFromLines } from '../helpers/fakeOcrEngine.js';
import { ICAO_SPECIMEN, buildTd3 } from '../helpers/mrzFixtures.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

const ENGINE = 'test-engine@1 / eng';
const NOW = () => new Date('2026-09-04T00:00:00Z');

// A minimal JPEG: correct magic so validateUpload sniffs `image/jpeg`; the fake
// OCR ignores the pixels entirely.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);

/** OCR double that returns a different result on each successive call. */
class SeqOcrEngine implements OcrEngine {
  calls = 0;
  #results: (OcrResult | Error)[];
  constructor(results: (OcrResult | Error)[]) {
    this.#results = results;
  }
  recognize(): Promise<OcrResult> {
    const r = this.#results[Math.min(this.calls, this.#results.length - 1)]!;
    this.calls += 1;
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r);
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

const specimenOcr = (extra: string[] = []): OcrResult =>
  ocrResultFromLines([ICAO_SPECIMEN.line1, ICAO_SPECIMEN.line2, ...extra], 92);

let db: DatabaseSync;
let dbPath: string;
const createdDocIds: string[] = [];

function makeApplicant(db: DatabaseSync, id = randomUUID()): string {
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

function mkDoc(applicantId: string | null, bytes: Uint8Array = JPEG): string {
  const summary = createDocument(db, { applicantId, originalName: 'passport.jpg', bytes });
  createdDocIds.push(summary.id);
  return summary.id;
}

beforeEach(() => {
  dbPath = makeTempDbPath();
  db = openDatabase(dbPath);
  runMigrations(db);
});
afterEach(() => {
  db.close();
  cleanupTempDb(dbPath);
  for (const id of createdDocIds.splice(0)) {
    rmSync(path.join(env.DOCUMENTS_DIR, id), { recursive: true, force: true });
  }
});

describe('createDocument', () => {
  it('sniffs, stores and inserts an uploaded row', () => {
    const applicantId = makeApplicant(db);
    const summary = createDocument(db, {
      applicantId,
      originalName: 'p.jpg',
      bytes: JPEG,
    });
    createdDocIds.push(summary.id);

    expect(summary.status).toBe('uploaded');
    expect(summary.kind).toBe('unknown');
    expect(summary.mimeType).toBe('image/jpeg');
    expect(summary.runCount).toBe(0);
    expect(summary.fieldCount).toBe(0);

    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(summary.id) as Record<
      string,
      unknown
    >;
    expect(row.status).toBe('uploaded');
    expect(row.kind).toBe('unknown');
    expect(typeof row.sha256).toBe('string');
    expect((row.sha256 as string).length).toBe(64);
    expect(existsSync(path.join(env.DOCUMENTS_DIR, row.storage_path as string))).toBe(true);
  });

  it('rejects an unsupported file type', () => {
    const applicantId = makeApplicant(db);
    expect(() =>
      createDocument(db, { applicantId, originalName: 'x.txt', bytes: new Uint8Array([1, 2, 3]) }),
    ).toThrow();
  });
});

describe('runExtraction — happy path', () => {
  it('records run 1, applies to an empty profile, marks the doc extracted', async () => {
    const applicantId = makeApplicant(db);
    const docId = mkDoc(applicantId);

    const detail = await runExtraction(db, docId, { ocr: new SeqOcrEngine([specimenOcr()]), engineDetail: ENGINE, now: NOW });

    expect(detail.status).toBe('extracted');
    expect(detail.latestExtractionMethod).toBe('mrz');
    expect(detail.kind).toBe('passport');
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0]!.attempt).toBe(1);
    expect(detail.runs[0]!.method).toBe('mrz');
    expect(detail.runs[0]!.mrzValid).toBe(true);
    expect(detail.runs[0]!.status).toBe('completed');
    expect(detail.runs[0]!.engineDetail).toBe(ENGINE);
    expect(detail.runs[0]!.fieldCount).toBeGreaterThan(0);
    expect(detail.fields.length).toBeGreaterThan(0);

    const number = detail.fields.find((f) => f.fieldPath === 'passport.number')!;
    expect(number.status).toBe('applied');
    expect(number.inProfile).toBe(true);
    expect(number.verified).toBe(false);
    expect(number.extractionRunId).toBe(detail.runs[0]!.id);

    const meta = db
      .prepare('SELECT * FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
      .get(applicantId, 'passport.number') as { verified: number; document_id: string | null };
    expect(meta.verified).toBe(0);
    expect(meta.document_id).toBe(docId);

    const pass = db
      .prepare('SELECT number FROM applicant_passport WHERE applicant_id = ?')
      .get(applicantId) as { number: string | null };
    expect(pass.number).toBe(number.value);
  });

  it('a second call records attempt 2', async () => {
    const applicantId = makeApplicant(db);
    const docId = mkDoc(applicantId);
    const ocr = new SeqOcrEngine([specimenOcr()]);
    await runExtraction(db, docId, { ocr, engineDetail: ENGINE, now: NOW });
    const detail = await runExtraction(db, docId, { ocr, engineDetail: ENGINE, now: NOW });
    expect(detail.runs.map((r) => r.attempt)).toEqual([1, 2]);
  });
});

describe('runExtraction — failures & guards', () => {
  it('throws no_applicant when the document has no applicant', async () => {
    const docId = mkDoc(null);
    await expect(
      runExtraction(db, docId, { ocr: new SeqOcrEngine([specimenOcr()]), engineDetail: ENGINE }),
    ).rejects.toBeInstanceOf(DocumentServiceError);
  });

  it('throws not_found for an unknown document', async () => {
    await expect(
      runExtraction(db, 'nope', { ocr: new SeqOcrEngine([specimenOcr()]), engineDetail: ENGINE }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('records a failed run (audit) and returns the detail — no partial fields', async () => {
    const applicantId = makeApplicant(db);
    const docId = mkDoc(applicantId);
    const detail = await runExtraction(db, docId, {
      ocr: new SeqOcrEngine([new Error('boom')]),
      engineDetail: ENGINE,
      now: NOW,
    });

    expect(detail.status).toBe('failed');
    expect(detail.errorCode).toBe('unreadable');
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0]!.status).toBe('failed');
    expect(detail.runs[0]!.method).toBeNull();
    expect(detail.runs[0]!.errorCode).toBe('unreadable');
    expect(detail.fields).toHaveLength(0);

    const n = db
      .prepare('SELECT count(*) AS n FROM document_fields WHERE document_id = ?')
      .get(docId) as { n: number };
    expect(n.n).toBe(0);
  });
});

describe('re-extraction rules', () => {
  it('updates a held field run_id and re-evaluates status (held → held)', async () => {
    const applicantId = makeApplicant(db);
    db.prepare('UPDATE applicant_passport SET number = ? WHERE applicant_id = ?').run(
      'PRESET-DIFFERENT',
      applicantId,
    );
    const docId = mkDoc(applicantId);
    const ocr = new SeqOcrEngine([specimenOcr()]);

    const d1 = await runExtraction(db, docId, { ocr, engineDetail: ENGINE, now: NOW });
    const f1 = d1.fields.find((f) => f.fieldPath === 'passport.number')!;
    expect(f1.status).toBe('held');
    const run1 = d1.runs[0]!.id;
    expect(f1.extractionRunId).toBe(run1);

    const d2 = await runExtraction(db, docId, { ocr, engineDetail: ENGINE, now: NOW });
    const f2 = d2.fields.find((f) => f.fieldPath === 'passport.number')!;
    expect(f2.id).toBe(f1.id);
    expect(f2.status).toBe('held');
    expect(f2.extractionRunId).toBe(d2.runs[1]!.id);
    expect(f2.extractionRunId).not.toBe(run1);
  });

  it('leaves a field the 2nd run does not produce untouched', async () => {
    const applicantId = makeApplicant(db);
    const docId = mkDoc(applicantId);
    const ocr = new SeqOcrEngine([
      specimenOcr(['Place of Issue: DHAKA']),
      specimenOcr(), // 2nd run: no "Place of Issue" line
    ]);

    const d1 = await runExtraction(db, docId, { ocr, engineDetail: ENGINE, now: NOW });
    const place1 = d1.fields.find((f) => f.fieldPath === 'passport.placeOfIssue');
    expect(place1).toBeDefined();
    const run1 = d1.runs[0]!.id;

    const d2 = await runExtraction(db, docId, { ocr, engineDetail: ENGINE, now: NOW });
    const place2 = d2.fields.find((f) => f.fieldPath === 'passport.placeOfIssue')!;
    expect(place2.extractionRunId).toBe(run1);
  });

  it('a dismissed field stays dismissed across a re-extraction', async () => {
    const applicantId = makeApplicant(db);
    db.prepare('UPDATE applicant_passport SET number = ? WHERE applicant_id = ?').run(
      'PRESET-DIFFERENT',
      applicantId,
    );
    const docId = mkDoc(applicantId);
    const ocr = new SeqOcrEngine([specimenOcr()]);

    await runExtraction(db, docId, { ocr, engineDetail: ENGINE, now: NOW });
    dismissField(db, docId, 'passport.number');

    const d = await runExtraction(db, docId, { ocr, engineDetail: ENGINE, now: NOW });
    const f = d.fields.find((x) => x.fieldPath === 'passport.number')!;
    expect(f.status).toBe('dismissed');
    expect(f.inProfile).toBe(false);
  });
});

describe('getDocument — fields ↔ live meta join', () => {
  it('reflects a later verified=1 on the meta row', async () => {
    const applicantId = makeApplicant(db);
    const docId = mkDoc(applicantId);
    await runExtraction(db, docId, { ocr: new SeqOcrEngine([specimenOcr()]), engineDetail: ENGINE, now: NOW });

    const before = getDocument(db, docId)!.fields.find((f) => f.fieldPath === 'passport.number')!;
    expect(before.verified).toBe(false);

    db.prepare(
      'UPDATE applicant_field_meta SET verified = 1 WHERE applicant_id = ? AND field_path = ?',
    ).run(applicantId, 'passport.number');

    const after = getDocument(db, docId)!.fields.find((f) => f.fieldPath === 'passport.number')!;
    expect(after.verified).toBe(true);
  });
});

describe('applyHeldField', () => {
  it('writes the held value, sets status applied, meta verified 0', async () => {
    const applicantId = makeApplicant(db);
    db.prepare('UPDATE applicant_passport SET number = ? WHERE applicant_id = ?').run(
      'PRESET-DIFFERENT',
      applicantId,
    );
    const docId = mkDoc(applicantId);
    const d1 = await runExtraction(db, docId, { ocr: new SeqOcrEngine([specimenOcr()]), engineDetail: ENGINE, now: NOW });
    const held = d1.fields.find((f) => f.fieldPath === 'passport.number')!;
    expect(held.status).toBe('held');

    const detail = applyHeldField(db, docId, 'passport.number');
    const now = detail.fields.find((f) => f.fieldPath === 'passport.number')!;
    expect(now.status).toBe('applied');
    expect(now.inProfile).toBe(true);

    const pass = db
      .prepare('SELECT number FROM applicant_passport WHERE applicant_id = ?')
      .get(applicantId) as { number: string };
    expect(pass.number).toBe(held.value);

    const meta = db
      .prepare('SELECT * FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
      .get(applicantId, 'passport.number') as { verified: number; document_id: string | null };
    expect(meta.verified).toBe(0);
    expect(meta.document_id).toBe(docId);
  });

  it('over a verified value resets verified to 0 and overrides the value', async () => {
    const applicantId = makeApplicant(db);
    db.prepare('UPDATE applicant_passport SET number = ? WHERE applicant_id = ?').run(
      'OLD-VERIFIED',
      applicantId,
    );
    db.prepare(
      `INSERT INTO applicant_field_meta
         (id, applicant_id, field_path, source, confidence, raw_value, verified, verified_at, document_id, created_at, updated_at)
       VALUES (?, ?, 'passport.number', 'manual', NULL, NULL, 1, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    ).run(randomUUID(), applicantId);

    const docId = mkDoc(applicantId);
    const d1 = await runExtraction(db, docId, { ocr: new SeqOcrEngine([specimenOcr()]), engineDetail: ENGINE, now: NOW });
    const held = d1.fields.find((f) => f.fieldPath === 'passport.number')!;
    expect(held.status).toBe('held');

    applyHeldField(db, docId, 'passport.number');

    const pass = db
      .prepare('SELECT number FROM applicant_passport WHERE applicant_id = ?')
      .get(applicantId) as { number: string };
    expect(pass.number).toBe(held.value);

    const meta = db
      .prepare('SELECT verified, verified_at FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
      .get(applicantId, 'passport.number') as { verified: number; verified_at: string | null };
    expect(meta.verified).toBe(0);
    expect(meta.verified_at).toBeNull();
  });

  it('throws field_not_held for an applied field and field_has_no_value for a null value', async () => {
    const applicantId = makeApplicant(db);
    const docId = mkDoc(applicantId);
    await runExtraction(db, docId, { ocr: new SeqOcrEngine([specimenOcr()]), engineDetail: ENGINE, now: NOW });

    // passport.number was auto-applied against the empty profile
    expect(() => applyHeldField(db, docId, 'passport.number')).toThrow(DocumentServiceError);
    try {
      applyHeldField(db, docId, 'passport.number');
    } catch (err) {
      expect((err as DocumentServiceError).code).toBe('field_not_held');
    }

    // a held field with value === null
    const applicant2 = makeApplicant(db);
    const { line1, line2 } = buildTd3({
      surname: 'X',
      givenNames: 'Y',
      documentNumber: 'A01234567',
      dateOfBirth: '999999',
      sex: 'M',
      expiryDate: '300114',
    });
    const doc2 = mkDoc(applicant2);
    await runExtraction(db, doc2, {
      ocr: new SeqOcrEngine([ocrResultFromLines([line1, line2], 90)]),
      engineDetail: ENGINE,
      now: NOW,
    });
    const dob = getDocument(db, doc2)!.fields.find((f) => f.fieldPath === 'identity.dateOfBirth')!;
    expect(dob.value).toBeNull();
    expect(dob.status).toBe('held');
    try {
      applyHeldField(db, doc2, 'identity.dateOfBirth');
      expect.unreachable();
    } catch (err) {
      expect((err as DocumentServiceError).code).toBe('field_has_no_value');
    }
  });
});

describe('dismissField', () => {
  it('marks the row dismissed and leaves an applied profile value in place', async () => {
    const applicantId = makeApplicant(db);
    const docId = mkDoc(applicantId);
    await runExtraction(db, docId, { ocr: new SeqOcrEngine([specimenOcr()]), engineDetail: ENGINE, now: NOW });

    const before = db
      .prepare('SELECT number FROM applicant_passport WHERE applicant_id = ?')
      .get(applicantId) as { number: string | null };

    const detail = dismissField(db, docId, 'passport.number');
    expect(detail.fields.find((f) => f.fieldPath === 'passport.number')!.status).toBe('dismissed');

    const after = db
      .prepare('SELECT number FROM applicant_passport WHERE applicant_id = ?')
      .get(applicantId) as { number: string | null };
    expect(after.number).toBe(before.number);
  });

  it('throws for a document that does not exist', () => {
    expect(() => dismissField(db, 'nope', 'passport.number')).toThrow(DocumentServiceError);
  });
});

describe('listDocuments', () => {
  it('lists all, and filters by applicant', async () => {
    const a = makeApplicant(db);
    const b = makeApplicant(db);
    mkDoc(a);
    mkDoc(a);
    mkDoc(b);
    expect(listDocuments(db)).toHaveLength(3);
    expect(listDocuments(db, a)).toHaveLength(2);
    expect(listDocuments(db, b)).toHaveLength(1);
  });
});

describe('deleteDocument', () => {
  it('removes the file + rows and nulls the field-meta back-link (value retained)', async () => {
    const applicantId = makeApplicant(db);
    const docId = mkDoc(applicantId);
    await runExtraction(db, docId, { ocr: new SeqOcrEngine([specimenOcr()]), engineDetail: ENGINE, now: NOW });

    const storagePath = (
      db.prepare('SELECT storage_path FROM documents WHERE id = ?').get(docId) as {
        storage_path: string;
      }
    ).storage_path;
    const number = (
      db.prepare('SELECT number FROM applicant_passport WHERE applicant_id = ?').get(applicantId) as {
        number: string;
      }
    ).number;

    expect(deleteDocument(db, docId)).toBe(true);

    expect(existsSync(path.join(env.DOCUMENTS_DIR, storagePath))).toBe(false);
    expect(db.prepare('SELECT id FROM documents WHERE id = ?').get(docId)).toBeUndefined();
    expect(
      (db.prepare('SELECT count(*) AS n FROM extraction_runs WHERE document_id = ?').get(docId) as {
        n: number;
      }).n,
    ).toBe(0);
    expect(
      (db.prepare('SELECT count(*) AS n FROM document_fields WHERE document_id = ?').get(docId) as {
        n: number;
      }).n,
    ).toBe(0);

    const meta = db
      .prepare('SELECT document_id FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
      .get(applicantId, 'passport.number') as { document_id: string | null };
    expect(meta.document_id).toBeNull();

    const pass = db
      .prepare('SELECT number FROM applicant_passport WHERE applicant_id = ?')
      .get(applicantId) as { number: string };
    expect(pass.number).toBe(number);
  });

  it('returns false for an unknown id', () => {
    expect(deleteDocument(db, 'nope')).toBe(false);
  });
});

describe('duplicateApplicant (Phase 2) after an extraction', () => {
  it('clones field-meta rows with document_id NULL', async () => {
    const applicantId = makeApplicant(db);
    const docId = mkDoc(applicantId);
    await runExtraction(db, docId, { ocr: new SeqOcrEngine([specimenOcr()]), engineDetail: ENGINE, now: NOW });

    const src = db
      .prepare('SELECT document_id FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
      .get(applicantId, 'passport.number') as { document_id: string | null };
    expect(src.document_id).toBe(docId);

    const copy = duplicateApplicant(db, applicantId)!;
    const rows = db
      .prepare('SELECT document_id FROM applicant_field_meta WHERE applicant_id = ?')
      .all(copy.id) as { document_id: string | null }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.document_id).toBeNull();
  });
});
