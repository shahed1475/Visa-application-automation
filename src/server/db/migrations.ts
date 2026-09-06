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
  {
    version: 3,
    up: `
      CREATE TABLE documents (
        id                         TEXT PRIMARY KEY,
        applicant_id               TEXT REFERENCES applicants(id) ON DELETE CASCADE,
        kind                       TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('passport','unknown')),
        classification_confidence  REAL,
        original_name              TEXT,
        mime_type                  TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
        byte_size                  INTEGER NOT NULL,
        sha256                     TEXT NOT NULL,
        storage_path               TEXT NOT NULL,
        status                     TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','extracted','failed')),
        latest_extraction_method   TEXT CHECK (latest_extraction_method IN ('mrz','ocr','mrz_ocr') OR latest_extraction_method IS NULL),
        latest_ocr_mean_confidence REAL,
        page_count                 INTEGER,
        error_code                 TEXT,
        created_at                 TEXT NOT NULL,
        updated_at                 TEXT NOT NULL
      );
      CREATE INDEX idx_documents_applicant ON documents(applicant_id);

      CREATE TABLE extraction_runs (
        id                  TEXT PRIMARY KEY,
        document_id         TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        attempt             INTEGER NOT NULL,
        method              TEXT CHECK (method IN ('mrz','ocr','mrz_ocr') OR method IS NULL),
        status              TEXT NOT NULL CHECK (status IN ('completed','failed')),
        mrz_detected        INTEGER NOT NULL DEFAULT 0 CHECK (mrz_detected IN (0,1)),
        mrz_valid           INTEGER NOT NULL DEFAULT 0 CHECK (mrz_valid IN (0,1)),
        ocr_mean_confidence REAL,
        field_count         INTEGER NOT NULL DEFAULT 0,
        error_code          TEXT,
        engine_detail       TEXT,
        created_at          TEXT NOT NULL,
        UNIQUE (document_id, attempt)
      );
      CREATE INDEX idx_extraction_runs_document ON extraction_runs(document_id);

      CREATE TABLE document_fields (
        id                 TEXT PRIMARY KEY,
        document_id        TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        extraction_run_id  TEXT NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
        field_path         TEXT NOT NULL,
        value              TEXT,
        raw_value          TEXT,
        source             TEXT NOT NULL CHECK (source IN ('passport_mrz','passport_ocr','document_ocr')),
        confidence         REAL NOT NULL,
        check_digit_ok     INTEGER CHECK (check_digit_ok IN (0,1) OR check_digit_ok IS NULL),
        status             TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','applied','held','dismissed')),
        normalization_note TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        UNIQUE (document_id, field_path)
      );
      CREATE INDEX idx_document_fields_document ON document_fields(document_id);

      ALTER TABLE applicant_field_meta ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
    `,
  },
  {
    version: 4,
    up: `
      CREATE TABLE applicant_family (
        applicant_id            TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
        father_name TEXT, father_nationality TEXT, father_prev_nationality TEXT, father_place_of_birth TEXT,
        mother_name TEXT, mother_nationality TEXT, mother_prev_nationality TEXT, mother_place_of_birth TEXT,
        marital_status TEXT CHECK (marital_status IN ('single','married','divorced','widowed') OR marital_status IS NULL),
        spouse_name TEXT, spouse_nationality TEXT, spouse_prev_nationality TEXT, spouse_place_of_birth TEXT,
        pakistan_ancestry TEXT CHECK (pakistan_ancestry IN ('yes','no') OR pakistan_ancestry IS NULL)
      );
      CREATE TABLE applicant_occupation (
        applicant_id     TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
        occupation TEXT, employer_name TEXT, employer_address TEXT, designation TEXT,
        military_police TEXT CHECK (military_police IN ('yes','no') OR military_police IS NULL)
      );
      -- Backfill the two new 1:1 satellite rows for applicants that already exist.
      -- writeSection is a bare UPDATE ... WHERE applicant_id = ?, so without a row here a
      -- family/occupation patch on a pre-migration-4 applicant would affect zero rows and
      -- silently drop the data. On a fresh DB "applicants" is empty at this point, so these
      -- INSERTs are no-ops and createApplicant remains the sole producer for new applicants.
      INSERT INTO applicant_family (applicant_id) SELECT id FROM applicants;
      INSERT INTO applicant_occupation (applicant_id) SELECT id FROM applicants;
      ALTER TABLE applicant_identity ADD COLUMN religion TEXT;
      ALTER TABLE applicant_identity ADD COLUMN education TEXT;
      ALTER TABLE applicant_identity ADD COLUMN national_id TEXT;
      ALTER TABLE applicant_identity ADD COLUMN visible_marks TEXT;
      ALTER TABLE applicant_identity ADD COLUMN nationality_at_birth TEXT;

      CREATE TABLE visa_applications (
        id                    TEXT PRIMARY KEY,
        applicant_id          TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
        destination           TEXT NOT NULL DEFAULT 'IND',
        application_mode      TEXT NOT NULL CHECK (application_mode IN ('evisa','regular')),
        category_id           TEXT NOT NULL,
        purpose               TEXT,
        entry_type            TEXT CHECK (entry_type IN ('single','double','multiple') OR entry_type IS NULL),
        intended_arrival_date TEXT,
        intended_stay_days    INTEGER,
        port_of_arrival       TEXT,
        status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','archived')),
        kb_version            TEXT NOT NULL,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      );
      CREATE INDEX idx_visa_applications_applicant ON visa_applications(applicant_id);

      CREATE TABLE application_field_values (
        id             TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
        field_path     TEXT NOT NULL,
        value          TEXT,
        verified       INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
        verified_at    TEXT,
        source         TEXT NOT NULL DEFAULT 'manual',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        UNIQUE (application_id, field_path)
      );
      CREATE INDEX idx_application_field_values_app ON application_field_values(application_id);
    `,
  },
  {
    version: 5,
    up: `
      CREATE TABLE automation_runs (
        id                    TEXT PRIMARY KEY,
        application_id        TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
        portal_id             TEXT REFERENCES visa_portals(id) ON DELETE SET NULL,
        portal_url_snapshot   TEXT NOT NULL,
        adapter_id            TEXT NOT NULL,
        status                TEXT NOT NULL CHECK (status IN ('pending','running','waiting_for_user','paused','review_ready','failed','aborted')),
        waiting_reason        TEXT CHECK (waiting_reason IN ('otp','captcha','mfa','anti_bot','unknown_page','missing_field_mapping','value_mismatch','document_upload_required','session_expired','validation_error','user_paused') OR waiting_reason IS NULL),
        current_portal_state  TEXT,
        current_section_id    TEXT,
        fields_total          INTEGER NOT NULL DEFAULT 0,
        fields_verified       INTEGER NOT NULL DEFAULT 0,
        documents_total       INTEGER NOT NULL DEFAULT 0,
        documents_ready       INTEGER NOT NULL DEFAULT 0,
        error_code            TEXT,
        error_message         TEXT,
        started_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        ended_at              TEXT
      );
      CREATE INDEX idx_automation_runs_application ON automation_runs(application_id);

      CREATE TABLE automation_events (
        id            TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
        seq           INTEGER NOT NULL,
        created_at    TEXT NOT NULL,
        type          TEXT NOT NULL,
        portal_state  TEXT,
        field_path    TEXT,
        status        TEXT,
        message       TEXT NOT NULL,
        evidence_path TEXT,
        UNIQUE (run_id, seq)
      );
      CREATE INDEX idx_automation_events_run ON automation_events(run_id);
    `,
  },
  {
    version: 6,
    // First line MUST stay `PRAGMA foreign_keys = OFF;` — runMigrations detects it and applies
    // it *outside* the wrapping transaction (the pragma is a no-op mid-BEGIN under node:sqlite),
    // then restores it after COMMIT. The `automation_runs` rebuild below drops the table while
    // `automation_events` still references it; with FKs enforced that DROP would cascade-wipe
    // the events (and `PRAGMA legacy_alter_table` does NOT stop RENAME from rewriting the child
    // FK in this SQLite build). The rebuild follows the SQLite "table rebuild" recipe: create
    // the replacement under a temp name, copy, drop the old, RENAME the new into place — the
    // RENAME leaves `automation_events`'s `REFERENCES automation_runs` untouched.
    up: `
      PRAGMA foreign_keys = OFF;

      CREATE TABLE portal_discovery_sessions (
        id                   TEXT PRIMARY KEY,
        portal_id            TEXT REFERENCES visa_portals(id) ON DELETE SET NULL,
        adapter_id           TEXT NOT NULL,
        status               TEXT NOT NULL CHECK (status IN ('active','ended','aborted')),
        started_at           TEXT NOT NULL,
        ended_at             TEXT,
        page_count           INTEGER NOT NULL DEFAULT 0,
        last_validation_json TEXT,
        notes                TEXT
      );
      CREATE UNIQUE INDEX idx_discovery_sessions_one_active
        ON portal_discovery_sessions(adapter_id) WHERE status = 'active';

      CREATE TABLE portal_discovery_pages (
        id               TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL REFERENCES portal_discovery_sessions(id) ON DELETE CASCADE,
        seq              INTEGER NOT NULL,
        created_at       TEXT NOT NULL,
        state_guess      TEXT,
        url_pattern      TEXT,
        page_title       TEXT,
        headings_json    TEXT NOT NULL,
        fingerprint_json TEXT NOT NULL,
        candidates_json  TEXT NOT NULL,
        signals_json     TEXT NOT NULL,
        UNIQUE (session_id, seq)
      );
      CREATE INDEX idx_discovery_pages_session ON portal_discovery_pages(session_id);

      CREATE TABLE _automation_runs_v6 (
        id                    TEXT PRIMARY KEY,
        application_id        TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
        portal_id             TEXT REFERENCES visa_portals(id) ON DELETE SET NULL,
        portal_url_snapshot   TEXT NOT NULL,
        adapter_id            TEXT NOT NULL,
        status                TEXT NOT NULL CHECK (status IN ('pending','running','waiting_for_user','paused','review_ready','failed','aborted')),
        waiting_reason        TEXT,
        current_portal_state  TEXT,
        current_section_id    TEXT,
        fields_total          INTEGER NOT NULL DEFAULT 0,
        fields_verified       INTEGER NOT NULL DEFAULT 0,
        documents_total       INTEGER NOT NULL DEFAULT 0,
        documents_ready       INTEGER NOT NULL DEFAULT 0,
        error_code            TEXT,
        error_message         TEXT,
        started_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        ended_at              TEXT
      );
      INSERT INTO _automation_runs_v6 SELECT * FROM automation_runs;
      DROP TABLE automation_runs;
      ALTER TABLE _automation_runs_v6 RENAME TO automation_runs;
      CREATE INDEX idx_automation_runs_application ON automation_runs(application_id);

      PRAGMA foreign_keys = ON;
    `,
  },
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1]!.version;

/** Applies every pending migration. `upTo` stops after that schema version — it exists so
 *  tests can materialise a genuine older database (e.g. v3) and then exercise the real
 *  upgrade path; production callers omit it and get everything. */
export function runMigrations(db: DatabaseSync, upTo?: number): void {
  const { user_version: current } = db
    .prepare('PRAGMA user_version')
    .get() as { user_version: number };
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    if (upTo !== undefined && migration.version > upTo) break;
    // `PRAGMA foreign_keys` is silently ignored inside a transaction (node:sqlite), so a
    // migration that must rebuild a referenced table declares `PRAGMA foreign_keys = OFF;`
    // on its first line and we toggle it around the wrapping BEGIN/COMMIT instead.
    const suspendFks = /^\s*PRAGMA foreign_keys = OFF;/i.test(migration.up);
    if (suspendFks) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(migration.up);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      if (suspendFks) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}
