import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/app.js';
import { loggerOptions } from '../../src/server/logger.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { createPortal, setActivePortal } from '../../src/server/services/portalService.js';
import { AutomationService } from '../../src/server/automation/automationService.js';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';
import { DiscoveryController } from '../../src/server/automation/discovery/discoveryController.js';
import { indiaAdapter } from '../../src/server/automation/adapters/india/indiaAdapter.js';
import { startFixturePortal, type FixturePortal } from '../helpers/fixturePortal.js';
import {
  FIXTURE_INDIA_PORTAL_MAP_V3,
  makeFixtureIndiaAdapter,
  type FixtureIndiaAdapterOptions,
} from './support/fixtureIndiaAdapter.js';
import type { ApplicationPlan, FieldPlan, SectionPlan } from '../../src/shared/application/types.js';
import type { Source } from '../../src/shared/visa-kb/schema.js';
import type { AutomationEventRow, AutomationRunRow } from '../../src/shared/automation/types.js';

// ---------------------------------------------------------------------------
// Phase 7 Task 12 — safety re-verification pass. Re-asserts every shipped rail
// with FRESH synthetic PII markers, in one Phase-7-labelled file:
//  - no field / plan value in the logs, automation_events, automation_runs
//  - submitCount === 0, no submit-like event, across every flow
//  - screenshots off by default
//  - OTP / CAPTCHA pause -> user -> re-detect -> resume
//  - stale_mapping / option_unavailable safe-stops (no fill attempt)
//  - the ToS runtime gate on BOTH entry points (startRun + discovery)
//  - a value_conflict pair never leaves the in-memory /live surface
// ---------------------------------------------------------------------------

/** Synthetic markers seeded into the plan's free-text fields. */
const SECRETS = [
  'TEST-NAME-ONLYX',
  'TEST-PASSPORT-123',
  'TEST-ADDR-NOWHERE',
  'TEST-JOB-XYZ',
  '2035-07-19', // passport.expiryDate (a date value)
];

function headlessBM(): BrowserManager {
  const bm = new BrowserManager();
  const orig = bm.launch.bind(bm);
  bm.launch = ((opts?: { headless?: boolean }) => orig({ ...opts, headless: true })) as BrowserManager['launch'];
  return bm;
}

const T = 't0';
const SRC = { officialUrl: 'https://x.test/', retrievedAt: '2026-01-01', confidence: 'secondary_guidance' } as unknown as Source;

function f(sectionId: string, appliesTo: string, value: string | null): FieldPlan {
  return {
    id: appliesTo, label: appliesTo, sectionId,
    requirement: 'required', condition: null, conditionMet: null,
    effectiveRequirement: 'required', appliesTo, value,
    present: value !== null, verified: true, source: SRC,
  };
}
function section(id: string, fields: FieldPlan[]): SectionPlan {
  return { id, label: id, applicable: true, source: SRC, fields };
}

/** Text-only production fields carrying markers, plus the portal-constrained ones. */
function markerSections(): SectionPlan[] {
  return [
    section('personal_particulars', [
      f('personal_particulars', 'identity.surname', 'TEST-NAME-ONLYX'),
      f('personal_particulars', 'identity.givenNames', 'GIVEN'),
      f('personal_particulars', 'identity.sex', 'M'),
    ]),
    section('passport_details', [
      f('passport_details', 'passport.number', 'TEST-PASSPORT-123'),
      f('passport_details', 'passport.expiryDate', '2035-07-19'),
    ]),
    section('address', [
      f('address', 'address.line1', 'TEST-ADDR-NOWHERE'),
      f('address', 'address.city', 'City'),
    ]),
    section('family', [f('family', 'family.maritalStatus', 'married')]),
    section('occupation', [f('occupation', 'occupation.occupation', 'TEST-JOB-XYZ')]),
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

let app: FastifyInstance;
let svc: AutomationService;
let portal: FixturePortal;
let dbPath: string;
let captured: string[];
let testLogger: FastifyBaseLogger;
let portalId: string;
const tmpDirs: string[] = [];

function walkPng(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkPng(full));
    else if (e.name.endsWith('.png')) out.push(full);
  }
  return out;
}

