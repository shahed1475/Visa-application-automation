import { describe, expect, it } from 'vitest';
import { parseTd3 } from '../../../src/shared/mrz/td3.js';
import { ICAO_SPECIMEN, buildTd3 } from '../../helpers/mrzFixtures.js';

describe('parseTd3 — ICAO specimen', () => {
  const r = parseTd3(ICAO_SPECIMEN.line1, ICAO_SPECIMEN.line2);
  it('splits the header', () => {
    expect(r.documentCode).toBe('P');
    expect(r.issuingState).toBe('UTO');
    expect(r.surname).toBe('ERIKSSON');
    expect(r.givenNames).toBe('ANNA MARIA');
  });
  it('reads line 2 fields with their raw values', () => {
    expect(r.documentNumber.raw).toBe('L898902C3');
    expect(r.nationality).toBe('UTO');
    expect(r.dateOfBirth.raw).toBe('740812');
    expect(r.sex).toBe('F');
    expect(r.expiryDate.raw).toBe('120415');
  });
  it('validates every check digit and the composite', () => {
    expect(r.documentNumber.checkDigit?.ok).toBe(true);
    expect(r.dateOfBirth.checkDigit?.ok).toBe(true);
    expect(r.expiryDate.checkDigit?.ok).toBe(true);
    expect(r.composite.ok).toBe(true);
    expect(r.overallValid).toBe(true);
  });
});

describe('parseTd3 — synthetic BGD specimen', () => {
  const built = buildTd3({
    surname: 'RAHMAN', givenNames: 'ABDUL KARIM',
    documentNumber: 'A01234567', dateOfBirth: '900115', sex: 'M', expiryDate: '300114',
  });
  const r = parseTd3(built.line1, built.line2);
  it('round-trips a valid MRZ', () => {
    expect(r.issuingState).toBe('BGD');
    expect(r.nationality).toBe('BGD');
    expect(r.surname).toBe('RAHMAN');
    expect(r.givenNames).toBe('ABDUL KARIM');
    expect(r.documentNumber.raw).toBe('A01234567');
    expect(r.overallValid).toBe(true);
  });
});

describe('parseTd3 — corrupted', () => {
  it('flags a bad document-number check digit but still returns the field', () => {
    const bad = ICAO_SPECIMEN.line2.slice(0, 9) + '9' + ICAO_SPECIMEN.line2.slice(10);
    const r = parseTd3(ICAO_SPECIMEN.line1, bad);
    expect(r.documentNumber.raw).toBe('L898902C3');
    expect(r.documentNumber.checkDigit?.ok).toBe(false);
    expect(r.overallValid).toBe(false);
  });
  it('handles a truncated / short line 2 without throwing', () => {
    const r = parseTd3(ICAO_SPECIMEN.line1, 'L898902C36UTO7408122F');
    expect(r.documentNumber.raw).toBe('L898902C3');
    expect(r.overallValid).toBe(false);
  });
});
