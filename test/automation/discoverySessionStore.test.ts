import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import {
  abortStaleDiscoverySessions,
  appendDiscoveryPage,
  createDiscoverySession,
  findActiveDiscoverySession,
  getDiscoverySession,
  listDiscoveryPages,
  listDiscoverySessions,
  updateDiscoverySession,
} from '../../src/server/automation/discovery/discoverySessionStore.js';

const now = 't0';

const sessionInput = (id: string, adapterId = 'india', portalId: string | null = null) => ({
  id,
  portalId,
  adapterId,
  now,
});

const pageInput = (id: string, sessionId: string) => ({
  id,
  sessionId,
  now,
  stateGuess: 'form',
  urlPattern: '/apply/*',
  pageTitle: 'Apply',
  headingsJson: '["Apply"]',
  fingerprintJson: '{"a":1}',
  candidatesJson: '[]',
  signalsJson: '{}',
});

describe('discoverySessionStore', () => {
  let db: DatabaseSync;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDbPath();
    db = openDatabase(dbPath);
    runMigrations(db);
    for (const pid of ['p1', 'p2']) {
      db.prepare(
        `INSERT INTO visa_portals (id, name, url, portal_type, enabled, created_at, updated_at)
         VALUES (?, ?, 'https://example.gov', 'evisa', 1, ?, ?)`,
      ).run(pid, pid, now, now);
    }
  });
  afterEach(() => {
    db.close();
    cleanupTempDb(dbPath);
  });

  it('createDiscoverySession returns an active row and getDiscoverySession round-trips it', () => {
    const created = createDiscoverySession(db, sessionInput('s1'));
    expect(created).toMatchObject({
      id: 's1',
      portal_id: null,
      adapter_id: 'india',
      status: 'active',
      started_at: now,
      ended_at: null,
      page_count: 0,
      last_validation_json: null,
      notes: null,
    });
    expect(getDiscoverySession(db, 's1')).toEqual(created);
    expect(getDiscoverySession(db, 'missing')).toBeNull();
  });

  it('listDiscoverySessions filters by portalId and adapterId', () => {
    createDiscoverySession(db, sessionInput('s1', 'india', 'p1'));
    updateDiscoverySession(db, 's1', { status: 'ended' }, now);
    createDiscoverySession(db, sessionInput('s2', 'india', 'p2'));
    createDiscoverySession(db, sessionInput('s3', 'other', 'p1'));
    updateDiscoverySession(db, 's3', { status: 'ended' }, now);

    expect(listDiscoverySessions(db, {}).map((r) => r.id).sort()).toEqual(['s1', 's2', 's3']);
    expect(listDiscoverySessions(db, { adapterId: 'india' }).map((r) => r.id).sort()).toEqual([
      's1',
      's2',
    ]);
    expect(listDiscoverySessions(db, { portalId: 'p1' }).map((r) => r.id).sort()).toEqual([
      's1',
      's3',
    ]);
    expect(
      listDiscoverySessions(db, { portalId: 'p1', adapterId: 'india' }).map((r) => r.id),
    ).toEqual(['s1']);
  });

  it('findActiveDiscoverySession returns only the active session for an adapter', () => {
    createDiscoverySession(db, sessionInput('s1'));
    expect(findActiveDiscoverySession(db, 'india')?.id).toBe('s1');
    expect(findActiveDiscoverySession(db, 'other')).toBeNull();
    updateDiscoverySession(db, 's1', { status: 'ended' }, now);
    expect(findActiveDiscoverySession(db, 'india')).toBeNull();
  });

  it('a second active session for one adapter throws (partial unique index)', () => {
    createDiscoverySession(db, sessionInput('s1'));
    expect(() => createDiscoverySession(db, sessionInput('s2'))).toThrow();
  });

  it('appendDiscoveryPage assigns monotonic seq and bumps page_count', () => {
    createDiscoverySession(db, sessionInput('s1'));
    const p1 = appendDiscoveryPage(db, pageInput('pg1', 's1'));
    const p2 = appendDiscoveryPage(db, pageInput('pg2', 's1'));
    expect(p1.seq).toBe(1);
    expect(p2.seq).toBe(2);
    expect(p1).toMatchObject({
      id: 'pg1',
      session_id: 's1',
      created_at: now,
      state_guess: 'form',
      url_pattern: '/apply/*',
      page_title: 'Apply',
      headings_json: '["Apply"]',
      fingerprint_json: '{"a":1}',
      candidates_json: '[]',
      signals_json: '{}',
    });
    expect(getDiscoverySession(db, 's1')?.page_count).toBe(2);
  });

  it('listDiscoveryPages returns pages for the session ordered by seq', () => {
    createDiscoverySession(db, sessionInput('s1'));
    createDiscoverySession(db, sessionInput('s2', 'other'));
    appendDiscoveryPage(db, pageInput('pg1', 's1'));
    appendDiscoveryPage(db, pageInput('pg2', 's1'));
    appendDiscoveryPage(db, pageInput('pg3', 's2'));
    expect(listDiscoveryPages(db, 's1').map((r) => r.id)).toEqual(['pg1', 'pg2']);
    expect(listDiscoveryPages(db, 's2').map((r) => r.id)).toEqual(['pg3']);
  });

  it('updateDiscoverySession applies an allow-listed patch and stamps ended_at on terminal status', () => {
    createDiscoverySession(db, sessionInput('s1'));
    const ended = updateDiscoverySession(
      db,
      's1',
      { status: 'ended', last_validation_json: '{"ok":true}', notes: 'done' },
      'tEnd',
    );
    expect(ended.status).toBe('ended');
    expect(ended.ended_at).toBe('tEnd');
    expect(ended.last_validation_json).toBe('{"ok":true}');
    expect(ended.notes).toBe('done');
  });

  it('updateDiscoverySession honours an explicit ended_at over the now stamp', () => {
    createDiscoverySession(db, sessionInput('s1'));
    const ended = updateDiscoverySession(db, 's1', { status: 'aborted', ended_at: 'explicit' }, 'tNow');
    expect(ended.ended_at).toBe('explicit');
  });

  it('abortStaleDiscoverySessions aborts every active row and leaves terminal rows alone', () => {
    createDiscoverySession(db, sessionInput('active1', 'india'));
    createDiscoverySession(db, sessionInput('active2', 'generic'));
    const done = createDiscoverySession(db, sessionInput('done1', 'other'));
    updateDiscoverySession(db, done.id, { status: 'ended', ended_at: 'tEnd' }, 'tEnd');

    const n = abortStaleDiscoverySessions(db, 'tBoot');
    expect(n).toBe(2);
    expect(getDiscoverySession(db, 'active1')).toMatchObject({ status: 'aborted', ended_at: 'tBoot' });
    expect(getDiscoverySession(db, 'active2')).toMatchObject({ status: 'aborted', ended_at: 'tBoot' });
    // an already-terminal row is untouched
    expect(getDiscoverySession(db, 'done1')).toMatchObject({ status: 'ended', ended_at: 'tEnd' });
    // idempotent — a second boot reconciles nothing
    expect(abortStaleDiscoverySessions(db, 'tBoot2')).toBe(0);
  });
});
