/**
 * Pure utilities for automation run progress tracking.
 * No imports, no side effects, computed from API response data.
 */

/**
 * Calculate elapsed time in milliseconds from an ISO 8601 timestamp.
 * Clamps to 0 if the result is negative (for future timestamps).
 */
export function elapsedMs(startedAtIso: string, nowMs?: number): number {
  const elapsed = (nowMs ?? Date.now()) - Date.parse(startedAtIso);
  return Math.max(0, elapsed);
}

/**
 * Estimate remaining time in milliseconds based on verification rate.
 * Returns null if no fields have been verified yet or if fieldsTotal is 0.
 * Returns 0 if all fields have been verified.
 * Otherwise linearly extrapolates from the observed per-field rate.
 */
export function estimateRemainingMs(a: {
  fieldsVerified: number;
  fieldsTotal: number;
  elapsedMs: number;
}): number | null {
  const { fieldsVerified, fieldsTotal, elapsedMs } = a;

  // Cannot estimate before any field is verified or if total is unknown
  if (fieldsVerified === 0 || fieldsTotal === 0) {
    return null;
  }

  // All fields already verified
  if (fieldsVerified >= fieldsTotal) {
    return 0;
  }

  // Linear extrapolation: (elapsed / verified) * remaining
  const remaining = (elapsedMs / fieldsVerified) * (fieldsTotal - fieldsVerified);
  return Math.round(remaining);
}

/**
 * Format a duration in milliseconds as mm:ss.
 * - Negative values clamp to 00:00
 * - Values >= 3600000ms (1 hour) clamp to >59:59
 * - All values zero-padded
 */
export function formatDuration(ms: number): string {
  // Clamp negative to 0
  if (ms < 0) {
    return '00:00';
  }

  // Clamp >= 1 hour to >59:59
  if (ms >= 3600_000) {
    return '>59:59';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return `${mm}:${ss}`;
}
