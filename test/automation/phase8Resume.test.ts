import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Page } from 'playwright';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { createPortal, setActivePortal } from '../../src/server/services/portalService.js';
import { AutomationService, CheckpointStillPresentError } from '../../src/server/automation/automationService.js';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';
import { startFixturePortal, type FixturePortal } from '../helpers/fixturePortal.js';
import { makeFixtureIndiaAdapter } from './support/fixtureIndiaAdapter.js';
import { indiaPortalMap, type IndiaFieldMapping } from '../../src/server/automation/adapters/india/indiaPortalMap.js';
import type {
  EngineContext,
  EngineStop,
} from '../../src/server/automation/engine/automationEngine.js';
import type { PortalAdapter } from '../../src/server/automation/adapters/baseAdapter.js';
import type { PageInspection } from '../../src/server/automation/engine/pageInspector.js';
import type { PageIdentity } from '../../src/shared/automation/types.js';
import type {
  ApplicationPlan,
  FieldPlan,
  SectionPlan,
} from '../../src/shared/application/types.js';
import type { Source } from '../../src/shared/visa-kb/schema.js';
import type { AutomationEventRow, AutomationRunRow } from '../../src/shared/automation/types.js';

// ---------------------------------------------------------------------------
// Phase 8 Task 12 — regression lock: a resumed run RE-DETECTS the current page
// and RE-CHECKS mapping readiness on the first post-resume iteration; it never
// blindly continues from where it paused. Also pins the resume-time checkpoint
// re-check at the service layer.
// ---------------------------------------------------------------------------

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

