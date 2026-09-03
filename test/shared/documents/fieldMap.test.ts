import { describe, expect, it } from 'vitest';
import { MRZ_FIELD_MAP, OCR_FIELD_MAP } from '../../../src/shared/documents/fieldMap.js';
import { isValidFieldPath } from '../../../src/shared/applicant/fieldPaths.js';

describe('field maps', () => {
  it('every MRZ target is a valid applicant field path', () => {
    for (const t of Object.values(MRZ_FIELD_MAP)) expect(isValidFieldPath(t.fieldPath)).toBe(true);
  });
  it('maps the expected MRZ keys', () => {
    expect(MRZ_FIELD_MAP.documentNumber.fieldPath).toBe('passport.number');
    expect(MRZ_FIELD_MAP.dateOfBirth.fieldPath).toBe('identity.dateOfBirth');
    expect(MRZ_FIELD_MAP.sex.section).toBe('identity');
  });
  it('OCR-only keys map into passport/identity', () => {
    expect(OCR_FIELD_MAP.issueDate.fieldPath).toBe('passport.issueDate');
    expect(OCR_FIELD_MAP.fullName.fieldPath).toBe('identity.fullNameAsInPassport');
  });
});
