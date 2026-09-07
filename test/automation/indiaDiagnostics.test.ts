import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import {
  appendDiscoveryPage,
  createDiscoverySession,
  updateDiscoverySession,
} from '../../src/server/automation/discovery/discoverySessionStore.js';
import { getIndiaDiagnostics } from '../../src/server/automation/adapters/india/diagnostics.js';

// ---------------------------------------------------------------------------
// Phase 6 §7.4 / §13.21 — India adapter self-diagnostics assembly. Value-free
// health snapshot: contract version, discovery progress, mapping lifecycle
// counts, unknown-page tally, and the last adapter-validation outcome.
// ---------------------------------------------------------------------------

const T = '2026-09-07T00:00:00.000Z';
/** A recognisable operator string seeded into a session note — must never surface. */
const PII = 'OPERATOR-NOTE-RANA-BG1234567-9f3a2b';

describe('getIndiaDiagnostics', () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDbPath();
    db = openDatabase(dbPath);
    runMigrations(db);
    db.prepare(
      `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`,
    ).run(T, T);
    db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES ('a1')`).run();
    db.prepare(
      `INSERT INTO visa_applications
         (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
       VALUES ('app1','a1','IND','regular','regular.tourist','draft','2026-09-06',?,?)`,
    ).run(T, T);
  });

  afterEach(() => {
    db.close();
    cleanupTempDb(dbPath);
  });

  function seedRun(id: string, eventTypes: string[]): void {
    db.prepare(
      `INSERT INTO automation_runs
         (id, application_id, portal_url_snapshot, adapter_id, status, started_at, updated_at)
       VALUES (?, 'app1', 'http://portal.example', 'india', 'waiting_for_user', ?, ?)`,
    ).run(id, T, T);
    eventTypes.forEach((type, i) => {
      db.prepare(
        `INSERT INTO automation_events (id, run_id, seq, created_at, type, message) VALUES (?, ?, ?, ?, ?, 'x')`,
      ).run(randomUUID(), id, i + 1, T, type);
    });
  }

  function seedPage(sessionId: string): void {
    appendDiscoveryPage(db, {
      id: randomUUID(),
      sessionId,
      now: T,
      stateGuess: 'PERSONAL_DETAILS',
      urlPattern: 'portal.example/personal',
      pageTitle: 'Personal',
      headingsJson: '[]',
      fingerprintJson: '{}',
      candidatesJson: '[]',
      signalsJson: '{}',
    });
  }

  it('assembles value-free counts from discovery pages, events and the india map', () => {
    const session = createDiscoverySession(db, {
      id: randomUUID(),
      portalId: null,
      adapterId: 'india',
      now: T,
    });
    seedPage(session.id);
    seedPage(session.id);
    updateDiscoverySession(
      db,
      session.id,
      {
        notes: PII,
        last_validation_json: JSON.stringify({
          adapterVersion: '6.0.0',
          mappingRevision: '2026-09-07',
          ranAt: T,
          ok: true,
          fields: [],
          states: [],
        }),
      },
      T,
    );

    seedRun('r1', ['RUN_STARTED', 'UNKNOWN_PORTAL_STATE', 'PAGE_DETECTED']);
    seedRun('r2', ['UNKNOWN_PORTAL_STATE']);

    const d = getIndiaDiagnostics(db, 'ignored-portal-id');

    expect(d.adapterId).toBe('india');
    expect(d.adapterVersion).toBe('6.0.0');
    expect(d.mappingRevision).toBe('2026-09-07');
    expect(d.lastDiscoveryAt).toBeNull();
    expect(d.pagesDiscovered).toBe(2);
    expect(d.fieldsDiscovered).toBe(0);
    expect(d.unknownPagesEncountered).toBe(2);

    // The mapping table is all-placeholder today.
    expect(d.mappings.total).toBeGreaterThan(0);
    expect(d.mappings.placeholder).toBe(d.mappings.total);
    expect(d.mappings.discovered).toBe(0);
    expect(d.mappings.validated).toBe(0);
    expect(d.staleMappings).toBe(0);
    expect(d.productionUsableMappings).toBe(0);
    expect(d.selectorStaleEvents).toBe(0);

    expect(d.lastValidation).toEqual({ ranAt: T, ok: true });

    // Value-free: the seeded operator note / applicant-shaped tokens never surface.
    const payload = JSON.stringify(d);
    expect(payload).not.toContain(PII);
    expect(payload).not.toContain('RANA');
    expect(payload).not.toContain('BG1234567');
    // no per-field path list — only counts
    expect(payload).not.toContain('identity.surname');
  });

  it('lastValidation is null with no validation report, and non-india sessions are ignored', () => {
    createDiscoverySession(db, {
      id: randomUUID(),
      portalId: null,
      adapterId: 'india',
      now: T,
    });
    const other = createDiscoverySession(db, {
      id: randomUUID(),
      portalId: null,
      adapterId: 'other',
      now: T,
    });
    seedPage(other.id);

    const d = getIndiaDiagnostics(db, 'p1');
    expect(d.pagesDiscovered).toBe(0);
    expect(d.lastValidation).toBeNull();
    expect(d.unknownPagesEncountered).toBe(0);
  });

  it('selectorStaleEvents counts SELECTOR_STALE events across all runs', () => {
    seedRun('r1', ['SELECTOR_STALE', 'PAGE_DETECTED', 'SELECTOR_STALE']);
    seedRun('r2', ['SELECTOR_STALE']);
    expect(getIndiaDiagnostics(db, 'p1').selectorStaleEvents).toBe(3);
  });

  it('a corrupt last_validation_json yields lastValidation: null, not a throw', () => {
    const s = createDiscoverySession(db, {
      id: randomUUID(),
      portalId: null,
      adapterId: 'india',
      now: T,
    });
    updateDiscoverySession(db, s.id, { last_validation_json: 'not json{' }, T);
    expect(() => getIndiaDiagnostics(db, 'p1')).not.toThrow();
    expect(getIndiaDiagnostics(db, 'p1').lastValidation).toBeNull();
  });
});
