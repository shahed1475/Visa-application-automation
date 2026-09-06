import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Page } from 'playwright';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { createPortal, setActivePortal } from '../../src/server/services/portalService.js';
import type { ApplicationPlan } from '../../src/shared/application/types.js';
import type { EngineStop } from '../../src/server/automation/engine/automationEngine.js';
import type { PortalAdapter } from '../../src/server/automation/adapters/baseAdapter.js';
import type { PageInspection } from '../../src/server/automation/engine/pageInspector.js';
import { AutomationService } from '../../src/server/automation/automationService.js';

// ---- fakes (mirror test/automation/automationService.test.ts) --------------

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

interface LoadedApp {
  application: unknown;
  plan: ApplicationPlan;
}
type GetApp = (db: DatabaseSync, id: string) => LoadedApp | null;

function makeSvc(
  getApplication: GetApp,
  opts: { stops?: EngineStop[]; runLoop?: () => Promise<EngineStop> } = {},
): AutomationService {
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
    browserManager: fakeBrowserManager as never,
    resolveAdapter: () => fakeAdapter,
    runLoop: runLoop as never,
    inspect: (async () => cleanInspection()) as never,
    getApplication,
  });
}

const readyApp: GetApp = () => ({ application: {}, plan: fakePlan(true) });

// ---- test harness --------------------------------------------------------

let app: FastifyInstance;
let dbPath: string;

beforeEach(() => {
  dbPath = makeTempDbPath();
});
afterEach(async () => {
  if (app) await app.close();
  cleanupTempDb(dbPath);
});

const T = 't0';

// The `automation_runs.application_id` FK requires real `visa_applications` rows,
// even though the ApplicationPlan itself comes from the injected getApplication fake.
function seedApplicationRows(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1', 'A', 'draft', ?, ?)`,
  ).run(T, T);
  db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES ('a1')`).run();
  for (const id of ['app1', 'app2']) {
    db.prepare(
      `INSERT INTO visa_applications
         (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
       VALUES (?, 'a1', 'IND', 'regular', 'regular.tourist', 'draft', '2026-09-06', ?, ?)`,
    ).run(id, T, T);
  }
}

async function build(svc: AutomationService): Promise<FastifyInstance> {
  app = await buildServer({ dbPath, automation: svc });
  const db = (app as unknown as { db: DatabaseSync }).db;
  seedApplicationRows(db);
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
  return app;
}

async function waitForStatus(
  runId: string,
  status: string,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await app.inject({ method: 'GET', url: `/api/automation-runs/${runId}` });
    if (res.statusCode === 200 && res.json().run.status === status) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitForStatus(${status}) timed out`);
}

