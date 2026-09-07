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
  FIXTURE_INDIA_PORTAL_MAP_V3,
  makeFixtureIndiaAdapter,
  type FixtureIndiaAdapterOptions,
} from './support/fixtureIndiaAdapter.js';
import { isoToDMY, parseDMY } from '../../src/server/automation/adapters/india/transforms.js';
import type { IndiaPortalMap } from '../../src/server/automation/adapters/india/indiaPortalMap.js';
import type {
  ApplicationPlan,
  FieldPlan,
  SectionPlan,
} from '../../src/shared/application/types.js';
import type { Source } from '../../src/shared/visa-kb/schema.js';
import type {
  AutomationEventRow,
  AutomationRunRow,
} from '../../src/shared/automation/types.js';

// ---------------------------------------------------------------------------
// Phase 7 Task 11 — the real engine + AutomationService + headless chromium
// driving fixture portal v3 through the PRODUCTION-controlled India adapter
// (FIXTURE_INDIA_PORTAL_MAP_V3, lifecycle mode). Proves end-to-end: the
// production-only field map, stale_mapping / option_unavailable safe-stops,
// SELECTOR_STALE on a configured fallback, an explicit date transform, session
// expiry -> safe stop, and a full populated run to review_ready.
//
// Global invariant: every scenario asserts portal.submitCount === 0.
// ---------------------------------------------------------------------------

function headlessBM(): BrowserManager {
  const bm = new BrowserManager();
  const orig = bm.launch.bind(bm);
  bm.launch = ((opts?: { headless?: boolean }) =>
    orig({ ...opts, headless: true })) as BrowserManager['launch'];
  return bm;
}

const T = 't0';
const SRC = { officialUrl: 'https://x.test/', retrievedAt: '2026-01-01', confidence: 'secondary_guidance' } as unknown as Source;

function f(sectionId: string, appliesTo: string, value: string | null, over: Partial<FieldPlan> = {}): FieldPlan {
  return {
    id: appliesTo, label: appliesTo, sectionId,
    requirement: 'required', condition: null, conditionMet: null,
    effectiveRequirement: 'required', appliesTo, value,
    present: value !== null, verified: true, source: SRC, ...over,
  };
}
function section(id: string, fields: FieldPlan[]): SectionPlan {
  return { id, label: id, applicable: true, source: SRC, fields };
}

/** The 12 production-usable v3 fields (v2's 13 minus the deliberately-stale family.spouseName). */
function productionSections(): SectionPlan[] {
  return [
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
    section('family', [f('family', 'family.maritalStatus', 'married')]),
    section('occupation', [f('occupation', 'occupation.occupation', 'Engineer')]),
    section('visa_details', [
      f('visa_details', 'application.purpose', 'business'),
      f('visa_details', 'application.intendedArrivalDate', '2027-01-15'),
    ]),
    section('previous_visits', [f('previous_visits', 'application.visitedIndiaBefore', 'no')]),
    section('references', []),
  ];
}

function makePlan(sections: SectionPlan[], requiredTotal: number): ApplicationPlan {
  return {
    selection: {}, category: null, eligibility: {},
    sections, documents: [], missing: [],
    verification: { requiredVerified: 0, requiredTotal, ratio: 0, label: 'unverified', bySection: {} },
    readyForAutomation: { ready: true, blockers: [] },
    provenance: {}, warnings: [],
  } as unknown as ApplicationPlan;
}

type LifecycleMap = Pick<IndiaPortalMap, 'mappingRevision' | 'fields'>;

let app: FastifyInstance;
let svc: AutomationService;
let portal: FixturePortal;
let dbPath: string;

