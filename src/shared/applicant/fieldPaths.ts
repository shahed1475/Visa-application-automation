import type { FieldSource } from './types.js';

export const FIELD_SOURCES = [
  'manual',
  'imported',
  'system',
  'passport_mrz',
  'passport_ocr',
  'document_ocr',
] as const satisfies readonly FieldSource[];

export const OCR_SOURCES = ['passport_mrz', 'passport_ocr', 'document_ocr'] as const;

export function isFieldSource(v: unknown): v is FieldSource {
  return typeof v === 'string' && (FIELD_SOURCES as readonly string[]).includes(v);
}

export function isOcrSource(v: string): boolean {
  return (OCR_SOURCES as readonly string[]).includes(v);
}

// Segments must start lowercase (so `Identity.Surname` is still rejected) but may
// carry camelCase after that — every producer emits camelCase keys straight from
// SECTION_TABLES (`identity.givenNames`, `passport.expiryDate`, …).
const SEGMENT = /^[a-z][a-zA-Z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dot-separated; each segment is a lowercase-initial identifier
 * (`[a-z][a-zA-Z0-9_]*`) or a UUID (list-item id). Max 200 chars.
 */
export function isValidFieldPath(p: string): boolean {
  if (p.length === 0 || p.length > 200) return false;
  const segs = p.split('.');
  return segs.every((seg) => SEGMENT.test(seg) || UUID.test(seg));
}

/**
 * Fields that count toward "complete" for each 1:1 section. camelCase — matches
 * the ApplicantDetail shape that computeCompleteness reads. Phase 3 may extend.
 */
export const PROFILE_SECTIONS = {
  identity: ['surname', 'givenNames', 'dateOfBirth', 'sex', 'placeOfBirth', 'nationality'],
  passport: ['documentType', 'number', 'issuingState', 'issueDate', 'expiryDate'],
  contact: ['email', 'phone'],
  address: ['line1', 'city', 'country'],
  family: ['fatherName', 'motherName', 'maritalStatus'],
  occupation: ['occupation'],
} as const satisfies Record<string, readonly string[]>;

/**
 * The authoritative "real applicant field path" allow-list — every
 * `<section>.<camelField>` path across the 1:1 sections (identity, passport,
 * contact, address, family, occupation). Deliberately excludes `travel` /
 * `references`, which are list items keyed by UUID, not static paths.
 *
 * Hand-maintained rather than derived from the server-side SECTION_TABLES map
 * (this module is shared/isomorphic and must not import server code) or from
 * the Zod schemas' shapes (adds a runtime dependency for what is, in effect, a
 * fixed catalog). Used by the visa-kb loader's `appliesTo` cross-check and by
 * the eligibility/form engine.
 */
export const PROFILE_FIELD_PATHS: ReadonlySet<string> = new Set([
  'identity.surname',
  'identity.givenNames',
  'identity.fullNameAsInPassport',
  'identity.dateOfBirth',
  'identity.sex',
  'identity.placeOfBirth',
  'identity.nationality',
  'identity.otherNationalities',
  'identity.religion',
  'identity.education',
  'identity.nationalId',
  'identity.visibleMarks',
  'identity.nationalityAtBirth',
  'passport.documentType',
  'passport.number',
  'passport.issuingState',
  'passport.issueDate',
  'passport.expiryDate',
  'passport.placeOfIssue',
  'passport.issuingAuthority',
  'contact.email',
  'contact.phone',
  'contact.altPhone',
  'address.line1',
  'address.line2',
  'address.city',
  'address.region',
  'address.postalCode',
  'address.country',
  'family.fatherName',
  'family.fatherNationality',
  'family.fatherPrevNationality',
  'family.fatherPlaceOfBirth',
  'family.motherName',
  'family.motherNationality',
  'family.motherPrevNationality',
  'family.motherPlaceOfBirth',
  'family.maritalStatus',
  'family.spouseName',
  'family.spouseNationality',
  'family.spousePrevNationality',
  'family.spousePlaceOfBirth',
  'family.pakistanAncestry',
  'occupation.occupation',
  'occupation.employerName',
  'occupation.employerAddress',
  'occupation.designation',
  'occupation.militaryPolice',
]);
