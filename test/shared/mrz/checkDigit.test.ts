import { describe, expect, it } from 'vitest';
import { charValue, computeCheckDigit, verifyCheckDigit } from '../../../src/shared/mrz/checkDigit.js';

describe('charValue', () => {
  it('maps digits, letters and filler', () => {
    expect(charValue('0')).toBe(0);
    expect(charValue('9')).toBe(9);
    expect(charValue('A')).toBe(10);
    expect(charValue('Z')).toBe(35);
    expect(charValue('<')).toBe(0);
  });
  it('throws on anything else', () => {
    expect(() => charValue('a')).toThrow();
    expect(() => charValue(' ')).toThrow();
  });
  it('throws on multi-char input', () => expect(() => charValue('ab')).toThrow());
});

describe('computeCheckDigit — ICAO 9303 vectors', () => {
  it('D23145890 → 7', () => expect(computeCheckDigit('D23145890')).toBe(7));
  it('740812 → 2', () => expect(computeCheckDigit('740812')).toBe(2));
  it('120415 → 9', () => expect(computeCheckDigit('120415')).toBe(9));
  it('L898902C3 → 6', () => expect(computeCheckDigit('L898902C3')).toBe(6));
  it('ZE184226B<<<<< → 1', () => expect(computeCheckDigit('ZE184226B<<<<<')).toBe(1));
  it('all-filler → 0', () => expect(computeCheckDigit('<<<<<<<<<<<<<<')).toBe(0));
});

describe('verifyCheckDigit', () => {
  it('accepts the correct digit', () => expect(verifyCheckDigit('740812', '2')).toBe(true));
  it('rejects a wrong digit', () => expect(verifyCheckDigit('740812', '3')).toBe(false));
  it('rejects a non-numeric supplied digit rather than throwing', () => {
    expect(verifyCheckDigit('740812', '<')).toBe(false);
    expect(verifyCheckDigit('740812', 'A')).toBe(false);
  });
});
