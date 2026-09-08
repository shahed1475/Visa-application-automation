import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { createPortal, setActivePortal } from '../../src/server/services/portalService.js';
import { AutomationService } from '../../src/server/automation/automationService.js';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';
import { startFixturePortal, type FixturePortal } from '../helpers/fixturePortal.js';
import {
  FIXTURE_INDIA_PORTAL_MAP_ALL_VALIDATED,
  makeFixtureIndiaAdapter,
} from './support/fixtureIndiaAdapter.js';
import { TIMING_PROFILES, BENCHMARK_TIMING } from '../../src/server/automation/engine/timing.js';
import type { ApplicationPlan, FieldPlan, SectionPlan } from '../../src/shared/application/types.js';
import type { Source } from '../../src/shared/visa-kb/schema.js';
import type { AutomationEventRow, AutomationRunRow } from '../../src/shared/automation/types.js';

// ---------------------------------------------------------------------------
// Phase 8 Task 6 — DETERMINISTIC performance benchmark.
//
// Runs the REAL engine + AutomationService + headless chromium against the
// local fixture portal v3 through the production-controlled India adapter, with
// the fully-validated fixture map (max production fields) and BENCHMARK_TIMING
// (every human delay 0) so the run is fast and cannot flake on a slow CI box.
//
// It then MODELS the wall-clock a `normal`-timing-profile run would take:
//   - modeledObservedMs        — the ACTUAL fill / nav counts from this run.
//   - modeledRealApplicationMs — a REPRESENTATIVE real India e-visa shape
//                                (35 fields, 7 navigations) — the ≤2-min claim.
//
// Never touches a real portal or the network. No submit-shaped event, ever.
// ---------------------------------------------------------------------------

function headlessBM(): BrowserManager {
  const bm = new BrowserManager();
  const orig = bm.launch.bind(bm);
  bm.launch = ((opts?: { headless?: boolean }) =>
    orig({ ...opts, headless: true })) as BrowserManager['launch'];
  return bm;
}

const T = 't0';
const SRC = {
  officialUrl: 'https://x.test/',
  retrievedAt: '2026-01-01',
  confidence: 'secondary_guidance',
} as unknown as Source;

function f(sectionId: string, appliesTo: string, value: string | null): FieldPlan {
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
    present: value !== null,
    verified: true,
    source: SRC,
  } as unknown as FieldPlan;
}
function section(id: string, fields: FieldPlan[]): SectionPlan {
  return { id, label: id, applicable: true, source: SRC, fields } as unknown as SectionPlan;
}

/**
 * A representative PREPARED application: every one of the 13 fixture-portal
 * controls populated with a synthetic value, spread across the fixture's pages.
 * (The fixture portal has fewer controls than a real e-visa form — the real
 * shape is modelled by hard-coded counts in the assertion below.)
 */
function representativePreparedPlan(): ApplicationPlan {
  const sections: SectionPlan[] = [
    section('personal_particulars', [
      f('personal_particulars', 'identity.surname', 'RANA'),
      f('personal_particulars', 'identity.givenNames', 'MITHU'),
      f('personal_particulars', 'identity.sex', 'M'),
    ]),
    section('passport_details', [
      f('passport_details', 'passport.number', 'BG1234567'),
      f('passport_details', 'passport.expiryDate', '2032-01-01'),
    ]),
    section('address', [
      f('address', 'address.line1', '12 Road 4'),
      f('address', 'address.city', 'Dhaka'),
    ]),
    section('family', [
      f('family', 'family.maritalStatus', 'married'),
      f('family', 'family.spouseName', 'MITHU SULTANA'),
    ]),
    section('occupation', [f('occupation', 'occupation.occupation', 'Engineer')]),
    section('visa_details', [
      f('visa_details', 'application.purpose', 'business'),
      f('visa_details', 'application.intendedArrivalDate', '2027-01-15'),
    ]),
    section('previous_visits', [f('previous_visits', 'application.visitedIndiaBefore', 'no')]),
    section('references', []),
  ];
  return {
    selection: {},
    category: null,
    eligibility: {},
    sections,
    documents: [],
    missing: [],
    verification: {
      requiredVerified: 0,
      requiredTotal: 13,
      ratio: 0,
      label: 'unverified',
      bySection: {},
    },
    readyForAutomation: { ready: true, blockers: [] },
    provenance: {},
    warnings: [],
  } as unknown as ApplicationPlan;
}

let app: FastifyInstance;
let svc: AutomationService;
let portal: FixturePortal;
let dbPath: string;

function seed(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`,
  ).run(T, T);
  db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES ('a1')`).run();
  db.prepare(
    `INSERT INTO visa_applications (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
     VALUES ('app1','a1','IND','regular','regular.tourist','draft','2026-09-06',?,?)`,
  ).run(T, T);
  const p = createPortal(db, {
    name: 'Fixture India',
    url: portal.url,
    portalType: 'custom',
    country: null,
    applicationType: null,
    notes: null,
    enabled: true,
  });
  setActivePortal(db, p.id);
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 30000, step = 100): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, step));
  }
}

