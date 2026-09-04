import { describe, expect, it } from 'vitest';
import { MRZ_FIELD_MAP, OCR_FIELD_MAP } from '../../../src/shared/documents/fieldMap.js';
import { isValidFieldPath } from '../../../src/shared/applicant/fieldPaths.js';

describe('field maps', () => {
  it('every MRZ and OCR target is a valid applicant field path', () => {
    for (const t of [...Object.values(MRZ_FIELD_MAP), ...Object.values(OCR_FIELD_MAP)])
      expect(isValidFieldPath(t.fieldPath)).toBe(true);
  });

  it('MRZ_FIELD_MAP maps every key to its spec §9 target', () => {
    expect(MRZ_FIELD_MAP.documentType).toEqual({ fieldPath: 'passport.documentType', section: 'passport' });
    expect(MRZ_FIELD_MAP.documentNumber).toEqual({ fieldPath: 'passport.number', section: 'passport' });
    expect(MRZ_FIELD_MAP.issuingState).toEqual({ fieldPath: 'passport.issuingState', section: 'passport' });
    expect(MRZ_FIELD_MAP.expiryDate).toEqual({ fieldPath: 'passport.expiryDate', section: 'passport' });
    expect(MRZ_FIELD_MAP.surname).toEqual({ fieldPath: 'identity.surname', section: 'identity' });
    expect(MRZ_FIELD_MAP.givenNames).toEqual({ fieldPath: 'identity.givenNames', section: 'identity' });
    expect(MRZ_FIELD_MAP.nationality).toEqual({ fieldPath: 'identity.nationality', section: 'identity' });
    expect(MRZ_FIELD_MAP.dateOfBirth).toEqual({ fieldPath: 'identity.dateOfBirth', section: 'identity' });
    expect(MRZ_FIELD_MAP.sex).toEqual({ fieldPath: 'identity.sex', section: 'identity' });
  });

  it('OCR_FIELD_MAP maps every key to its spec §9 target', () => {
    expect(OCR_FIELD_MAP.placeOfIssue).toEqual({ fieldPath: 'passport.placeOfIssue', section: 'passport' });
    expect(OCR_FIELD_MAP.issueDate).toEqual({ fieldPath: 'passport.issueDate', section: 'passport' });
  });

  it('exposes exactly the spec §9 key sets (no added or removed keys)', () => {
    expect(Object.keys(MRZ_FIELD_MAP).sort()).toEqual(
      [
        'dateOfBirth',
        'documentNumber',
        'documentType',
        'expiryDate',
        'givenNames',
        'issuingState',
        'nationality',
        'sex',
        'surname',
      ].sort(),
    );
    expect(Object.keys(OCR_FIELD_MAP).sort()).toEqual(['issueDate', 'placeOfIssue'].sort());
  });
});
