export type TimingProfileName = 'fast' | 'normal' | 'careful';
export interface TimingProfile {
  readonly name: TimingProfileName | 'benchmark';
  readonly navigationWaitMs: number;      // pause after clickNext, before settle checks
  readonly pageStabilizeTimeoutMs: number; // max wait for an anchor/element to appear
  readonly fieldInteractionDelayMs: number; // pause after focus/scroll, before writing
  readonly scrollDelayMs: number;          // pause after scrollIntoViewIfNeeded
  readonly postFillVerifyDelayMs: number;  // pause after write, before read-back
  readonly retryDelayMs: number;           // pause before the single verify retry
  readonly resolveProbeMs: number;         // primary-vs-fallback probe window
}

export const TIMING_PROFILES: Record<TimingProfileName, TimingProfile> = {
  fast:    { name: 'fast',    navigationWaitMs: 300,  pageStabilizeTimeoutMs: 8_000,  fieldInteractionDelayMs: 80,  scrollDelayMs: 50,  postFillVerifyDelayMs: 120, retryDelayMs: 200,  resolveProbeMs: 1_500 },
  normal:  { name: 'normal',  navigationWaitMs: 800,  pageStabilizeTimeoutMs: 10_000, fieldInteractionDelayMs: 250, scrollDelayMs: 150, postFillVerifyDelayMs: 300, retryDelayMs: 500,  resolveProbeMs: 2_000 },
  careful: { name: 'careful', navigationWaitMs: 1_500, pageStabilizeTimeoutMs: 15_000, fieldInteractionDelayMs: 600, scrollDelayMs: 400, postFillVerifyDelayMs: 900, retryDelayMs: 1_200, resolveProbeMs: 3_000 },
};
export const BENCHMARK_TIMING: TimingProfile = {
  name: 'benchmark', navigationWaitMs: 0, pageStabilizeTimeoutMs: 2_000, fieldInteractionDelayMs: 0,
  scrollDelayMs: 0, postFillVerifyDelayMs: 0, retryDelayMs: 0, resolveProbeMs: 500,
};
export function resolveTimingProfile(name: string | undefined): TimingProfile {
  return name === 'fast' || name === 'careful' ? TIMING_PROFILES[name] : TIMING_PROFILES.normal;
}
