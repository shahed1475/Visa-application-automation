import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { LATEST_SCHEMA_VERSION, runMigrations } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

const userVersion = (db: DatabaseSync): number =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('migration 5 — automation_runs + automation_events', () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDbPath();
    db = openDatabase(dbPath);
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
    cleanupTempDb(dbPath);
  });

  it('LATEST_SCHEMA_VERSION is 6', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(6);
    expect(userVersion(db)).toBe(6);
  });

  it('a fresh DB has automation_runs + automation_events with their indexes', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['automation_runs', 'automation_events']));
    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining(['idx_automation_runs_application', 'idx_automation_events_run']),
    );
  });
});

describe('migration 5 — real v4 -> v5 upgrade of an existing application', () => {
  let db: DatabaseSync;
  let dbPath: string;
  const now = 't';

  beforeEach(() => {
    dbPath = makeTempDbPath();
    db = openDatabase(dbPath);
    // Stop at v4: the DB now looks exactly like one written by the previous release.
    runMigrations(db, 4);
    expect(userVersion(db)).toBe(4);

    db.prepare(
      `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`,
    ).run(now, now);
    db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES ('a1')`).run();
    db.prepare(
      `INSERT INTO visa_applications
         (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
       VALUES ('app1','a1','IND','regular','regular.tourist','draft','2026-09-06',?,?)`,
    ).run(now, now);

    // The upgrade under test.
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
    cleanupTempDb(dbPath);
  });

  it('reaches the latest schema version and keeps the v4-era data', () => {
    expect(userVersion(db)).toBe(6);
    expect(db.prepare(`SELECT display_name FROM applicants WHERE id='a1'`).get()).toEqual({
      display_name: 'A',
    });
  });

  it('accepts an automation_runs insert then a dependent automation_events insert', () => {
    db.prepare(
      `INSERT INTO automation_runs
         (id, application_id, portal_id, portal_url_snapshot, adapter_id, status, started_at, updated_at)
       VALUES ('r1','app1',NULL,'https://indianvisaonline.gov.in','india-evisa','pending',?,?)`,
    ).run(now, now);
    expect(
      (db.prepare('SELECT count(*) AS c FROM automation_runs').get() as { c: number }).c,
    ).toBe(1);

    db.prepare(
      `INSERT INTO automation_events (id, run_id, seq, created_at, type, message)
       VALUES ('e1','r1',1,?,'RUN_STARTED','started')`,
    ).run(now);
    expect(
      (db.prepare('SELECT count(*) AS c FROM automation_events').get() as { c: number }).c,
    ).toBe(1);
  });

  it('cascades deletes from visa_applications through runs and events', () => {
    db.prepare(
      `INSERT INTO automation_runs
         (id, application_id, portal_url_snapshot, adapter_id, status, started_at, updated_at)
       VALUES ('r1','app1','https://x','india-evisa','pending',?,?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO automation_events (id, run_id, seq, created_at, type, message)
       VALUES ('e1','r1',1,?,'RUN_STARTED','started')`,
    ).run(now);

    db.prepare(`DELETE FROM visa_applications WHERE id='app1'`).run();

    expect(
      (db.prepare('SELECT count(*) AS c FROM automation_runs').get() as { c: number }).c,
    ).toBe(0);
    expect(
      (db.prepare('SELECT count(*) AS c FROM automation_events').get() as { c: number }).c,
    ).toBe(0);
  });

  it('rejects an illegal run status via the CHECK constraint', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO automation_runs
             (id, application_id, portal_url_snapshot, adapter_id, status, started_at, updated_at)
           VALUES ('r','app1','u','india-evisa','completed',?,?)`,
        )
        .run(now, now),
    ).toThrow();
  });

  it('no longer constrains waiting_reason (migration 6 dropped the CHECK)', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO automation_runs
             (id, application_id, portal_url_snapshot, adapter_id, status, waiting_reason, started_at, updated_at)
           VALUES ('r','app1','u','india-evisa','waiting_for_user','value_conflict',?,?)`,
        )
        .run(now, now),
    ).not.toThrow();
    expect(
      (
        db.prepare(`SELECT waiting_reason AS w FROM automation_runs WHERE id='r'`).get() as {
          w: string;
        }
      ).w,
    ).toBe('value_conflict');
  });

  it('enforces UNIQUE (run_id, seq) on automation_events', () => {
    db.prepare(
      `INSERT INTO automation_runs
         (id, application_id, portal_url_snapshot, adapter_id, status, started_at, updated_at)
       VALUES ('r1','app1','https://x','india-evisa','pending',?,?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO automation_events (id, run_id, seq, created_at, type, message)
       VALUES ('e1','r1',1,?,'RUN_STARTED','a')`,
    ).run(now);
    expect(() =>
      db
        .prepare(
          `INSERT INTO automation_events (id, run_id, seq, created_at, type, message)
           VALUES ('e2','r1',1,?,'PROGRESS','b')`,
        )
        .run(now),
    ).toThrow();
  });
});
