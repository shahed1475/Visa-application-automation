// The run loop (spec §5): per portal page — settle, detect, checkpoint-scan,
// map + fill + verify fields, check required documents, ask the adapter whether
// the page can continue, then either stop at the final review or navigate to the
// next page. The loop NEVER submits: there is no submit/confirm/pay affordance
// and `adapter.submitSelector` is `null` by contract.
//
// The engine does NOT persist a terminal status. It emits value-free events,
// reports counters/current-state through `onProgress`, and RETURNS an
// `EngineStop`. Task 12's `AutomationService` maps that stop onto a
// `status` + `waiting_reason`/`error_code` and writes it.

import type { Page } from 'playwright';
import type { PortalAdapter } from '../adapters/baseAdapter.js';
import type { PageInspection } from './pageInspector.js';
import { detectCheckpoint, type CheckpointKind } from './checkpointDetector.js';
import { OptionNotFoundError, SelectorNotFoundError } from './pageActions.js';
import { mapFields } from '../../../shared/automation/fieldMapping.js';
import { SESSION_EXPIRED_STATE, UNKNOWN_STATE } from '../../../shared/automation/types.js';
import type {
  AutomationRunRow,
  ConflictDecision,
  ControlKind,
  MappedField,
  PageIdentity,
  PortalFieldSpec,
  VerificationOutcome,
  WaitingReason,
} from '../../../shared/automation/types.js';
import type { EventType } from '../../../shared/automation/events.js';
import type { ApplicationPlan } from '../../../shared/application/types.js';
import type { CheckpointManager } from '../checkpoints/checkpointManager.js';

/** Counter / current-state patch reported after each page — never carries `status`. */
export type EngineProgress = Pick<
  AutomationRunRow,
  | 'current_portal_state'
  | 'current_section_id'
  | 'fields_total'
  | 'fields_verified'
  | 'documents_total'
  | 'documents_ready'
>;

/** One appended run event. No `value`/`expected`/`actual` field exists — by design. */
export interface EngineEvent {
  type: EventType;
  portalState?: string | null;
  fieldPath?: string | null;
  status?: string | null;
}

export interface EngineContext {
  page: Page;
  adapter: PortalAdapter;
  plan: ApplicationPlan;
  /** Kept for Task 12's resume wiring; the loop itself does not need it. */
  checkpoints: CheckpointManager;
  runId: string;
  onProgress: (patch: EngineProgress) => void | Promise<void>;
  emit: (e: EngineEvent) => void | Promise<void>;
  /** In-memory mismatch surface for `GET /live` — the ONLY place raw values go. */
  recordMismatch: (m: { fieldPath: string; expected: string; actual: string }) => void;
  now: () => string;
  // Injectable so the loop is unit-testable without a real browser. Task 12
  // defaults these to the real modules.
  inspect: (page: Page) => Promise<PageInspection>;
  detectPage: (
    page: Page,
    adapter: PortalAdapter,
    inspection: PageInspection,
  ) => Promise<PageIdentity>;
  applyField: (
    page: Page,
    m: MappedField,
  ) => Promise<{
    filled: boolean;
    outcome: VerificationOutcome;
    alreadySet: boolean;
    usedFallback: boolean;
    /** The selector `applyField` acted on — used for the post-fill read-back. */
    selector: string;
  }>;
  readControl: (page: Page, selector: string, control: ControlKind) => Promise<string | null>;
  /**
   * Read-only pre-fill triage of the portal's current value for a field.
   * `'conflict'` (portal holds a different non-empty value) makes the loop pause
   * on `value_conflict` unless `conflictDecisions` already carries a ruling.
   */
  classifyPreFill: (
    page: Page,
    spec: PortalFieldSpec,
    expected: string,
  ) => Promise<'empty' | 'match' | 'conflict'>;
  /**
   * Per-field user rulings on value conflicts, keyed by `fieldPath`. Task 11
   * feeds the runner's live decision map here so a resumed re-walk does not
   * re-pause on a field the user already decided.
   */
  conflictDecisions: ReadonlyMap<string, ConflictDecision>;
  /**
   * Fallback ruling applied to ANY unresolved value conflict that has no
   * per-field entry in `conflictDecisions`. Task 11 sets this to `keep_portal`
   * on a crash-recovery re-walk, where the fresh runner cannot know which field
   * paused or what the portal now holds — so it must never blind-overwrite.
   */
  defaultConflictDecision?: ConflictDecision;
  settle: (page: Page) => Promise<void>;
  /**
   * Required-field verified count carried in from an earlier `runLoop` call on
   * the same run (a resume re-enters the loop from scratch). Defaults to 0 for a
   * first invocation. Without this the counter resets to 0 on every pause/resume
   * and every real run — which must pass at least one OTP checkpoint — reaches
   * `review_ready` reporting 0 verified fields (spec §5: counters are durable).
   */
  initialVerifiedCount?: number;
}

