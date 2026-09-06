// Task 12 — wires the automation engine (Tasks 1-11) to the DB, the browser and
// the Fastify app. One `AutomationService` per process; it owns at most one
// `AutomationRunner` at a time (`activeRunner`). The runner walks portal pages
// in the background: launch browser → goto entry URL → runLoop → map the
// returned `EngineStop` onto a persisted `status` (+ `waiting_reason` /
// `error_code`) via `assertTransition`-guarded `updateRun`. On a `waiting` stop
// it parks on `CheckpointManager.awaitResume` until `resumeRun` / `abortRun` /
// `dispose` releases it. Raw field values NEVER touch the DB — only the
// in-memory `mismatches[]` (surfaced by `getLive`) and value-free events.

import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { env } from '../env.js';
import type {
  AutomationEventRow,
  AutomationRunRow,
  RunStatus,
  WaitingReason,
} from '../../shared/automation/types.js';
import { assertTransition, isTerminal } from '../../shared/automation/states.js';
import { EVENT_MESSAGES } from '../../shared/automation/events.js';
import type { ApplicationPlan } from '../../shared/application/types.js';
import {
  appendEvent,
  createRun,
  findActiveRun,
  getRun as getRunRow,
  listEvents as listEventRows,
  listRunsForApplication as listRunRowsForApplication,
  updateRun,
} from './state/automationRunStore.js';
import {
  runLoop as realRunLoop,
  type EngineContext,
  type EngineStop,
} from './engine/automationEngine.js';
import { CheckpointManager } from './checkpoints/checkpointManager.js';
import { BrowserManager } from './engine/browserManager.js';
import { resolveAdapter as realResolveAdapter } from './adapters/registry.js';
import type { PortalAdapter } from './adapters/baseAdapter.js';
import { detectPage } from './engine/pageDetector.js';
import { applyField } from './engine/fieldActions.js';
import { readControl, waitForPageSettled } from './engine/pageActions.js';
import { inspectPage, type PageInspection } from './engine/pageInspector.js';
import { getApplication as realGetApplication } from '../services/applicationService.js';
import { getActivePortal } from '../services/portalService.js';

const now = (): string => new Date().toISOString();

const CHECKPOINT_REASONS: ReadonlySet<string> = new Set(['otp', 'captcha', 'mfa', 'anti_bot']);

// Event types worth a screenshot when AUTOMATION_EVIDENCE='screenshots': the run
// paused for the user, hit a challenge, or reached the review page — moments a
// screenshot helps a human understand. Routine per-field events are excluded.
const NOTABLE_EVENTS: ReadonlySet<string> = new Set([
  'OTP_REQUIRED',
  'CAPTCHA_REQUIRED',
  'MFA_REQUIRED',
  'ANTI_BOT_DETECTED',
  'FIELD_MISMATCH',
  'VALIDATION_ERROR',
  'REVIEW_READY',
  'UNKNOWN_PORTAL_STATE',
  'BLOCKED_MISSING_DOCUMENT',
  'NAVIGATION_STALLED',
  'SESSION_EXPIRED',
]);

// ---- error classes ---------------------------------------------------------

export class ApplicationNotFoundError extends Error {
  constructor(readonly applicationId: string) {
    super(`application ${applicationId} not found`);
    this.name = 'ApplicationNotFoundError';
  }
}

export class NotReadyError extends Error {
  constructor(readonly blockers: unknown[]) {
    super('the application is not ready for automation');
    this.name = 'NotReadyError';
  }
}

export class RunInProgressError extends Error {
  constructor(readonly runId: string) {
    super(`a run is already in progress for this application: ${runId}`);
    this.name = 'RunInProgressError';
  }
}

export class AnotherRunActiveError extends Error {
  constructor(readonly runId: string) {
    super(`another automation run is active: ${runId}`);
    this.name = 'AnotherRunActiveError';
  }
}

export class NoActivePortalError extends Error {
  constructor() {
    super('no active portal is configured');
    this.name = 'NoActivePortalError';
  }
}

export class RunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`automation run ${runId} not found`);
    this.name = 'RunNotFoundError';
  }
}

export class NotWaitingError extends Error {
  constructor(readonly runId: string) {
    super(`automation run ${runId} is not waiting for the user`);
    this.name = 'NotWaitingError';
  }
}

export class CheckpointStillPresentError extends Error {
  constructor() {
    super('the security checkpoint is still present on the page');
    this.name = 'CheckpointStillPresentError';
  }
}

// ---- service --------------------------------------------------------------

interface LoadedApplication {
  application: unknown;
  plan: ApplicationPlan;
}

