import { describe, expect, it } from 'vitest';
import { parseTd3 } from '../../../src/shared/mrz/td3.js';
import { mapMrzResult } from '../../../src/shared/documents/fieldMap.js';
import { ICAO_SPECIMEN, buildTd3 } from '../../helpers/mrzFixtures.js';

describe('mapMrzResult — ICAO specimen', () => {
  const fields = mapMrzResult(parseTd3(ICAO_SPECIMEN.line1, ICAO_SPECIMEN.line2));

  it('maps passport.number from the MRZ with a check-digit score', () => {
    const num = fields.find((f) => f.fieldPath === 'passport.number');
    expect(num).toBeDefined();
    expect(num?.source).toBe('passport_mrz');
    expect(num?.confidence).toBe(0.99);
    expect(num?.checkDigitOk).toBe(true);
    expect(num?.value).toBe('L898902C3');
    expect(num?.normalizationNote).toBeNull();
  });

  it('scores a no-own-check-digit field (surname) from the composite', () => {
    const surname = fields.find((f) => f.fieldPath === 'identity.surname');
    expect(surname?.value).toBe('ERIKSSON');
    expect(surname?.confidence).toBe(0.95);
    expect(surname?.checkDigitOk).toBeNull();
  });

  it('normalizes dates and country codes', () => {
    expect(fields.find((f) => f.fieldPath === 'identity.dateOfBirth')?.value).toBe('1974-08-12');
    expect(fields.find((f) => f.fieldPath === 'identity.sex')?.value).toBe('F');
  });
});

describe('mapMrzResult — unresolvable date', () => {
  const built = buildTd3({
    surname: 'Doe',
    givenNames: 'John',
    documentNumber: 'AB123456',
    dateOfBirth: '999999',
    sex: 'M',
    expiryDate: '300101',
  });
  const fields = mapMrzResult(parseTd3(built.line1, built.line2));

  it('keeps a bad date field with a null value + note + halved confidence', () => {
    const dob = fields.find((f) => f.fieldPath === 'identity.dateOfBirth');
    expect(dob).toBeDefined();
    expect(dob?.value).toBeNull();
    expect(dob?.raw).toBe('999999');
    expect(dob?.normalizationNote).toBe('MRZ date did not resolve to a real calendar date');
    expect(dob?.confidence).toBeCloseTo(0.495);
  });
});
