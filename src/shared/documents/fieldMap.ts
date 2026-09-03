/**
 * Single source of truth for "what a passport can fill". Every target is an
 * existing Phase 2 applicant `field_path` and satisfies `isValidFieldPath`
 * (asserted in `test/shared/documents/fieldMap.test.ts`). Per design §9.
 *
 * Pure module — types only, no runtime imports. `mapMrzResult` (MRZ →
 * normalized + scored `ExtractedField[]`) is deferred to Task 7: it needs
 * `confidence.ts`.
 */

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

export type OcrFieldKey = 'placeOfIssue' | 'issueDate' | 'fullName';

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
  fullName: { fieldPath: 'identity.fullNameAsInPassport', section: 'identity' },
} as const;
