import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Page } from 'playwright';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { createPortal, setActivePortal } from '../../src/server/services/portalService.js';
import type { ApplicationPlan } from '../../src/shared/application/types.js';
import type { EngineStop } from '../../src/server/automation/engine/automationEngine.js';
import type { PortalAdapter } from '../../src/server/automation/adapters/baseAdapter.js';
import type { PageInspection } from '../../src/server/automation/engine/pageInspector.js';
import {
  AutomationService,
  CheckpointStillPresentError,
  NotReadyError,
  NotWaitingError,
  RunInProgressError,
} from '../../src/server/automation/automationService.js';

const T = 't0';

function seedApplication(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1', 'A', 'draft', ?, ?)`,
  ).run(T, T);
  db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES ('a1')`).run();
  db.prepare(
    `INSERT INTO visa_applications
       (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
     VALUES ('app1', 'a1', 'IND', 'regular', 'regular.tourist', 'draft', '2026-09-06', ?, ?)`,
  ).run(T, T);
}

function seedActivePortal(db: DatabaseSync): void {
  const portal = createPortal(db, {
    name: 'Fake Portal',
    url: 'https://example.gov/apply',
    portalType: 'evisa',
    country: null,
    applicationType: null,
    notes: null,
    enabled: true,
  });
  setActivePortal(db, portal.id);
}

const fakePage = {
  goto: async () => {},
  bringToFront: async () => {},
  url: () => 'about:blank',
  waitForLoadState: async () => {},
} as unknown as Page;

const fakeContext = { close: async () => {} };

const fakeBrowserManager = {
  launch: async () => {},
  newPage: async () => ({ page: fakePage, context: fakeContext }),
  bringToFront: async () => {},
  close: async () => {},
};

const fakeAdapter: PortalAdapter = {
  id: 'fake',
  matches: () => true,
  entryUrl: (u: string) => u,
  getPageIdentity: async () => ({ state: 'UNKNOWN', confidence: 0, signals: [] }),
  sectionIdsForState: () => [],
  documentIdsForState: () => [],
  getFieldMap: () => ({}),
  canContinue: async () => ({ ok: true }),
  clickNext: async () => {},
  isFinalReview: () => false,
  submitSelector: null,
};

function fakePlan(ready: boolean, blockerCount = 0): ApplicationPlan {
  return {
    readyForAutomation: {
      ready,
      blockers: Array.from({ length: blockerCount }, (_, i) => ({
        text: `blocker ${i}`,
        kind: 'field' as const,
        source: null,
      })),
    },
    sections: [],
    documents: [],
    verification: { requiredTotal: 0 },
  } as unknown as ApplicationPlan;
}

const cleanInspection = (): PageInspection => ({
  pageTitle: null,
  elementCounts: {},
  securityChallengeFlags: {},
});

interface ServiceOpts {
  ready?: boolean;
  blockers?: number;
  stops?: EngineStop[];
  runLoop?: () => Promise<EngineStop>;
  inspect?: () => Promise<PageInspection>;
  browserManager?: unknown;
}

function makeService(opts: ServiceOpts = {}): AutomationService {
  const stops = opts.stops ?? ([{ kind: 'review_ready' }] as EngineStop[]);
  let call = 0;
  const runLoop =
    opts.runLoop ??
    (async (): Promise<EngineStop> => {
      const s = stops[Math.min(call, stops.length - 1)]!;
      call += 1;
      return s;
    });
  return new AutomationService({
    browserManager: (opts.browserManager ?? fakeBrowserManager) as never,
    resolveAdapter: () => fakeAdapter,
    runLoop: runLoop as never,
    inspect: (opts.inspect ?? (async () => cleanInspection())) as never,
    getApplication: () => ({
      application: { id: 'app1', applicantId: 'a1' },
      plan: fakePlan(opts.ready ?? true, opts.blockers ?? 0),
    }),
  });
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timed out');
}

describe('AutomationService', () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDbPath();
    db = openDatabase(dbPath);
    runMigrations(db);
    seedApplication(db);
    seedActivePortal(db);
  });
  afterEach(() => {
    db.close();
    cleanupTempDb(dbPath);
  });

  it('case 1: startRun on a not-ready application rejects NotReadyError and creates no run row', async () => {
    const svc = makeService({ ready: false, blockers: 2 });
    let caught: unknown;
    try {
      await svc.startRun(db, 'app1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NotReadyError);
    expect((caught as NotReadyError).blockers.length).toBe(2);
    const { c } = db.prepare('SELECT count(*) AS c FROM automation_runs').get() as { c: number };
    expect(c).toBe(0);
  });

  it('case 2: a second startRun while the first is active rejects RunInProgressError', async () => {
    const svc = makeService({ stops: [{ kind: 'waiting', reason: 'value_mismatch' }] });
    const run = await svc.startRun(db, 'app1');
    expect(['pending', 'running', 'waiting_for_user']).toContain(run.status);
    await expect(svc.startRun(db, 'app1')).rejects.toBeInstanceOf(RunInProgressError);
    await svc.dispose();
  });

  it('case 3: happy path reaches review_ready with ended_at set', async () => {
    const svc = makeService({ stops: [{ kind: 'review_ready' }] });
    const run = await svc.startRun(db, 'app1');
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'review_ready');
    const got = svc.getRun(db, run.id)!;
    expect(got.run.status).toBe('review_ready');
    expect(got.run.ended_at).not.toBeNull();
  });

  it('case 4: a value_mismatch wait resumes and the run reaches review_ready', async () => {
    const svc = makeService({
      stops: [{ kind: 'waiting', reason: 'value_mismatch' }, { kind: 'review_ready' }],
    });
    const run = await svc.startRun(db, 'app1');
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'waiting_for_user');
    const resumed = await svc.resumeRun(db, run.id);
    expect(['waiting_for_user', 'running', 'review_ready']).toContain(resumed.status);
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'review_ready');
    const events = svc.getRun(db, run.id)!.events;
    expect(events.some((e) => e.type === 'RUN_RESUMED')).toBe(true);
  });

  it('case 5: resumeRun on a running (non-waiting) run rejects NotWaitingError', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const svc = makeService({
      runLoop: async () => {
        await gate;
        return { kind: 'review_ready' };
      },
    });
    const run = await svc.startRun(db, 'app1');
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'running');
    await expect(svc.resumeRun(db, run.id)).rejects.toBeInstanceOf(NotWaitingError);
    release();
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'review_ready');
  });

  it('case 6: resume while an OTP checkpoint is still present rejects CheckpointStillPresentError', async () => {
    let inspection: PageInspection = cleanInspection();
    const svc = makeService({
      stops: [{ kind: 'waiting', reason: 'otp' }],
      inspect: async () => inspection,
    });
    const run = await svc.startRun(db, 'app1');
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'waiting_for_user');
    inspection = {
      pageTitle: null,
      elementCounts: {},
      securityChallengeFlags: { mentionsOtp: true },
    };
    await expect(svc.resumeRun(db, run.id)).rejects.toBeInstanceOf(CheckpointStillPresentError);
    const events = svc.getRun(db, run.id)!.events;
    expect(events.some((e) => e.type === 'CHECKPOINT_STILL_PRESENT')).toBe(true);
    await svc.dispose();
  });

  it('case 8: abortRun on a parked run persists a terminal status and releases the runner', async () => {
    const svc = makeService({
      stops: [{ kind: 'waiting', reason: 'value_mismatch' }, { kind: 'review_ready' }],
    });
    const run = await svc.startRun(db, 'app1');
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'waiting_for_user');

    await svc.abortRun(db, run.id);

    const got = svc.getRun(db, run.id)!;
    expect(got.run.status).toBe('aborted');
    expect(got.run.ended_at).not.toBeNull();
    expect(got.events.some((e) => e.type === 'RUN_ABORTED')).toBe(true);

    // A fresh run for the same application must not be blocked by the aborted one.
    await waitFor(() => svc.activeRunner === null || svc.activeRunner.runId !== run.id);
    await expect(svc.startRun(db, 'app1')).resolves.toBeDefined();
    await svc.dispose();
  });

  it('case 9: an engine error records error_code engine_error and never leaks the error message', async () => {
    const svc = makeService({
      runLoop: async () => {
        throw new Error('secret selector #passport-value-here');
      },
    });
    const run = await svc.startRun(db, 'app1');
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'failed');

    const got = svc.getRun(db, run.id)!.run;
    expect(got.error_code).toBe('engine_error');
    expect(got.error_message).not.toMatch(/secret|selector|#passport/);
    expect(got.error_message).toBe('Error');
  });

  it('case 7: dispose while a runner is parked at a wait resolves and closes the browser', async () => {
    let closed = false;
    const bm = { ...fakeBrowserManager, close: async () => {
      closed = true;
    } };
    const svc = makeService({
      stops: [{ kind: 'waiting', reason: 'value_mismatch' }],
      browserManager: bm,
    });
    const run = await svc.startRun(db, 'app1');
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'waiting_for_user');
    await expect(svc.dispose()).resolves.toBeUndefined();
    expect(closed).toBe(true);
  });
});
