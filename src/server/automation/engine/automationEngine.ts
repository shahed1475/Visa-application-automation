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
import { SelectorNotFoundError } from './pageActions.js';
import { mapFields } from '../../../shared/automation/fieldMapping.js';
import { UNKNOWN_STATE } from '../../../shared/automation/types.js';
import type {
  AutomationRunRow,
  ControlKind,
  MappedField,
  PageIdentity,
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
  ) => Promise<{ filled: boolean; outcome: VerificationOutcome; alreadySet: boolean }>;
  readControl: (page: Page, selector: string, control: ControlKind) => Promise<string | null>;
  settle: (page: Page) => Promise<void>;
}

export type EngineStop =
  | { kind: 'review_ready' }
  | { kind: 'waiting'; reason: WaitingReason }
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

export async function runLoop(ctx: EngineContext): Promise<EngineStop> {
  await ctx.emit({ type: 'RUN_STARTED' });

  let countVerified = 0;
  /** The state we navigated away from at the end of the previous iteration. */
  let leftState: string | null = null;

  for (;;) {
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

    // §5.1 — unknown / low-confidence page → pause.
    if (state === UNKNOWN_STATE) {
      await ctx.emit({ type: 'UNKNOWN_PORTAL_STATE', portalState: state });
      return { kind: 'waiting', reason: 'unknown_page' };
    }
    await ctx.emit({ type: 'PAGE_DETECTED', portalState: state });

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
    const sectionIds = ctx.adapter.sectionIdsForState(state);
    const mapped = mapFields(ctx.plan.sections, ctx.adapter.getFieldMap(), sectionIds);

    for (const m of mapped) {
      if (m.spec === null) {
        if (m.required && m.present) {
          await ctx.emit({ type: 'FIELD_UNMAPPED', fieldPath: m.fieldPath, status: 'blocked' });
          return { kind: 'waiting', reason: 'missing_field_mapping' };
        }
        await ctx.emit({ type: 'FIELD_UNMAPPED', fieldPath: m.fieldPath, status: 'skipped' });
        continue;
      }
      if (!m.present) continue;

      await ctx.emit({ type: 'FIELD_FILL_STARTED', fieldPath: m.fieldPath });

      let r: { filled: boolean; outcome: VerificationOutcome; alreadySet: boolean };
      try {
        r = await ctx.applyField(ctx.page, m);
      } catch (e) {
        if (e instanceof SelectorNotFoundError) {
          await ctx.emit({ type: 'FIELD_NOT_FOUND', fieldPath: m.fieldPath, status: 'blocked' });
          if (m.required) return { kind: 'waiting', reason: 'missing_field_mapping' };
          continue;
        }
        throw e;
      }

      if (r.alreadySet) {
        await ctx.emit({ type: 'FIELD_ALREADY_SET', fieldPath: m.fieldPath });
        countVerified += 1;
        continue;
      }
      if (r.outcome === 'verified') {
        await ctx.emit({ type: 'FIELD_VERIFIED', fieldPath: m.fieldPath });
        countVerified += 1;
        if (!m.verified) {
          await ctx.emit({ type: 'FIELD_FILLED_UNVERIFIED', fieldPath: m.fieldPath });
        }
        continue;
      }
      if (r.outcome === 'mismatch') {
        const actual = await ctx.readControl(ctx.page, m.spec.selector, m.spec.control);
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

    // §5 tail — progress after every fully-handled page, before documents.
    const reqDocs = requiredDocuments(ctx.plan);
    await ctx.onProgress({
      current_portal_state: state,
      current_section_id: sectionIds[0] ?? null,
      fields_total: ctx.plan.verification.requiredTotal,
      fields_verified: countVerified,
      documents_total: reqDocs.length,
      documents_ready: reqDocs.filter((d) => d.uploaded).length,
    });

    // §5.4 — required documents for this page.
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
