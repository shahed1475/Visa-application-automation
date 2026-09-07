import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/app.js';
import { loggerOptions } from '../../src/server/logger.js';
import { env } from '../../src/server/env.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { createPortal, setActivePortal } from '../../src/server/services/portalService.js';
import { AutomationService } from '../../src/server/automation/automationService.js';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';
import { EVENT_MESSAGES } from '../../src/shared/automation/events.js';
import { startFixturePortal, type FixturePortal } from '../helpers/fixturePortal.js';
import { DiscoveryController } from '../../src/server/automation/discovery/discoveryController.js';
import { updateDiscoverySession } from '../../src/server/automation/discovery/discoverySessionStore.js';
import { validateAdapterAgainstPage } from '../../src/server/automation/adapters/india/validateAdapter.js';
import { makeFixtureIndiaAdapter, FIXTURE_INDIA_PORTAL_MAP_V2 } from './support/fixtureIndiaAdapter.js';
import type {
  ApplicationPlan,
  FieldPlan,
  SectionPlan,
} from '../../src/shared/application/types.js';
import type { Source } from '../../src/shared/visa-kb/schema.js';
import type { AutomationRunRow } from '../../src/shared/automation/types.js';

// ---------------------------------------------------------------------------
// Spec §17 "Security" (behavioural half): full-run redaction, screenshot-evidence
// path safety, behavioural isolation, not-ready refusal. Reuses the Task 15
// fixture-portal integration harness (real engine + real headless chromium).
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

/** The 13 canonical `appliesTo` paths the Task 14 field map covers. */
const CONTRACT_PATHS = new Set([
  'identity.surname',
  'identity.givenNames',
  'identity.sex',
  'passport.number',
  'passport.expiryDate',
  'address.line1',
  'address.city',
  'family.maritalStatus',
  'family.spouseName',
  'occupation.occupation',
  'application.purpose',
  'application.intendedArrivalDate',
  'application.visitedIndiaBefore',
]);

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
  readyForAutomation?: { ready: boolean; blockers: unknown[] };
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
    readyForAutomation: over?.readyForAutomation ?? { ready: true, blockers: [] },
    provenance: {},
    warnings: [],
  } as unknown as ApplicationPlan;
}

// ---------------------------------------------------------------------------

let app: FastifyInstance;
let svc: AutomationService;
let portal: FixturePortal;
let dbPath: string;
let captured: string[];
let testLogger: FastifyBaseLogger;
let portalId: string;
const tmpDirs: string[] = [];

/** Every `.png` file anywhere under `dir` (recursive). `[]` if `dir` is absent. */
function walkPng(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkPng(full));
    else if (entry.name.endsWith('.png')) out.push(full);
  }
  return out;
}

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
  portalId = p.id;
}

function makeSvc(opts?: {
  plan?: ApplicationPlan;
  evidence?: 'off' | 'screenshots';
  automationDir?: string;
}): AutomationService {
  const plan = opts?.plan ?? makeReadyPlan();
  return new AutomationService({
    browserManager: headlessBM(),
    resolveAdapter: () => makeFixtureIndiaAdapter(portal.url),
    getApplication: () => ({
      application: { id: 'app1', applicantId: 'a1' },
      plan,
    }),
    evidence: opts?.evidence,
    automationDir: opts?.automationDir,
  });
}

async function build(opts?: {
  plan?: ApplicationPlan;
  evidence?: 'off' | 'screenshots';
  automationDir?: string;
  withLogger?: boolean;
  discovery?: DiscoveryController;
}): Promise<void> {
  svc = makeSvc(opts);
  app = await buildServer({
    dbPath,
    automation: svc,
    ...(opts?.discovery ? { discovery: opts.discovery } : {}),
    ...(opts?.withLogger ? { loggerInstance: testLogger } : {}),
  });
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

async function startRun(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/applications/app1/automation-runs',
  });
  expect(res.statusCode).toBe(201);
  return res.json().run.id as string;
}

