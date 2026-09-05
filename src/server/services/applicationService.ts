import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ApplicationMode, PurposeTag } from '../../shared/visa-kb/schema.js';
import { getCategory, validateCombination } from '../../shared/visa-kb/queries.js';
import { loadKnowledgeBase } from '../../shared/visa-kb/loader.js';
import { isValidFieldPath } from '../../shared/applicant/fieldPaths.js';
import type {
  ApplicationCreate,
  ApplicationPlan,
  ApplicationPut,
  ApplicationStatus,
  DocumentCoverage,
  DocumentCoverageEntry,
  EntryType,
  FlatApplicant,
  Selection,
  VisaApplication,
  VisaApplicationSummary,
} from '../../shared/application/index.js';
import { buildApplicationPlan } from '../../shared/application/index.js';
import { getApplicantDetail } from './applicantService.js';
import { getDocument, listDocuments } from '../documents/documentService.js';

export class ApplicationServiceError extends Error {
  constructor(
    public readonly code: 'not_found' | 'no_applicant' | 'invalid_category' | 'mode_mismatch' | 'invalid_field',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ApplicationServiceError';
  }
}

interface VisaApplicationRow {
  id: string;
  applicant_id: string;
  destination: string;
  application_mode: string;
  category_id: string;
  purpose: string | null;
  entry_type: string | null;
  intended_arrival_date: string | null;
  intended_stay_days: number | null;
  port_of_arrival: string | null;
  status: string;
  kb_version: string;
  created_at: string;
  updated_at: string;
}