describe('automation routes', () => {
  it('case 1: POST automation-runs on a ready application → 201 { run }', async () => {
    await build(makeSvc(readyApp));
    const res = await app.inject({
      method: 'POST',
      url: '/api/applications/app1/automation-runs',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.run.id).toBe('string');
    expect(['pending', 'running']).toContain(body.run.status);
  });

  it('case 2: POST on a not-ready application → 409 NOT_READY with blockers', async () => {
    await build(makeSvc(() => ({ application: {}, plan: fakePlan(false, 2) })));
    const res = await app.inject({
      method: 'POST',
      url: '/api/applications/app1/automation-runs',
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe('NOT_READY');
    expect(Array.isArray(body.blockers)).toBe(true);
    expect(body.blockers).toHaveLength(2);
  });

  it('case 3: GET /api/automation-runs/:id → 200 { run, events }', async () => {
    await build(makeSvc(readyApp));
    const created = (
      await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' })
    ).json();
    const res = await app.inject({
      method: 'GET',
      url: `/api/automation-runs/${created.run.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe(created.run.id);
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('case 4: GET /api/automation-runs/:id/events?after=0 → 200 { events }', async () => {
    await build(
      makeSvc(readyApp, { stops: [{ kind: 'waiting', reason: 'value_mismatch' }] }),
    );
    const created = (
      await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' })
    ).json();
    await waitForStatus(created.run.id, 'waiting_for_user');
    const res = await app.inject({
      method: 'GET',
      url: `/api/automation-runs/${created.run.id}/events?after=0`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
    await app.automation.dispose();
  });

  it('case 5: POST resume on a running (non-waiting) run → 409 NOT_WAITING', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await build(
      makeSvc(readyApp, {
        runLoop: async () => {
          await gate;
          return { kind: 'review_ready' };
        },
      }),
    );
    const created = (
      await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' })
    ).json();
    await waitForStatus(created.run.id, 'running');
    const res = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${created.run.id}/resume`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_WAITING');
    release();
    await waitForStatus(created.run.id, 'review_ready');
  });

  it('case 6: POST abort → 202 { run: { status: "aborted" } }', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await build(
      makeSvc(readyApp, {
        runLoop: async () => {
          await gate;
          return { kind: 'review_ready' };
        },
      }),
    );
    const created = (
      await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' })
    ).json();
    await waitForStatus(created.run.id, 'running');
    const res = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${created.run.id}/abort`,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().run.status).toBe('aborted');
    release();
  });

  it('case 7: unknown run id → 404; unknown application id → 404 NOT_FOUND', async () => {
    await build(makeSvc((_db, id) => (id === 'app1' ? readyApp(_db, id) : null)));
    const miss = await app.inject({
      method: 'GET',
      url: '/api/automation-runs/does-not-exist',
    });
    expect(miss.statusCode).toBe(404);

    const badApp = await app.inject({
      method: 'POST',
      url: '/api/applications/nope/automation-runs',
    });
    expect(badApp.statusCode).toBe(404);
    expect(badApp.json().error.code).toBe('NOT_FOUND');
  });

  it('case 9: POST resume with { decision } on a value_conflict wait → 202', async () => {
    await build(
      makeSvc(readyApp, {
        stops: [
          { kind: 'waiting', reason: 'value_conflict', conflictFieldPath: 'identity.surname' },
          { kind: 'review_ready' },
        ],
      }),
    );
    const created = (
      await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' })
    ).json();
    await waitForStatus(created.run.id, 'waiting_for_user');
    const res = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${created.run.id}/resume`,
      payload: { decision: 'use_application' },
    });
    expect(res.statusCode).toBe(202);
    await waitForStatus(created.run.id, 'review_ready');
  });

  it('case 10: POST resume with no body on a value_conflict wait → 400 DECISION_REQUIRED', async () => {
    await build(
      makeSvc(readyApp, {
        stops: [{ kind: 'waiting', reason: 'value_conflict', conflictFieldPath: 'identity.surname' }],
      }),
    );
    const created = (
      await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' })
    ).json();
    await waitForStatus(created.run.id, 'waiting_for_user');
    const res = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${created.run.id}/resume`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('DECISION_REQUIRED');
    await app.automation.dispose();
  });

  it('case 11: POST resume with { decision: "bogus" } → 400 VALIDATION_ERROR', async () => {
    await build(
      makeSvc(readyApp, {
        stops: [{ kind: 'waiting', reason: 'value_conflict', conflictFieldPath: 'identity.surname' }],
      }),
    );
    const created = (
      await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' })
    ).json();
    await waitForStatus(created.run.id, 'waiting_for_user');
    const res = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${created.run.id}/resume`,
      payload: { decision: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    await app.automation.dispose();
  });

  it('case 8: cross-application isolation', async () => {
    await build(
      makeSvc((_db, id) =>
        id === 'app1' || id === 'app2' ? { application: {}, plan: fakePlan(true) } : null,
      ),
    );

    const run1 = (
      await app.inject({ method: 'POST', url: '/api/applications/app1/automation-runs' })
    ).json().run;
    // Abort so app2 can start (one runner process-wide).
    const aborted = await app.inject({
      method: 'POST',
      url: `/api/automation-runs/${run1.id}/abort`,
    });
    expect(aborted.statusCode).toBe(202);

    const run2res = await app.inject({
      method: 'POST',
      url: '/api/applications/app2/automation-runs',
    });
    expect(run2res.statusCode).toBe(201);
    const run2 = run2res.json().run;

    const list1 = (
      await app.inject({ method: 'GET', url: '/api/applications/app1/automation-runs' })
    ).json().runs.map((r: { id: string }) => r.id);
    expect(list1).toContain(run1.id);
    expect(list1).not.toContain(run2.id);

    const list2 = (
      await app.inject({ method: 'GET', url: '/api/applications/app2/automation-runs' })
    ).json().runs.map((r: { id: string }) => r.id);
    expect(list2).toContain(run2.id);
    expect(list2).not.toContain(run1.id);

    const one = await app.inject({ method: 'GET', url: `/api/automation-runs/${run1.id}` });
    expect(one.statusCode).toBe(200);
    expect(one.json().run.application_id).toBe('app1');
    expect(JSON.stringify(one.json())).not.toContain('app2');

    await app.automation.dispose();
  });
});
