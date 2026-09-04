/**
 * Heuristic extraction-confidence scoring (design §8, Amendment 2).
 *
 * `confidence` here is an application-level heuristic **trust score in [0, 1]**.
 * Its only jobs are to order the review list and to flag fields that want a
 * closer human look. It is deliberately NOT a statistically calibrated
 * probability: a score of `0.99` means "this value came from an MRZ field whose
 * ICAO 9303 check digit passed" — a strong structural-integrity signal — and
 * NOT "there is a 99% chance this value is correct". The functions below, with
 * their exact constants, are the entire definition of the score; the review UI
 * surfaces them as labelled heuristics ("MRZ check digit OK", "OCR — low"), not
 * as a bare percentage asserting certainty.
 *
 * This module scores extraction only. Manual / imported / system field values
 * never receive a confidence — that is enforced on the Phase 2 write path, not
 * here.
 *
 * Pure module: imports nothing, no Node/browser/npm surface.
 */

/** `Math.min(hi, Math.max(lo, x))`. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export interface MrzScoreInput {
  /** Does this MRZ field carry its own ICAO 9303 check digit (doc number / DOB / expiry)? */
  hasOwnCheckDigit: boolean;
  /** Result of that own check digit; `null` when the field has none. */
  ownCheckOk: boolean | null;
  /** Did the line's other check digits (composite) verify? */
  siblingChecksOk: boolean;
}

/**
 * Score one MRZ-sourced field.
 *
 * - own check digit present & OK → `0.99`
 * - own check digit present & FAILED → `0.55`
 * - no own check digit, siblings OK → `0.95`
 * - no own check digit, siblings failed → `0.60`
 */
export function scoreMrzField(i: MrzScoreInput): number {
  if (i.hasOwnCheckDigit) return i.ownCheckOk ? 0.99 : 0.55;
  return i.siblingChecksOk ? 0.95 : 0.6;
}

/**
 * Score one OCR-fallback field. `lineConfidence` is the tesseract line
 * confidence (0–100) for the line the value was read from.
 *
 * - anchored (value sits next to its printed label) →
 *   `clamp(0.35 + 0.5·lc, 0.30, 0.75)`
 * - unanchored → `clamp(0.15 + 0.4·lc, 0.15, 0.55)`
 *
 * where `lc = lineConfidence / 100`.
 */
export function scoreOcrField(i: { anchored: boolean; lineConfidence: number }): number {
  const lc = i.lineConfidence / 100;
  return i.anchored
    ? clamp(0.35 + 0.5 * lc, 0.3, 0.75)
    : clamp(0.15 + 0.4 * lc, 0.15, 0.55);
}

/** Halve a score when the raw value failed to normalize (`value = null`). */
export function penalizeUnnormalized(score: number): number {
  return score * 0.5;
}
