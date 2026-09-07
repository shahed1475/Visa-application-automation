import { describe, expect, it } from 'vitest';
import {
  FIELD_SOURCES,
  OCR_SOURCES,
  isFieldSource,
  isOcrSource,
  isValidFieldPath,
  PROFILE_SECTIONS,
  PROFILE_FIELD_PATHS,
} from '../../src/shared/applicant/fieldPaths.js';
import {
  identitySchema, passportSchema, contactSchema, addressSchema,
  familySchema, occupationSchema,
  travelSchema, referenceSchema, fieldMetaInputSchema,
  applicantCreateSchema, applicantPutSchema,
} from '../../src/shared/applicant/schemas.js';
import { SECTION_TABLES } from '../../src/server/services/applicantColumns.js';

describe('field sources', () => {
  it('includes the Phase 2 sources and the Phase 3 OCR sources', () => {
    expect([...FIELD_SOURCES]).toEqual(
      expect.arrayContaining(['manual', 'imported', 'system', 'passport_mrz', 'passport_ocr', 'document_ocr']),
    );
  });
  it('isFieldSource accepts known, rejects unknown / non-strings', () => {
    expect(isFieldSource('manual')).toBe(true);
    expect(isFieldSource('passport_ocr')).toBe(true);
    expect(isFieldSource('nope')).toBe(false);
    expect(isFieldSource(42)).toBe(false);
    expect(isFieldSource(undefined)).toBe(false);
  });
  it('isOcrSource is true only for the OCR set', () => {
    expect(OCR_SOURCES.every(isOcrSource)).toBe(true);
    expect(isOcrSource('manual')).toBe(false);
  });
});

describe('isValidFieldPath', () => {
  it('accepts simple and list paths', () => {
    expect(isValidFieldPath('identity.surname')).toBe(true);
    expect(isValidFieldPath('passport.number')).toBe(true);
    expect(isValidFieldPath('travel.3f1c2b7a-9d4e-4a1b-8c2d-0e1f2a3b4c5d.arrival_date')).toBe(true);
  });
  it('rejects empty, spaces, uppercase, leading/trailing dots, over-long', () => {
    expect(isValidFieldPath('')).toBe(false);
    expect(isValidFieldPath('identity .surname')).toBe(false);
    expect(isValidFieldPath('Identity.Surname')).toBe(false);
    expect(isValidFieldPath('identity.')).toBe(false);
    expect(isValidFieldPath('.identity')).toBe(false);
    expect(isValidFieldPath('a.'.repeat(120))).toBe(false);
  });

  it('accepts every real `<section>.<field>` path the producers emit', () => {
    // SectionCard / applicantCompleteness / the updateApplicant reconciliation all
    // build `${sectionKey}.${camelCaseColumnKey}` — every one must validate.
    const seen: string[] = [];
    for (const [section, def] of Object.entries(SECTION_TABLES)) {
      for (const field of Object.keys(def.cols)) {
        const path = `${section}.${field}`;
        seen.push(path);
        expect(isValidFieldPath(path), `${path} should be a valid field path`).toBe(true);
      }
    }
    // Guards against the map silently shrinking: 13 + 7 + 3 + 6 + 14 + 5 columns
    // (identity carries 5 more since Task 5: religion/education/nationalId/
    // visibleMarks/nationalityAtBirth).
    expect(seen).toHaveLength(48);
    expect(seen).toContain('identity.givenNames');
    expect(seen).toContain('passport.expiryDate');
    expect(seen).toContain('address.postalCode');
  });

  it('accepts child-row paths for both snake_case and camelCase leaf fields', () => {
    const uuid = '3f1c2b7a-9d4e-4a1b-8c2d-0e1f2a3b4c5d';
    expect(isValidFieldPath(`travel.${uuid}.arrival_date`)).toBe(true);
    expect(isValidFieldPath(`travel.${uuid}.arrivalDate`)).toBe(true);
    expect(isValidFieldPath(`references.${uuid}.organization`)).toBe(true);
    expect(isValidFieldPath(`references.${uuid}.emailAddress`)).toBe(true);
  });
});

