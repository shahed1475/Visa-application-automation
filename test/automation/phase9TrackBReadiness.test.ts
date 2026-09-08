import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { createPortal, setActivePortal } from '../../src/server/services/portalService.js';
import { DiscoveryController } from '../../src/server/automation/discovery/discoveryController.js';
import { startFixturePortal, type FixturePortal } from '../helpers/fixturePortal.js';
import { makeFixtureIndiaAdapter } from './support/fixtureIndiaAdapter.js';

// ---------------------------------------------------------------------------
// Phase 9 — Track B TOOLING readiness (NOT real-portal validation).
//
// Walks the operator's discovery checklist (docs/portals/india.md "### Track B
// execution checklist", steps 2 + 6-9 + 13 + 17) as ONE CONTINUOUS sequence
// against the LOCAL FIXTURE portal + real Chromium, off a REAL captured
// discovery page (not a hand-seeded candidate row — that is what every
// discoveryRoutes.test.ts case does):
//
//   start session → operator navigates → capture → promote → validate-adapter
//   → field-tables → end
//
// It proves the capture→promote handoff (candidate object shape), the
// value-free surfaces, and that discovery NEVER mutates the page or submits.
//
// SYNTHETIC-TESTED ONLY. Zero real Indian-portal selectors are produced; the
// shipped indiaPortalMap.ts is untouched. The ToS gate + policy-ack (step 1)
// is a no-op for a localhost host by design (policyGate.isRealIndiaHost) and
// is covered by discoveryRoutes.test.ts / discoveryController.test.ts.
// ---------------------------------------------------------------------------

let app: FastifyInstance;
let portal: FixturePortal;
let dbPath: string;
let portalId: string;
let controller: DiscoveryController;
const tmpDirs: string[] = [];

function seed(db: DatabaseSync): void {
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

beforeEach(async () => {
  dbPath = makeTempDbPath();
  portal = await startFixturePortal();
  const profileDir = mkdtempSync(path.join(tmpdir(), 'phase9-trackb-'));
  tmpDirs.push(profileDir);
  controller = new DiscoveryController({
    resolveAdapter: () => makeFixtureIndiaAdapter(portal.url),
    profileDir,
  });
  app = await buildServer({ dbPath, discovery: controller });
  seed(app.db);
});

afterEach(async () => {
  await controller?.dispose().catch(() => undefined);
  if (app) await app.close().catch(() => undefined);
  await portal?.close().catch(() => undefined);
  cleanupTempDb(dbPath);
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('phase 9 — Track B tooling readiness (fixture portal)', () => {
  it('the operator discovery loop holds end-to-end: start → capture → promote → validate-adapter → field-tables', async () => {
    // --- step 2: start a discovery session (headed context, one goto) --------
    const started = await app.inject({
      method: 'POST',
      url: `/api/portals/${portalId}/discovery-sessions`,
    });
    expect(started.statusCode).toBe(201);
    const sessionId = started.json().session.id as string;
    expect(started.json().session.status).toBe('active');

    // --- steps 3-6: the OPERATOR drives the browser; the tool only observes --
    await controller.activePage!.goto(`${portal.url}/personal`, {
      waitUntil: 'domcontentloaded',
    });

    // --- step 6: capture the real page -------------------------------------
    const captured = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${sessionId}/capture`,
    });
    expect(captured.statusCode).toBe(201);

    // --- step 7: review the candidate table -------------------------------
    const view = await app.inject({
      method: 'GET',
      url: `/api/discovery-sessions/${sessionId}`,
    });
    expect(view.statusCode).toBe(200);
    const pageRow = (view.json().pages as { state_guess: string; candidates_json: string }[])[0]!;
    expect(pageRow.state_guess).toBe('PERSONAL_DETAILS');
    const candidates = JSON.parse(pageRow.candidates_json) as {
      label: string;
      primarySelector: string;
      control: string;
    }[];
    expect(candidates.length).toBeGreaterThan(0);

    // a real text control the fixture renders (#surname / #given-names)
    const textIdx = candidates.findIndex(
      (c) => c.control === 'text' && c.primarySelector.length > 0,
    );
    expect(textIdx).toBeGreaterThanOrEqual(0);

    // --- steps 8-9: promote it → paste-ready literal, no source written ----
    const promoted = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${sessionId}/promote`,
      payload: { pageSeq: 1, candidateIndex: textIdx, canonicalFieldPath: 'identity.surname' },
    });
    expect(promoted.statusCode).toBe(200);
    const literal = promoted.json().mappingEdit.literal as string;
    expect(literal).toContain(`selector: '${candidates[textIdx]!.primarySelector}'`);
    expect(literal).toContain("status: 'discovered'");
    expect(literal).toContain(`discoverySessionRef: '${sessionId}'`);
    // the three validation-stamp TODOs the operator must satisfy (step 14)
    expect(literal).toContain('// TODO:');
    expect(literal).toContain('validatedAt');
    expect(literal).toContain('validatedAgainstRevision');
    // text candidate → text expected: the clean path, no control-mismatch noise
    expect(promoted.json().mappingEdit.warnings).toStrictEqual([]);

    // --- step 13: run "Validate Adapter" against the live page -------------
    const validated = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${sessionId}/validate-adapter`,
    });
    expect(validated.statusCode).toBe(200);
    const report = validated.json().report;
    // the shipped india map is all-placeholder → a vacuous pass, no fields yet
    expect(report.ok).toBe(true);
    expect(typeof report.ranAt).toBe('string');

    // --- step 17: copy the field-support tables (value-free) --------------
    const tables = await app.inject({
      method: 'GET',
      url: `/api/discovery-sessions/${sessionId}/field-tables`,
    });
    expect(tables.statusCode).toBe(200);
    const md = tables.json().markdown as string;
    expect(md).toMatch(/Validated|Discovered|Placeholder/);
    // value-free: no rendered control value, option label, or contact detail
    expect(md).not.toMatch(/@|e\.g\.|example/i);

    // --- step 16 close-out: end the session ------------------------------
    const ended = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${sessionId}/end`,
    });
    expect(ended.statusCode).toBe(202);
    expect(ended.json().session.status).toBe('ended');

    // --- invariants: discovery mutated nothing, submitted nothing --------
    expect(portal.submitCount).toBe(0);
    // the app wrote NO adapter source — the shipped map is still all placeholder
    const mappings = await app.inject({
      method: 'GET',
      url: `/api/portals/${portalId}/adapter-mappings`,
    });
    expect(mappings.json().status.validated ?? 0).toBe(0);
  }, 60_000);
});
