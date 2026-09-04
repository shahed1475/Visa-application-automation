import { describe, expect, it } from 'vitest';
import { normalizeMrzDate, normalizeSex, normalizeCountry, normalizeDocNumber } from '../../../src/shared/mrz/normalize.js';

const REF = new Date('2026-09-04T00:00:00Z');

describe('normalizeMrzDate', () => {
  it('birth date in the plausible past', () => {
    expect(normalizeMrzDate('900115', 'birth', REF)).toBe('1990-01-15');
    expect(normalizeMrzDate('010101', 'birth', REF)).toBe('2001-01-01');
  });
  it('a 2-digit birth year that would be in the future rolls back a century', () => {
    expect(normalizeMrzDate('271231', 'birth', REF)).toBe('1927-12-31');
  });
  it('expiry date within the forward window', () => {
    expect(normalizeMrzDate('300114', 'expiry', REF)).toBe('2030-01-14');
  });
  it('rejects an impossible calendar date', () => {
    expect(normalizeMrzDate('900230', 'birth', REF)).toBeNull();
    expect(normalizeMrzDate('901301', 'birth', REF)).toBeNull();
    expect(normalizeMrzDate('<<<<<<', 'birth', REF)).toBeNull();
  });
});

describe('normalizeSex', () => {
  it('maps the MRZ codes', () => {
    expect(normalizeSex('M')).toBe('M');
    expect(normalizeSex('F')).toBe('F');
    expect(normalizeSex('<')).toBe('X');
    expect(normalizeSex('')).toBe('X');
  });
});

describe('normalizeCountry', () => {
  it('names the ones we know', () => {
    expect(normalizeCountry('BGD')).toBe('Bangladesh');
    expect(normalizeCountry('IND')).toBe('India');
  });
  it('passes an unknown code straight through — never guesses', () => {
    expect(normalizeCountry('UTO')).toBe('UTO');
    expect(normalizeCountry('D')).toBe('D');
  });
});

describe('normalizeDocNumber', () => {
  it('trims filler and uppercases', () => {
    expect(normalizeDocNumber('a012345<<')).toBe('A012345');
  });
});
