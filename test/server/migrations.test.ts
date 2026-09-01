import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations, LATEST_SCHEMA_VERSION } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let db: DatabaseSync;
let dbPath: string;

beforeEach(() => {
  dbPath = makeTempDbPath();
  db = openDatabase(dbPath);
});
afterEach(() => {
  db.close();
  cleanupTempDb(dbPath);
});

it('brings a fresh db to the latest schema version', () => {
  runMigrations(db);
  expect(
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
  ).toBe(LATEST_SCHEMA_VERSION);
});

it('creates the expected tables', () => {
  runMigrations(db);
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r: { name: string }) => r.name);
  expect(names).toContain('visa_portals');
  expect(names).toContain('app_settings');
});

it('is idempotent when run twice', () => {
  runMigrations(db);
  expect(() => runMigrations(db)).not.toThrow();
  expect(
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
  ).toBe(LATEST_SCHEMA_VERSION);
});
