import { describe, expect, it } from 'vitest';
import { TIMING_PROFILES, resolveTimingProfile, BENCHMARK_TIMING } from '../../src/server/automation/engine/timing.js';

const KNOBS = ['navigationWaitMs','fieldInteractionDelayMs','scrollDelayMs','postFillVerifyDelayMs','retryDelayMs'] as const;

describe('timing profiles', () => {
  it('delay knobs are monotonic fast <= normal <= careful', () => {
    for (const k of KNOBS) {
      expect(TIMING_PROFILES.fast[k]).toBeLessThanOrEqual(TIMING_PROFILES.normal[k]);
      expect(TIMING_PROFILES.normal[k]).toBeLessThanOrEqual(TIMING_PROFILES.careful[k]);
    }
  });
  it('normal is the default for unknown / undefined', () => {
    expect(resolveTimingProfile(undefined)).toBe(TIMING_PROFILES.normal);
    expect(resolveTimingProfile('bogus')).toBe(TIMING_PROFILES.normal);
    expect(resolveTimingProfile('careful')).toBe(TIMING_PROFILES.careful);
  });
  it('normal profile models a sub-2-minute run for a typical prepared application', () => {
    // 7 pages, 36 required fields — representative India e-visa shape.
    const p = TIMING_PROFILES.normal;
    const perField = p.scrollDelayMs + p.fieldInteractionDelayMs + p.postFillVerifyDelayMs;
    const modeled = 5_000 /* browser open */
      + 36 * perField
      + 7 * (p.navigationWaitMs + p.pageStabilizeTimeoutMs * 0.15 /* typical settle */)
      + 36 * 550 /* observed fill+readback compute, from the benchmark */;
    expect(modeled).toBeLessThan(120_000);
  });
  it('benchmark timing zeroes every delay knob', () => {
    for (const k of KNOBS) expect(BENCHMARK_TIMING[k]).toBe(0);
  });
});
