import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { createPortal, setActivePortal } from '../../src/server/services/portalService.js';
import { AutomationService } from '../../src/server/automation/automationService.js';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';
import { DiscoveryController } from '../../src/server/automation/discovery/discoveryController.js';
import { startFixturePortal, type FixturePortal } from '../helpers/fixturePortal.js';
import {
  makeFixtureIndiaAdapter,
  type FixtureIndiaAdapterOptions,
} from './support/fixtureIndiaAdapter.js';
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
// Task 13 — the real engine (`runLoop` + `AutomationService` + `resumeRun`)
// driving a real headless chromium against fixture portal v2 (Task 12). Proves
// the whole India autofill path end-to-end: prefill-match skip, value-conflict →
// both resume decisions, WebForms-page identity + advance, unknown page stop, a
// full populated run to `review_ready`, and a discovery-session round-trip.
//
// Global invariant: every scenario asserts `submitCount === 0`. The engine has
// no submit affordance and `adapter.submitSelector` is `null` by contract.
// ---------------------------------------------------------------------------

/** Force headless regardless of `AUTOMATION_HEADLESS`. */
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

function f(
  sectionId: string,
  appliesTo: string,
  value: string | null,
  over: Partial<FieldPlan> = {},
): FieldPlan {
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
    ...over,
  };
}

function section(id: string, fields: FieldPlan[]): SectionPlan {
  return { id, label: id, applicable: true, source: SRC, fields };
}

/** The full 13-required-field walk (personal → … → previous visits). */
function defaultSections(): SectionPlan[] {
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
    section('family', [
      f('family', 'family.maritalStatus', 'married'),
      f('family', 'family.spouseName', 'MITHU SULTANA'),
    ]),
    section('occupation', [f('occupation', 'occupation.occupation', 'Engineer')]),
    section('visa_details', [
      f('visa_details', 'application.purpose', 'business'),
      f('visa_details', 'application.intendedArrivalDate', '2027-01-15'),
    ]),
    section('previous_visits', [
      f('previous_visits', 'application.visitedIndiaBefore', 'no'),
    ]),
    section('references', []),
  ];
}

function makeReadyPlan(over?: {
  sections?: SectionPlan[];
  documents?: unknown[];
  requiredTotal?: number;
}): ApplicationPlan {
  return {
    selection: {},
    category: null,
    eligibility: {},
    sections: over?.sections ?? defaultSections(),
    documents: over?.documents ?? [],
    missing: [],
    verification: {
      requiredVerified: 0,
      requiredTotal: over?.requiredTotal ?? 13,
      ratio: 0,
      label: 'unverified',
      bySection: {},
    },
    readyForAutomation: { ready: true, blockers: [] },
    provenance: {},
    warnings: [],
  } as unknown as ApplicationPlan;
}

// ---------------------------------------------------------------------------

let app: FastifyInstance;
let svc: AutomationService;
let portal: FixturePortal;
let dbPath: string;
let portalId: string;
const tmpDirs: string[] = [];

