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
} as const satisfies Record<string, readonly string[]>;