export interface AutomationServiceDeps {
  browserManager?: BrowserManager;
  resolveAdapter?: (url: string) => PortalAdapter;
  runLoop?: (ctx: EngineContext) => Promise<EngineStop>;
  inspect?: (page: Page) => Promise<PageInspection>;
  getApplication?: (db: DatabaseSync, id: string) => LoadedApplication | null;
  evidence?: 'off' | 'screenshots';
  automationDir?: string;
}

export class AutomationService {
  readonly bm: BrowserManager;
  readonly checkpoints = new CheckpointManager();
  readonly resolveAdapter: (url: string) => PortalAdapter;
  readonly runLoop: (ctx: EngineContext) => Promise<EngineStop>;
  /** Reassignable so a test can swap the page-inspection result mid-run. */
  inspect: (page: Page) => Promise<PageInspection>;
  private readonly getApplication: (db: DatabaseSync, id: string) => LoadedApplication | null;
  /** `'screenshots'` captures a page image on notable events; defaults to env (`'off'`). */
  readonly evidence: 'off' | 'screenshots';
  /** Directory the screenshot files live under; defaults to `env.AUTOMATION_DIR` (under `data/`). */
  readonly automationDir: string;

  /** At most one runner process-wide. */
  activeRunner: AutomationRunner | null = null;

  constructor(deps: AutomationServiceDeps = {}) {
    this.bm = deps.browserManager ?? new BrowserManager();
    this.resolveAdapter = deps.resolveAdapter ?? realResolveAdapter;
    this.runLoop = deps.runLoop ?? realRunLoop;
    this.inspect = deps.inspect ?? inspectPage;
    this.getApplication = deps.getApplication ?? realGetApplication;
    this.evidence = deps.evidence ?? env.AUTOMATION_EVIDENCE;
    this.automationDir = deps.automationDir ?? env.AUTOMATION_DIR;
  }

  async startRun(db: DatabaseSync, applicationId: string): Promise<AutomationRunRow> {
    const loaded = this.getApplication(db, applicationId);
    if (!loaded) throw new ApplicationNotFoundError(applicationId);
    if (!loaded.plan.readyForAutomation.ready) {
      throw new NotReadyError(loaded.plan.readyForAutomation.blockers);
    }

    const mine = findActiveRun(db, { applicationId });
    if (mine) throw new RunInProgressError(mine.id);
    const anyRun = findActiveRun(db, {});
    if (anyRun) throw new AnotherRunActiveError(anyRun.id);

    const portal = getActivePortal(db);
    if (!portal) throw new NoActivePortalError();
    const portalUrlSnapshot = portal.url;
    const adapter = this.resolveAdapter(portalUrlSnapshot);

    const run = createRun(db, {
      id: randomUUID(),
      applicationId,
      portalId: portal.id,
      portalUrlSnapshot,
      adapterId: adapter.id,
      now: now(),
    });

    this.activeRunner = new AutomationRunner(
      this,
      db,
      run.id,
      adapter,
      loaded.plan,
      portalUrlSnapshot,
    );
    void this.activeRunner.run();
    return run;
  }

  getRun(
    db: DatabaseSync,
    id: string,
  ): { run: AutomationRunRow; events: AutomationEventRow[] } | null {
    const run = getRunRow(db, id);
    if (!run) return null;
    return { run, events: listEventRows(db, id) };
  }

  listEvents(db: DatabaseSync, id: string, afterSeq?: number): AutomationEventRow[] {
    return listEventRows(db, id, afterSeq);
  }

  listRunsForApplication(db: DatabaseSync, applicationId: string): AutomationRunRow[] {
    return listRunRowsForApplication(db, applicationId);
  }

  getLive(id: string): { mismatches: { fieldPath: string; expected: string; actual: string }[] } | null {
    return this.activeRunner?.runId === id
      ? { mismatches: [...this.activeRunner.mismatches] }
      : null;
  }