export type EngineStop =
  | { kind: 'review_ready' }
  | { kind: 'waiting'; reason: WaitingReason; conflictFieldPath?: string }
  | { kind: 'failed'; errorCode: string };

/** checkpoint.kind → the specific event to emit (all four kinds are valid WaitingReasons). */
const CHECKPOINT_EVENT: Record<CheckpointKind, EventType> = {
  otp: 'OTP_REQUIRED',
  captcha: 'CAPTCHA_REQUIRED',
  mfa: 'MFA_REQUIRED',
  anti_bot: 'ANTI_BOT_DETECTED',
};

const requiredDocuments = (plan: ApplicationPlan) =>
  plan.documents.filter((d) => d.effectiveRequirement === 'required');

/**
 * Hard cap on page iterations. The `leftState` check only catches an *immediate*
 * non-advance (A→A); this is the backstop against an adapter that cycles
 * A→B→A→B… forever.
 */
const MAX_ITERATIONS = 60;

export async function runLoop(ctx: EngineContext): Promise<EngineStop> {
  await ctx.emit({ type: 'RUN_STARTED' });

  let countVerified = ctx.initialVerifiedCount ?? 0;
  /** The state we navigated away from at the end of the previous iteration. */
  let leftState: string | null = null;
  let iterations = 0;

  /** Report counters + the run's real location. Called twice per page: once as
   *  soon as a recognised state is known (so a mid-page pause records where it
   *  paused), once after the field loop (with the updated verified count). */
  const reportProgress = (state: string, sectionId: string | null) => {
    const reqDocs = requiredDocuments(ctx.plan);
    return ctx.onProgress({
      current_portal_state: state,
      current_section_id: sectionId,
      fields_total: ctx.plan.verification.requiredTotal,
      fields_verified: countVerified,
      documents_total: reqDocs.length,
      documents_ready: reqDocs.filter((d) => d.uploaded).length,
    });
  };

  for (;;) {
    if ((iterations += 1) > MAX_ITERATIONS) {
      await ctx.emit({ type: 'NAVIGATION_STALLED' });
      return { kind: 'waiting', reason: 'unknown_page' };
    }

    // ---- top of page: settle + inspect + detect -------------------------------
    await ctx.settle(ctx.page);
    const inspection = await ctx.inspect(ctx.page);
    const identity = await ctx.detectPage(ctx.page, ctx.adapter, inspection);
    const state = identity.state;

    // §5.7 tail: navigation that did not move us off the previous page.
    if (leftState !== null && state === leftState) {
      await ctx.emit({ type: 'NAVIGATION_STALLED', portalState: state });
      return { kind: 'waiting', reason: 'unknown_page' };
    }

    // A session-expired / login-redirect page → its own safe stop, so the
    // operator is told to sign in again rather than just "unrecognised page".
    if (state === SESSION_EXPIRED_STATE) {
      await ctx.emit({ type: 'SESSION_EXPIRED', portalState: state });
      return { kind: 'waiting', reason: 'session_expired' };
    }

    // §5.1 — unknown / low-confidence page → pause.
    if (state === UNKNOWN_STATE) {
      await ctx.emit({ type: 'UNKNOWN_PORTAL_STATE', portalState: state });
      return { kind: 'waiting', reason: 'unknown_page' };
    }
    await ctx.emit({ type: 'PAGE_DETECTED', portalState: state });

    // §5.3 head — this page's sections (pure adapter lookup; needed for the
    // early progress report too).
    const sectionIds = ctx.adapter.sectionIdsForState(state);

    // Persist the run's real location BEFORE any mid-page suspension.
    await reportProgress(state, sectionIds[0] ?? null);

    // §5.2 — security checkpoint → bring the tab forward and pause.
    const checkpoint = await detectCheckpoint(
      inspection,
      ctx.page,
      ctx.adapter.checkpointHints,
    );
    if (checkpoint !== null) {
      await ctx.page.bringToFront().catch(() => {});
      await ctx.emit({ type: CHECKPOINT_EVENT[checkpoint.kind], portalState: state });
      return { kind: 'waiting', reason: checkpoint.kind };
    }

    // §5.3 — map, fill and verify this page's fields.
    const mapped = mapFields(ctx.plan.sections, ctx.adapter.getFieldMap(), sectionIds);

    for (const m of mapped) {
      if (m.spec === null) {
        if (m.required && m.present) {
          // A required field is absent from the production field map. The adapter
          // (optionally) explains why: a mapping that exists but is stale /
          // unvalidated must NOT be treated as "just unmapped" — it pauses with
          // its own reason so the operator knows to re-validate, not to hand-fill.
          const readiness = ctx.adapter.mappingReadiness?.(m.fieldPath) ?? 'unmapped';
          if (readiness === 'stale' || readiness === 'unvalidated') {
            await ctx.emit({
              type: 'MAPPING_NOT_PRODUCTION_READY',
              fieldPath: m.fieldPath,
              status: 'blocked',
            });
            return { kind: 'waiting', reason: 'stale_mapping' };
          }
          await ctx.emit({ type: 'FIELD_UNMAPPED', fieldPath: m.fieldPath, status: 'blocked' });
          return { kind: 'waiting', reason: 'missing_field_mapping' };
        }
        await ctx.emit({ type: 'FIELD_UNMAPPED', fieldPath: m.fieldPath, status: 'skipped' });
        continue;
      }
      if (!m.present) continue;

      // §6 — the portal already holds a *different* value: never blind-overwrite.
      // Pause for a decision unless the user already ruled on this field.
      const pre = await ctx.classifyPreFill(ctx.page, m.spec, m.expected ?? '');
      if (pre === 'conflict') {
        const decision = ctx.conflictDecisions.get(m.fieldPath) ?? ctx.defaultConflictDecision;
        if (decision === undefined) {
          // Best-effort read for the in-memory /live pair; a detached primary
          // (fallback was used at classify time) must not turn the pause into a
          // hard error.
          let actual: string | null = null;
          try {
            actual = await ctx.readControl(ctx.page, m.spec.selector, m.spec.control);
          } catch {
            actual = '(unreadable)';
          }
          ctx.recordMismatch({
            fieldPath: m.fieldPath,
            expected: m.expected ?? '',
            actual: actual ?? '',
          });
          await ctx.emit({ type: 'VALUE_CONFLICT', fieldPath: m.fieldPath, status: 'blocked' });
          return { kind: 'waiting', reason: 'value_conflict', conflictFieldPath: m.fieldPath };
        }
        if (decision === 'keep_portal') {
          await ctx.emit({ type: 'FIELD_CONFLICT_KEPT', fieldPath: m.fieldPath });
          continue;
        }
        await ctx.emit({ type: 'FIELD_CONFLICT_OVERWRITTEN', fieldPath: m.fieldPath });
        // fall through to the normal fill path
      }

      await ctx.emit({ type: 'FIELD_FILL_STARTED', fieldPath: m.fieldPath });

      let r: {
        filled: boolean;
        outcome: VerificationOutcome;
        alreadySet: boolean;
        usedFallback: boolean;
        selector: string;
      };
      try {
        r = await ctx.applyField(ctx.page, m);
      } catch (e) {
        if (e instanceof SelectorNotFoundError) {
          await ctx.emit({ type: 'FIELD_NOT_FOUND', fieldPath: m.fieldPath, status: 'blocked' });
          if (m.required) return { kind: 'waiting', reason: 'missing_field_mapping' };
          continue;
        }
        if (e instanceof OptionNotFoundError) {
          // The dropdown does not offer the expected option (missing, disabled,
          // or removed). Never pick a "closest" one — pause for a human.
          await ctx.emit({
            type: 'DROPDOWN_OPTION_MISSING',
            fieldPath: m.fieldPath,
            status: 'blocked',
          });
          return { kind: 'waiting', reason: 'option_unavailable' };
        }
        throw e;
      }

      if (r.usedFallback) {
        // The primary selector no longer matched; the configured fallback did.
        // Informational — the run continues; diagnostics count these.
        await ctx.emit({ type: 'SELECTOR_STALE', fieldPath: m.fieldPath });
      }

      if (r.alreadySet) {
        await ctx.emit({ type: 'FIELD_ALREADY_SET', fieldPath: m.fieldPath });
        // Only required fields count toward `fields_verified` — `fields_total` is
        // `verification.requiredTotal` (required-only). Optionals still get their event.
        if (m.required) countVerified += 1;
        continue;
      }
      if (r.outcome === 'verified') {
        await ctx.emit({ type: 'FIELD_VERIFIED', fieldPath: m.fieldPath });
        if (m.required) countVerified += 1;
        if (!m.verified) {
          await ctx.emit({ type: 'FIELD_FILLED_UNVERIFIED', fieldPath: m.fieldPath });
        }
        continue;
      }
      if (r.outcome === 'mismatch') {
        // Read back through the selector `applyField` actually used — a stale
        // primary + a configured fallback would otherwise miss here and turn a
        // review-pause into a terminal engine error.
        let actual: string | null = null;
        try {
          actual = await ctx.readControl(ctx.page, r.selector, m.spec.control);
        } catch {
          actual = '(unreadable)';
        }
        ctx.recordMismatch({
          fieldPath: m.fieldPath,
          expected: m.expected ?? '',
          actual: actual ?? '',
        });
        await ctx.emit({ type: 'FIELD_MISMATCH', fieldPath: m.fieldPath, status: 'mismatch' });
        if (m.required) return { kind: 'waiting', reason: 'value_mismatch' };
        continue;
      }
      // r.outcome === 'unreadable' (or any residual 'skipped_no_value')
      await ctx.emit({ type: 'FIELD_UNVERIFIABLE', fieldPath: m.fieldPath, status: 'blocked' });
      if (m.required) {
        ctx.recordMismatch({
          fieldPath: m.fieldPath,
          expected: m.expected ?? '',
          actual: '(unreadable)',
        });
        return { kind: 'waiting', reason: 'value_mismatch' };
      }
    }

    // §5 tail — progress again after the field loop, with the updated verified count.
    await reportProgress(state, sectionIds[0] ?? null);

    // §5.4 — required documents for this page.
    const reqDocs = requiredDocuments(ctx.plan);
    const docIds = ctx.adapter.documentIdsForState(state);
    const pageRequiredDocs = reqDocs.filter((d) => docIds.includes(d.id));
    const notUploaded = pageRequiredDocs.filter((d) => !d.uploaded);
    if (notUploaded.length > 0) {
      for (const d of notUploaded) {
        await ctx.emit({
          type: 'BLOCKED_MISSING_DOCUMENT',
          fieldPath: d.id,
          status: 'blocked',
          portalState: state,
        });
      }
      return { kind: 'failed', errorCode: 'missing_document' };
    }
    if (pageRequiredDocs.length > 0) {
      for (const d of pageRequiredDocs) {
        await ctx.emit({ type: 'DOCUMENT_READY', fieldPath: d.id, portalState: state });
      }
      return { kind: 'waiting', reason: 'document_upload_required' };
    }

    // §5.5 — portal-side validation gate.
    const cont = await ctx.adapter.canContinue(ctx.page);
    if (!cont.ok) {
      await ctx.emit({ type: 'VALIDATION_ERROR', status: 'blocked', portalState: state });
      return { kind: 'waiting', reason: 'validation_error' };
    }

    // §5.6 — stop at the final review page. NEVER submit.
    if (ctx.adapter.isFinalReview(state)) {
      await ctx.emit({ type: 'REVIEW_READY', portalState: state });
      return { kind: 'review_ready' };
    }

    // §5.7 — advance to the next page.
    await ctx.emit({ type: 'NAVIGATION_STARTED', portalState: state });
    await ctx.adapter.clickNext(ctx.page);
    await ctx.settle(ctx.page);
    await ctx.emit({ type: 'NAVIGATION_COMPLETED', portalState: state });
    leftState = state;
  }
}
