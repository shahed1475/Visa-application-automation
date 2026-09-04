import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

/** camelCase key -> snake_case column, per 1:1 section table. */
export const SECTION_TABLES = {
  identity: {
    table: 'applicant_identity',
    cols: {
      surname: 'surname',
      givenNames: 'given_names',
      fullNameAsInPassport: 'full_name_as_in_passport',
      dateOfBirth: 'date_of_birth',
      sex: 'sex',
      placeOfBirth: 'place_of_birth',
      nationality: 'nationality',
      otherNationalities: 'other_nationalities',
    },
  },
  passport: {
    table: 'applicant_passport',
    cols: {
      documentType: 'document_type',
      number: 'number',
      issuingState: 'issuing_state',
      issueDate: 'issue_date',
      expiryDate: 'expiry_date',
      placeOfIssue: 'place_of_issue',
      issuingAuthority: 'issuing_authority',
    },
  },
  contact: {
    table: 'applicant_contact',
    cols: { email: 'email', phone: 'phone', altPhone: 'alt_phone' },
  },
  address: {
    table: 'applicant_address',
    cols: {
      line1: 'line1',
      line2: 'line2',
      city: 'city',
      region: 'region',
      postalCode: 'postal_code',
      country: 'country',
    },
  },
  family: {
    table: 'applicant_family',
    cols: {
      fatherName: 'father_name', fatherNationality: 'father_nationality',
      fatherPrevNationality: 'father_prev_nationality', fatherPlaceOfBirth: 'father_place_of_birth',
      motherName: 'mother_name', motherNationality: 'mother_nationality',
      motherPrevNationality: 'mother_prev_nationality', motherPlaceOfBirth: 'mother_place_of_birth',
      maritalStatus: 'marital_status',
      spouseName: 'spouse_name', spouseNationality: 'spouse_nationality',
      spousePrevNationality: 'spouse_prev_nationality', spousePlaceOfBirth: 'spouse_place_of_birth',
      pakistanAncestry: 'pakistan_ancestry',
    },
  },
  occupation: {
    table: 'applicant_occupation',
    cols: {
      occupation: 'occupation', employerName: 'employer_name', employerAddress: 'employer_address',
      designation: 'designation', militaryPolice: 'military_police',
    },
  },
} as const;

export type SectionName = keyof typeof SECTION_TABLES;

export function emptySection(cols: Record<string, string>): Record<string, null> {
  return Object.fromEntries(Object.keys(cols).map((k) => [k, null]));
}

export function readSection<T>(
  db: DatabaseSync,
  table: string,
  cols: Record<string, string>,
  applicantId: string,
): T {
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE applicant_id = ?`)
    .get(applicantId) as Record<string, unknown> | undefined;
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(cols)) {
    out[key] = row ? (row[col] ?? null) : null;
  }
  return out as T;
}

/**
 * UPDATE only the keys actually present in `patch`. A key whose value is
 * `undefined` counts as absent (the section schemas leave omitted keys
 * `undefined`), so a `PUT { identity: { surname: 'X' } }` touches exactly one
 * column and every sibling value — and its `applicant_field_meta` row — survives.
 * An explicit `null` still writes NULL, i.e. clears the field.
 *
 * Table names/columns come from the in-code SECTION_TABLES map (never user input)
 * so interpolation is safe.
 */
export function writeSection(
  db: DatabaseSync,
  table: string,
  cols: Record<string, string>,
  applicantId: string,
  patch: Record<string, unknown>,
): void {
  const entries = Object.entries(patch).filter(
    ([key, value]) => Object.hasOwn(cols, key) && value !== undefined,
  );
  if (entries.length === 0) return;
  const setSql = entries.map(([key]) => `${cols[key]} = ?`).join(', ');
  const values = entries.map(([, v]) => v) as SQLInputValue[];
  db.prepare(`UPDATE ${table} SET ${setSql} WHERE applicant_id = ?`).run(
    ...values,
    applicantId,
  );
}
