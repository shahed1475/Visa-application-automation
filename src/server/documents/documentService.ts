/**
 * Document service (Phase 3, spec §3, §10–§13): the DB layer that ties the
 * extraction pipeline and the apply rules to SQLite, with extraction-run
 * tracking (Amendment 3).
 *
 * `runExtraction` runs the async pipeline (`extractionPipeline.runExtraction`,
 * imported as `runPipeline`) OUTSIDE any transaction, then records exactly one
 * `extraction_runs` row + upserts the `document_fields` rows (sticky `dismissed`,
 * re-extraction re-evaluates `status`) + applies each field to the profile via
 * `applyExtractedField` — all in one synchronous SQLite transaction. A pipeline
 * failure is still a recorded run (audit) and the failed detail is returned, not
 * thrown.
 *
 * NEVER writes `verified = 1`: `applyExtractedField` and the local meta upsert
 * only ever write `verified = 0` / `verified_at = NULL`.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  DocumentDetail,
  DocumentExtractedFieldView,
  DocumentKind,
  DocumentStatus,
  ExtractionMethod,
  ExtractionOutcome,
  ExtractionRunView,
  DocumentFieldStatus,
  DocumentSummary,
} from '../../shared/documents/index.js';
import { validateUpload } from './fileType.js';
import type { SniffedMime } from './fileType.js';
import { sha256Hex, storeOriginal, readOriginal, deleteOriginal } from './storage.js';
import { runExtraction as runPipeline } from './extractionPipeline.js';
import { ExtractionError } from './pdfImage.js';
import { applyExtractedField } from './documentApply.js';
import { SECTION_TABLES, readSection, writeSection } from '../services/applicantColumns.js';
import type { OcrEngine } from './ocrEngine.js';

export class DocumentServiceError extends Error {
  constructor(
    public readonly code:
      | 'no_applicant'
      | 'not_found'
      | 'field_not_held'
      | 'field_has_no_value',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DocumentServiceError';
  }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

interface DocumentRow {
  id: string;
  applicant_id: string | null;
  kind: DocumentKind;
  classification_confidence: number | null;
  original_name: string | null;
  mime_type: string;
  byte_size: number;
  sha256: string;
  storage_path: string;
  status: DocumentStatus;
  latest_extraction_method: ExtractionMethod | null;
  latest_ocr_mean_confidence: number | null;
  page_count: number | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  document_id: string;
  attempt: number;
  method: ExtractionMethod | null;
  status: 'completed' | 'failed';
  mrz_detected: number;
  mrz_valid: number;
  ocr_mean_confidence: number | null;
  field_count: number;
  error_code: string | null;
  engine_detail: string | null;
  created_at: string;
}

interface FieldRow {
  id: string;
  document_id: string;
  extraction_run_id: string;
  field_path: string;
  value: string | null;
  raw_value: string | null;
  source: DocumentExtractedFieldView['source'];
  confidence: number;
  check_digit_ok: number | null;
  status: DocumentFieldStatus;
  normalization_note: string | null;
  created_at: string;
  updated_at: string;
}

function getDocumentRow(db: DatabaseSync, id: string): DocumentRow | undefined {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
    | DocumentRow
    | undefined;
}

function touchApplicant(db: DatabaseSync, applicantId: string | null, now: string): void {
  if (applicantId == null) return;
  db.prepare('UPDATE applicants SET updated_at = ? WHERE id = ?').run(now, applicantId);
}

function scalarCount(db: DatabaseSync, sql: string, param: string): number {
  const row = db.prepare(sql).get(param) as { n: number };
  return row.n;
}

function rowToSummary(db: DatabaseSync, r: DocumentRow): DocumentSummary {
  return {
    id: r.id,
    applicantId: r.applicant_id,
    kind: r.kind,
    originalName: r.original_name,
    mimeType: r.mime_type,
    status: r.status,
    runCount: scalarCount(
      db,
      'SELECT count(*) AS n FROM extraction_runs WHERE document_id = ?',
      r.id,
    ),
    fieldCount: scalarCount(
      db,
      'SELECT count(*) AS n FROM document_fields WHERE document_id = ?',
      r.id,
    ),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function runRowToView(r: RunRow): ExtractionRunView {
  return {
    id: r.id,
    attempt: r.attempt,
    method: r.method,
    status: r.status,
    mrzDetected: r.mrz_detected === 1,
    mrzValid: r.mrz_valid === 1,
    ocrMeanConfidence: r.ocr_mean_confidence,
    fieldCount: r.field_count,
    errorCode: r.error_code,
    engineDetail: r.engine_detail,
    createdAt: r.created_at,
  };
}

/**
 * Focused `applicant_field_meta` upsert for the explicit held-field resolution
 * path. Always writes `verified = 0` / `verified_at = NULL` — resolving a held
 * field is a fresh, unverified apply even when the previous value was verified.
 */