function seedActivePortal(db: DatabaseSync, url = 'https://example.gov/apply'): void {
  const portal = createPortal(db, {
    name: 'Fake Portal',
    url,
    portalType: 'custom',
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

function baseFakeAdapter(): PortalAdapter {
  return {
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
}

function fakePlan(): ApplicationPlan {
  return {
    readyForAutomation: { ready: true, blockers: [] },
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

async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timed out');
}

// ===========================================================================
// (a) + (c) — pure-fake service harness (deterministic)
// ===========================================================================

describe('phase 8 — resume re-detects page + re-runs the checkpoint check (service)', () => {
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

  it('a resume re-detects the current page before re-entering the loop (never assumes the old page)', async () => {
    // The engine paused at an OTP checkpoint having detected PASSPORT. While the
    // run is parked the operator navigates the portal to the ADDRESS page. The
    // real service loop rebuilds the EngineContext and re-invokes runLoop on
    // resume; runLoop here exercises the REAL detectPage + adapter to prove the
    // next iteration acts on ADDRESS, not the stale PASSPORT.
    let pageState = 'PASSPORT';
    const adapter: PortalAdapter = {
      ...baseFakeAdapter(),
      getPageIdentity: async (): Promise<PageIdentity> => ({
        state: pageState,
        confidence: 0.95,
        signals: [],
      }),
    };
    let call = 0;
    const svc = new AutomationService({
      browserManager: fakeBrowserManager as never,
      resolveAdapter: () => adapter,
      inspect: (async () => cleanInspection()) as never,
      runLoop: (async (ctx: EngineContext): Promise<EngineStop> => {
        call += 1;
        const inspection = await ctx.inspect(ctx.page);
        const identity = await ctx.detectPage(ctx.page, ctx.adapter, inspection);
        await ctx.emit({ type: 'PAGE_DETECTED', portalState: identity.state });
        if (call === 1) {
          await ctx.emit({ type: 'OTP_REQUIRED', portalState: identity.state });
          return { kind: 'waiting', reason: 'otp' };
        }
        return { kind: 'review_ready' };
      }) as never,
      getApplication: () => ({ application: { id: 'app1', applicantId: 'a1' }, plan: fakePlan() }),
    });

    const run = await svc.startRun(db, 'app1');
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'waiting_for_user');

    // it paused having really detected PASSPORT
    expect(
      svc
        .getRun(db, run.id)!
        .events.some((e) => e.type === 'PAGE_DETECTED' && e.portal_state === 'PASSPORT'),
    ).toBe(true);

    // operator navigates the portal while the run is parked
    pageState = 'ADDRESS';

    await svc.resumeRun(db, run.id);
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'review_ready');

    const events: AutomationEventRow[] = svc.getRun(db, run.id)!.events;
    const resumedIdx = events.findIndex((e) => e.type === 'RUN_RESUMED');
    const addressIdx = events.findIndex(
      (e) => e.type === 'PAGE_DETECTED' && e.portal_state === 'ADDRESS',
    );
    expect(resumedIdx).toBeGreaterThanOrEqual(0);
    // the resumed iteration detected ADDRESS...
    expect(addressIdx).toBeGreaterThan(resumedIdx);
    // ...and never re-detected the stale PASSPORT after the resume
    expect(
      events.some(
        (e, i) => i > resumedIdx && e.type === 'PAGE_DETECTED' && e.portal_state === 'PASSPORT',
      ),
    ).toBe(false);
    expect(svc.getRun(db, run.id)!.run.status).toBe('review_ready');
  });

  it('a resume re-runs the checkpoint check and rejects while the challenge is still present', async () => {
    let inspection: PageInspection = cleanInspection();
    const svc = new AutomationService({
      browserManager: fakeBrowserManager as never,
      resolveAdapter: () => baseFakeAdapter(),
      inspect: (async () => inspection) as never,
      runLoop: (async (): Promise<EngineStop> => ({ kind: 'waiting', reason: 'otp' })) as never,
      getApplication: () => ({ application: { id: 'app1', applicantId: 'a1' }, plan: fakePlan() }),
    });

    const run = await svc.startRun(db, 'app1');
    await waitFor(() => svc.getRun(db, run.id)?.run.status === 'waiting_for_user');

    // the OTP challenge is still on the page when the operator hits resume
    inspection = {
      pageTitle: null,
      elementCounts: {},
      securityChallengeFlags: { mentionsOtp: true },
    };
    await expect(svc.resumeRun(db, run.id)).rejects.toBeInstanceOf(CheckpointStillPresentError);

    const after = svc.getRun(db, run.id)!;
    expect(after.events.some((e) => e.type === 'CHECKPOINT_STILL_PRESENT')).toBe(true);
    // still parked and resumable — the failed resume did not advance the run
    expect(after.run.status).toBe('waiting_for_user');
    expect(after.run.waiting_reason).toBe('otp');
    await svc.dispose();
  });
});

// ===========================================================================
// (b) — real engine + headless chromium + fixture portal
// ===========================================================================

function headlessBM(): BrowserManager {
  const bm = new BrowserManager();
  const orig = bm.launch.bind(bm);
  bm.launch = ((opts?: { headless?: boolean }) =>
    orig({ ...opts, headless: true })) as BrowserManager['launch'];
  return bm;
}

const SRC = {
  officialUrl: 'https://x.test/',
  retrievedAt: '2026-01-01',
  confidence: 'secondary_guidance',
} as unknown as Source;

function f(sectionId: string, appliesTo: string, value: string): FieldPlan {
  return {
    id: appliesTo,
    label: appliesTo,
    sectionId,
    requirement: 'required',
    condition: null,
    conditionMet: null,
    effectiveRequirement: 'required',
    appliesTo,
    value,
    present: true,
    verified: true,
    source: SRC,
  } as unknown as FieldPlan;
}

function section(id: string, fields: FieldPlan[]): SectionPlan {
  return { id, label: id, applicable: true, source: SRC, fields } as unknown as SectionPlan;
}

function makePlan(sections: SectionPlan[], requiredTotal: number): ApplicationPlan {
  return {
    selection: {},
    category: null,
    eligibility: {},
    sections,
    documents: [],
    missing: [],
    verification: { requiredVerified: 0, requiredTotal, ratio: 0, label: 'unverified', bySection: {} },
    readyForAutomation: { ready: true, blockers: [] },
    provenance: {},
    warnings: [],
  } as unknown as ApplicationPlan;
}

describe('phase 8 — resume past a fixed stale mapping (real engine + headless chromium)', () => {
  let app: FastifyInstance;
  let svc: AutomationService;
  let portal: FixturePortal;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = makeTempDbPath();
    portal = await startFixturePortal();
  });
  afterEach(async () => {
    await svc?.dispose().catch(() => undefined);
    if (app) await app.close().catch(() => undefined);
    await portal?.close().catch(() => undefined);
    cleanupTempDb(dbPath);
  });

  async function getRun(id: string): Promise<AutomationRunRow> {
    return (await app.inject({ method: 'GET', url: `/api/automation-runs/${id}` })).json()
      .run as AutomationRunRow;
  }
  async function getEvents(id: string): Promise<AutomationEventRow[]> {
    return (await app.inject({ method: 'GET', url: `/api/automation-runs/${id}` })).json()
      .events as AutomationEventRow[];
  }
  async function poll(fn: () => Promise<boolean>, timeoutMs = 25000): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await fn()) return;
      if (Date.now() - start > timeoutMs) throw new Error('poll timed out');
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it('a run paused on stale_mapping resumes past the field once the map is production-usable', async () => {
    const rev = indiaPortalMap.mappingRevision;
    const validated = (selector: string, control: 'text' | 'radio', againstRev: string): IndiaFieldMapping =>
      ({
        selector,
        control,
        selectorConfidence: 'stable',
        status: 'validated',
        discoverySessionRef: 'fixture',
        validatedAt: '2026-09-06T00:00:00.000Z',
        validatedAgainstRevision: againstRev,
      }) as IndiaFieldMapping;

    // A lifecycle map the test holds by reference: family.spouseName starts
    // STALE (validated against an old revision → filtered out of getFieldMap,
    // classified 'stale' by mappingReadiness). The adapter reads this object on
    // every getFieldMap()/mappingReadiness() call, so mutating it mid-run is
    // exactly the "operator re-validated the mapping" case.
    const mutableMap = {
      mappingRevision: rev,
      fields: {
        'family.maritalStatus': validated('input[name="marital-status"]', 'radio', rev),
        'family.spouseName': validated('#spouse-name', 'text', '2020-01-01'),
      } as Record<string, IndiaFieldMapping>,
    };

    svc = new AutomationService({
      browserManager: headlessBM(),
      resolveAdapter: () =>
        makeFixtureIndiaAdapter(portal.url, { entryPath: '/family', lifecycleMap: mutableMap }),
      getApplication: () => ({
        application: { id: 'app1', applicantId: 'a1' },
        plan: makePlan(
          [
            section('family', [
              f('family', 'family.maritalStatus', 'married'),
              f('family', 'family.spouseName', 'RANA'),
            ]),
          ],
          2,
        ),
      }),
    });
    app = await buildServer({ dbPath, automation: svc });
    seedApplication(app.db);
    const p = createPortal(app.db, {
      name: 'Fixture India',
      url: portal.url,
      portalType: 'custom',
      country: null,
      applicationType: null,
      notes: null,
      enabled: true,
    });
    setActivePortal(app.db, p.id);
    portal.setChallenge('ok');

    const started = await app.inject({
      method: 'POST',
      url: '/api/applications/app1/automation-runs',
    });
    expect(started.statusCode).toBe(201);
    const id = started.json().run.id as string;

    // pauses on the stale mapping — spouseName never filled
    await poll(async () => (await getRun(id)).status === 'waiting_for_user');
    expect((await getRun(id)).waiting_reason).toBe('stale_mapping');
    let evs = await getEvents(id);
    expect(evs.find((e) => e.type === 'MAPPING_NOT_PRODUCTION_READY')).toMatchObject({
      field_path: 'family.spouseName',
      status: 'blocked',
    });
    expect(evs.some((e) => e.type === 'FIELD_FILL_STARTED' && e.field_path === 'family.spouseName')).toBe(
      false,
    );

    // operator re-validates the mapping against the current revision, then resumes
    const spouseMapping = mutableMap.fields['family.spouseName'];
    expect(spouseMapping).toBeDefined();
    spouseMapping!.validatedAgainstRevision = rev;
    const resumed = await app.inject({ method: 'POST', url: `/api/automation-runs/${id}/resume` });
    expect(resumed.statusCode).toBe(202);

    await poll(async () => (await getRun(id)).status === 'review_ready', 30000);

    const run = await getRun(id);
    expect(run.status).toBe('review_ready');
    expect(run.waiting_reason).toBeNull();
    expect(run.fields_verified).toBe(run.fields_total);

    evs = await getEvents(id);
    expect(
      evs.some((e) => e.type === 'FIELD_VERIFIED' && e.field_path === 'family.spouseName'),
    ).toBe(true);
    // it did not re-pause on the (now fixed) stale mapping
    expect(
      evs.filter((e) => e.type === 'MAPPING_NOT_PRODUCTION_READY').length,
    ).toBe(1);
    expect(portal.submitCount).toBe(0);
  }, 60000);
});
