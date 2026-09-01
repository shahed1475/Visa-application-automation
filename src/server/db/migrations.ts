import type { DatabaseSync } from 'node:sqlite';

interface Migration {
  version: number;
  up: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE visa_portals (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        url              TEXT NOT NULL,
        portal_type      TEXT NOT NULL CHECK (portal_type IN ('regular','evisa','custom')),
        country          TEXT,
        application_type TEXT,
        notes            TEXT,
        enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE TABLE app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1]!.version;

export function runMigrations(db: DatabaseSync): void {
  const { user_version: current } = db
    .prepare('PRAGMA user_version')
    .get() as { user_version: number };
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.up);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