function seed(db: DatabaseSync): void {
  db.prepare(`INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`).run(T, T);
  db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES ('a1')`).run();
  db.prepare(
    `INSERT INTO visa_applications (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
     VALUES ('app1','a1','IND','regular','regular.tourist','draft','2026-09-06',?,?)`,
  ).run(T, T);
  const p = createPortal(db, {
    name: 'Fixture India', url: portal.url, portalType: 'custom',
    country: null, applicationType: null, notes: null, enabled: true,
  });
  setActivePortal(db, p.id);
}

async function build(opts: {
  plan: ApplicationPlan;
  adapter?: FixtureIndiaAdapterOptions;
  lifecycleMap?: LifecycleMap;
}): Promise<void> {
  const lifecycleMap = opts.lifecycleMap ?? FIXTURE_INDIA_PORTAL_MAP_V3;
  svc = new AutomationService({
    browserManager: headlessBM(),
    resolveAdapter: () => makeFixtureIndiaAdapter(portal.url, { ...opts.adapter, lifecycleMap }),
    getApplication: () => ({ application: { id: 'app1', applicantId: 'a1' }, plan: opts.plan }),
  });
  app = await buildServer({ dbPath, automation: svc });
  seed(app.db);
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 20000, step = 100): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, step));
  }
}
async function getRun(id: string): Promise<AutomationRunRow> {
  return (await app.inject({ method: 'GET', url: `/api/automation-runs/${id}` })).json().run as AutomationRunRow;
}
async function getEvents(id: string): Promise<AutomationEventRow[]> {
  return (await app.inject({ method: 'GET', url: `/api/automation-runs/${id}` })).json().events as AutomationEventRow[];
}
async function startRun(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' });
  expect(res.statusCode).toBe(201);
  return res.json().run.id as string;
}
async function settles(id: string, timeoutMs = 25000): Promise<void> {
  await waitFor(async () => {
    const s = (await getRun(id)).status;
    return s !== 'pending' && s !== 'running';
  }, timeoutMs);
}
const types = (evs: AutomationEventRow[]) => evs.map((e) => e.type);
function assertNoSubmit(evs: AutomationEventRow[]): void {
  expect(evs.some((e) => /submit|confirm|lodge|pay/i.test(e.type))).toBe(false);
  expect(portal.submitCount).toBe(0);
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

describe('phase 7 matrix (real engine + headless chromium + fixture v3)', () => {
  it('1. full populated run: fills only production mappings, pauses OTP, resumes to review_ready', async () => {
    await build({ plan: makePlan(productionSections(), 12) });
    portal.setChallenge('otp');

    const id = await startRun();
    await settles(id);
    expect((await getRun(id)).waiting_reason).toBe('otp');

    portal.setChallenge('ok');
    expect((await app.inject({ method: 'POST', url: `/api/automation-runs/${id}/resume` })).statusCode).toBe(202);

    await waitFor(async () => (await getRun(id)).status === 'review_ready', 30000);
    const run = await getRun(id);
    expect(run.status).toBe('review_ready');
    expect(run.fields_verified).toBe(run.fields_total);
    expect(run.fields_total).toBe(12);

    const evs = await getEvents(id);
    // each production field was filled exactly once (no double-fill across the pause).
    const surnameFills = evs.filter(
      (e) => e.field_path === 'identity.surname' && e.type === 'FIELD_FILL_STARTED',
    );
    expect(surnameFills).toHaveLength(1);
    expect(evs.some((e) => e.type === 'FIELD_VERIFIED' && e.field_path === 'identity.surname')).toBe(true);
    expect(evs.some((e) => e.type === 'REVIEW_READY')).toBe(true);
    assertNoSubmit(evs);
  }, 60000);

  it('2. a stale mapping (family.spouseName) → MAPPING_NOT_PRODUCTION_READY + stale_mapping, never filled', async () => {
    await build({
      plan: makePlan([section('family', [f('family', 'family.spouseName', 'MITHU SULTANA')])], 1),
      adapter: { entryPath: '/family' },
    });
    const id = await startRun();
    await settles(id);

    const run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('stale_mapping');
    const evs = await getEvents(id);
    expect(evs.find((e) => e.type === 'MAPPING_NOT_PRODUCTION_READY')).toMatchObject({
      field_path: 'family.spouseName',
      status: 'blocked',
    });
    expect(types(evs)).not.toContain('FIELD_FILL_STARTED');
    assertNoSubmit(evs);
  });

  it('3. an unmapped required field → missing_field_mapping (NOT stale_mapping)', async () => {
    await build({
      plan: makePlan([section('occupation', [f('occupation', 'occupation.employerName', 'Acme')])], 1),
      adapter: { entryPath: '/occupation' },
    });
    const id = await startRun();
    await settles(id);

    expect((await getRun(id)).waiting_reason).toBe('missing_field_mapping');
    const evs = await getEvents(id);
    expect(types(evs)).toContain('FIELD_UNMAPPED');
    expect(types(evs)).not.toContain('MAPPING_NOT_PRODUCTION_READY');
    assertNoSubmit(evs);
  });

  it('4. a removed dropdown option → DROPDOWN_OPTION_MISSING + option_unavailable, the control is untouched', async () => {
    await build({
      plan: makePlan([section('visa_details', [f('visa_details', 'application.purpose', 'business')])], 1),
      adapter: { entryPath: '/visa-details?option=removed' },
    });
    const id = await startRun();
    await settles(id);

    const run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('option_unavailable');
    const evs = await getEvents(id);
    expect(evs.find((e) => e.type === 'DROPDOWN_OPTION_MISSING')).toMatchObject({
      field_path: 'application.purpose',
      status: 'blocked',
    });
    assertNoSubmit(evs);
  });

  it('5. a disabled dropdown option → option_unavailable', async () => {
    await build({
      plan: makePlan([section('visa_details', [f('visa_details', 'application.purpose', 'business')])], 1),
      adapter: { entryPath: '/visa-details?option=disabled' },
    });
    const id = await startRun();
    await settles(id);
    expect((await getRun(id)).waiting_reason).toBe('option_unavailable');
    assertNoSubmit(await getEvents(id));
  });

  it('6. primary selector gone but the configured fallback resolves → SELECTOR_STALE, run continues', async () => {
    await build({
      plan: makePlan([section('personal_particulars', [f('personal_particulars', 'identity.surname', 'RANA')])], 1),
      adapter: { entryPath: '/personal?selector=fallback' },
    });
    portal.setChallenge('ok');
    const id = await startRun();
    await waitFor(async () => (await getRun(id)).status === 'review_ready', 30000);

    const evs = await getEvents(id);
    expect(evs.find((e) => e.type === 'SELECTOR_STALE')).toMatchObject({ field_path: 'identity.surname' });
    expect(evs.some((e) => e.type === 'FIELD_VERIFIED' && e.field_path === 'identity.surname')).toBe(true);
    assertNoSubmit(evs);
  }, 40000);

  it('7. primary AND fallback selector gone → FIELD_NOT_FOUND + missing_field_mapping (never a guess)', async () => {
    await build({
      plan: makePlan([section('personal_particulars', [f('personal_particulars', 'identity.surname', 'RANA')])], 1),
      adapter: { entryPath: '/personal?selector=changed' },
    });
    const id = await startRun();
    await settles(id);
    expect((await getRun(id)).waiting_reason).toBe('missing_field_mapping');
    const evs = await getEvents(id);
    expect(evs.find((e) => e.type === 'FIELD_NOT_FOUND')).toMatchObject({ field_path: 'identity.surname' });
    assertNoSubmit(evs);
  }, 40000);

  it('8. an explicit DD/MM/YYYY date transform round-trips: fill via isoToDMY, verify via parseDMY', async () => {
    const dmyMap: LifecycleMap = {
      mappingRevision: FIXTURE_INDIA_PORTAL_MAP_V3.mappingRevision,
      fields: {
        'application.intendedArrivalDate': {
          selector: '#passport-expiry',
          control: 'date',
          selectorConfidence: 'stable',
          status: 'validated',
          discoverySessionRef: 'fixture',
          validatedAt: '2026-09-06T00:00:00.000Z',
          validatedAgainstRevision: FIXTURE_INDIA_PORTAL_MAP_V3.mappingRevision,
          transform: isoToDMY,
          readBackParse: parseDMY,
        },
      },
    };
    await build({
      plan: makePlan([section('visa_details', [f('visa_details', 'application.intendedArrivalDate', '2027-01-15')])], 1),
      adapter: { entryPath: '/dates' },
      lifecycleMap: dmyMap,
    });
    const id = await startRun();
    await waitFor(async () => (await getRun(id)).status === 'review_ready', 30000);

    const evs = await getEvents(id);
    expect(
      evs.some((e) => e.type === 'FIELD_VERIFIED' && e.field_path === 'application.intendedArrivalDate'),
    ).toBe(true);
    // the value the plan asked for never reaches a persisted event
    const raw = JSON.stringify(app.db.prepare('SELECT * FROM automation_events WHERE run_id = ?').all(id));
    expect(raw).not.toContain('2027-01-15');
    expect(raw).not.toContain('15/01/2027');
    assertNoSubmit(evs);
  }, 40000);

  it('9. a session-expired page → unknown_page safe stop, no fields touched', async () => {
    await build({
      plan: makePlan([section('personal_particulars', [f('personal_particulars', 'identity.surname', 'RANA')])], 1),
      adapter: { entryPath: '/personal?session=expired' },
    });
    const id = await startRun();
    await settles(id);

    const run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('unknown_page');
    const evs = await getEvents(id);
    expect(types(evs)).toContain('UNKNOWN_PORTAL_STATE');
    expect(types(evs)).not.toContain('FIELD_FILL_STARTED');
    assertNoSubmit(evs);
  });

  it('10. a CAPTCHA checkpoint pauses with reason captcha', async () => {
    await build({ plan: makePlan(productionSections(), 12), adapter: { entryPath: '/challenge?challenge=captcha' } });
    const id = await startRun();
    await settles(id);
    expect((await getRun(id)).waiting_reason).toBe('captcha');
    const evs = await getEvents(id);
    expect(types(evs)).toContain('CAPTCHA_REQUIRED');
    assertNoSubmit(evs);
  });
});