function seed(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1', 'A', 'draft', ?, ?)`,
  ).run(T, T);
  db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES ('a1')`).run();
  db.prepare(
    `INSERT INTO visa_applications
       (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
     VALUES ('app1', 'a1', 'IND', 'regular', 'regular.tourist', 'draft', '2026-09-06', ?, ?)`,
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
  portalId = p.id;
  setActivePortal(db, p.id);
}

function makeSvc(opts?: {
  adapter?: FixtureIndiaAdapterOptions;
  plan?: ApplicationPlan;
}): AutomationService {
  const plan = opts?.plan ?? makeReadyPlan();
  return new AutomationService({
    browserManager: headlessBM(),
    resolveAdapter: () => makeFixtureIndiaAdapter(portal.url, opts?.adapter),
    getApplication: () => ({
      application: { id: 'app1', applicantId: 'a1' },
      plan,
    }),
  });
}

async function build(opts?: {
  adapter?: FixtureIndiaAdapterOptions;
  plan?: ApplicationPlan;
  discovery?: DiscoveryController;
}): Promise<void> {
  svc = makeSvc(opts);
  app = await buildServer({ dbPath, automation: svc, discovery: opts?.discovery });
  seed(app.db);
}

async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 20000,
  step = 100,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, step));
  }
}

async function getRun(id: string): Promise<AutomationRunRow> {
  const res = await app.inject({ method: 'GET', url: `/api/automation-runs/${id}` });
  return res.json().run as AutomationRunRow;
}

async function getEvents(id: string): Promise<AutomationEventRow[]> {
  const res = await app.inject({ method: 'GET', url: `/api/automation-runs/${id}` });
  return res.json().events as AutomationEventRow[];
}

async function startRun(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/applications/app1/automation-runs',
  });
  expect(res.statusCode).toBe(201);
  return res.json().run.id as string;
}

async function runSettles(id: string, timeoutMs = 20000): Promise<void> {
  await waitFor(async () => {
    const s = (await getRun(id)).status;
    return s !== 'pending' && s !== 'running';
  }, timeoutMs);
}

const SUBMIT_RE = /submit|confirm|lodge|pay/i;

function assertNoSubmitEvents(events: AutomationEventRow[]): void {
  expect(events.some((e) => SUBMIT_RE.test(e.type))).toBe(false);
}

/** The persisted event rows for this run, serialised (for a "no raw value" scan). */
function persistedEventsJson(id: string): string {
  const rows = app.db.prepare('SELECT * FROM automation_events WHERE run_id = ?').all(id);
  return JSON.stringify(rows);
}

// ---------------------------------------------------------------------------

beforeEach(async () => {
  dbPath = makeTempDbPath();
  portal = await startFixturePortal();
});

afterEach(async () => {
  await svc?.dispose().catch(() => undefined);
  if (app) await app.close().catch(() => undefined);
  await portal?.close().catch(() => undefined);
  cleanupTempDb(dbPath);
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('phase-6 fixture-v2 integration (real engine + headless chromium)', () => {
  it('1. prefill-match: the pre-filled surname is left as-is (FIELD_ALREADY_SET, not VALUE_CONFLICT); reaches review_ready', async () => {
    const sections = defaultSections();
    sections[0]!.fields = [f('personal_particulars', 'identity.surname', 'RANA')];
    await build({ plan: makeReadyPlan({ sections }) });
    portal.setPrefill('match');
    portal.setChallenge('ok');

    const id = await startRun();
    await waitFor(async () => (await getRun(id)).status === 'review_ready', 25000);

    const run = await getRun(id);
    expect(run.status).toBe('review_ready');
    const events = await getEvents(id);
    const surname = events.filter((e) => e.field_path === 'identity.surname');
    expect(surname.some((e) => e.type === 'FIELD_ALREADY_SET')).toBe(true);
    expect(events.some((e) => e.type === 'VALUE_CONFLICT')).toBe(false);
    assertNoSubmitEvents(events);
    expect(portal.submitCount).toBe(0);
  });

  it('2. prefill-conflict → keep_portal: pauses value_conflict, /live carries the pair, events do not, resume keeps the portal value', async () => {
    const sections = defaultSections();
    sections[0]!.fields = [f('personal_particulars', 'identity.surname', 'RANA')];
    await build({ plan: makeReadyPlan({ sections }) });
    portal.setPrefill('conflict');
    portal.setChallenge('ok');

    const id = await startRun();
    await runSettles(id);
    let run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('value_conflict');
    expect((await getEvents(id)).some((e) => e.type === 'VALUE_CONFLICT')).toBe(true);

    const live = await app.inject({ method: 'GET', url: `/api/automation-runs/${id}/live` });
    expect(live.statusCode).toBe(200);
    const m = live
      .json()
      .mismatches.find((x: { fieldPath: string }) => x.fieldPath === 'identity.surname');
    expect(m).toEqual({ fieldPath: 'identity.surname', expected: 'RANA', actual: 'SOMEONE-ELSE' });

    // The pair lives ONLY in /live — never in the persisted events.
    const json = persistedEventsJson(id);
    expect(json).not.toContain('RANA');
    expect(json).not.toContain('SOMEONE-ELSE');

    const resumed = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${id}/resume`,
      payload: { decision: 'keep_portal' },
    });
    expect(resumed.statusCode).toBe(202);

    await waitFor(async () => (await getRun(id)).status === 'review_ready', 25000);
    run = await getRun(id);
    expect(run.status).toBe('review_ready');
    const events = await getEvents(id);
    expect(events.some((e) => e.type === 'FIELD_CONFLICT_KEPT')).toBe(true);
    expect(persistedEventsJson(id)).not.toContain('SOMEONE-ELSE');
    assertNoSubmitEvents(events);
    expect(portal.submitCount).toBe(0);
  });

  it('3. prefill-conflict → use_application: resume overwrites the portal value with the application value and verifies it', async () => {
    const sections = defaultSections();
    sections[0]!.fields = [f('personal_particulars', 'identity.surname', 'RANA')];
    await build({ plan: makeReadyPlan({ sections }) });
    portal.setPrefill('conflict');
    portal.setChallenge('ok');

    const id = await startRun();
    await runSettles(id);
    const paused = await getRun(id);
    expect(paused.status).toBe('waiting_for_user');
    expect(paused.waiting_reason).toBe('value_conflict');

    const resumed = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${id}/resume`,
      payload: { decision: 'use_application' },
    });
    expect(resumed.statusCode).toBe(202);

    await waitFor(async () => (await getRun(id)).status === 'review_ready', 25000);
    const events = await getEvents(id);
    const surname = events.filter((e) => e.field_path === 'identity.surname');
    expect(surname.some((e) => e.type === 'FIELD_CONFLICT_OVERWRITTEN')).toBe(true);
    expect(surname.some((e) => e.type === 'FIELD_VERIFIED')).toBe(true);
    const json = persistedEventsJson(id);
    expect(json).not.toContain('RANA');
    expect(json).not.toContain('SOMEONE-ELSE');
    assertNoSubmitEvents(events);
    expect(portal.submitCount).toBe(0);
  });

  it('4. conflict resume with no decision → 400 DECISION_REQUIRED; the run stays waiting_for_user', async () => {
    const sections = defaultSections();
    sections[0]!.fields = [f('personal_particulars', 'identity.surname', 'RANA')];
    await build({ plan: makeReadyPlan({ sections }) });
    portal.setPrefill('conflict');
    portal.setChallenge('ok');

    const id = await startRun();
    await runSettles(id);
    expect((await getRun(id)).waiting_reason).toBe('value_conflict');

    const res = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${id}/resume`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('DECISION_REQUIRED');

    const run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('value_conflict');
    const json = persistedEventsJson(id);
    expect(json).not.toContain('RANA');
    expect(json).not.toContain('SOMEONE-ELSE');
    expect(portal.submitCount).toBe(0);
  });

  it('5. WebForms page: entry at /webforms-personal is identified (>= 0.6), fills via the wf- controls, advances via .next — no false NAVIGATION_STALLED', async () => {
    const sections = defaultSections();
    sections[0]!.fields = [
      f('personal_particulars', 'identity.surname', 'RANA'),
      f('personal_particulars', 'identity.givenNames', 'MITHU'),
    ];
    await build({
      adapter: {
        entryPath: '/webforms-personal',
        fieldMapOverride: {
          'identity.surname': {
            selector: '#wf-surname',
            control: 'text',
            selectorConfidence: 'stable',
          },
          'identity.givenNames': {
            selector: '#wf-given-names',
            control: 'text',
            selectorConfidence: 'stable',
          },
        },
      },
      plan: makeReadyPlan({ sections }),
    });
    portal.setChallenge('ok');

    const id = await startRun();
    await waitFor(async () => (await getRun(id)).status === 'review_ready', 25000);

    const run = await getRun(id);
    expect(run.status).toBe('review_ready');
    const events = await getEvents(id);
    expect(
      events.some((e) => e.type === 'PAGE_DETECTED' && e.portal_state === 'WEBFORMS_PERSONAL'),
    ).toBe(true);
    expect(events.some((e) => e.type === 'UNKNOWN_PORTAL_STATE')).toBe(false);
    expect(events.some((e) => e.type === 'NAVIGATION_STALLED')).toBe(false);
    expect(
      events.some((e) => e.type === 'FIELD_VERIFIED' && e.field_path === 'identity.surname'),
    ).toBe(true);
    expect(portal.requests.some((r) => r.url === '/webforms-personal')).toBe(true);
    expect(portal.requests.some((r) => r.url === '/passport')).toBe(true);
    assertNoSubmitEvents(events);
    expect(portal.submitCount).toBe(0);
  }, 60000);

  it('6. unknown page: entry at /nowhere (a real 200 page that matches no adapter state) → unknown_page, no fills attempted', async () => {
    await build({ adapter: { entryPath: '/nowhere' } });
    const id = await startRun();

    await runSettles(id);
    const run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('unknown_page');

    const events = await getEvents(id);
    expect(events.some((e) => e.type === 'UNKNOWN_PORTAL_STATE')).toBe(true);
    expect(events.some((e) => e.type === 'FIELD_FILL_STARTED')).toBe(false);
    assertNoSubmitEvents(events);
    expect(portal.submitCount).toBe(0);
  });

  it('7. full populated run: walks every section, pauses OTP, resumes to review_ready with fields_verified === fields_total; nothing submit-like', async () => {
    await build();
    // The adapter contract: no submit affordance, ever.
    expect(makeFixtureIndiaAdapter(portal.url).submitSelector).toBeNull();
    portal.setChallenge('otp');

    const id = await startRun();
    await runSettles(id);
    let run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('otp');
    expect((await getEvents(id)).some((e) => e.type === 'OTP_REQUIRED')).toBe(true);

    portal.setChallenge('ok');
    const resumed = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${id}/resume`,
    });
    expect(resumed.statusCode).toBe(202);

    await waitFor(async () => (await getRun(id)).status === 'review_ready', 25000);
    run = await getRun(id);
    expect(run.status).toBe('review_ready');
    expect(run.fields_total).toBe(13);
    expect(run.fields_verified).toBe(run.fields_total);

    const events = await getEvents(id);
    expect(events.some((e) => e.type === 'REVIEW_READY')).toBe(true);
    // Global constraint: no event type matches /submit|confirm|lodge|pay/i.
    assertNoSubmitEvents(events);
    expect(portal.submitCount).toBe(0);
  }, 60000);

  it('8. discovery round-trip: start → user navigates to a prefilled page → capture → end; 1 page captured with a real state guess + non-empty candidates, and NO rendered control value leaks into the row', async () => {
    const profileDir = mkdtempSync(path.join(tmpdir(), 'phase6-disco-'));
    tmpDirs.push(profileDir);
    const controller = new DiscoveryController({
      resolveAdapter: () => makeFixtureIndiaAdapter(portal.url),
      profileDir,
    });
    await build({ discovery: controller });

    const started = await app.inject({
      method: 'POST',
      url: `/api/portals/${portalId}/discovery-sessions`,
    });
    expect(started.statusCode).toBe(201);
    const sessionId = started.json().session.id as string;

    // The operator drives the real headed browser to a page that RENDERS
    // recognisable control values (`#surname` = "SOMEONE-ELSE", `#given-names` =
    // "DIFFERENT" per fixturePortal's `?prefill=conflict`). captureDiscoveryV2
    // must persist page STRUCTURE only — never a control value (commit 81a1d74).
    await controller.activePage!.goto(`${portal.url}/personal?prefill=conflict`, {
      waitUntil: 'domcontentloaded',
    });
    // Guard against a vacuous leak check: the value really is in the live DOM.
    expect(await controller.activePage!.locator('#surname').inputValue()).toBe('SOMEONE-ELSE');
    expect(await controller.activePage!.locator('#given-names').inputValue()).toBe('DIFFERENT');

    const captured = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${sessionId}/capture`,
    });
    expect(captured.statusCode).toBe(201);

    const ended = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${sessionId}/end`,
    });
    expect(ended.statusCode).toBe(202);

    const view = await app.inject({
      method: 'GET',
      url: `/api/discovery-sessions/${sessionId}`,
    });
    expect(view.statusCode).toBe(200);
    const body = view.json() as {
      session: { status: string; page_count: number };
      pages: {
        state_guess: string | null;
        candidates_json: string;
        url_pattern: string | null;
      }[];
    };
    expect(body.session.status).toBe('ended');
    expect(body.pages).toHaveLength(1);
    const pageRow = body.pages[0]!;

    // Capture did its real job: a recognised state + a non-empty candidate array.
    expect(pageRow.state_guess).toBe('PERSONAL_DETAILS');
    expect(pageRow.candidates_json).not.toBe('[]');
    const candidates = JSON.parse(pageRow.candidates_json) as unknown[];
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
    expect(pageRow.url_pattern).toContain('127.0.0.1');

    // ...but NONE of the rendered control values reached the persisted row —
    // not the full GET body, and not `candidates_json` specifically.
    const RENDERED_VALUES = ['SOMEONE-ELSE', 'DIFFERENT'];
    const serialized = JSON.stringify(body.pages);
    for (const v of RENDERED_VALUES) {
      expect(serialized, `discovery GET body leaked rendered value ${v}`).not.toContain(v);
      expect(pageRow.candidates_json, `candidates_json leaked rendered value ${v}`).not.toContain(v);
    }
    // And the raw persisted table row is clean too (defence in depth).
    const rawRows = app.db
      .prepare('SELECT * FROM portal_discovery_pages WHERE session_id = ?')
      .all(sessionId);
    const rawJson = JSON.stringify(rawRows);
    for (const v of RENDERED_VALUES) {
      expect(rawJson, `portal_discovery_pages row leaked ${v}`).not.toContain(v);
    }

    // Discovery is read-only: it never posts the fixture submit endpoint.
    expect(portal.submitCount).toBe(0);
  }, 60000);
});