/** Run scenario 1 (happy path) all the way to `review_ready`. */
async function runScenario1ToReview(id: string): Promise<void> {
  await waitFor(async () => {
    const s = (await getRun(id)).status;
    return s !== 'pending' && s !== 'running';
  });
  expect((await getRun(id)).waiting_reason).toBe('otp');

  portal.setChallenge('ok');
  const resumed = await app.inject({
    method: 'POST',
    url: `/api/automation-runs/${id}/resume`,
  });
  expect(resumed.statusCode).toBe(202);

  await waitFor(async () => (await getRun(id)).status === 'review_ready');
}

// ---------------------------------------------------------------------------

beforeEach(async () => {
  dbPath = makeTempDbPath();
  portal = await startFixturePortal();

  // A capturing pino logger, configured exactly like production.
  captured = [];
  const stream = {
    write(chunk: string) {
      captured.push(chunk);
    },
  };
  testLogger = pino(
    { ...loggerOptions, level: 'info', transport: undefined },
    stream,
  ) as unknown as FastifyBaseLogger;
});

afterEach(async () => {
  await svc?.dispose().catch(() => undefined);
  if (app) await app.close().catch(() => undefined);
  await portal?.close().catch(() => undefined);
  cleanupTempDb(dbPath);
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('automation security suite (behavioural)', () => {
  it('1. full-run redaction: no field value / challenge secret / expected-actual reaches the log or the DB message column', async () => {
    await build({ withLogger: true });
    const id = await startRun();
    await runScenario1ToReview(id);

    const log = captured.join('');
    expect(log.length).toBeGreaterThan(0);

    // Every field VALUE from makeReadyPlan — absent from the log.
    expect(log).not.toContain('RANA'); // surname
    expect(log).not.toContain('BG1234567'); // passport number
    expect(log).not.toContain('2032-01-01'); // a date value
    expect(log).not.toContain('MITHU SULTANA'); // spouse name

    // No value-carrying JSON shapes for the challenge secret or a verify compare.
    // (The WORD "otp" may legitimately appear inside an event message string.)
    expect(log).not.toMatch(/"otp"\s*:\s*"(?!\[REDACTED\])[^"]+"/);
    expect(log).not.toMatch(/"otp"\s*:\s*\d/);
    expect(log).not.toContain('"expected":"');
    expect(log).not.toContain('"actual":"');

    // The DB message column is a closed vocabulary.
    const messages = app.db
      .prepare('SELECT DISTINCT message FROM automation_events WHERE run_id = ?')
      .all(id) as { message: string }[];
    expect(messages.length).toBeGreaterThan(0);
    const vocab = new Set(Object.values(EVENT_MESSAGES));
    for (const { message } of messages) {
      expect(vocab.has(message), `unexpected event message: ${message}`).toBe(true);
    }

    // Every non-null field_path is a contract path or a document id — never a value.
    const fieldPaths = app.db
      .prepare('SELECT DISTINCT field_path FROM automation_events WHERE run_id = ? AND field_path IS NOT NULL')
      .all(id) as { field_path: string }[];
    for (const { field_path } of fieldPaths) {
      const ok =
        CONTRACT_PATHS.has(field_path) ||
        field_path === 'invitation_letter_indian_company';
      expect(ok, `unexpected field_path: ${field_path}`).toBe(true);
    }
  });

  it('2. screenshot evidence: files land under AUTOMATION_DIR and only a relative path is stored', async () => {
    const tempAutomationDir = mkdtempSync(path.join(tmpdir(), 'automation-evidence-'));
    try {
      await build({ evidence: 'screenshots', automationDir: tempAutomationDir });
      const id = await startRun();
      await runScenario1ToReview(id);

      const rows = app.db
        .prepare('SELECT evidence_path FROM automation_events WHERE run_id = ?')
        .all(id) as { evidence_path: string | null }[];
      const paths = rows
        .map((r) => r.evidence_path)
        .filter((p): p is string => p !== null);

      expect(paths.length).toBeGreaterThan(0); // OTP_REQUIRED and/or REVIEW_READY

      for (const p of paths) {
        expect(path.isAbsolute(p)).toBe(false);
        expect(/^[a-zA-Z]:/.test(p)).toBe(false); // no drive letter
        expect(p.startsWith(id)).toBe(true); // <runId>/…
        expect(p.endsWith('.png')).toBe(true);
        expect(existsSync(path.join(tempAutomationDir, p))).toBe(true);
      }

      // The default AUTOMATION_DIR sits under DATA_DIR, which `.gitignore`'s `data/` covers.
      expect(
        path.resolve(env.AUTOMATION_DIR).startsWith(path.resolve(env.DATA_DIR)),
      ).toBe(true);
    } finally {
      rmSync(tempAutomationDir, { recursive: true, force: true });
    }
  });

  it('3. behavioural isolation: run view exposes only its own columns; a fresh service has no live surface', async () => {
    await build();
    const id = await startRun();
    await waitFor(async () => (await getRun(id)).status !== 'pending' && (await getRun(id)).status !== 'running');

    const res = await app.inject({ method: 'GET', url: `/api/automation-runs/${id}` });
    const run = res.json().run as Record<string, unknown>;
    expect(Object.keys(run).sort()).toEqual(
      [
        'id',
        'application_id',
        'portal_id',
        'portal_url_snapshot',
        'adapter_id',
        'status',
        'waiting_reason',
        'current_portal_state',
        'current_section_id',
        'fields_total',
        'fields_verified',
        'documents_total',
        'documents_ready',
        'error_code',
        'error_message',
        'started_at',
        'updated_at',
        'ended_at',
      ].sort(),
    );
    // No nested plan / application / raw fields leaked into the run object.
    for (const k of ['plan', 'application', 'fields', 'sections']) {
      expect(k in run).toBe(false);
    }

    // A fresh service (no runner in memory) → the live endpoint refuses.
    const svc2 = makeSvc();
    const app2 = await buildServer({ dbPath, automation: svc2 });
    try {
      const live = await app2.inject({
        method: 'GET',
        url: `/api/automation-runs/${id}/live`,
      });
      expect(live.statusCode).toBe(409);
      expect(live.json().error.code).toBe('NOT_ACTIVE');
    } finally {
      await app2.close();
      await svc2.dispose().catch(() => undefined);
    }
  });

  it('4. not-ready refusal: POST is rejected 409 NOT_READY and no run row is created', async () => {
    await build({
      plan: makeReadyPlan({
        readyForAutomation: {
          ready: false,
          blockers: [{ text: 'passport too short', kind: 'field', source: null }],
        },
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/applications/app1/automation-runs',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_READY');
    expect(res.json().blockers).toHaveLength(1);

    const { c } = app.db
      .prepare('SELECT count(*) AS c FROM automation_runs')
      .get() as { c: number };
    expect(c).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 (spec §11 / §13.21 / §13.23 / §13.24): the same behavioural proof
// extended over the India portal-adapter surface — a full fixture-v2 autofill
// run AND a user-driven discovery session (real headed context, tmp profile).
// No field value, no conflict value, no rendered control value may reach a log
// line, an `automation_events` row, a `portal_discovery_pages` / …_sessions row,
// or a screenshot file; and every persisted discovery `url_pattern` is masked.
// ---------------------------------------------------------------------------

describe('phase 6 security suite (behavioural)', () => {
  /** Field VALUES seeded into the run plan + the values a `?prefill=conflict`
   *  page renders into its controls. None of these is structure — all are PII. */
  const SECRETS = [
    'RANA', // plan surname
    'BG1234567', // plan passport number
    '2032-01-01', // plan passport expiry (a date value)
    'MITHU SULTANA', // plan spouse name
    'Dhaka', // plan address city
    'SOMEONE-ELSE', // rendered #surname on ?prefill=conflict
    'DIFFERENT', // rendered #given-names on ?prefill=conflict
  ];

  async function discoveryRoundTrip(controller: DiscoveryController): Promise<string> {
    const started = await app.inject({
      method: 'POST',
      url: `/api/portals/${portalId}/discovery-sessions`,
    });
    expect(started.statusCode).toBe(201);
    const sessionId = started.json().session.id as string;

    // `ref=` carries a token that `sanitizeUrlToPattern` MUST strip — a hex blob
    // AND a 5+ digit run. The fixture is a plain static server that ignores
    // unknown query params, so the page still serves personal.html with prefill.
    await controller.activePage!.goto(
      `${portal.url}/personal?prefill=conflict&ref=deadbeefcafe12345678`,
      { waitUntil: 'domcontentloaded' },
    );
    // Guard against a vacuous leak check: the values really are in the live DOM.
    expect(await controller.activePage!.locator('#surname').inputValue()).toBe('SOMEONE-ELSE');
    expect(await controller.activePage!.locator('#given-names').inputValue()).toBe('DIFFERENT');

    // Populate `last_validation_json` from a NON-vacuous report. The real india
    // map is all-placeholder, so `validateIndiaAdapter` would yield empty
    // `fields`/`states` arrays and the PII scan below would prove nothing. Run
    // the validator against the populated fixture v2 map instead (13 validated
    // mappings, real <option> labels) and persist that.
    const valReport = await validateAdapterAgainstPage(
      controller.activePage!,
      FIXTURE_INDIA_PORTAL_MAP_V2,
    );
    expect(valReport.fields.length).toBeGreaterThan(5);
    expect(valReport.fields.some((f) => (f.optionLabels?.length ?? 0) > 0)).toBe(true);
    updateDiscoverySession(
      app.db,
      sessionId,
      { last_validation_json: JSON.stringify(valReport) },
      new Date().toISOString(),
    );

    const captureRes = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${sessionId}/capture`,
    });
    expect(captureRes.statusCode).toBe(201);

    const ended = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${sessionId}/end`,
    });
    expect(ended.statusCode).toBe(202);
    return sessionId;
  }

  it(
    '5. full autofill run + discovery session: no field/rendered value in the log, automation_events, portal_discovery_pages/…_sessions; messages stay in the closed vocab; last_validation_json is value-free; url_pattern masked',
    async () => {
      const profileDir = mkdtempSync(path.join(tmpdir(), 'phase6-sec-disco-'));
      const automationDir = path.join(
        mkdtempSync(path.join(tmpdir(), 'phase6-sec-auto-')),
        'evidence',
      );
      tmpDirs.push(profileDir, path.dirname(automationDir));
      const controller = new DiscoveryController({
        resolveAdapter: () => makeFixtureIndiaAdapter(portal.url),
        profileDir,
      });

      // evidence deliberately left at its 'off' default.
      await build({ withLogger: true, discovery: controller, automationDir });

      // --- autofill half: a full populated run to review_ready ---
      portal.setChallenge('ok');
      const id = await startRun();
      await waitFor(async () => (await getRun(id)).status === 'review_ready', 40000);

      // --- discovery half: a round-trip over a prefilled (conflict) page ---
      await discoveryRoundTrip(controller);

      const log = captured.join('');
      expect(log.length).toBeGreaterThan(0);

      const eventRows = app.db.prepare('SELECT * FROM automation_events').all();
      const eventsJson = JSON.stringify(eventRows);
      const discoPagesJson = JSON.stringify(
        app.db.prepare('SELECT * FROM portal_discovery_pages').all(),
      );
      const sessionRows = app.db
        .prepare('SELECT * FROM portal_discovery_sessions')
        .all() as { last_validation_json: string | null; notes: string | null }[];
      const sessionsJson = JSON.stringify(sessionRows);

      for (const s of SECRETS) {
        expect(log, `log leaked ${s}`).not.toContain(s);
        expect(eventsJson, `automation_events leaked ${s}`).not.toContain(s);
        expect(discoPagesJson, `portal_discovery_pages leaked ${s}`).not.toContain(s);
        expect(sessionsJson, `portal_discovery_sessions leaked ${s}`).not.toContain(s);
      }

      // Every persisted event message is a value of the closed EVENT_MESSAGES map.
      const vocab = new Set(Object.values(EVENT_MESSAGES));
      const messages = app.db
        .prepare('SELECT DISTINCT message FROM automation_events')
        .all() as { message: string }[];
      expect(messages.length).toBeGreaterThan(0);
      for (const { message } of messages) {
        expect(vocab.has(message), `unexpected event message: ${message}`).toBe(true);
      }

      // last_validation_json, minus its own metadata, carries no value shape.
      const withValidation = sessionRows.filter((r) => r.last_validation_json !== null);
      expect(withValidation.length).toBeGreaterThan(0);
      for (const r of withValidation) {
        const report = JSON.parse(r.last_validation_json!) as Record<string, unknown>;
        // Drop the report's own metadata (a timestamp + two ISO-dated version
        // strings — none of it PII) before scanning the substance for values.
        delete report.ranAt;
        delete report.adapterVersion;
        delete report.mappingRevision;
        const rest = JSON.stringify(report);
        for (const s of SECRETS) expect(rest).not.toContain(s);
        expect(rest, 'passport-shaped token in last_validation_json').not.toMatch(
          /\b[A-Z]{1,2}\d{6,8}\b/,
        );
        expect(rest, 'ISO date value in last_validation_json').not.toMatch(/\d{4}-\d{2}-\d{2}/);
      }

      // Every persisted discovery url_pattern is masked. The captured page URL
      // carried `?ref=deadbeefcafe12345678` — a hex blob AND a 5+ digit run that
      // `sanitizeUrlToPattern` must strip to `ref=*`. (`sanitizeUrlToPattern`
      // keeps the host:port verbatim — the fixture port is not PII — so the raw
      // digit-run check is applied to everything after the host.)
      const patterns = app.db
        .prepare('SELECT url_pattern FROM portal_discovery_pages')
        .all() as { url_pattern: string | null }[];
      expect(patterns.length).toBeGreaterThan(0);
      for (const { url_pattern } of patterns) {
        expect(url_pattern).not.toBeNull();
        // the assertion that bites if query-value masking regresses:
        expect(url_pattern!, `raw ref token in ${url_pattern}`).not.toContain(
          'deadbeefcafe12345678',
        );
        // …and it was a real capture, not an empty row passing vacuously:
        expect(url_pattern!, `no /personal segment in ${url_pattern}`).toContain('/personal');
        expect(url_pattern!, `hex blob in ${url_pattern}`).not.toMatch(/[0-9a-f]{8,}/i);
        const afterHost = url_pattern!.replace(/^[^/]*/, '');
        expect(afterHost, `raw 5+ digit run in ${url_pattern}`).not.toMatch(/\d{5,}/);
      }

      // evidence stayed 'off': no screenshot file, no evidence_path column value.
      expect(walkPng(automationDir)).toEqual([]);
      const evidencePaths = app.db
        .prepare('SELECT evidence_path FROM automation_events')
        .all() as { evidence_path: string | null }[];
      expect(evidencePaths.every((r) => r.evidence_path === null)).toBe(true);
    },
    90000,
  );

  it(
    '6. AUTOMATION_EVIDENCE off: a value_conflict pause writes no screenshot file',
    async () => {
      const automationDir = path.join(
        mkdtempSync(path.join(tmpdir(), 'phase6-sec-nopng-')),
        'evidence',
      );
      tmpDirs.push(path.dirname(automationDir));

      const sections = defaultSections();
      sections[0]!.fields = [f('personal_particulars', 'identity.surname', 'RANA')];
      await build({ plan: makeReadyPlan({ sections }), automationDir });
      portal.setPrefill('conflict');
      portal.setChallenge('ok');

      const id = await startRun();
      await waitFor(async () => {
        const s = (await getRun(id)).status;
        return s !== 'pending' && s !== 'running';
      });
      expect((await getRun(id)).waiting_reason).toBe('value_conflict');

      expect(walkPng(automationDir)).toEqual([]);
      expect(existsSync(automationDir)).toBe(false);
      const evidencePaths = app.db
        .prepare('SELECT evidence_path FROM automation_events')
        .all() as { evidence_path: string | null }[];
      expect(evidencePaths.every((r) => r.evidence_path === null)).toBe(true);

      // The conflict pair never reached the persisted events.
      const json = JSON.stringify(
        app.db.prepare('SELECT * FROM automation_events').all(),
      );
      expect(json).not.toContain('RANA');
      expect(json).not.toContain('SOMEONE-ELSE');
    },
    45000,
  );
});
