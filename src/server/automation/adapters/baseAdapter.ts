import type { Page } from 'playwright';
import type { PageInspection } from '../engine/pageInspector.js';
import type {
  PageIdentity,
  PortalState,
  PortalFieldMap,
  SignalMatch,
} from '../../../shared/automation/types.js';

export interface CheckpointHints {
  otpLabelPatterns?: RegExp[];
  captchaSelectors?: string[];
  mfaPatterns?: RegExp[];
}

export interface PortalStateConfig {
  signals: (page: Page, inspection: PageInspection) => Promise<SignalMatch[]>;
  sectionIds: string[];
  nextSelector: string | null; // null on the final review state
  isFinalReview?: boolean;
}

export interface PortalAdapter {
  readonly id: string;
  matches(url: string): boolean;
  entryUrl(portalUrl: string): string;
  getPageIdentity(page: Page, inspection: PageInspection): Promise<PageIdentity>;
  sectionIdsForState(state: PortalState): string[];
  /** Document ids (matching `ApplicationPlan.documents[].id`) the portal collects while in `state`. */
  documentIdsForState(state: PortalState): string[];
  getFieldMap(): PortalFieldMap;
  /**
   * OPTIONAL. Explains why a plan field is NOT in `getFieldMap()`:
   * - `'production'`  — it IS in the map (the caller need not have asked)
   * - `'stale'`       — a validated mapping exists but was stamped against an old revision
   * - `'unvalidated'` — a mapping entry exists at `'placeholder'` / `'discovered'`
   * - `'unmapped'`    — no mapping entry at all
   * A generic adapter omits this; the engine then treats every gap as `'unmapped'`.
   */
  mappingReadiness?(fieldPath: string): 'production' | 'stale' | 'unvalidated' | 'unmapped';
  /**
   * OPTIONAL. The lifecycle readiness of `state`'s next-page navigation selector,
   * classified exactly like {@link mappingReadiness} classifies a field:
   * - `'production'`  — the `nextSelector` is validated against the current revision
   * - `'stale'`       — a validated `nextSelector` stamped against an old revision
   * - `'unvalidated'` — a `nextSelector` at `'placeholder'` / `'discovered'`
   * - `'unmapped'`    — no state config, or the `nextSelector` is still `'TODO:discover'`
   * The engine treats anything other than `'production'` as a `stale_mapping`
   * safe-stop (recoverable), NOT a terminal failure. A generic adapter omits this;
   * the engine then assumes `'production'` and relies on `clickNext` itself.
   */
  nextSelectorReadiness?(state: string): 'production' | 'stale' | 'unvalidated' | 'unmapped';
  canContinue(page: Page): Promise<{ ok: boolean; reason?: string }>;
  clickNext(page: Page): Promise<void>;
  isFinalReview(state: PortalState): boolean;
  checkpointHints?: CheckpointHints;
  readonly submitSelector: null;
}
