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
  {
    version: 2,
    up: `
      CREATE TABLE applicants (
        id            TEXT PRIMARY KEY,
        display_name  TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','archived')),
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE applicant_identity (
        applicant_id             TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
        surname                  TEXT,
        given_names              TEXT,
        full_name_as_in_passport TEXT,
        date_of_birth            TEXT,
        sex                      TEXT CHECK (sex IN ('M','F','X') OR sex IS NULL),
        place_of_birth           TEXT,
        nationality              TEXT,
        other_nationalities      TEXT
      );

      CREATE TABLE applicant_passport (
        applicant_id      TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
        document_type     TEXT,
        number            TEXT,
        issuing_state     TEXT,
        issue_date        TEXT,
        expiry_date       TEXT,
        place_of_issue    TEXT,
        issuing_authority TEXT
      );

      CREATE TABLE applicant_contact (
        applicant_id TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
        email        TEXT,
        phone        TEXT,
        alt_phone    TEXT
      );

      CREATE TABLE applicant_address (
        applicant_id TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
        line1        TEXT,
        line2        TEXT,
        city         TEXT,
        region       TEXT,
        postal_code  TEXT,
        country      TEXT
      );

      CREATE TABLE applicant_travel (
        id                  TEXT PRIMARY KEY,
        applicant_id        TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
        sort_order          INTEGER NOT NULL DEFAULT 0,
        trip_type           TEXT,
        purpose             TEXT,
        destination_country TEXT,
        cities              TEXT,
        arrival_date        TEXT,
        departure_date      TEXT,
        port_of_entry       TEXT,
        port_of_exit        TEXT,
        accommodation       TEXT,
        previous_travel     TEXT,
        notes               TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX idx_applicant_travel_applicant ON applicant_travel(applicant_id, sort_order);

      CREATE TABLE applicant_reference (
        id           TEXT PRIMARY KEY,
        applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        kind         TEXT NOT NULL DEFAULT 'other'
                     CHECK (kind IN ('emergency_contact','employer','in_country_host','sponsor','other')),
        name         TEXT,
        relationship TEXT,
        organization TEXT,
        phone        TEXT,
        email        TEXT,
        address      TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_applicant_reference_applicant ON applicant_reference(applicant_id, sort_order);

      CREATE TABLE applicant_field_meta (
        id           TEXT PRIMARY KEY,
        applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
        field_path   TEXT NOT NULL,
        source       TEXT NOT NULL,
        confidence   REAL,
        raw_value    TEXT,
        verified     INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
        verified_at  TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        UNIQUE (applicant_id, field_path)
      );
      CREATE INDEX idx_applicant_field_meta_applicant ON applicant_field_meta(applicant_id);
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