  async resumeRun(db: DatabaseSync, id: string): Promise<AutomationRunRow> {
    const cur = getRunRow(db, id);
    if (!cur) throw new RunNotFoundError(id);
    if (cur.status !== 'waiting_for_user' && cur.status !== 'paused') {
      throw new NotWaitingError(id);
    }

    if (CHECKPOINT_REASONS.has(cur.waiting_reason ?? '')) {
      const runner = this.activeRunner;
      if (runner?.runId === id && runner.page) {
        // The user completes the challenge in the real browser, which changes
        // the page server-side; re-fetch the current URL so the re-check (and
        // the resumed loop) sees the live DOM, not the stale challenge markup.
        // Best-effort: a fake/detached page (unit tests) simply skips this.
        try {
          await runner.page.reload({ waitUntil: 'domcontentloaded' });
        } catch {
          /* best-effort — fall through to the re-check on whatever is loaded */
        }
        const inspection = await this.inspect(runner.page);
        const adapter = this.resolveAdapter(cur.portal_url_snapshot);
        const cp = await this.checkpoints.stillBlocked(
          runner.page,
          inspection,
          adapter.checkpointHints,
        );
        if (cp) {
          appendEvent(db, {
            id: randomUUID(),
            runId: id,
            type: 'CHECKPOINT_STILL_PRESENT',
            message: EVENT_MESSAGES.CHECKPOINT_STILL_PRESENT,
            now: now(),
          });
          throw new CheckpointStillPresentError();
        }
      }
    }

    const signalled = this.checkpoints.signalResume(id);
    if (!signalled) {
      // Crash-recovery path: no in-memory runner is parked on this run (the
      // process restarted while it was waiting). Phase 5 simplification — start
      // a fresh runner from the entry URL with a fresh browser context. The loop
      // genuinely re-walks and re-fills every page from scratch (the blank
      // context has no earlier progress); this is idempotent in effect because
      // the portal accepts the same values a second time.
      const loaded = this.getApplication(db, cur.application_id);
      if (!loaded) throw new ApplicationNotFoundError(cur.application_id);
      const adapter = this.resolveAdapter(cur.portal_url_snapshot);
      this.activeRunner = new AutomationRunner(
        this,
        db,
        id,
        adapter,
        loaded.plan,
        cur.portal_url_snapshot,
      );
      void this.activeRunner.run();
    }

    return getRunRow(db, id)!;
  }

  async abortRun(db: DatabaseSync, id: string): Promise<AutomationRunRow> {
    const cur = getRunRow(db, id);
    if (!cur) throw new RunNotFoundError(id);
    if (isTerminal(cur.status)) return cur; // idempotent

    assertTransition(cur.status, 'aborted');
    updateRun(db, id, { status: 'aborted', ended_at: now() }, now());
    appendEvent(db, {
      id: randomUUID(),
      runId: id,
      type: 'RUN_ABORTED',
      message: EVENT_MESSAGES.RUN_ABORTED,
      now: now(),
    });

    if (this.activeRunner?.runId === id) {
      this.activeRunner.aborted = true;
      this.checkpoints.signalResume(id);
    }
    return getRunRow(db, id)!;
  }

  async dispose(): Promise<void> {
    if (this.activeRunner) {
      // A dispose is a shutdown / crash-simulation, NOT a user abort: stop the
      // in-memory runner but leave the persisted run in its current (non-terminal)
      // state so a fresh process can resume it from the DB record (spec §10, R18).
      this.activeRunner.stopped = true;
      this.checkpoints.signalResume(this.activeRunner.runId);
    }
    await this.bm.close().catch(() => undefined);
  }
}

// ---- runner --------------------------------------------------------------

export class AutomationRunner {
  page: Page | null = null;
  context: BrowserContext | null = null;
  readonly mismatches: { fieldPath: string; expected: string; actual: string }[] = [];
  /** Set by `abortRun` — the run is being terminated; persist `aborted`. */
  aborted = false;
  /** Set by `dispose` — stop the loop but leave the persisted run resumable. */
  stopped = false;

  constructor(
    private readonly svc: AutomationService,
    private readonly db: DatabaseSync,
    readonly runId: string,
    private readonly adapter: PortalAdapter,
    private readonly plan: ApplicationPlan,
    private readonly portalUrl: string,
  ) {}

  private transition(to: RunStatus): void {
    const cur = getRunRow(this.db, this.runId);
    if (!cur) throw new Error(`automation run ${this.runId} vanished`);
    assertTransition(cur.status, to);
    updateRun(this.db, this.runId, { status: to }, now());
  }

  private emitEvent(
    type: string,
    extra?: { portalState?: string | null; fieldPath?: string | null; status?: string | null },
    evidencePath?: string | null,
  ): void {
    appendEvent(this.db, {
      id: randomUUID(),
      runId: this.runId,
      type,
      portalState: extra?.portalState ?? null,
      fieldPath: extra?.fieldPath ?? null,
      status: extra?.status ?? null,
      message: EVENT_MESSAGES[type as keyof typeof EVENT_MESSAGES] ?? type,
      evidencePath: evidencePath ?? null,
      now: now(),
    });
  }