describe('PROFILE_SECTIONS', () => {
  it('lists counting fields for each 1:1 section', () => {
    expect(PROFILE_SECTIONS.identity).toContain('surname');
    expect(PROFILE_SECTIONS.passport).toContain('number');
    expect(PROFILE_SECTIONS.contact).toContain('email');
    expect(PROFILE_SECTIONS.address).toContain('city');
    expect(PROFILE_SECTIONS.family).toEqual(['fatherName', 'motherName', 'maritalStatus']);
    expect(PROFILE_SECTIONS.occupation).toEqual(['occupation']);
    for (const k of ['identity', 'passport', 'contact', 'address', 'family', 'occupation'] as const) {
      expect(PROFILE_SECTIONS[k].length).toBeGreaterThan(0);
    }
  });
});

describe('PROFILE_FIELD_PATHS', () => {
  it('is the authoritative real-applicant-path allow-list: 48 entries covering every 1:1 section', () => {
    expect(PROFILE_FIELD_PATHS.size).toBe(48);
    expect(PROFILE_FIELD_PATHS.has('identity.religion')).toBe(true);
    expect(PROFILE_FIELD_PATHS.has('identity.nationalityAtBirth')).toBe(true);
    expect(PROFILE_FIELD_PATHS.has('family.fatherName')).toBe(true);
    expect(PROFILE_FIELD_PATHS.has('family.pakistanAncestry')).toBe(true);
    expect(PROFILE_FIELD_PATHS.has('occupation.militaryPolice')).toBe(true);
    // deliberately excludes travel/references — list items keyed by UUID
    expect(PROFILE_FIELD_PATHS.has('travel.arrivalDate')).toBe(false);
    expect(PROFILE_FIELD_PATHS.has('references.name')).toBe(false);
    // and rejects a well-formed but non-real path
    expect(PROFILE_FIELD_PATHS.has('family.bogusField')).toBe(false);
  });
});

