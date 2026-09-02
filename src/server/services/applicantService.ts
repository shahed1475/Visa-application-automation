import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Address,
  Applicant,
  ApplicantDetail,
  ApplicantStatus,
  ApplicantSummary,
  Contact,
  FieldMeta,
  Identity,
  Passport,
  Reference,
  TravelRecord,
} from '../../shared/applicant/types.js';
import type { ApplicantCreate, ApplicantPut } from '../../shared/applicant/schemas.js';
import { SECTION_TABLES, readSection, writeSection } from './applicantColumns.js';
import {
  collectWarnings,
  computeCompleteness,
  computeVerification,
} from './applicantCompleteness.js';

interface ApplicantRow {
  id: string;
  display_name: string;
  status: ApplicantStatus;
  created_at: string;
  updated_at: string;
}

function rowToApplicant(r: ApplicantRow): Applicant {
  return {
    id: r.id,
    displayName: r.display_name,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function touch(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE applicants SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}

function getApplicantRow(db: DatabaseSync, id: string): ApplicantRow | undefined {
  return db.prepare('SELECT * FROM applicants WHERE id = ?').get(id) as
    | ApplicantRow
    | undefined;
}

function listTravel(db: DatabaseSync, applicantId: string): TravelRecord[] {
  return (
    db
      .prepare(
        'SELECT * FROM applicant_travel WHERE applicant_id = ? ORDER BY sort_order, created_at',
      )
      .all(applicantId) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    applicantId: r.applicant_id as string,
    sortOrder: r.sort_order as number,
    tripType: (r.trip_type as string) ?? null,
    purpose: (r.purpose as string) ?? null,
    destinationCountry: (r.destination_country as string) ?? null,
    cities: (r.cities as string) ?? null,
    arrivalDate: (r.arrival_date as string) ?? null,
    departureDate: (r.departure_date as string) ?? null,
    portOfEntry: (r.port_of_entry as string) ?? null,
    portOfExit: (r.port_of_exit as string) ?? null,
    accommodation: (r.accommodation as string) ?? null,
    previousTravel: (r.previous_travel as string) ?? null,
    notes: (r.notes as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

function listReferences(db: DatabaseSync, applicantId: string): Reference[] {
  return (
    db
      .prepare(
        'SELECT * FROM applicant_reference WHERE applicant_id = ? ORDER BY sort_order, created_at',
      )
      .all(applicantId) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    applicantId: r.applicant_id as string,
    sortOrder: r.sort_order as number,
    kind: r.kind as Reference['kind'],
    name: (r.name as string) ?? null,
    relationship: (r.relationship as string) ?? null,
    organization: (r.organization as string) ?? null,
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    address: (r.address as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

function listFieldMeta(db: DatabaseSync, applicantId: string): FieldMeta[] {
  return (
    db
      .prepare(
        'SELECT * FROM applicant_field_meta WHERE applicant_id = ? ORDER BY field_path',
      )
      .all(applicantId) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    applicantId: r.applicant_id as string,
    fieldPath: r.field_path as string,
    source: r.source as FieldMeta['source'],
    confidence: (r.confidence as number) ?? null,
    rawValue: (r.raw_value as string) ?? null,
    verified: r.verified === 1,
    verifiedAt: (r.verified_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

function assembleDetail(db: DatabaseSync, row: ApplicantRow): ApplicantDetail {
  const identity = readSection<Identity>(
    db,
    SECTION_TABLES.identity.table,
    SECTION_TABLES.identity.cols,
    row.id,
  );
  const passport = readSection<Passport>(
    db,
    SECTION_TABLES.passport.table,
    SECTION_TABLES.passport.cols,
    row.id,
  );
  const contact = readSection<Contact>(
    db,
    SECTION_TABLES.contact.table,
    SECTION_TABLES.contact.cols,
    row.id,
  );
  const address = readSection<Address>(
    db,
    SECTION_TABLES.address.table,
    SECTION_TABLES.address.cols,
    row.id,
  );
  const travel = listTravel(db, row.id);
  const references = listReferences(db, row.id);
  const fieldMeta = listFieldMeta(db, row.id);

  const completeness = computeCompleteness({ identity, passport, contact, address, travel, references });
  const verification = computeVerification({ identity, passport, contact, address, fieldMeta });
  const warnings = collectWarnings({ passport, travel });

  return {
    ...rowToApplicant(row),
    identity,
    passport,
    contact,
    address,
    travel,
    references,
    fieldMeta,
    completeness,
    verification,
    warnings,
  };
}

export function createApplicant(db: DatabaseSync, input: ApplicantCreate): ApplicantDetail {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO applicants (id, display_name, status, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?)`,
    ).run(id, input.displayName, now, now);
    db.prepare('INSERT INTO applicant_identity (applicant_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO applicant_passport (applicant_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO applicant_contact (applicant_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO applicant_address (applicant_id) VALUES (?)').run(id);
    for (const key of ['identity', 'passport', 'contact', 'address'] as const) {
      const patch = input[key];
      if (patch) {
        writeSection(
          db,
          SECTION_TABLES[key].table,
          SECTION_TABLES[key].cols,
          id,
          patch as Record<string, unknown>,
        );
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getApplicantDetail(db, id)!;
}

export function getApplicantDetail(db: DatabaseSync, id: string): ApplicantDetail | null {
  const row = getApplicantRow(db, id);
  return row ? assembleDetail(db, row) : null;
}

export function updateApplicant(
  db: DatabaseSync,
  id: string,
  patch: ApplicantPut,
): ApplicantDetail | null {
  if (!getApplicantRow(db, id)) return null;
  db.exec('BEGIN');
  try {
    if (patch.displayName !== undefined || patch.status !== undefined) {
      const current = getApplicantRow(db, id)!;
      db.prepare('UPDATE applicants SET display_name = ?, status = ? WHERE id = ?').run(
        patch.displayName ?? current.display_name,
        patch.status ?? current.status,
        id,
      );
    }
    for (const key of ['identity', 'passport', 'contact', 'address'] as const) {
      const sectionPatch = patch[key];
      if (sectionPatch) {
        writeSection(
          db,
          SECTION_TABLES[key].table,
          SECTION_TABLES[key].cols,
          id,
          sectionPatch as Record<string, unknown>,
        );
      }
    }
    touch(db, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getApplicantDetail(db, id);
}

export function deleteApplicant(db: DatabaseSync, id: string): boolean {
  const { changes } = db.prepare('DELETE FROM applicants WHERE id = ?').run(id);
  return Number(changes) > 0;
}

export function listApplicants(db: DatabaseSync, q?: string): ApplicantSummary[] {
  const term = (q ?? '').trim();
  const like = `%${term}%`;
  const sql = `
    SELECT a.id, a.display_name, a.status, a.created_at, a.updated_at,
           i.nationality AS nationality,
           p.number AS passport_number
    FROM applicants a
    LEFT JOIN applicant_identity i ON i.applicant_id = a.id
    LEFT JOIN applicant_passport p ON p.applicant_id = a.id
    ${term.length > 0
      ? `WHERE a.display_name LIKE ? COLLATE NOCASE
           OR i.surname LIKE ? COLLATE NOCASE
           OR i.given_names LIKE ? COLLATE NOCASE
           OR i.nationality LIKE ? COLLATE NOCASE
           OR p.number LIKE ? COLLATE NOCASE
           OR EXISTS (SELECT 1 FROM applicant_contact c
                      WHERE c.applicant_id = a.id AND c.email LIKE ? COLLATE NOCASE)`
      : ''}
    ORDER BY a.updated_at DESC, a.id DESC`;
  const args = term.length > 0 ? [like, like, like, like, like, like] : [];
  const rows = db.prepare(sql).all(...args) as Record<string, unknown>[];

  return rows.map((r) => {
    const id = r.id as string;
    const detail = getApplicantDetail(db, id)!;
    const num = (r.passport_number as string) ?? null;
    return {
      id,
      displayName: r.display_name as string,
      status: r.status as ApplicantStatus,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      nationality: (r.nationality as string) ?? null,
      passportNumberLast4: num && num.length >= 4 ? num.slice(-4) : null,
      completeness: { overall: detail.completeness.overall },
      verification: { label: detail.verification.label },
    };
  });
}