function rowToApplication(r: VisaApplicationRow): VisaApplication {
  return {
    id: r.id,
    applicantId: r.applicant_id,
    destination: r.destination,
    applicationMode: r.application_mode as ApplicationMode,
    categoryId: r.category_id,
    purpose: r.purpose as PurposeTag | null,
    entryType: r.entry_type as EntryType | null,
    intendedArrivalDate: r.intended_arrival_date,
    intendedStayDays: r.intended_stay_days,
    portOfArrival: r.port_of_arrival,
    status: r.status as ApplicationStatus,
    kbVersion: r.kb_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function getApplicationRow(db: DatabaseSync, id: string): VisaApplicationRow | undefined {
  return db.prepare('SELECT * FROM visa_applications WHERE id = ?').get(id) as
    | VisaApplicationRow
    | undefined;
}

function touchApplication(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE visa_applications SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}

/** Assembles Phase 3 document coverage for the engine input. Only `status: 'applied'`
 *  fields count toward `fieldCoverage` — a `proposed`/`held`/`dismissed` field was never
 *  actually reflected in the applicant's profile, so it must not be represented as "this
 *  document covers this path". When two documents both applied the same `fieldPath`,
 *  `verified` is `true` if *either* contributed a verified value (OR, not last-write-wins). */
function assembleDocumentCoverage(db: DatabaseSync, applicantId: string): DocumentCoverage {
  const summaries = listDocuments(db, applicantId);
  const documents: DocumentCoverageEntry[] = [];
  const fieldCoverage: Record<string, { applied: boolean; verified: boolean }> = {};
  for (const summary of summaries) {
    const detail = getDocument(db, summary.id);
    if (!detail) continue; // defensive; summary and detail come from the same table
    const applied = detail.fields.filter((f) => f.status === 'applied');
    documents.push({
      id: detail.id,
      kind: detail.kind,
      originalName: detail.originalName,
      fields: applied.map((f) => ({ fieldPath: f.fieldPath, verified: f.verified })),
    });
    for (const f of applied) {
      const existing = fieldCoverage[f.fieldPath];
      fieldCoverage[f.fieldPath] = { applied: true, verified: (existing?.verified ?? false) || f.verified };
    }
  }
  return { documents, fieldCoverage };
}

function listApplicationFieldValues(
  db: DatabaseSync,
  applicationId: string,
): Record<string, { value: string | null; verified: boolean }> {
  const rows = db
    .prepare('SELECT field_path, value, verified FROM application_field_values WHERE application_id = ?')
    .all(applicationId) as { field_path: string; value: string | null; verified: number }[];
  const out: Record<string, { value: string | null; verified: boolean }> = {};
  for (const r of rows) {
    out[r.field_path] = { value: r.value, verified: r.verified === 1 };
  }
  return out;
}

export function createApplication(
  db: DatabaseSync,
  applicantId: string,
  input: ApplicationCreate,
): VisaApplicationSummary {
  if (!db.prepare('SELECT 1 FROM applicants WHERE id = ?').get(applicantId)) {
    throw new ApplicationServiceError('no_applicant', `applicant "${applicantId}" not found`);
  }

  const kb = loadKnowledgeBase();

  if (!getCategory(input.categoryId, kb)) {
    throw new ApplicationServiceError('invalid_category', `no visa category "${input.categoryId}"`);
  }

  const validation = validateCombination(
    { applicationMode: input.applicationMode, categoryId: input.categoryId },
    kb,
  );
  if (!validation.valid) {
    if (validation.code === 'MODE_MISMATCH') {
      throw new ApplicationServiceError('mode_mismatch', validation.message);
    }
    // Defensive/unreachable given the checks above: UNKNOWN_MODE can't happen because
    // `input.applicationMode` is already Zod-typed, and UNKNOWN_CATEGORY can't happen
    // because `getCategory` already confirmed the category exists.
    throw new ApplicationServiceError('invalid_category', validation.message);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO visa_applications
       (id, applicant_id, destination, application_mode, category_id, purpose, entry_type,
        intended_arrival_date, intended_stay_days, port_of_arrival, status, kb_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).run(
    id,
    applicantId,
    input.destination ?? 'IND',
    input.applicationMode,
    input.categoryId,
    input.purpose ?? null,
    input.entryType ?? null,
    input.intendedArrivalDate ?? null,
    input.intendedStayDays ?? null,
    input.portOfArrival ?? null,
    kb.meta.kbVersion,
    now,
    now,
  );

  return rowToApplication(getApplicationRow(db, id)!);
}

export function listApplications(db: DatabaseSync, applicantId?: string): VisaApplicationSummary[] {
  const rows = (
    applicantId === undefined
      ? db.prepare('SELECT * FROM visa_applications ORDER BY updated_at DESC, id DESC').all()
      : db
          .prepare(
            'SELECT * FROM visa_applications WHERE applicant_id = ? ORDER BY updated_at DESC, id DESC',
          )
          .all(applicantId)
  ) as unknown as VisaApplicationRow[];
  return rows.map(rowToApplication);
}

export function getApplication(
  db: DatabaseSync,
  id: string,
): { application: VisaApplication; plan: ApplicationPlan } | null {
  const row = getApplicationRow(db, id);
  if (!row) return null;
  const application = rowToApplication(row);

  const applicantDetail = getApplicantDetail(db, application.applicantId);
  if (!applicantDetail) {
    // FK cascade means this shouldn't happen in practice; defend anyway rather than
    // let buildApplicationPlan receive a broken input.
    throw new ApplicationServiceError(
      'no_applicant',
      `applicant ${application.applicantId} not found for application ${application.id}`,
    );
  }

  const flatApplicant: FlatApplicant = {
    identity: applicantDetail.identity,
    passport: applicantDetail.passport,
    contact: applicantDetail.contact,
    address: applicantDetail.address,
    family: applicantDetail.family,
    occupation: applicantDetail.occupation,
    travel: applicantDetail.travel,
    references: applicantDetail.references,
    fieldMeta: applicantDetail.fieldMeta,
  };

  const selection: Selection = {
    destination: application.destination,
    applicationMode: application.applicationMode,
    categoryId: application.categoryId,
    purpose: application.purpose,
    entryType: application.entryType,
    intendedArrivalDate: application.intendedArrivalDate,
    intendedStayDays: application.intendedStayDays,
    portOfArrival: application.portOfArrival,
  };

  const kb = loadKnowledgeBase();
  const plan = buildApplicationPlan({
    applicant: flatApplicant,
    documentCoverage: assembleDocumentCoverage(db, application.applicantId),
    selection,
    applicationValues: listApplicationFieldValues(db, id),
    kb,
    now: new Date(),
  });

  const finalPlan =
    application.kbVersion !== kb.meta.kbVersion
      ? {
          ...plan,
          warnings: [
            ...plan.warnings,
            {
              severity: 'info' as const,
              text: `plan computed against KB ${application.kbVersion}; current KB is ${kb.meta.kbVersion}`,
              source: null,
            },
          ],
        }
      : plan;

  return { application, plan: finalPlan };
}

export function updateApplication(
  db: DatabaseSync,
  id: string,
  patch: ApplicationPut,
): { application: VisaApplication; plan: ApplicationPlan } | null {
  const row = getApplicationRow(db, id);
  if (!row) return null;

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE visa_applications
         SET destination = ?, application_mode = ?, category_id = ?, purpose = ?, entry_type = ?,
             intended_arrival_date = ?, intended_stay_days = ?, port_of_arrival = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      patch.destination ?? row.destination,
      patch.applicationMode ?? row.application_mode,
      patch.categoryId ?? row.category_id,
      patch.purpose ?? row.purpose,
      patch.entryType ?? row.entry_type,
      patch.intendedArrivalDate ?? row.intended_arrival_date,
      patch.intendedStayDays ?? row.intended_stay_days,
      patch.portOfArrival ?? row.port_of_arrival,
      new Date().toISOString(),
      id,
    );

    // This task does not re-validate categoryId/applicationMode on update:
    // buildApplicationPlan already degrades gracefully (a category: null plan with a
    // blocker) if a caller patches to a nonexistent category, and the brief's test
    // list doesn't ask for update-time category validation.
    const { plan } = getApplication(db, id)!;

    if (row.status !== 'archived') {
      const newStatus: ApplicationStatus = plan.readyForAutomation.ready ? 'ready' : 'draft';
      if (newStatus !== row.status) {
        db.prepare('UPDATE visa_applications SET status = ?, updated_at = ? WHERE id = ?').run(
          newStatus,
          new Date().toISOString(),
          id,
        );
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getApplication(db, id);
}

export function setApplicationFieldValue(
  db: DatabaseSync,
  id: string,
  fieldPath: string,
  input: { value?: string | null; verified?: boolean },
): { application: VisaApplication; plan: ApplicationPlan } | null {
  if (!getApplicationRow(db, id)) return null;

  if (!fieldPath.startsWith('application.') || !isValidFieldPath(fieldPath)) {
    throw new ApplicationServiceError('invalid_field', `invalid application field path: ${fieldPath}`);
  }

  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT * FROM application_field_values WHERE application_id = ? AND field_path = ?')
    .get(id, fieldPath) as Record<string, unknown> | undefined;

  const value = input.value !== undefined ? input.value : ((existing?.value as string | null) ?? null);
  const verified = input.verified ?? (existing ? existing.verified === 1 : false);
  const verifiedAt = verified ? ((existing?.verified_at as string | null) ?? now) : null;

  if (existing) {
    db.prepare(
      'UPDATE application_field_values SET value = ?, verified = ?, verified_at = ?, updated_at = ? WHERE id = ?',
    ).run(value, verified ? 1 : 0, verifiedAt, now, existing.id as string);
  } else {
    db.prepare(
      `INSERT INTO application_field_values
         (id, application_id, field_path, value, verified, verified_at, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    ).run(randomUUID(), id, fieldPath, value, verified ? 1 : 0, verifiedAt, now, now);
  }
  touchApplication(db, id);

  return getApplication(db, id);
}

export function deleteApplication(db: DatabaseSync, id: string): boolean {
  const { changes } = db.prepare('DELETE FROM visa_applications WHERE id = ?').run(id);
  return Number(changes) > 0;
}
