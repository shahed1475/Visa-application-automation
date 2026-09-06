import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import {
  appendEvent,
  createRun,
  findActiveRun,
  getRun,
  listEvents,
  listRunsForApplication,
  updateRun,
} from '../../src/server/automation/state/automationRunStore.js';

const now = 't0';

function seedApplication(db: DatabaseSync, appId = 'app1', applicantId = 'a1'): void {
  db.prepare(
    `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES (?, 'A', 'draft', ?, ?)`,
  ).run(applicantId, now, now);
  db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES (?)`).run(applicantId);
  db.prepare(
    `INSERT INTO visa_applications
       (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
     VALUES (?, ?, 'IND', 'regular', 'regular.tourist', 'draft', '2026-09-06', ?, ?)`,
  ).run(appId, applicantId, now, now);
}

const runInput = (id: string, applicationId = 'app1') => ({
  id,
  applicationId,
  portalId: null,
  portalUrlSnapshot: 'https://indianvisaonline.gov.in',
  adapterId: 'india-evisa',
  now,
});

describe('automationRunStore', () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDbPath();
    db = openDatabase(dbPath);
    runMigrations(db);
    seedApplication(db);
  });
  afterEach(() => {
    db.close();
    cleanupTempDb(dbPath);
  });

  it('createRun returns a pending row and getRun round-trips every column', () => {
    const created = createRun(db, runInput('r1'));
    expect(created.status).toBe('pending');
    expect(created.id).toBe('r1');
    expect(created.application_id).toBe('app1');
    expect(created.portal_id).toBeNull();
    expect(created.portal_url_snapshot).toBe('https://indianvisaonline.gov.in');
    expect(created.adapter_id).toBe('india-evisa');
    expect(created.waiting_reason).toBeNull();
    expect(created.fields_total).toBe(0);
    expect(created.fields_verified).toBe(0);
    expect(created.documents_total).toBe(0);
    expect(created.documents_ready).toBe(0);
    expect(created.started_at).toBe(now);
    expect(created.updated_at).toBe(now);
    expect(created.ended_at).toBeNull();

    const fetched = getRun(db, 'r1');
    expect(fetched).toEqual(created);
  });

  it('getRun returns null for an unknown id', () => {
    expect(getRun(db, 'nope')).toBeNull();
  });

  it('listRunsForApplication returns rows for the application', () => {
    createRun(db, runInput('r1'));
    createRun(db, runInput('r2'));
    const rows = listRunsForApplication(db, 'app1');
    expect(rows.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });

  it('appendEvent assigns seq 1,2,3 and a forced duplicate (run_id, seq) throws', () => {
    createRun(db, runInput('r1'));
    const e1 = appendEvent(db, { id: 'e1', runId: 'r1', type: 'RUN_STARTED', message: 'a', now });
    const e2 = appendEvent(db, { id: 'e2', runId: 'r1', type: 'PROGRESS', message: 'b', now });
    const e3 = appendEvent(db, { id: 'e3', runId: 'r1', type: 'PROGRESS', message: 'c', now });
    expect([e1.seq, e2.seq, e3.seq]).toEqual([1, 2, 3]);
    expect(e2.created_at).toBe(now);
    expect(e2.message).toBe('b');

    expect(() =>
      db
        .prepare(
          `INSERT INTO automation_events (id, run_id, seq, created_at, type, message)
           VALUES ('dup', 'r1', 2, ?, 'PROGRESS', 'x')`,
        )
        .run(now),
    ).toThrow();
  });

  it('appendEvent persists the optional columns', () => {
    createRun(db, runInput('r1'));
    const ev = appendEvent(db, {
      id: 'e1',
      runId: 'r1',
      type: 'FIELD_VERIFIED',
      portalState: 'PERSONAL',
      fieldPath: 'identity.surname',
      status: 'verified',
      message: 'ok',
      evidencePath: '/tmp/shot.png',
      now,
    });
    expect(ev.portal_state).toBe('PERSONAL');
    expect(ev.field_path).toBe('identity.surname');
    expect(ev.status).toBe('verified');
    expect(ev.evidence_path).toBe('/tmp/shot.png');
  });

  it('listEvents(runId, afterSeq) returns only events past that seq, in order', () => {
    createRun(db, runInput('r1'));
    appendEvent(db, { id: 'e1', runId: 'r1', type: 'RUN_STARTED', message: 'a', now });
    appendEvent(db, { id: 'e2', runId: 'r1', type: 'PROGRESS', message: 'b', now });
    appendEvent(db, { id: 'e3', runId: 'r1', type: 'PROGRESS', message: 'c', now });
    expect(listEvents(db, 'r1').map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(listEvents(db, 'r1', 1).map((e) => e.seq)).toEqual([2, 3]);
  });

  it('findActiveRun skips terminal-status runs but returns a running one', () => {
    createRun(db, runInput('r1'));
    updateRun(db, 'r1', { status: 'review_ready' }, 't1');
    expect(findActiveRun(db)).toBeNull();

    createRun(db, runInput('r2'));
    updateRun(db, 'r2', { status: 'running' }, 't1');
    expect(findActiveRun(db)?.id).toBe('r2');
  });

  it('findActiveRun skips failed and aborted runs', () => {
    createRun(db, runInput('r1'));
    updateRun(db, 'r1', { status: 'failed' }, 't1');
    createRun(db, runInput('r2'));
    updateRun(db, 'r2', { status: 'aborted' }, 't1');
    expect(findActiveRun(db)).toBeNull();
  });

  it('findActiveRun scopes to applicationId', () => {
    seedApplication(db, 'app2', 'a2');
    createRun(db, runInput('r1', 'app1'));
    updateRun(db, 'r1', { status: 'running' }, 't1');
    createRun(db, runInput('r2', 'app2'));
    updateRun(db, 'r2', { status: 'running' }, 't1');

    expect(findActiveRun(db, { applicationId: 'app1' })?.id).toBe('r1');
    expect(findActiveRun(db, { applicationId: 'app2' })?.id).toBe('r2');
  });

  it('updateRun applies the patch, always bumps updated_at, and returns the fresh row', () => {
    createRun(db, runInput('r1'));
    const updated = updateRun(
      db,
      'r1',
      {
        status: 'waiting_for_user',
        waiting_reason: 'otp',
        current_portal_state: 'OTP',
        current_section_id: 'sec-1',
        fields_total: 10,
        fields_verified: 4,
        documents_total: 2,
        documents_ready: 1,
        error_code: null,
        error_message: null,
        ended_at: null,
      },
      't1',
    );
    expect(updated.status).toBe('waiting_for_user');
    expect(updated.waiting_reason).toBe('otp');
    expect(updated.current_portal_state).toBe('OTP');
    expect(updated.current_section_id).toBe('sec-1');
    expect(updated.fields_total).toBe(10);
    expect(updated.fields_verified).toBe(4);
    expect(updated.documents_total).toBe(2);
    expect(updated.documents_ready).toBe(1);
    expect(updated.updated_at).toBe('t1');
    expect(updated.started_at).toBe(now);
  });

  it('updateRun with an empty patch still bumps updated_at', () => {
    createRun(db, runInput('r1'));
    const updated = updateRun(db, 'r1', {}, 't9');
    expect(updated.updated_at).toBe('t9');
    expect(updated.status).toBe('pending');
  });

  it('deleting the parent visa_applications row cascades runs and events', () => {
    createRun(db, runInput('r1'));
    appendEvent(db, { id: 'e1', runId: 'r1', type: 'RUN_STARTED', message: 'a', now });
    db.prepare(`DELETE FROM visa_applications WHERE id = 'app1'`).run();
    expect(getRun(db, 'r1')).toBeNull();
    expect(
      (db.prepare('SELECT count(*) AS c FROM automation_events').get() as { c: number }).c,
    ).toBe(0);
  });
});