function upsertMetaUnverified(
  db: DatabaseSync,
  applicantId: string,
  fieldPath: string,
  patch: { source: string; confidence: number | null; rawValue: string | null; documentId: string },
  now: string,
): void {
  const existing = db
    .prepare('SELECT id FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
    .get(applicantId, fieldPath) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE applicant_field_meta
         SET source = ?, confidence = ?, raw_value = ?, document_id = ?,
             verified = 0, verified_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      patch.source,
      patch.confidence,
      patch.rawValue,
      patch.documentId,
      now,
      existing.id,
    );
    return;
  }

  db.prepare(
    `INSERT INTO applicant_field_meta
       (id, applicant_id, field_path, source, confidence, raw_value, verified, verified_at, document_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
  ).run(
    randomUUID(),
    applicantId,
    fieldPath,
    patch.source,
    patch.confidence,
    patch.rawValue,
    patch.documentId,
    now,
    now,
  );
}

function sectionColumn(fieldPath: string): { table: string; cols: Record<string, string>; key: string } | null {
  const dot = fieldPath.indexOf('.');
  if (dot === -1) return null;
  const section = fieldPath.slice(0, dot);
  const key = fieldPath.slice(dot + 1);
  const def = (SECTION_TABLES as Record<string, { table: string; cols: Record<string, string> }>)[
    section
  ];
  if (!def || !Object.hasOwn(def.cols, key)) return null;
  return { table: def.table, cols: def.cols, key };
}

/**
 * The value currently stored in the applicant's section table for `fieldPath`,
 * as a string (or `null` when unset / not a mapped column). Reuses `readSection`
 * so the column mapping stays in one place.
 */
function currentSectionValue(
  db: DatabaseSync,
  applicantId: string,
  fieldPath: string,
): string | null {
  const target = sectionColumn(fieldPath);
  if (!target) return null;
  const section = readSection<Record<string, unknown>>(db, target.table, target.cols, applicantId);
  const v = section[target.key];
  return typeof v === 'string' ? v : null;
}

// --- public API -------------------------------------------------------------

export function createDocument(
  db: DatabaseSync,
  input: { applicantId: string | null; originalName: string | null; bytes: Uint8Array },
): DocumentSummary {
  const { mime } = validateUpload(input.bytes);
  const ext = EXT_BY_MIME[mime]!;
  const id = randomUUID();
  const storagePath = storeOriginal(id, ext, input.bytes);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO documents
       (id, applicant_id, kind, mime_type, byte_size, sha256, storage_path, status, original_name, created_at, updated_at)
     VALUES (?, ?, 'unknown', ?, ?, ?, ?, 'uploaded', ?, ?, ?)`,
  ).run(
    id,
    input.applicantId,
    mime,
    input.bytes.byteLength,
    sha256Hex(input.bytes),
    storagePath,
    input.originalName,
    now,
    now,
  );
  return rowToSummary(db, getDocumentRow(db, id)!);
}

