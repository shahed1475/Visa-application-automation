import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations, LATEST_SCHEMA_VERSION } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let db: DatabaseSync;
let dbPath: string;

function userVersion(d: DatabaseSync): number {
  return (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}
function tableNames(d: DatabaseSync): string[] {
  return d
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name);
}

beforeEach(() => {
  dbPath = makeTempDbPath();
  db = openDatabase(dbPath);
});
afterEach(() => {
  db.close();
  cleanupTempDb(dbPath);
});

it('LATEST_SCHEMA_VERSION is 5', () => {
  expect(LATEST_SCHEMA_VERSION).toBe(5);
});

it('creates all eight applicant tables and reaches version 5', () => {
  runMigrations(db);
  expect(userVersion(db)).toBe(5);
  for (const t of [
    'applicants',
    'applicant_identity',
    'applicant_passport',
    'applicant_contact',
    'applicant_address',
    'applicant_travel',
    'applicant_reference',
    'applicant_field_meta',
  ]) {
    expect(tableNames(db)).toContain(t);
  }
});

it('is idempotent', () => {
  runMigrations(db);
  expect(() => runMigrations(db)).not.toThrow();
  expect(userVersion(db)).toBe(5);
});

it('preserves existing portal data when upgrading from v1', () => {
  // simulate a Phase 0/1 database: run only migration 1 by faking user_version
  db.exec(`
    CREATE TABLE visa_portals (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
      portal_type TEXT NOT NULL, country TEXT, application_type TEXT, notes TEXT,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    PRAGMA user_version = 1;
  `);
  db.prepare(
    `INSERT INTO visa_portals (id,name,url,portal_type,enabled,created_at,updated_at)
     VALUES ('p1','Keep me','https://example.com','evisa',1,'2026-01-01','2026-01-01')`,
  ).run();

  runMigrations(db);

  expect(userVersion(db)).toBe(5);
  const row = db.prepare('SELECT name FROM visa_portals WHERE id = ?').get('p1') as
    | { name: string }
    | undefined;
  expect(row?.name).toBe('Keep me');
});

it('cascades applicant deletion to every child table', () => {
  runMigrations(db);
  const now = '2026-01-01T00:00:00Z';
  db.prepare(
    `INSERT INTO applicants (id, display_name, status, created_at, updated_at)
     VALUES ('a1','A','draft',?,?)`,
  ).run(now, now);
  db.prepare(`INSERT INTO applicant_identity (applicant_id, surname) VALUES ('a1','X')`).run();
  db.prepare(`INSERT INTO applicant_passport (applicant_id, number) VALUES ('a1','N')`).run();
  db.prepare(`INSERT INTO applicant_contact (applicant_id, email) VALUES ('a1','e')`).run();
  db.prepare(`INSERT INTO applicant_address (applicant_id, city) VALUES ('a1','C')`).run();
  db.prepare(
    `INSERT INTO applicant_travel (id, applicant_id, sort_order, created_at, updated_at)
     VALUES ('t1','a1',0,?,?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO applicant_reference (id, applicant_id, sort_order, kind, created_at, updated_at)
     VALUES ('r1','a1',0,'other',?,?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO applicant_field_meta
       (id, applicant_id, field_path, source, verified, created_at, updated_at)
     VALUES ('m1','a1','identity.surname','manual',0,?,?)`,
  ).run(now, now);

  db.prepare('DELETE FROM applicants WHERE id = ?').run('a1');

  for (const t of [
    'applicant_identity',
    'applicant_passport',
    'applicant_contact',
    'applicant_address',
    'applicant_travel',
    'applicant_reference',
    'applicant_field_meta',
  ]) {
    const count = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
    expect(count.n, `${t} should be empty after cascade`).toBe(0);
  }
});
