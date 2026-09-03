import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations, LATEST_SCHEMA_VERSION } from '../../src/server/db/migrations.js';
import { makeTempDbPath, cleanupTempDb } from '../helpers/tempDb.js';

describe('migration 3 — document tables', () => {
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

  it('bumps the schema version to 3', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(3);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
  });

  it('creates documents with the expected columns', () => {
    expect(cols('documents').sort()).toEqual(
      [
        'applicant_id', 'byte_size', 'classification_confidence', 'created_at', 'error_code',
        'id', 'kind', 'latest_extraction_method', 'latest_ocr_mean_confidence', 'mime_type',
        'original_name', 'page_count', 'sha256', 'status', 'storage_path', 'updated_at',
      ].sort(),
    );
  });

  it('creates extraction_runs and document_fields', () => {
    expect(cols('extraction_runs')).toContain('attempt');
    expect(cols('extraction_runs')).toContain('mrz_valid');
    expect(cols('extraction_runs')).toContain('engine_detail');
    expect(cols('document_fields')).toContain('extraction_run_id');
    expect(cols('document_fields')).toContain('check_digit_ok');
    expect(cols('document_fields')).toContain('normalization_note');
  });

  it('adds applicant_field_meta.document_id', () => {
    expect(cols('applicant_field_meta')).toContain('document_id');
  });

  it('enforces documents.kind and documents.mime_type CHECK constraints', () => {
    const ins = () =>
      db.prepare(
        `INSERT INTO documents (id, kind, mime_type, byte_size, sha256, storage_path, status, created_at, updated_at)
         VALUES ('d1', 'passport-photo', 'image/gif', 1, 'x', 'p', 'uploaded', 't', 't')`,
      ).run();
    expect(ins).toThrow();
  });

  it('cascades documents → extraction_runs → document_fields on delete', () => {
    db.exec('PRAGMA foreign_keys = ON');
    const now = 't';
    db.prepare(
      `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO documents (id, applicant_id, kind, mime_type, byte_size, sha256, storage_path, status, created_at, updated_at)
       VALUES ('d1','a1','passport','image/jpeg',10,'h','d1/original.jpg','uploaded',?,?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO extraction_runs (id, document_id, attempt, method, status, created_at) VALUES ('r1','d1',1,'mrz','completed',?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO document_fields (id, document_id, extraction_run_id, field_path, source, confidence, status, created_at, updated_at)
       VALUES ('f1','d1','r1','passport.number','passport_mrz',0.99,'proposed',?,?)`,
    ).run(now, now);
    db.prepare(`DELETE FROM documents WHERE id = 'd1'`).run();
    expect(db.prepare(`SELECT count(*) c FROM extraction_runs`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM document_fields`).get()).toEqual({ c: 0 });
  });

  it('nulls applicant_field_meta.document_id when the document is deleted (ON DELETE SET NULL)', () => {
    db.exec('PRAGMA foreign_keys = ON');
    const now = 't';
    db.prepare(`INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`).run(now, now);
    db.prepare(
      `INSERT INTO documents (id, applicant_id, kind, mime_type, byte_size, sha256, storage_path, status, created_at, updated_at)
       VALUES ('d1','a1','passport','image/jpeg',10,'h','d1/o.jpg','uploaded',?,?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO applicant_field_meta (id, applicant_id, field_path, source, verified, document_id, created_at, updated_at)
       VALUES ('m1','a1','passport.number','passport_mrz',0,'d1',?,?)`,
    ).run(now, now);
    db.prepare(`DELETE FROM documents WHERE id = 'd1'`).run();
    const meta = db.prepare(`SELECT document_id FROM applicant_field_meta WHERE id = 'm1'`).get();
    expect(meta).toEqual({ document_id: null });
  });

  it('a v2 database upgrades to v3 without data loss', () => {
    const p2 = makeTempDbPath();
    const d2 = openDatabase(p2);
    d2.exec('PRAGMA user_version = 0');
    runMigrations(d2);
    d2.prepare(
      `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft','t','t')`,
    ).run();
    d2.close();
    const d3 = openDatabase(p2);
    runMigrations(d3);
    expect(
      (d3.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(3);
    expect(d3.prepare(`SELECT display_name FROM applicants WHERE id='a1'`).get()).toEqual({
      display_name: 'A',
    });
    d3.close();
    cleanupTempDb(p2);
  });
});
