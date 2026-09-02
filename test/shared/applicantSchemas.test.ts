import { describe, expect, it } from 'vitest';
import {
  FIELD_SOURCES,
  OCR_SOURCES,
  isFieldSource,
  isOcrSource,
  isValidFieldPath,
  PROFILE_SECTIONS,
} from '../../src/shared/applicant/fieldPaths.js';

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