describe('section schemas', () => {
  it('identity: an omitted key stays absent, an explicit null clears', () => {
    // A section body is a TRUE partial patch: absent must be distinguishable from
    // "clear me", or writeSection would null every sibling field.
    expect(identitySchema.parse({})).toEqual({});
    expect('surname' in identitySchema.parse({})).toBe(false);
    expect(identitySchema.parse({ surname: null }).surname).toBeNull();
    expect(identitySchema.parse({ surname: 'Khan' })).toEqual({ surname: 'Khan' });
    // sex is an enum rather than an nstr — same rule
    expect(identitySchema.parse({})).not.toHaveProperty('sex');
    expect(identitySchema.parse({ sex: null }).sex).toBeNull();
    expect(identitySchema.parse({ sex: 'F' }).sex).toBe('F');
  });
  it('identity: trims blank strings to null', () => {
    expect(identitySchema.parse({ surname: '  ' }).surname).toBeNull();
    expect(identitySchema.parse({ surname: '  Khan ' }).surname).toBe('Khan');
  });
  it('identity: rejects a bad sex and a bad date', () => {
    expect(identitySchema.safeParse({ sex: 'Q' }).success).toBe(false);
    expect(identitySchema.safeParse({ dateOfBirth: '01/02/2000' }).success).toBe(false);
    expect(identitySchema.safeParse({ dateOfBirth: '2000-02-01' }).success).toBe(true);
  });
  it('identity: accepts the 5 new fields, blank -> null, omitted -> absent', () => {
    const parsed = identitySchema.parse({
      religion: 'Islam',
      education: 'BSc',
      nationalId: '1234567890',
      visibleMarks: 'Scar on left hand',
      nationalityAtBirth: 'Bangladeshi',
    });
    expect(parsed).toEqual({
      religion: 'Islam',
      education: 'BSc',
      nationalId: '1234567890',
      visibleMarks: 'Scar on left hand',
      nationalityAtBirth: 'Bangladeshi',
    });
    expect(identitySchema.parse({ religion: '  ' }).religion).toBeNull();
    expect(identitySchema.parse({})).not.toHaveProperty('nationalId');
    expect(identitySchema.parse({ nationalityAtBirth: null }).nationalityAtBirth).toBeNull();
  });
  it('passport: valid dates ok, garbage rejected', () => {
    expect(passportSchema.safeParse({ issueDate: '2020-01-01', expiryDate: '2030-01-01' }).success).toBe(true);
    expect(passportSchema.safeParse({ expiryDate: 'soon' }).success).toBe(false);
  });
  it('contact: lenient email when present, null ok', () => {
    expect(contactSchema.safeParse({ email: null }).success).toBe(true);
    expect(contactSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(contactSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
  });
  it('address: all optional; only the sent key comes back', () => {
    expect(addressSchema.parse({ city: 'Dhaka' })).toEqual({ city: 'Dhaka' });
    expect(addressSchema.parse({})).toEqual({});
  });
  it('rejects an impossible calendar date that matches the YYYY-MM-DD shape', () => {
    expect(identitySchema.safeParse({ dateOfBirth: '2026-02-31' }).success).toBe(false);
    expect(passportSchema.safeParse({ expiryDate: '2026-13-01' }).success).toBe(false);
    expect(passportSchema.safeParse({ expiryDate: '2026-00-10' }).success).toBe(false);
    expect(travelSchema.safeParse({ arrivalDate: '2025-02-29' }).success).toBe(false);
    // real dates, including a genuine leap day, still pass
    expect(identitySchema.safeParse({ dateOfBirth: '2024-02-29' }).success).toBe(true);
    expect(passportSchema.safeParse({ expiryDate: '2026-02-28' }).success).toBe(true);
  });
});

describe('familySchema / occupationSchema', () => {
  it('family: accepts valid input; omitted keys absent, blank -> null', () => {
    expect(familySchema.parse({})).toEqual({});
    expect(familySchema.parse({ fatherName: '  ' }).fatherName).toBeNull();
    expect(familySchema.parse({ fatherName: 'Karim', maritalStatus: 'married', pakistanAncestry: 'no' })).toEqual({
      fatherName: 'Karim',
      maritalStatus: 'married',
      pakistanAncestry: 'no',
    });
  });
  it('family: enum fields accept null and reject unknown values', () => {
    expect(familySchema.parse({ maritalStatus: null }).maritalStatus).toBeNull();
    expect(familySchema.safeParse({ maritalStatus: 'engaged' }).success).toBe(false);
    expect(familySchema.parse({ pakistanAncestry: null }).pakistanAncestry).toBeNull();
    expect(familySchema.safeParse({ pakistanAncestry: 'maybe' }).success).toBe(false);
  });
  it('occupation: accepts valid input; enum enforced', () => {
    expect(occupationSchema.parse({})).toEqual({});
    expect(occupationSchema.parse({ occupation: 'Engineer', militaryPolice: 'no' })).toEqual({
      occupation: 'Engineer',
      militaryPolice: 'no',
    });
    expect(occupationSchema.safeParse({ militaryPolice: 'sometimes' }).success).toBe(false);
    expect(occupationSchema.parse({ employerName: '  ' }).employerName).toBeNull();
  });
});

describe('travelSchema / referenceSchema', () => {
  it('travel: everything optional; omitted keys stay absent', () => {
    expect(travelSchema.parse({})).toEqual({});
    expect(travelSchema.parse({ arrivalDate: '2026-05-01' })).toEqual({ arrivalDate: '2026-05-01' });
    expect(travelSchema.parse({ purpose: '' }).purpose).toBeNull();
    expect(travelSchema.safeParse({ arrivalDate: 'May' }).success).toBe(false);
  });
  it('reference: kind defaults to other, enum enforced', () => {
    expect(referenceSchema.parse({}).kind).toBe('other');
    expect(referenceSchema.parse({ kind: 'employer' }).kind).toBe('employer');
    expect(referenceSchema.safeParse({ kind: 'friend' }).success).toBe(false);
  });
});

describe('fieldMetaInputSchema', () => {
  it('leaves an omitted source undefined (the service supplies the manual default)', () => {
    // Deliberately NOT `.default('manual')` — an omitted source must stay absent so
    // upsertFieldMeta can keep an existing row's provenance on a verify-only write.
    expect(fieldMetaInputSchema.parse({ fieldPath: 'identity.surname' }).source).toBeUndefined();
    expect(fieldMetaInputSchema.parse({ fieldPath: 'identity.surname', source: 'manual' }).source).toBe('manual');
    expect(fieldMetaInputSchema.parse({ fieldPath: 'passport.number', source: 'passport_mrz', confidence: 0.98 }).confidence).toBe(0.98);
  });
  it('rejects unknown source, bad path, and confidence without an explicit OCR source', () => {
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'identity.surname', source: 'guess' }).success).toBe(false);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'Bad Path' }).success).toBe(false);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'identity.surname', source: 'manual', confidence: 0.5 }).success).toBe(false);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'identity.surname', confidence: 0.5 }).success).toBe(false);
  });
  it('confidence must be within [0,1] for OCR sources', () => {
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'x.y', source: 'passport_ocr', confidence: 1.5 }).success).toBe(false);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'x.y', source: 'passport_ocr', confidence: null }).success).toBe(true);
  });
  it('rejects an OCR write that also claims verified', () => {
    const bad = fieldMetaInputSchema.safeParse({
      fieldPath: 'passport.number', source: 'passport_ocr', confidence: 0.9, verified: true,
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.some((i) => i.path.join('.') === 'verified')).toBe(true);
    // every OCR source, not just passport_ocr
    for (const source of OCR_SOURCES) {
      expect(fieldMetaInputSchema.safeParse({ fieldPath: 'x.y', source, verified: true }).success).toBe(false);
    }
    // verified:false with an OCR source is fine, and so is confirming separately
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'x.y', source: 'passport_ocr', verified: false }).success).toBe(true);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'x.y', verified: true }).success).toBe(true);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'x.y', source: 'manual', verified: true }).success).toBe(true);
  });
});