async function runFixtureToReviewReady(opts: {
  timing: typeof BENCHMARK_TIMING;
}): Promise<{ runId: string; run: AutomationRunRow; events: AutomationEventRow[] }> {
  svc = new AutomationService({
    browserManager: headlessBM(),
    resolveAdapter: () =>
      makeFixtureIndiaAdapter(portal.url, {
        lifecycleMap: FIXTURE_INDIA_PORTAL_MAP_ALL_VALIDATED,
      }),
    getApplication: () => ({
      application: { id: 'app1', applicantId: 'a1' },
      plan: representativePreparedPlan(),
    }),
    timing: opts.timing,
  });
  app = await buildServer({ dbPath, automation: svc });
  seed(app.db);

  // No OTP pause: the fixture's /challenge renders "ok" so the run walks
  // straight through. A human OTP wait is not autofill time and must not be
  // measured (see brief).
  portal.setChallenge('ok');

  const res = await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' });
  expect(res.statusCode).toBe(201);
  const runId = res.json().run.id as string;

  await waitFor(async () => {
    const r = (
      await app.inject({ method: 'GET', url: `/api/automation-runs/${runId}` })
    ).json().run as AutomationRunRow;
    return r.status !== 'pending' && r.status !== 'running';
  });

  const body = (await app.inject({ method: 'GET', url: `/api/automation-runs/${runId}` })).json();
  return {
    runId,
    run: body.run as AutomationRunRow,
    events: body.events as AutomationEventRow[],
  };
}

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

describe('phase 8 — performance', () => {
  it('a representative prepared application reaches review_ready and models under 2 minutes', async () => {
    const t0 = performance.now();
    const { events, run } = await runFixtureToReviewReady({ timing: BENCHMARK_TIMING });
    const fixtureMs = performance.now() - t0;

    expect(run.status).toBe('review_ready');
    expect(run.fields_verified).toBe(run.fields_total);
    expect(run.fields_total).toBeGreaterThan(0);
    // no submit-shaped event; the fixture's submit endpoint stays untouched
    expect(events.some((e) => /SUBMIT|CONFIRM|LODGE|PAY/i.test(e.type))).toBe(false);
    expect(portal.submitCount).toBe(0);

    // The fully-validated fixture map exposes every fixture control as
    // production-usable — nothing filtered out as stale/unvalidated.
    const validatedFields = Object.values(FIXTURE_INDIA_PORTAL_MAP_ALL_VALIDATED.fields);
    expect(validatedFields.length).toBe(13);
    expect(
      validatedFields.every(
        (m) =>
          m.status === 'validated' &&
          m.validatedAgainstRevision === FIXTURE_INDIA_PORTAL_MAP_ALL_VALIDATED.mappingRevision,
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === 'MAPPING_NOT_PRODUCTION_READY')).toBe(false);

    const fills = events.filter((e) => e.type === 'FIELD_FILL_STARTED').length;
    const navs = events.filter((e) => e.type === 'NAVIGATION_STARTED').length;
    // every prepared field was filled once — the max production set.
    expect(fills).toBe(13);

    const p = TIMING_PROFILES.normal;
    const perField = p.scrollDelayMs + p.fieldInteractionDelayMs + p.postFillVerifyDelayMs;
    const perNav = p.navigationWaitMs + 1_500; // + ~1.5s typical page settle
    const BROWSER_OPEN_MS = 5_000; // browser launch + entry goto — fixed budget

    const model = (fillCount: number, navCount: number): number =>
      BROWSER_OPEN_MS + fillCount * perField + navCount * perNav + fixtureMs;

    // (a) the ACTUAL shape of this fixture run, costed at `normal` timings.
    const modeledObservedMs = model(fills, navs);

    // (b) a REPRESENTATIVE real India e-visa: ~35 fields over ~7 form pages.
    // Hard-coded because the fixture portal is deliberately smaller than the
    // real form; these are the representative shape, not a fixture measurement.
    const REAL_FIELDS = 35;
    const REAL_NAVS = 7;
    const modeledRealApplicationMs = model(REAL_FIELDS, REAL_NAVS);

    console.log(
      `[bench] fixtureMs=${fixtureMs | 0} fills=${fills} navs=${navs} ` +
        `modeledObservedMs=${modeledObservedMs | 0} ` +
        `modeledRealApplicationMs=${modeledRealApplicationMs | 0}`,
    );

    // The real ≤2-minute guarantee — pure arithmetic on constants + counts.
    expect(modeledRealApplicationMs).toBeLessThan(120_000);
    // M3 — the MEASURED shape must also gate: this fixture run, costed at
    // `normal` timings, is well under the 2-minute budget, and it actually
    // navigated (a walk that never advanced would model as trivially fast).
    expect(navs).toBeGreaterThan(0);
    expect(modeledObservedMs).toBeLessThan(120_000);
    // Loose CI ceiling on the fixture run itself — never the point of the test.
    expect(fixtureMs).toBeLessThan(90_000);
  }, 120_000);
});
