import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations, LATEST_SCHEMA_VERSION } from '../../src/server/db/migrations.js';
import { updateApplicant } from '../../src/server/services/applicantService.js';
import { makeTempDbPath, cleanupTempDb } from '../helpers/tempDb.js';

describe('migration 4 — applicant family/occupation/identity + visa_applications', () => {
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

  const cols = (t: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((r) => r.name);
  const now = 't';

  const insertApplicant = (id: string) =>
    db
      .prepare(
        `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES (?, 'A', 'draft', ?, ?)`,
      )
      .run(id, now, now);

  it('bumps the schema version to the latest', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(6);
    expect(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(6);
  });

  it('creates applicant_family with the expected columns', () => {
    expect(cols('applicant_family').sort()).toEqual(
      [
        'applicant_id',
        'father_name', 'father_nationality', 'father_prev_nationality', 'father_place_of_birth',
        'mother_name', 'mother_nationality', 'mother_prev_nationality', 'mother_place_of_birth',
        'marital_status',
        'spouse_name', 'spouse_nationality', 'spouse_prev_nationality', 'spouse_place_of_birth',
        'pakistan_ancestry',
      ].sort(),
    );
  });

  it('creates applicant_occupation with the expected columns', () => {
    expect(cols('applicant_occupation').sort()).toEqual(
      ['applicant_id', 'occupation', 'employer_name', 'employer_address', 'designation', 'military_police'].sort(),
    );
  });

  it('adds the 5 new applicant_identity columns', () => {
    const c = cols('applicant_identity');
    expect(c).toContain('religion');
    expect(c).toContain('education');
    expect(c).toContain('national_id');
    expect(c).toContain('visible_marks');
    expect(c).toContain('nationality_at_birth');
  });

  it('creates visa_applications with the expected columns', () => {
    expect(cols('visa_applications').sort()).toEqual(
      [
        'id', 'applicant_id', 'destination', 'application_mode', 'category_id', 'purpose',
        'entry_type', 'intended_arrival_date', 'intended_stay_days', 'port_of_arrival',
        'status', 'kb_version', 'created_at', 'updated_at',
      ].sort(),
    );
  });

  it('creates application_field_values with the expected columns', () => {
    expect(cols('application_field_values').sort()).toEqual(
      [
        'id', 'application_id', 'field_path', 'value', 'verified', 'verified_at', 'source',
        'created_at', 'updated_at',
      ].sort(),
    );
  });

  it('enforces applicant_family.marital_status CHECK', () => {
    insertApplicant('a1');
    expect(() =>
      db
        .prepare(`INSERT INTO applicant_family (applicant_id, marital_status) VALUES ('a1', 'engaged')`)
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(`INSERT INTO applicant_family (applicant_id, marital_status) VALUES ('a1', 'married')`)
        .run(),
    ).not.toThrow();
  });

  it('enforces applicant_family.pakistan_ancestry CHECK', () => {
    insertApplicant('a1');
    expect(() =>
      db
        .prepare(`INSERT INTO applicant_family (applicant_id, pakistan_ancestry) VALUES ('a1', 'maybe')`)
        .run(),
    ).toThrow();
  });

  it('allows NULL for applicant_family.marital_status/pakistan_ancestry', () => {
    insertApplicant('a1');
    expect(() =>
      db.prepare(`INSERT INTO applicant_family (applicant_id) VALUES ('a1')`).run(),
    ).not.toThrow();
  });

  it('enforces applicant_occupation.military_police CHECK', () => {
    insertApplicant('a1');
    expect(() =>
      db
        .prepare(`INSERT INTO applicant_occupation (applicant_id, military_police) VALUES ('a1', 'unsure')`)
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(`INSERT INTO applicant_occupation (applicant_id, military_police) VALUES ('a1', 'no')`)
        .run(),
    ).not.toThrow();
  });

  it('enforces visa_applications.application_mode CHECK', () => {
    insertApplicant('a1');
    const ins = (mode: string) =>
      db
        .prepare(
          `INSERT INTO visa_applications (id, applicant_id, application_mode, category_id, kb_version, created_at, updated_at)
           VALUES ('v1', 'a1', ?, 'c1', 'kb1', ?, ?)`,
        )
        .run(mode, now, now);
    expect(() => ins('paper')).toThrow();
  });

  it('accepts a valid visa_applications row with defaults', () => {
    insertApplicant('a1');
    db.prepare(
      `INSERT INTO visa_applications (id, applicant_id, application_mode, category_id, kb_version, created_at, updated_at)
       VALUES ('v1', 'a1', 'evisa', 'c1', 'kb1', ?, ?)`,
    ).run(now, now);
    const row = db
      .prepare(`SELECT destination, status FROM visa_applications WHERE id = 'v1'`)
      .get();
    expect(row).toEqual({ destination: 'IND', status: 'draft' });
  });

  it('enforces visa_applications.status CHECK', () => {
    insertApplicant('a1');
    expect(() =>
      db
        .prepare(
          `INSERT INTO visa_applications (id, applicant_id, application_mode, category_id, status, kb_version, created_at, updated_at)
           VALUES ('v1', 'a1', 'evisa', 'c1', 'submitted', 'kb1', ?, ?)`,
        )
        .run(now, now),
    ).toThrow();
  });

  it('enforces visa_applications.entry_type CHECK, allowing NULL', () => {
    insertApplicant('a1');
    expect(() =>
      db
        .prepare(
          `INSERT INTO visa_applications (id, applicant_id, application_mode, category_id, entry_type, kb_version, created_at, updated_at)
           VALUES ('v1', 'a1', 'evisa', 'c1', 'triple', 'kb1', ?, ?)`,
        )
        .run(now, now),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO visa_applications (id, applicant_id, application_mode, category_id, entry_type, kb_version, created_at, updated_at)
           VALUES ('v2', 'a1', 'evisa', 'c1', NULL, 'kb1', ?, ?)`,
        )
        .run(now, now),
    ).not.toThrow();
  });

  it('enforces application_field_values.verified CHECK and UNIQUE(application_id, field_path)', () => {
    insertApplicant('a1');
    db.prepare(
      `INSERT INTO visa_applications (id, applicant_id, application_mode, category_id, kb_version, created_at, updated_at)
       VALUES ('v1', 'a1', 'evisa', 'c1', 'kb1', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO application_field_values (id, application_id, field_path, value, verified, source, created_at, updated_at)
       VALUES ('f1', 'v1', 'identity.surname', 'X', 0, 'manual', ?, ?)`,
    ).run(now, now);
    expect(() =>
      db
        .prepare(
          `INSERT INTO application_field_values (id, application_id, field_path, value, verified, source, created_at, updated_at)
           VALUES ('f2', 'v1', 'identity.surname', 'Y', 0, 'manual', ?, ?)`,
        )
        .run(now, now),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO application_field_values (id, application_id, field_path, value, verified, source, created_at, updated_at)
           VALUES ('f3', 'v1', 'identity.given_names', 'Y', 2, 'manual', ?, ?)`,
        )
        .run(now, now),
    ).toThrow();
  });

  it('cascades applicants deletion to applicant_family, applicant_occupation, and visa_applications', () => {
    insertApplicant('a1');
    db.prepare(`INSERT INTO applicant_family (applicant_id) VALUES ('a1')`).run();
    db.prepare(`INSERT INTO applicant_occupation (applicant_id) VALUES ('a1')`).run();
    db.prepare(
      `INSERT INTO visa_applications (id, applicant_id, application_mode, category_id, kb_version, created_at, updated_at)
       VALUES ('v1', 'a1', 'evisa', 'c1', 'kb1', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO application_field_values (id, application_id, field_path, verified, source, created_at, updated_at)
       VALUES ('f1', 'v1', 'identity.surname', 0, 'manual', ?, ?)`,
    ).run(now, now);

    db.prepare(`DELETE FROM applicants WHERE id = 'a1'`).run();

    for (const t of ['applicant_family', 'applicant_occupation', 'visa_applications', 'application_field_values']) {
      const count = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
      expect(count.n, `${t} should be empty after cascade`).toBe(0);
    }
  });

  it('cascades visa_applications deletion to application_field_values', () => {
    insertApplicant('a1');
    db.prepare(
      `INSERT INTO visa_applications (id, applicant_id, application_mode, category_id, kb_version, created_at, updated_at)
       VALUES ('v1', 'a1', 'evisa', 'c1', 'kb1', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO application_field_values (id, application_id, field_path, verified, source, created_at, updated_at)
       VALUES ('f1', 'v1', 'identity.surname', 0, 'manual', ?, ?)`,
    ).run(now, now);

    db.prepare(`DELETE FROM visa_applications WHERE id = 'v1'`).run();

    const count = db.prepare(`SELECT COUNT(*) AS n FROM application_field_values`).get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });

  it('a v3 database upgrades to the latest schema without data loss', () => {
    const p3 = makeTempDbPath();
    const d3 = openDatabase(p3);
    d3.exec('PRAGMA user_version = 0');
    runMigrations(d3);
    d3.prepare(
      `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft','t','t')`,
    ).run();
    d3.close();
    const d4 = openDatabase(p3);
    runMigrations(d4);
    expect(
      (d4.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(6);
    expect(d4.prepare(`SELECT display_name FROM applicants WHERE id='a1'`).get()).toEqual({
      display_name: 'A',
    });
    d4.close();
    cleanupTempDb(p3);
  });
});

/** A genuine v3 database (migrations 1-3 only, applicant + v3-era satellite rows already
 *  present) upgraded by migration 4 alone. The `PRAGMA user_version = 0` + run-everything
 *  style above never has a v3 database, so it cannot see the backfill at all. */
describe('migration 4 — real v3 -> v4 upgrade of an existing applicant', () => {
  let db: DatabaseSync;
  let dbPath: string;
  const now = 't';

  beforeEach(() => {
    dbPath = makeTempDbPath();
    db = openDatabase(dbPath);
    // Stop at v3: the DB now looks exactly like one written by the previous release.
    runMigrations(db, 3);
    expect(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(3);

    db.prepare(
      `INSERT INTO applicants (id, display_name, status, created_at, updated_at)
       VALUES ('legacy', 'Legacy Applicant', 'draft', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO applicant_identity (applicant_id, surname, given_names) VALUES ('legacy', 'Rai', 'Asha')`,
    ).run();
    db.prepare(`INSERT INTO applicant_passport (applicant_id, number) VALUES ('legacy', 'P123')`).run();
    db.prepare(`INSERT INTO applicant_contact (applicant_id, email) VALUES ('legacy', 'a@b.c')`).run();
    db.prepare(`INSERT INTO applicant_address (applicant_id, city) VALUES ('legacy', 'Dhaka')`).run();
    db.prepare(
      `INSERT INTO applicant_field_meta (id, applicant_id, field_path, source, verified, created_at, updated_at)
       VALUES ('m1', 'legacy', 'identity.surname', 'manual', 1, ?, ?)`,
    ).run(now, now);

    // The upgrade under test.
    runMigrations(db);
  });
  afterEach(() => {
    db.close();
    cleanupTempDb(dbPath);
  });

  const count = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE applicant_id = 'legacy'`).get() as { n: number }).n;

  it('reaches the latest schema version and keeps the v3-era data', () => {
    expect(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(6);
    expect(db.prepare(`SELECT surname FROM applicant_identity WHERE applicant_id='legacy'`).get()).toEqual({
      surname: 'Rai',
    });
    expect(count('applicant_field_meta')).toBe(1);
  });

  it('backfills applicant_family and applicant_occupation for the pre-existing applicant', () => {
    expect(count('applicant_family')).toBe(1);
    expect(count('applicant_occupation')).toBe(1);
  });

  it('persists a family/occupation patch on the upgraded applicant', () => {
    const detail = updateApplicant(db, 'legacy', {
      family: { fatherName: 'X' },
      occupation: { occupation: 'Y' },
    });
    expect(detail).not.toBeNull();
    expect(detail!.family.fatherName).toBe('X');
    expect(detail!.occupation.occupation).toBe('Y');

    // Read back straight from SQL, so a service-layer cache could not mask a lost write.
    expect(
      db.prepare(`SELECT father_name FROM applicant_family WHERE applicant_id='legacy'`).get(),
    ).toEqual({ father_name: 'X' });
    expect(
      db.prepare(`SELECT occupation FROM applicant_occupation WHERE applicant_id='legacy'`).get(),
    ).toEqual({ occupation: 'Y' });
  });

  it('does not double-insert satellite rows when migrations are re-run', () => {
    runMigrations(db);
    expect(count('applicant_family')).toBe(1);
    expect(count('applicant_occupation')).toBe(1);
  });
});