describe('applicantCreateSchema / applicantPutSchema', () => {
  it('create: displayName required and trimmed', () => {
    expect(applicantCreateSchema.safeParse({}).success).toBe(false);
    expect(applicantCreateSchema.safeParse({ displayName: '   ' }).success).toBe(false);
    expect(applicantCreateSchema.parse({ displayName: '  Aisha  ' }).displayName).toBe('Aisha');
  });
  it('create: optional nested sections validated', () => {
    expect(applicantCreateSchema.safeParse({ displayName: 'A', identity: { sex: 'bad' } }).success).toBe(false);
    expect(applicantCreateSchema.parse({ displayName: 'A', identity: { surname: 'A' } }).identity?.surname).toBe('A');
  });
  it('create/put: accept family and occupation sections', () => {
    expect(applicantCreateSchema.safeParse({ displayName: 'A', family: { maritalStatus: 'bad' } }).success).toBe(false);
    expect(
      applicantCreateSchema.parse({ displayName: 'A', family: { fatherName: 'K' }, occupation: { occupation: 'Engineer' } })
        .family?.fatherName,
    ).toBe('K');
    expect(applicantPutSchema.safeParse({ occupation: { militaryPolice: 'bad' } }).success).toBe(false);
    expect(applicantPutSchema.parse({ family: { pakistanAncestry: 'yes' } }).family?.pakistanAncestry).toBe('yes');
  });
  it('put: every key optional, status enum enforced', () => {
    expect(applicantPutSchema.parse({}).displayName).toBeUndefined();
    expect(applicantPutSchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(applicantPutSchema.safeParse({ status: 'archived' }).success).toBe(true);
  });
});
