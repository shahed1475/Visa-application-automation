import { describe, expect, it } from 'vitest';
import { elapsedMs, estimateRemainingMs, formatDuration } from '../../../src/shared/automation/progress.js';

describe('elapsedMs', () => {
  it('calculates elapsed time from ISO string', () => {
    const startedAt = new Date('2026-09-08T10:00:00Z').toISOString();
    const nowMs = new Date('2026-09-08T10:00:05Z').getTime();
    expect(elapsedMs(startedAt, nowMs)).toBe(5000);
  });

  it('uses Date.now() when nowMs is not provided', () => {
    const now = Date.now();
    const startedAt = new Date(now - 3000).toISOString();
    const elapsed = elapsedMs(startedAt);
    expect(elapsed).toBeGreaterThanOrEqual(2900); // Allow small timing variance
    expect(elapsed).toBeLessThanOrEqual(3100);
  });

  it('clamps negative values to 0', () => {
    const futureTime = new Date(Date.now() + 5000).toISOString();
    expect(elapsedMs(futureTime, Date.now())).toBe(0);
  });
});

describe('estimateRemainingMs', () => {
  it('is null before any field is verified', () => {
    expect(estimateRemainingMs({ fieldsVerified: 0, fieldsTotal: 30, elapsedMs: 4000 })).toBeNull();
  });

  it('linear-extrapolates from the observed per-field rate', () => {
    // 10/30 in 40s -> 4s per field -> ~80s left
    expect(estimateRemainingMs({ fieldsVerified: 10, fieldsTotal: 30, elapsedMs: 40_000 })).toBe(80_000);
  });

  it('is 0 once every field is verified', () => {
    expect(estimateRemainingMs({ fieldsVerified: 30, fieldsTotal: 30, elapsedMs: 90_000 })).toBe(0);
  });

  it('is null when fieldsTotal is 0', () => {
    expect(estimateRemainingMs({ fieldsVerified: 5, fieldsTotal: 0, elapsedMs: 10_000 })).toBeNull();
  });

  it('handles partial completion with rounding', () => {
    // 1/3 in 3s -> 9s left (3/1 * 2)
    expect(estimateRemainingMs({ fieldsVerified: 1, fieldsTotal: 3, elapsedMs: 3000 })).toBe(6000);
  });
});

describe('formatDuration', () => {
  it('renders mm:ss zero-padded', () => {
    expect(formatDuration(102_000)).toBe('01:42');
    expect(formatDuration(7_000)).toBe('00:07');
  });

  it('clamps negative values to 00:00', () => {
    expect(formatDuration(-5000)).toBe('00:00');
  });

  it('clamps large values to >59:59', () => {
    expect(formatDuration(3600_000)).toBe('>59:59');
    expect(formatDuration(7200_000)).toBe('>59:59');
  });

  it('handles boundary at 59:59', () => {
    expect(formatDuration(3599_000)).toBe('59:59');
    expect(formatDuration(3599_999)).toBe('59:59');
  });
});