  // DESIGN NOTE — Screenshots of a mid-fill portal page contain PII. That is why
  // AUTOMATION_EVIDENCE defaults to 'off', the files live under AUTOMATION_DIR
  // (gitignored via data/), and only a RELATIVE path — never the image bytes —
  // is stored in automation_events. (spec §13, R19)
  private async captureEvidence(page: Page, type: string): Promise<string | null> {
    try {
      const name = `${Date.now()}-${type}.png`;
      const rel = path.posix.join(this.runId, name); // forward slashes in the DB
      const abs = path.join(this.svc.automationDir, this.runId, name);
      await mkdir(path.dirname(abs), { recursive: true });
      await page.screenshot({ path: abs });
      return rel;
    } catch {
      return null;
    }
  }

  private buildContext(page: Page): EngineContext {
    const { db, runId } = this;
    return {
      page,
      adapter: this.adapter,
      plan: this.plan,
      checkpoints: this.svc.checkpoints,
      runId,
      onProgress: (patch) => {
        updateRun(db, runId, patch, now());
      },
      emit: async (e) => {
        let evidencePath: string | null = null;
        if (this.svc.evidence === 'screenshots' && NOTABLE_EVENTS.has(e.type)) {
          evidencePath = await this.captureEvidence(page, e.type);
        }
        this.emitEvent(
          e.type,
          {
            portalState: e.portalState ?? null,
            fieldPath: e.fieldPath ?? null,
            status: e.status ?? null,
          },
          evidencePath,
        );
      },
      recordMismatch: (m) => {
        this.mismatches.push(m);
      },
      now,
      inspect: this.svc.inspect,
      detectPage,
      applyField,
      readControl,
      settle: waitForPageSettled,
    };
  }

  async run(): Promise<void> {
    const { db, runId } = this;
    try {
      await this.svc.bm.launch({ headless: env.AUTOMATION_HEADLESS });
      const { page, context } = await this.svc.bm.newPage();
      this.page = page;
      this.context = context;

      await page.goto(this.adapter.entryUrl(this.portalUrl));
      this.transition('running');
      updateRun(db, runId, { waiting_reason: null }, now());

      for (;;) {
        const ctx = this.buildContext(page);
        const stop = await this.svc.runLoop(ctx);
        if (this.aborted || this.stopped) break;

        if (stop.kind === 'review_ready') {
          this.transition('review_ready');
          updateRun(db, runId, { ended_at: now() }, now());
          break;
        }
        if (stop.kind === 'failed') {
          this.transition('failed');
          updateRun(db, runId, { error_code: stop.errorCode, ended_at: now() }, now());
          break;
        }

        // waiting
        this.transition('waiting_for_user');
        updateRun(db, runId, { waiting_reason: stop.reason as WaitingReason }, now());
        this.emitEvent('USER_ACTION_REQUIRED');

        await this.svc.checkpoints.awaitResume(runId);

        if (this.aborted || this.stopped || getRunRow(db, runId)?.status === 'aborted') break;

        this.transition('running');
        updateRun(db, runId, { waiting_reason: null }, now());
        this.emitEvent('RUN_RESUMED');
        await ctx.settle(page); // re-settle before re-entering the loop
      }

      // The loop broke because of an abort (abortRun flipped `aborted`) or a
      // dispose (`stopped`). Only an abort persists a terminal status; a dispose
      // leaves the run resumable. If abortRun's own DB write has not landed yet,
      // persist the terminal status
      // here so a restart does not see a stuck non-terminal run. Idempotent with
      // abortRun — whichever runs first wins; the loser's assertTransition throws.
      if (this.aborted) {
        try {
          const s = getRunRow(db, runId)?.status;
          if (s != null && !isTerminal(s)) {
            this.transition('aborted');
            updateRun(db, runId, { ended_at: now() }, now());
          }
        } catch {
          /* abortRun's own write won the race */
        }
      }
    } catch (e) {
      // NEVER persist `e.message` — it may carry a selector or verbose page text.
      // If the run was aborted (or is otherwise already terminal), the throw is a
      // side effect of the abort racing an in-flight `transition('running')` —
      // do not overwrite the user's abort with an engine-error record.
      const fresh = getRunRow(this.db, this.runId)?.status;
      if (
        this.aborted ||
        this.stopped ||
        fresh === 'aborted' ||
        (fresh != null && isTerminal(fresh))
      ) {
        return;
      }
      try {
        this.transition('failed');
      } catch {
        /* already terminal — leave the recorded status as-is */
      }
      updateRun(
        db,
        runId,
        {
          error_code: 'engine_error',
          error_message: e instanceof Error ? e.name : 'error',
          ended_at: now(),
        },
        now(),
      );
      this.emitEvent('RUN_FAILED');
    } finally {
      await this.context?.close().catch(() => undefined);
      // Only clear the pointer if it still points at *this* runner — a newer
      // runner may have claimed `activeRunner` while `context.close()` awaited.
      if (this.svc.activeRunner === this) this.svc.activeRunner = null;
    }
  }
}
