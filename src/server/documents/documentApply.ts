import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { ExtractedField } from '../../shared/documents/index.js';
import { SECTION_TABLES, readSection, writeSection } from '../services/applicantColumns.js';

export interface ApplyResult {
  fieldPath: string;
  status: 'applied' | 'held';
  reason: 'empty' | 'same_value' | 'different' | 'verified' | 'unnormalizable';
}

interface MetaIdRow {
  id: string;
}

interface MetaRow {
  id: string;
  source: string;
  confidence: number | null;
  raw_value: string | null;
  verified: number;
  verified_at: string | null;
  document_id: string | null;
}

/**
 * Columns the meta upsert may touch, camel patch key -> column. `verified` is
 * only ever the literal `0` here (see the `MetaPatch` type) and `verified_at`
 * only ever `null` — this file has NO path that writes `verified = 1`.
 */
const META_COLS: Record<string, string> = {
  source: 'source',
  confidence: 'confidence',
  rawValue: 'raw_value',
  documentId: 'document_id',
  verified: 'verified',
  verifiedAt: 'verified_at',
};

interface MetaPatch {
  source?: string;
  confidence?: number | null;
  rawValue?: string | null;
  documentId?: string;
  verified?: 0;
  verifiedAt?: null;
}

/**
 * Hand-written focused upsert for `applicant_field_meta`. If a row exists at
 * `(applicantId, fieldPath)` it UPDATEs exactly the columns named in `patch`
 * plus `updated_at`; otherwise it INSERTs a fresh row (new `randomUUID()` id,
 * `created_at = updated_at = now`, `verified = 0`, `verified_at = NULL`).
 *
 * By construction it can never set `verified = 1` or a non-null `verified_at`:
 * the INSERT hard-codes them and `MetaPatch` only admits `verified?: 0` /
 * `verifiedAt?: null`.
 */
function upsertFieldMetaRow(
  db: DatabaseSync,
  applicantId: string,
  fieldPath: string,
  patch: MetaPatch,
  now: string,
): void {
  const existing = db
    .prepare('SELECT id FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
    .get(applicantId, fieldPath) as MetaIdRow | undefined;

  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);

  if (existing) {
    const setSql = [
      ...entries.map(([key]) => `${META_COLS[key]} = ?`),
      'updated_at = ?',
    ].join(', ');
    const values = [
      ...entries.map(([, v]) => v as SQLInputValue),
      now,
      existing.id,
    ] as SQLInputValue[];
    db.prepare(`UPDATE applicant_field_meta SET ${setSql} WHERE id = ?`).run(...values);
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
    (patch.source ?? 'manual') as SQLInputValue,
    (patch.confidence ?? null) as SQLInputValue,
    (patch.rawValue ?? null) as SQLInputValue,
    (patch.documentId ?? null) as SQLInputValue,
    now,
    now,
  );
}

/**
 * Decide + perform the profile write for one extracted field. Transaction-agnostic:
 * the caller (Task 14 documentService.runExtraction) wraps this in the run's
 * BEGIN/COMMIT and does the `applicants.updated_at` touch. This function only
 * touches the section table and applicant_field_meta.
 *
 * NEVER writes verified = 1. `applied` means "the value is now in the profile,
 * unverified"; verification is a separate explicit user action (Phase 2
 * PUT /field-meta).
 */
export function applyExtractedField(
  db: DatabaseSync,
  applicantId: string,
  documentId: string,
  field: ExtractedField,
  now: string,
): ApplyResult {
  const fieldPath = field.fieldPath;
  const dot = fieldPath.indexOf('.');
  const section = dot === -1 ? '' : fieldPath.slice(0, dot);
  const key = dot === -1 ? '' : fieldPath.slice(dot + 1);

  const sectionDef = (
    SECTION_TABLES as Record<string, { table: string; cols: Record<string, string> }>
  )[section];
  const col = sectionDef ? sectionDef.cols[key] : undefined;

  // Defensive fallback: fieldMap only ever targets identity.*/passport.* keys
  // that exist in `cols`, but if the path cannot be mapped, hold and touch
  // nothing.
  if (!sectionDef || !col) {
    return { fieldPath, status: 'held', reason: 'different' };
  }

  const V = field.value;

  // 1. UNNORMALIZABLE — nothing written.
  if (V === null) {
    return { fieldPath, status: 'held', reason: 'unnormalizable' };
  }

  const current = readSection<Record<string, string | null>>(
    db,
    sectionDef.table,
    sectionDef.cols,
    applicantId,
  );
  const C = current[key] ?? null;
  const Cset = C != null && String(C).trim() !== '';

  const M = db
    .prepare('SELECT * FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
    .get(applicantId, fieldPath) as MetaRow | undefined;
  const Mverified = M?.verified === 1;
  const same = Cset && String(C).trim() === String(V).trim();

  // 2. EMPTY — auto-fill + fresh unverified provenance.
  if (!Cset) {
    writeSection(db, sectionDef.table, sectionDef.cols, applicantId, { [key]: V });
    upsertFieldMetaRow(
      db,
      applicantId,
      fieldPath,
      {
        source: field.source,
        confidence: field.confidence,
        rawValue: field.raw,
        documentId,
        verified: 0,
        verifiedAt: null,
      },
      now,
    );
    return { fieldPath, status: 'applied', reason: 'empty' };
  }

  // 3. SAME — no collision; do NOT write the section column, reconcile provenance.
  if (same) {
    if (Mverified) {
      // Verified value: leave M entirely untouched.
    } else if (!M) {
      upsertFieldMetaRow(
        db,
        applicantId,
        fieldPath,
        {
          source: field.source,
          confidence: field.confidence,
          rawValue: field.raw,
          documentId,
          verified: 0,
        },
        now,
      );
    } else if (M.source === 'manual') {
      // Provenance upgrade: manual (unverified) -> this OCR source.
      upsertFieldMetaRow(
        db,
        applicantId,
        fieldPath,
        {
          source: field.source,
          confidence: field.confidence,
          rawValue: field.raw,
          documentId,
          verified: 0,
        },
        now,
      );
    } else {
      // Already an OCR source: refresh confidence/raw/document_id only,
      // keep source + verified (which is 0).
      upsertFieldMetaRow(
        db,
        applicantId,
        fieldPath,
        {
          confidence: field.confidence,
          rawValue: field.raw,
          documentId,
        },
        now,
      );
    }
    return { fieldPath, status: 'applied', reason: 'same_value' };
  }

  // 4/5. DIFFERENT — never overwrite automatically.
  if (Mverified) {
    return { fieldPath, status: 'held', reason: 'verified' };
  }
  return { fieldPath, status: 'held', reason: 'different' };
}
