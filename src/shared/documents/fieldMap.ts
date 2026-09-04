/**
 * Single source of truth for "what a passport can fill". Every target is an
 * existing Phase 2 applicant `field_path` and satisfies `isValidFieldPath`
 * (asserted in `test/shared/documents/fieldMap.test.ts`). Per design §9.
 *
 * Pure module — no Node/browser/npm surface. `mapMrzResult` runs a validated
 * TD3 result through `../mrz` normalization and `./confidence` scoring.
 */

import type { Td3Result } from '../mrz/types.js';
import {
  normalizeCountry,
  normalizeDocNumber,
  normalizeMrzDate,
  normalizeSex,
} from '../mrz/normalize.js';
import { penalizeUnnormalized, scoreMrzField } from './confidence.js';
import type { ExtractedField } from './types.js';

export type MrzFieldKey =
  | 'documentType'
  | 'documentNumber'
  | 'issuingState'
  | 'expiryDate'
  | 'surname'
  | 'givenNames'
  | 'nationality'
  | 'dateOfBirth'
  | 'sex';

export type OcrFieldKey = 'placeOfIssue' | 'issueDate';

export interface FieldTarget {
  fieldPath: string;
  section: 'identity' | 'passport';
}

export const MRZ_FIELD_MAP: Readonly<Record<MrzFieldKey, FieldTarget>> = {
  documentType: { fieldPath: 'passport.documentType', section: 'passport' },
  documentNumber: { fieldPath: 'passport.number', section: 'passport' },
  issuingState: { fieldPath: 'passport.issuingState', section: 'passport' },
  expiryDate: { fieldPath: 'passport.expiryDate', section: 'passport' },
  surname: { fieldPath: 'identity.surname', section: 'identity' },
  givenNames: { fieldPath: 'identity.givenNames', section: 'identity' },
  nationality: { fieldPath: 'identity.nationality', section: 'identity' },
  dateOfBirth: { fieldPath: 'identity.dateOfBirth', section: 'identity' },
  sex: { fieldPath: 'identity.sex', section: 'identity' },
} as const;

export const OCR_FIELD_MAP: Readonly<Record<OcrFieldKey, FieldTarget>> = {
  placeOfIssue: { fieldPath: 'passport.placeOfIssue', section: 'passport' },
  issueDate: { fieldPath: 'passport.issueDate', section: 'passport' },
} as const;

/** Keys that carry their own ICAO 9303 check digit in a TD3 MRZ. */
const OWN_CHECK_DIGIT_KEYS: ReadonlySet<MrzFieldKey> = new Set([
  'documentNumber',
  'dateOfBirth',
  'expiryDate',
]);

/** Keys whose normalized value may legitimately be `null` (unresolvable date). */
const DATE_KEYS: ReadonlySet<MrzFieldKey> = new Set(['dateOfBirth', 'expiryDate']);

const DATE_NOTE = 'MRZ date did not resolve to a real calendar date';

const emptyToNull = (s: string): string | null => (s === '' ? null : s);

/**
 * Map a parsed (and check-digit-verified) TD3 result to `ExtractedField[]`.
 *
 * One field per `MrzFieldKey`: the raw MRZ substring is normalized per key,
 * scored via {@link scoreMrzField} (own check digit for doc-number / DOB /
 * expiry, otherwise the composite check as the sibling signal), and tagged
 * `source: 'passport_mrz'`.
 *
 * Drop rule: a field whose normalized value is `null` is skipped entirely
 * (an empty name / doc number), EXCEPT the two dates — an unresolvable date is
 * kept with `value: null`, the raw preserved, a `normalizationNote`, and a
 * halved confidence, so the reviewer still sees that the MRZ carried a date
 * that could not be trusted.
 */
export function mapMrzResult(r: Td3Result, ref?: Date): ExtractedField[] {
  const out: ExtractedField[] = [];

  for (const key of Object.keys(MRZ_FIELD_MAP) as MrzFieldKey[]) {
    let raw: string;
    let value: string | null;
    let checkDigitOk: boolean | null = null;

    switch (key) {
      case 'documentType':
        raw = r.documentCode;
        value = emptyToNull(raw.trim());
        break;
      case 'documentNumber':
        raw = r.documentNumber.raw;
        checkDigitOk = r.documentNumber.checkDigit?.ok ?? null;
        value = emptyToNull(normalizeDocNumber(raw));
        break;
      case 'issuingState':
        raw = r.issuingState;
        value = emptyToNull(normalizeCountry(raw));
        break;
      case 'expiryDate':
        raw = r.expiryDate.raw;
        checkDigitOk = r.expiryDate.checkDigit?.ok ?? null;
        value = normalizeMrzDate(raw, 'expiry', ref);
        break;
      case 'surname':
        raw = r.surname;
        value = emptyToNull(raw.trim());
        break;
      case 'givenNames':
        raw = r.givenNames;
        value = emptyToNull(raw.trim());
        break;
      case 'nationality':
        raw = r.nationality;
        value = emptyToNull(normalizeCountry(raw));
        break;
      case 'dateOfBirth':
        raw = r.dateOfBirth.raw;
        checkDigitOk = r.dateOfBirth.checkDigit?.ok ?? null;
        value = normalizeMrzDate(raw, 'birth', ref);
        break;
      case 'sex':
        raw = r.sex;
        value = normalizeSex(raw);
        break;
    }

    const score = scoreMrzField({
      hasOwnCheckDigit: OWN_CHECK_DIGIT_KEYS.has(key),
      ownCheckOk: checkDigitOk,
      siblingChecksOk: r.composite.ok,
    });

    if (value === null && !DATE_KEYS.has(key)) continue;

    const unresolved = value === null;
    out.push({
      fieldPath: MRZ_FIELD_MAP[key].fieldPath,
      value,
      raw: emptyToNull(raw),
      source: 'passport_mrz',
      confidence: unresolved ? penalizeUnnormalized(score) : score,
      checkDigitOk,
      normalizationNote: unresolved ? DATE_NOTE : null,
    });
  }

  return out;
}