export async function runExtraction(
  db: DatabaseSync,
  documentId: string,
  deps: { ocr: OcrEngine; engineDetail: string; now?: () => Date },
): Promise<DocumentDetail> {
  const doc = getDocumentRow(db, documentId);
  if (!doc) throw new DocumentServiceError('not_found');
  if (doc.applicant_id == null) throw new DocumentServiceError('no_applicant');
  const applicantId = doc.applicant_id;

  const bytes = readOriginal(doc.storage_path);
  const now = deps.now?.() ?? new Date();
  const nowIso = now.toISOString();

  // --- async pipeline: OUTSIDE any transaction --------------------------------
  let outcome: ExtractionOutcome | null = null;
  let failCode: string | null = null;
  try {
    outcome = await runPipeline(new Uint8Array(bytes), doc.mime_type as SniffedMime, {
      ocr: deps.ocr,
      now: () => now,
    });
  } catch (err) {
    failCode = err instanceof ExtractionError ? err.code : 'internal';
  }

  // --- synchronous persistence: one transaction ------------------------------
  db.exec('BEGIN');
  try {
    const attempt = (
      db
        .prepare('SELECT COALESCE(MAX(attempt),0)+1 AS n FROM extraction_runs WHERE document_id = ?')
        .get(documentId) as { n: number }
    ).n;
    const runId = randomUUID();

    if (failCode) {
      db.prepare(
        `INSERT INTO extraction_runs
           (id, document_id, attempt, method, status, mrz_detected, mrz_valid, ocr_mean_confidence, field_count, error_code, engine_detail, created_at)
         VALUES (?, ?, ?, NULL, 'failed', 0, 0, NULL, 0, ?, ?, ?)`,
      ).run(runId, documentId, attempt, failCode, deps.engineDetail, nowIso);
      db.prepare(
        `UPDATE documents SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ?`,
      ).run(failCode, nowIso, documentId);
      touchApplicant(db, applicantId, nowIso);
      db.exec('COMMIT');
      return getDocument(db, documentId)!;
    }

    const result = outcome!;
    db.prepare(
      `INSERT INTO extraction_runs
         (id, document_id, attempt, method, status, mrz_detected, mrz_valid, ocr_mean_confidence, field_count, error_code, engine_detail, created_at)
       VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      runId,
      documentId,
      attempt,
      result.method,
      result.mrzDetected ? 1 : 0,
      result.mrzValid ? 1 : 0,
      result.ocrMeanConfidence,
      result.fields.length,
      deps.engineDetail,
      nowIso,
    );

    for (const field of result.fields) {
      const existing = db
        .prepare('SELECT * FROM document_fields WHERE document_id = ? AND field_path = ?')
        .get(documentId, field.fieldPath) as FieldRow | undefined;

      // Sticky dismiss: never re-apply, never touch the row.
      if (existing?.status === 'dismissed') continue;

      const applied = applyExtractedField(db, applicantId, documentId, field, nowIso);
      const dfStatus: DocumentFieldStatus = applied.status;
      const checkDigitOk =
        field.checkDigitOk === null ? null : field.checkDigitOk ? 1 : 0;

      if (existing) {
        db.prepare(
          `UPDATE document_fields
             SET extraction_run_id = ?, value = ?, raw_value = ?, source = ?, confidence = ?,
                 check_digit_ok = ?, status = ?, normalization_note = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          runId,
          field.value,
          field.raw,
          field.source,
          field.confidence,
          checkDigitOk,
          dfStatus,
          field.normalizationNote,
          nowIso,
          existing.id,
        );
      } else {
        db.prepare(
          `INSERT INTO document_fields
             (id, document_id, extraction_run_id, field_path, value, raw_value, source, confidence, check_digit_ok, status, normalization_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          documentId,
          runId,
          field.fieldPath,
          field.value,
          field.raw,
          field.source,
          field.confidence,
          checkDigitOk,
          dfStatus,
          field.normalizationNote,
          nowIso,
          nowIso,
        );
      }
    }
    // Fields a prior run produced that THIS run does not → left as-is.

    db.prepare(
      `UPDATE documents
         SET kind = ?, classification_confidence = ?, status = 'extracted',
             latest_extraction_method = ?, latest_ocr_mean_confidence = ?, page_count = ?,
             error_code = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      result.kind,
      result.classificationConfidence,
      result.method,
      result.ocrMeanConfidence,
      result.pageCount,
      nowIso,
      documentId,
    );
    touchApplicant(db, applicantId, nowIso);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getDocument(db, documentId)!;
}

export function getDocument(db: DatabaseSync, id: string): DocumentDetail | null {
  const r = getDocumentRow(db, id);
  if (!r) return null;

  const runs = (
    db
      .prepare('SELECT * FROM extraction_runs WHERE document_id = ? ORDER BY attempt')
      .all(id) as unknown as RunRow[]
  ).map(runRowToView);

  const fieldRows = db
    .prepare('SELECT * FROM document_fields WHERE document_id = ? ORDER BY field_path')
    .all(id) as unknown as FieldRow[];

  const fields: DocumentExtractedFieldView[] = fieldRows.map((df) => {
    const meta =
      r.applicant_id == null
        ? undefined
        : (db
            .prepare(
              'SELECT verified FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?',
            )
            .get(r.applicant_id, df.field_path) as { verified: number } | undefined);
    let profileMatches = false;
    if (r.applicant_id != null && df.status === 'applied' && df.value != null) {
      const current = currentSectionValue(db, r.applicant_id, df.field_path);
      profileMatches = current != null && current.trim() === df.value.trim();
    }
    return {
      id: df.id,
      fieldPath: df.field_path,
      value: df.value,
      raw: df.raw_value,
      source: df.source,
      confidence: df.confidence,
      checkDigitOk: df.check_digit_ok === null ? null : df.check_digit_ok === 1,
      normalizationNote: df.normalization_note,
      status: df.status,
      extractionRunId: df.extraction_run_id,
      inProfile: df.status === 'applied',
      profileMatches,
      verified: meta?.verified === 1,
    };
  });

  const summary = rowToSummary(db, r);
  return {
    ...summary,
    classificationConfidence: r.classification_confidence,
    latestExtractionMethod: r.latest_extraction_method,
    latestOcrMeanConfidence: r.latest_ocr_mean_confidence,
    pageCount: r.page_count,
    errorCode: r.error_code,
    byteSize: r.byte_size,
    runCount: runs.length,
    fieldCount: fields.length,
    runs,
    fields,
  };
}

/**
 * Raw stored bytes + mime for `GET /api/documents/:id/file`. Deliberately kept
 * off `getDocument` (which never exposes `storage_path`). Returns `null` for an
 * unknown id.
 */
export function getDocumentFile(
  db: DatabaseSync,
  id: string,
): { bytes: Buffer; mimeType: string } | null {
  const row = getDocumentRow(db, id);
  if (!row) return null;
  return { bytes: readOriginal(row.storage_path), mimeType: row.mime_type };
}

export function listDocuments(db: DatabaseSync, applicantId?: string): DocumentSummary[] {
  const rows = (
    applicantId === undefined
      ? db.prepare('SELECT * FROM documents ORDER BY created_at DESC').all()
      : db
          .prepare('SELECT * FROM documents WHERE applicant_id = ? ORDER BY created_at DESC')
          .all(applicantId)
  ) as unknown as DocumentRow[];
  return rows.map((r) => rowToSummary(db, r));
}

export function applyHeldField(
  db: DatabaseSync,
  documentId: string,
  fieldPath: string,
): DocumentDetail {
  const doc = getDocumentRow(db, documentId);
  if (!doc) throw new DocumentServiceError('not_found');

  const df = db
    .prepare('SELECT * FROM document_fields WHERE document_id = ? AND field_path = ?')
    .get(documentId, fieldPath) as FieldRow | undefined;
  if (!df || df.status !== 'held') throw new DocumentServiceError('field_not_held');
  if (df.value === null) throw new DocumentServiceError('field_has_no_value');
  if (doc.applicant_id == null) throw new DocumentServiceError('no_applicant');
  const applicantId = doc.applicant_id;

  const target = sectionColumn(fieldPath);
  if (!target) throw new DocumentServiceError('field_not_held');

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    writeSection(db, target.table, target.cols, applicantId, { [target.key]: df.value });
    upsertMetaUnverified(
      db,
      applicantId,
      fieldPath,
      {
        source: df.source,
        confidence: df.confidence,
        rawValue: df.raw_value,
        documentId,
      },
      now,
    );
    db.prepare('UPDATE document_fields SET status = ?, updated_at = ? WHERE id = ?').run(
      'applied',
      now,
      df.id,
    );
    touchApplicant(db, applicantId, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getDocument(db, documentId)!;
}

export function dismissField(
  db: DatabaseSync,
  documentId: string,
  fieldPath: string,
): DocumentDetail {
  const doc = getDocumentRow(db, documentId);
  if (!doc) throw new DocumentServiceError('not_found');

  const df = db
    .prepare('SELECT id FROM document_fields WHERE document_id = ? AND field_path = ?')
    .get(documentId, fieldPath) as { id: string } | undefined;
  if (!df) throw new DocumentServiceError('field_not_held');

  db.prepare('UPDATE document_fields SET status = ?, updated_at = ? WHERE id = ?').run(
    'dismissed',
    new Date().toISOString(),
    df.id,
  );
  return getDocument(db, documentId)!;
}

export function deleteDocument(db: DatabaseSync, id: string): boolean {
  const row = db
    .prepare('SELECT storage_path, applicant_id FROM documents WHERE id = ?')
    .get(id) as { storage_path: string; applicant_id: string | null } | undefined;
  if (!row) return false;

  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  deleteOriginal(row.storage_path);
  touchApplicant(db, row.applicant_id, new Date().toISOString());
  return true;
}
