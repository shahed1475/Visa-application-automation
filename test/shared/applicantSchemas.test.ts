import { describe, expect, it } from 'vitest';
import {
  FIELD_SOURCES,
  OCR_SOURCES,
  isFieldSource,
  isOcrSource,
  isValidFieldPath,
  PROFILE_SECTIONS,
} from '../../src/shared/applicant/fieldPaths.js';
import {
  identitySchema, passportSchema, contactSchema, addressSchema,
  travelSchema, referenceSchema, fieldMetaInputSchema,
  applicantCreateSchema, applicantPutSchema,
} from '../../src/shared/applicant/schemas.js';

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
});

describe('PROFILE_SECTIONS', () => {
  it('lists counting fields for each 1:1 section', () => {
    expect(PROFILE_SECTIONS.identity).toContain('surname');
    expect(PROFILE_SECTIONS.passport).toContain('number');
    expect(PROFILE_SECTIONS.contact).toContain('email');
    expect(PROFILE_SECTIONS.address).toContain('city');
    for (const k of ['identity', 'passport', 'contact', 'address'] as const) {
      expect(PROFILE_SECTIONS[k].length).toBeGreaterThan(0);
    }
  });
});

describe('section schemas', () => {
  it('identity: accepts all-null / omitted', () => {
    expect(identitySchema.parse({}).surname).toBeNull();
    expect(identitySchema.parse({ surname: null }).surname).toBeNull();
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
  it('passport: valid dates ok, garbage rejected', () => {
    expect(passportSchema.safeParse({ issueDate: '2020-01-01', expiryDate: '2030-01-01' }).success).toBe(true);
    expect(passportSchema.safeParse({ expiryDate: 'soon' }).success).toBe(false);
  });
  it('contact: lenient email when present, null ok', () => {
    expect(contactSchema.safeParse({ email: null }).success).toBe(true);
    expect(contactSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(contactSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
  });
  it('address: all optional', () => {
    expect(addressSchema.parse({ city: 'Dhaka' }).city).toBe('Dhaka');
    expect(addressSchema.parse({}).line1).toBeNull();
  });
});

describe('travelSchema / referenceSchema', () => {
  it('travel: everything optional', () => {
    expect(travelSchema.parse({}).purpose).toBeNull();
    expect(travelSchema.parse({ arrivalDate: '2026-05-01' }).arrivalDate).toBe('2026-05-01');
    expect(travelSchema.safeParse({ arrivalDate: 'May' }).success).toBe(false);
  });
  it('reference: kind defaults to other, enum enforced', () => {
    expect(referenceSchema.parse({}).kind).toBe('other');
    expect(referenceSchema.parse({ kind: 'employer' }).kind).toBe('employer');
    expect(referenceSchema.safeParse({ kind: 'friend' }).success).toBe(false);
  });
});

describe('fieldMetaInputSchema', () => {
  it('defaults source to manual, accepts OCR sources', () => {
    expect(fieldMetaInputSchema.parse({ fieldPath: 'identity.surname' }).source).toBe('manual');
    expect(fieldMetaInputSchema.parse({ fieldPath: 'passport.number', source: 'passport_mrz', confidence: 0.98 }).confidence).toBe(0.98);
  });
  it('rejects unknown source, bad path, and confidence on a non-OCR source', () => {
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'identity.surname', source: 'guess' }).success).toBe(false);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'Bad Path' }).success).toBe(false);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'identity.surname', source: 'manual', confidence: 0.5 }).success).toBe(false);
  });
  it('confidence must be within [0,1] for OCR sources', () => {
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'x.y', source: 'passport_ocr', confidence: 1.5 }).success).toBe(false);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'x.y', source: 'passport_ocr', confidence: null }).success).toBe(true);
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
  it('put: every key optional, status enum enforced', () => {
    expect(applicantPutSchema.parse({}).displayName).toBeUndefined();
    expect(applicantPutSchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(applicantPutSchema.safeParse({ status: 'archived' }).success).toBe(true);
  });
});
