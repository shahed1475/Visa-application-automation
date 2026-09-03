import { describe, expect, it } from 'vitest';
import { scoreMrzField, scoreOcrField, penalizeUnnormalized } from '../../../src/shared/documents/confidence.js';

describe('scoreMrzField', () => {
  it('own check digit OK → 0.99', () =>
    expect(scoreMrzField({ hasOwnCheckDigit: true, ownCheckOk: true, siblingChecksOk: true })).toBe(0.99));
  it('own check digit FAILED → 0.55', () =>
    expect(scoreMrzField({ hasOwnCheckDigit: true, ownCheckOk: false, siblingChecksOk: true })).toBe(0.55));
  it('no own check digit, siblings OK → 0.95', () =>
    expect(scoreMrzField({ hasOwnCheckDigit: false, ownCheckOk: null, siblingChecksOk: true })).toBe(0.95));
  it('no own check digit, siblings failed → 0.60', () =>
    expect(scoreMrzField({ hasOwnCheckDigit: false, ownCheckOk: null, siblingChecksOk: false })).toBe(0.6));
});

describe('scoreOcrField', () => {
  it('anchored, mid confidence', () =>
    expect(scoreOcrField({ anchored: true, lineConfidence: 80 })).toBeCloseTo(0.35 + 0.5 * 0.8));
  it('anchored clamps at 0.75', () =>
    expect(scoreOcrField({ anchored: true, lineConfidence: 100 })).toBe(0.75));
  it('unanchored clamps at 0.15 floor', () =>
    expect(scoreOcrField({ anchored: false, lineConfidence: 0 })).toBe(0.15));
});

describe('penalizeUnnormalized', () => {
  it('halves the score', () => expect(penalizeUnnormalized(0.99)).toBeCloseTo(0.495));
});
