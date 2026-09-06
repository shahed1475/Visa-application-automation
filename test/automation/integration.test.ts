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
// The real engine (`runLoop`, `inspect`, `detectPage`, `applyField`,
// `readControl`, `settle`) driving a real headless chromium against the local
// fixture portal (Task 14). Spec §17 "Integration" — the 8 scenarios.
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

/** A FieldPlan the engine will read. `present` follows `value` unless overridden. */
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

// ---------------------------------------------------------------------------

let app: FastifyInstance;
let svc: AutomationService;
let portal: FixturePortal;
let dbPath: string;

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
}): Promise<void> {
  svc = makeSvc(opts);
  app = await buildServer({ dbPath, automation: svc });
  seed(app.db);
}

async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 15000,
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

/** Poll until the run leaves the transient `pending`/`running` states. */
async function runSettles(id: string): Promise<void> {
  await waitFor(async () => {
    const s = (await getRun(id)).status;
    return s !== 'pending' && s !== 'running';
  });
}

const SUBMIT_RE = /submit|confirm|lodge|pay/i;

function assertNoSubmitEvents(events: AutomationEventRow[]): void {
  expect(events.some((e) => SUBMIT_RE.test(e.type))).toBe(false);
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
});

describe('fixture-portal integration (real engine + real headless chromium)', () => {
  it('1. happy path: walks every page, pauses at the OTP challenge, resumes to review_ready', async () => {
    await build();
    const id = await startRun();

    await runSettles(id);
    let run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('otp');

    let events = await getEvents(id);
    expect(events.some((e) => e.type === 'OTP_REQUIRED')).toBe(true);

    portal.setChallenge('ok');
    const resumed = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${id}/resume`,
    });
    expect(resumed.statusCode).toBe(202);

    await waitFor(async () => (await getRun(id)).status === 'review_ready');
    run = await getRun(id);
    expect(run.status).toBe('review_ready');
    expect(run.waiting_reason).toBeNull();

    events = await getEvents(id);
    expect(events.some((e) => e.type === 'REVIEW_READY')).toBe(true);
    assertNoSubmitEvents(events);
    expect(portal.submitCount).toBe(0);
  });

  it('2. CAPTCHA: pauses, refuses resume while present, then resumes once cleared', async () => {
    await build();
    portal.setChallenge('captcha');
    const id = await startRun();

    await runSettles(id);
    let run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('captcha');
    expect((await getEvents(id)).some((e) => e.type === 'CAPTCHA_REQUIRED')).toBe(true);

    const stillBlocked = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${id}/resume`,
    });
    expect(stillBlocked.statusCode).toBe(409);
    expect(stillBlocked.json().error.code).toBe('CHECKPOINT_STILL_PRESENT');
    expect(
      (await getEvents(id)).some((e) => e.type === 'CHECKPOINT_STILL_PRESENT'),
    ).toBe(true);

    portal.setChallenge('ok');
    const resumed = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${id}/resume`,
    });
    expect(resumed.statusCode).toBe(202);

    await waitFor(async () => (await getRun(id)).status === 'review_ready');
    run = await getRun(id);
    expect(run.status).toBe('review_ready');
    assertNoSubmitEvents(await getEvents(id));
    expect(portal.submitCount).toBe(0);
  });

  it('3. missing required field on FAMILY: canContinue false → validation_error, no navigation past FAMILY', async () => {
    const sections = defaultSections();
    const family = sections.find((s) => s.id === 'family')!;
    family.fields = [
      f('family', 'family.maritalStatus', 'married'),
      f('family', 'family.spouseName', null, { present: false, value: null }),
    ];
    await build({
      adapter: { failCanContinueOn: ['FAMILY'] },
      plan: makeReadyPlan({ sections }),
    });
    const id = await startRun();

    await runSettles(id);
    const run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('validation_error');
    expect((await getEvents(id)).some((e) => e.type === 'VALIDATION_ERROR')).toBe(true);

    // The engine filled personal/passport/address/family but never advanced.
    expect(portal.requests.some((r) => r.url === '/occupation')).toBe(false);
    expect(portal.requests.some((r) => r.url === '/family')).toBe(true);
    expect(portal.submitCount).toBe(0);
  });

  it('4. missing required document: BLOCKED_MISSING_DOCUMENT → status failed / missing_document', async () => {
    await build({
      adapter: { documentIds: { DOCUMENTS: ['invitation_letter_indian_company'] } },
      plan: makeReadyPlan({
        documents: [
          {
            id: 'invitation_letter_indian_company',
            label: 'Invitation letter',
            requirement: 'required',
            condition: null,
            conditionMet: null,
            effectiveRequirement: 'required',
            uploaded: false,
            matchedDocumentId: null,
            source: SRC,
          },
        ],
      }),
    });
    const id = await startRun();

    await runSettles(id);
    const run = await getRun(id);
    expect(run.status).toBe('failed');
    expect(run.error_code).toBe('missing_document');
    expect(run.waiting_reason).toBeNull();

    const events = await getEvents(id);
    const blocked = events.find((e) => e.type === 'BLOCKED_MISSING_DOCUMENT');
    expect(blocked?.field_path).toBe('invitation_letter_indian_company');
    assertNoSubmitEvents(events);
    expect(portal.submitCount).toBe(0);
  });

  it('5. unknown page: entry URL points at /nonsense → unknown_page, no fills attempted', async () => {
    await build({ adapter: { entryPath: '/nonsense' } });
    const id = await startRun();

    await runSettles(id);
    const run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('unknown_page');

    const events = await getEvents(id);
    expect(events.some((e) => e.type === 'UNKNOWN_PORTAL_STATE')).toBe(true);
    expect(events.some((e) => e.type === 'FIELD_FILL_STARTED')).toBe(false);
    expect(portal.submitCount).toBe(0);
  });

  it('6. value mismatch: a self-mutating control never verifies → value_mismatch + /live, no raw values persisted', async () => {
    await build({
      adapter: {
        fieldMapOverride: {
          'identity.surname': {
            selector: '#surname-bad',
            control: 'text',
            selectorConfidence: 'stable',
          },
        },
      },
    });
    const id = await startRun();

    await runSettles(id);
    const run = await getRun(id);
    expect(run.status).toBe('waiting_for_user');
    expect(run.waiting_reason).toBe('value_mismatch');

    const live = await app.inject({
      method: 'GET',
      url: `/api/automation-runs/${id}/live`,
    });
    expect(live.statusCode).toBe(200);
    const m = live
      .json()
      .mismatches.find((x: { fieldPath: string }) => x.fieldPath === 'identity.surname');
    expect(m).toBeDefined();
    expect(m.expected).toBe('RANA');
    expect(m.actual).toContain('RANAX');

    // The persisted events must carry NEITHER the expected NOR the actual value.
    const rows = app.db
      .prepare('SELECT * FROM automation_events WHERE run_id = ?')
      .all(id);
    const json = JSON.stringify(rows);
    expect(json).not.toContain('RANA');
    expect(json).not.toContain('RANAX');
    expect(portal.submitCount).toBe(0);
  });

  it('7. crash / resume: dispose the service mid-pause, rebuild, resume from the DB record', async () => {
    await build();
    const id = await startRun();
    await runSettles(id);
    expect((await getRun(id)).waiting_reason).toBe('otp');

    // Simulate a process crash: kill the runner + browser, drop the server.
    await svc.dispose();
    await waitFor(() => svc.activeRunner === null, 5000);
    await app.close();

    // Fresh service + server on the SAME db file — no re-seed (rows persist).
    svc = makeSvc();
    app = await buildServer({ dbPath, automation: svc });

    // The run row must have survived as resumable, not aborted.
    expect((await getRun(id)).status).toBe('waiting_for_user');

    portal.setChallenge('ok');
    const resumed = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${id}/resume`,
    });
    expect(resumed.statusCode).toBe(202);

    await waitFor(async () => (await getRun(id)).status === 'review_ready', 20000);
    const events = await getEvents(id);
    expect(events.some((e) => e.type === 'FIELD_VERIFIED')).toBe(true);
    assertNoSubmitEvents(events);
    expect(portal.submitCount).toBe(0);
  });

  it('8. not ready: POST automation-runs → 409 NOT_READY, no run row created', async () => {
    await build({
      plan: {
        readyForAutomation: {
          ready: false,
          blockers: [
            { text: 'x', kind: 'field', source: null },
            { text: 'y', kind: 'document', source: null },
          ],
        },
        sections: [],
        documents: [],
      } as unknown as ApplicationPlan,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/applications/app1/automation-runs',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_READY');
    expect(res.json().blockers).toHaveLength(2);

    const { c } = app.db
      .prepare('SELECT count(*) AS c FROM automation_runs')
      .get() as { c: number };
    expect(c).toBe(0);
  });
});
