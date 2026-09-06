import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations, LATEST_SCHEMA_VERSION } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

const T = 't0';

describe('migration 6', () => {
  let db: DatabaseSync; let p: string;
  beforeEach(() => { p = makeTempDbPath(); db = openDatabase(p); });
  afterEach(() => { db.close(); cleanupTempDb(p); });

  it('LATEST_SCHEMA_VERSION is 6', () => { expect(LATEST_SCHEMA_VERSION).toBe(6); });

  it('fresh DB reaches v6 with both discovery tables + indexes', () => {
    runMigrations(db);
    expect((db.prepare('PRAGMA user_version').get() as any).user_version).toBe(6);
    for (const t of ['portal_discovery_sessions', 'portal_discovery_pages']) {
      expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t)).toBeTruthy();
    }
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_discovery_sessions_one_active'`).get()).toBeTruthy();
  });

  it('a genuine v5 -> v6 upgrade preserves automation_runs / automation_events and the cascade still fires', () => {
    runMigrations(db, 5);
    db.prepare(`INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`).run(T, T);
    db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES ('a1')`).run();
    db.prepare(`INSERT INTO visa_applications (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
                VALUES ('app1','a1','IND','regular','regular.tourist','draft','2026-09-06',?,?)`).run(T, T);
    db.prepare(`INSERT INTO automation_runs (id, application_id, portal_url_snapshot, adapter_id, status, started_at, updated_at)
                VALUES ('r1','app1','http://x','india','waiting_for_user',?,?)`).run(T, T);
    db.prepare(`INSERT INTO automation_events (id, run_id, seq, created_at, type, message) VALUES ('e1','r1',1,?,'RUN_STARTED','x')`).run(T);

    runMigrations(db); // -> v6

    expect((db.prepare('PRAGMA user_version').get() as any).user_version).toBe(6);
    expect((db.prepare(`SELECT count(*) c FROM automation_runs`).get() as any).c).toBe(1);
    // the CHECK is gone: value_conflict is now storable
    db.prepare(`UPDATE automation_runs SET waiting_reason='value_conflict' WHERE id='r1'`).run();
    expect((db.prepare(`SELECT waiting_reason w FROM automation_runs WHERE id='r1'`).get() as any).w).toBe('value_conflict');
    // cascade intact
    db.prepare(`DELETE FROM visa_applications WHERE id='app1'`).run();
    expect((db.prepare(`SELECT count(*) c FROM automation_runs`).get() as any).c).toBe(0);
    expect((db.prepare(`SELECT count(*) c FROM automation_events`).get() as any).c).toBe(0);
  });

  it('discovery tables reject a bad status and cascade session -> pages on delete', () => {
    runMigrations(db);
    db.prepare(`INSERT INTO portal_discovery_sessions (id, adapter_id, status, started_at, page_count) VALUES ('s1','india','active',?,0)`).run(T);
    expect(() => db.prepare(`INSERT INTO portal_discovery_sessions (id, adapter_id, status, started_at, page_count) VALUES ('s2','india','bogus',?,0)`).run(T)).toThrow();
    db.prepare(`INSERT INTO portal_discovery_pages (id, session_id, seq, created_at, headings_json, fingerprint_json, candidates_json, signals_json)
                VALUES ('pg1','s1',1,?, '[]','{}','[]','{}')`).run(T);
    db.prepare(`DELETE FROM portal_discovery_sessions WHERE id='s1'`).run();
    expect((db.prepare(`SELECT count(*) c FROM portal_discovery_pages`).get() as any).c).toBe(0);
  });

  it('the partial unique index forbids a second active session for one adapter', () => {
    runMigrations(db);
    db.prepare(`INSERT INTO portal_discovery_sessions (id, adapter_id, status, started_at, page_count) VALUES ('s1','india','active',?,0)`).run(T);
    expect(() => db.prepare(`INSERT INTO portal_discovery_sessions (id, adapter_id, status, started_at, page_count) VALUES ('s2','india','active',?,0)`).run(T)).toThrow();
    db.prepare(`UPDATE portal_discovery_sessions SET status='ended' WHERE id='s1'`).run();
    expect(() => db.prepare(`INSERT INTO portal_discovery_sessions (id, adapter_id, status, started_at, page_count) VALUES ('s3','india','active',?,0)`).run(T)).not.toThrow();
  });
});
