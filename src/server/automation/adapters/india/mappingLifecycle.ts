// Pure lifecycle classification for India portal mappings (Phase 7 spec §6).
//
//   placeholder -> discovered -> validated -> (stale on a mappingRevision bump)
//
// A mapping is PRODUCTION-USABLE only when it is `validated` AND its
// `validatedAgainstRevision` equals the CURRENT `mappingRevision`. A validated
// mapping with a missing or outdated stamp classifies as `stale` and must never
// drive autofill — it has to be re-validated first.
//
// No I/O, no browser, no DB. Consumed by the India adapter's production
// field-map filter, its `mappingReadiness` hook, `clickNext`, and the
// diagnostics / registry counts.

import type { IndiaFieldMapping, IndiaPortalStateConfig, MappingStatus } from './indiaPortalMap.js';

export type MappingLifecycle = 'placeholder' | 'discovered' | 'validated' | 'stale';

/**
 * Where `m` sits in its lifecycle relative to `currentRevision`. `placeholder`
 * and `discovered` pass straight through; a `validated` mapping is `validated`
 * only if its stamp matches, otherwise `stale`.
 */
export function classifyMapping(m: IndiaFieldMapping, currentRevision: string): MappingLifecycle {
  if (m.status !== 'validated') return m.status;
  return m.validatedAgainstRevision === currentRevision ? 'validated' : 'stale';
}

/** True iff `m` is `validated` against `currentRevision` — the only state that may reach the engine. */
export function isProductionUsable(m: IndiaFieldMapping, currentRevision: string): boolean {
  return classifyMapping(m, currentRevision) === 'validated';
}

type NextSelectorView = Pick<
  IndiaPortalStateConfig,
  'nextSelector' | 'nextSelectorStatus' | 'nextSelectorValidatedAgainstRevision'
>;

/** Same production rule as {@link isProductionUsable}, applied to a state's `nextSelector`. */
export function isNextSelectorProductionUsable(
  cfg: NextSelectorView,
  currentRevision: string,
): boolean {
  if (!cfg.nextSelector || cfg.nextSelector === 'TODO:discover') return false;
  const status: MappingStatus = cfg.nextSelectorStatus;
  return status === 'validated' && cfg.nextSelectorValidatedAgainstRevision === currentRevision;
}

/**
 * Where a state's `nextSelector` sits in its lifecycle relative to
 * `currentRevision` — the {@link classifyMapping} equivalent for page nav.
 * A `null` / `'TODO:discover'` selector is `'unmapped'` (nothing to validate);
 * a non-validated one is `'unvalidated'`; a validated one is `'validated'` only
 * if its stamp matches, else `'stale'`.
 */
export function classifyNextSelector(
  cfg: NextSelectorView | undefined,
  currentRevision: string,
): 'production' | 'stale' | 'unvalidated' | 'unmapped' {
  if (!cfg || !cfg.nextSelector || cfg.nextSelector === 'TODO:discover') return 'unmapped';
  if (cfg.nextSelectorStatus !== 'validated') return 'unvalidated';
  return cfg.nextSelectorValidatedAgainstRevision === currentRevision ? 'production' : 'stale';
}