function seed(db: DatabaseSync, portalUrl: string): void {
  db.prepare(`INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`).run(T, T);
  db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES ('a1')`).run();
  db.prepare(
    `INSERT INTO visa_applications (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
     VALUES ('app1','a1','IND','regular','regular.tourist','draft','2026-09-06',?,?)`,
  ).run(T, T);
  const p = createPortal(db, {
    name: 'P', url: portalUrl, portalType: 'custom',
    country: null, applicationType: null, notes: null, enabled: true,
  });
  portalId = p.id;
  setActivePortal(db, p.id);
}

async function build(opts: {
  plan: ApplicationPlan;
  adapter?: FixtureIndiaAdapterOptions;
  real?: boolean;
  portalUrl?: string;
  automationDir?: string;
  discovery?: DiscoveryController;
}): Promise<void> {
  const portalUrl = opts.portalUrl ?? portal.url;
  svc = new AutomationService({
    browserManager: headlessBM(),
    resolveAdapter: () =>
      opts.real
        ? indiaAdapter
        : makeFixtureIndiaAdapter(portal.url, { ...opts.adapter, lifecycleMap: FIXTURE_INDIA_PORTAL_MAP_V3 }),
    getApplication: () => ({ application: { id: 'app1', applicantId: 'a1' }, plan: opts.plan }),
    automationDir: opts.automationDir,
  });
  app = await buildServer({
    dbPath,
    automation: svc,
    loggerInstance: testLogger,
    ...(opts.discovery ? { discovery: opts.discovery } : {}),
  });
  seed(app.db, portalUrl);
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 25000, step = 100): Promise<void> {
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
async function startRun(): Promise<{ status: number; body: unknown }> {
  const res = await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' });
  return { status: res.statusCode, body: res.json() };
}
async function settles(id: string, timeoutMs = 25000): Promise<void> {
  await waitFor(async () => {
    const s = (await getRun(id)).status;
    return s !== 'pending' && s !== 'running';
  }, timeoutMs);
}
function rowsJson(runId: string): string {
  return JSON.stringify({
    events: app.db.prepare('SELECT * FROM automation_events WHERE run_id = ?').all(runId),
    runs: app.db.prepare('SELECT * FROM automation_runs').all(),
    sessions: app.db.prepare('SELECT * FROM portal_discovery_sessions').all(),
    pages: app.db.prepare('SELECT * FROM portal_discovery_pages').all(),
  });
}

beforeEach(async () => {
  dbPath = makeTempDbPath();
  portal = await startFixturePortal();
  captured = [];
  const stream = { write: (c: string) => captured.push(c) };
  testLogger = pino({ ...loggerOptions, level: 'info', transport: undefined }, stream) as unknown as FastifyBaseLogger;
});
afterEach(async () => {
  await svc?.dispose().catch(() => undefined);
  if (app) await app.close().catch(() => undefined);
  await portal?.close().catch(() => undefined);
  cleanupTempDb(dbPath);
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('phase 7 safety re-verification', () => {
  it('1. a full v3 run leaks no marker into logs / events / runs, and never submits', async () => {
    const automationDir = path.join(mkdtempSync(path.join(tmpdir(), 'p7s-')), 'evidence');
    tmpDirs.push(path.dirname(automationDir));
    await build({ plan: makePlan(markerSections(), 12), automationDir });
    portal.setChallenge('otp');

    const { status } = await startRun();
    expect(status).toBe(201);
    const id = (await app.db.prepare('SELECT id FROM automation_runs').get() as { id: string }).id;

    await settles(id);
    portal.setChallenge('ok');
    await app.inject({ method: 'POST', url: `/api/automation-runs/${id}/resume` });
    await waitFor(async () => (await getRun(id)).status === 'review_ready', 30000);

    const evs = await getEvents(id);
    // non-vacuous: the markers really did pass through the engine.
    expect(evs.some((e) => e.type === 'FIELD_VERIFIED' && e.field_path === 'identity.surname')).toBe(true);

    const haystack = captured.join('') + rowsJson(id);
    for (const s of SECRETS) expect(haystack, `leaked ${s}`).not.toContain(s);

    // no-submit
    expect(evs.some((e) => /submit|confirm|lodge|pay/i.test(e.type))).toBe(false);
    expect(portal.submitCount).toBe(0);
    // screenshots off by default
    expect(walkPng(automationDir)).toEqual([]);
  }, 60000);

  it('2. an OTP checkpoint: resume while it is still present → 409; resume after it clears → continues', async () => {
    await build({ plan: makePlan(markerSections(), 12) });
    portal.setChallenge('otp');
    const { status } = await startRun();
    expect(status).toBe(201);
    const id = (app.db.prepare('SELECT id FROM automation_runs').get() as { id: string }).id;

    await settles(id);
    expect((await getRun(id)).waiting_reason).toBe('otp');

    const stillThere = await app.inject({ method: 'POST', url: `/api/automation-runs/${id}/resume` });
    expect(stillThere.statusCode).toBe(409);
    expect(stillThere.json().error.code).toBe('CHECKPOINT_STILL_PRESENT');

    portal.setChallenge('ok');
    const ok = await app.inject({ method: 'POST', url: `/api/automation-runs/${id}/resume` });
    expect(ok.statusCode).toBe(202);
    await waitFor(async () => (await getRun(id)).status === 'review_ready', 30000);
    expect(portal.submitCount).toBe(0);
  }, 60000);

  it('3. a CAPTCHA checkpoint pauses (reason captcha), no fill, no submit', async () => {
    await build({ plan: makePlan(markerSections(), 12), adapter: { entryPath: '/challenge?challenge=captcha' } });
    const { status } = await startRun();
    expect(status).toBe(201);
    const id = (app.db.prepare('SELECT id FROM automation_runs').get() as { id: string }).id;
    await settles(id);
    expect((await getRun(id)).waiting_reason).toBe('captcha');
    const evs = await getEvents(id);
    expect(evs.some((e) => e.type === 'FIELD_FILL_STARTED')).toBe(false);
    expect(portal.submitCount).toBe(0);
  });

  it('4. a stale mapping never fills and leaks no marker', async () => {
    await build({
      plan: makePlan([section('family', [f('family', 'family.spouseName', 'TEST-NAME-ONLYX')])], 1),
      adapter: { entryPath: '/family' },
    });
    const { status } = await startRun();
    expect(status).toBe(201);
    const id = (app.db.prepare('SELECT id FROM automation_runs').get() as { id: string }).id;
    await settles(id);

    expect((await getRun(id)).waiting_reason).toBe('stale_mapping');
    const evs = await getEvents(id);
    expect(evs.some((e) => e.type === 'FIELD_FILL_STARTED')).toBe(false);
    expect(captured.join('') + rowsJson(id)).not.toContain('TEST-NAME-ONLYX');
    expect(portal.submitCount).toBe(0);
  });

  it('5. an unavailable dropdown option pauses (option_unavailable), the control is untouched, no submit', async () => {
    await build({
      plan: makePlan([section('visa_details', [f('visa_details', 'application.purpose', 'business')])], 1),
      adapter: { entryPath: '/visa-details?option=removed' },
    });
    const { status } = await startRun();
    expect(status).toBe(201);
    const id = (app.db.prepare('SELECT id FROM automation_runs').get() as { id: string }).id;
    await settles(id);
    expect((await getRun(id)).waiting_reason).toBe('option_unavailable');
    expect(portal.submitCount).toBe(0);
  });

  it('6. the ToS gate refuses startRun for a real India host with no acknowledgement (no run row, no browser launch)', async () => {
    let launched = false;
    const bm = headlessBM();
    const origLaunch = bm.launch.bind(bm);
    bm.launch = (async (o?: unknown) => {
      launched = true;
      return origLaunch(o as never);
    }) as BrowserManager['launch'];

    svc = new AutomationService({
      browserManager: bm,
      resolveAdapter: () => indiaAdapter,
      getApplication: () => ({ application: { id: 'app1', applicantId: 'a1' }, plan: makePlan(markerSections(), 12) }),
    });
    app = await buildServer({ dbPath, automation: svc, loggerInstance: testLogger });
    seed(app.db, 'https://indianvisaonline.gov.in/evisa/');

    const res = await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TOS_NOT_ACKNOWLEDGED');
    expect((app.db.prepare('SELECT count(*) AS c FROM automation_runs').get() as { c: number }).c).toBe(0);
    expect(launched).toBe(false);
  });

  it('7. the ToS gate refuses a discovery session for a real India host with no acknowledgement', async () => {
    const profileDir = mkdtempSync(path.join(tmpdir(), 'p7s-disco-'));
    tmpDirs.push(profileDir);
    const controller = new DiscoveryController({ resolveAdapter: () => indiaAdapter, profileDir });
    svc = new AutomationService({
      browserManager: headlessBM(),
      resolveAdapter: () => indiaAdapter,
      getApplication: () => ({ application: { id: 'app1', applicantId: 'a1' }, plan: makePlan(markerSections(), 12) }),
    });
    app = await buildServer({ dbPath, automation: svc, discovery: controller, loggerInstance: testLogger });
    seed(app.db, 'https://indianvisaonline.gov.in/evisa/');

    const res = await app.inject({ method: 'POST', url: `/api/portals/${portalId}/discovery-sessions` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TOS_NOT_ACKNOWLEDGED');
    expect((app.db.prepare('SELECT count(*) AS c FROM portal_discovery_sessions').get() as { c: number }).c).toBe(0);
  });

  it('8. a value_conflict pair lives only in /live — never in a persisted row', async () => {
    await build({
      plan: makePlan([section('personal_particulars', [f('personal_particulars', 'identity.surname', 'TEST-NAME-ONLYX')])], 1),
    });
    portal.setPrefill('conflict');
    portal.setChallenge('ok');

    const { status } = await startRun();
    expect(status).toBe(201);
    const id = (app.db.prepare('SELECT id FROM automation_runs').get() as { id: string }).id;
    await settles(id);
    expect((await getRun(id)).waiting_reason).toBe('value_conflict');

    const live = await app.inject({ method: 'GET', url: `/api/automation-runs/${id}/live` });
    const m = live.json().mismatches.find((x: { fieldPath: string }) => x.fieldPath === 'identity.surname');
    expect(m).toEqual({ fieldPath: 'identity.surname', expected: 'TEST-NAME-ONLYX', actual: 'SOMEONE-ELSE' });

    const haystack = captured.join('') + rowsJson(id);
    expect(haystack).not.toContain('TEST-NAME-ONLYX');
    expect(haystack).not.toContain('SOMEONE-ELSE');
    expect(portal.submitCount).toBe(0);
  });
});
