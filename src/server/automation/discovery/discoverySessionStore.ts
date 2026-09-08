import type { DatabaseSync } from 'node:sqlite';

/** Plain prepared-statement store over `portal_discovery_sessions` / `portal_discovery_pages`
 *  (migration 6). No HTTP types, no engine logic — the caller supplies every id and clock. */

export interface DiscoverySessionRow {
  id: string;
  portal_id: string | null;
  adapter_id: string;
  status: 'active' | 'ended' | 'aborted';
  started_at: string;
  ended_at: string | null;
  page_count: number;
  last_validation_json: string | null;
  notes: string | null;
}

export interface DiscoveryPageRow {
  id: string;
  session_id: string;
  seq: number;
  created_at: string;
  state_guess: string | null;
  url_pattern: string | null;
  page_title: string | null;
  headings_json: string;
  fingerprint_json: string;
  candidates_json: string;
  signals_json: string;
}

export function createDiscoverySession(
  db: DatabaseSync,
  input: { id: string; portalId: string | null; adapterId: string; now: string },
): DiscoverySessionRow {
  db.prepare(
    `INSERT INTO portal_discovery_sessions
       (id, portal_id, adapter_id, status, started_at, page_count)
     VALUES (?, ?, ?, 'active', ?, 0)`,
  ).run(input.id, input.portalId, input.adapterId, input.now);
  return getDiscoverySession(db, input.id)!;
}

export function getDiscoverySession(db: DatabaseSync, id: string): DiscoverySessionRow | null {
  const row = db
    .prepare('SELECT * FROM portal_discovery_sessions WHERE id = ?')
    .get(id) as DiscoverySessionRow | undefined;
  return row ?? null;
}

export function listDiscoverySessions(
  db: DatabaseSync,
  opts: { portalId?: string; adapterId?: string },
): DiscoverySessionRow[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts.portalId !== undefined) {
    clauses.push('portal_id = ?');
    params.push(opts.portalId);
  }
  if (opts.adapterId !== undefined) {
    clauses.push('adapter_id = ?');
    params.push(opts.adapterId);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT * FROM portal_discovery_sessions${where} ORDER BY started_at DESC, id DESC`,
    )
    .all(...params) as unknown as DiscoverySessionRow[];
}

export function findActiveDiscoverySession(
  db: DatabaseSync,
  adapterId: string,
): DiscoverySessionRow | null {
  const row = db
    .prepare(
      `SELECT * FROM portal_discovery_sessions
       WHERE adapter_id = ? AND status = 'active'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(adapterId) as DiscoverySessionRow | undefined;
  return row ?? null;
}

export function appendDiscoveryPage(
  db: DatabaseSync,
  input: {
    id: string;
    sessionId: string;
    now: string;
    stateGuess: string | null;
    urlPattern: string | null;
    pageTitle: string | null;
    headingsJson: string;
    fingerprintJson: string;
    candidatesJson: string;
    signalsJson: string;
  },
): DiscoveryPageRow {
  const { seq } = db
    .prepare(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM portal_discovery_pages WHERE session_id = ?',
    )
    .get(input.sessionId) as { seq: number };
  db.prepare(
    `INSERT INTO portal_discovery_pages
       (id, session_id, seq, created_at, state_guess, url_pattern, page_title,
        headings_json, fingerprint_json, candidates_json, signals_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    seq,
    input.now,
    input.stateGuess,
    input.urlPattern,
    input.pageTitle,
    input.headingsJson,
    input.fingerprintJson,
    input.candidatesJson,
    input.signalsJson,
  );
  db.prepare('UPDATE portal_discovery_sessions SET page_count = page_count + 1 WHERE id = ?').run(
    input.sessionId,
  );
  return db
    .prepare('SELECT * FROM portal_discovery_pages WHERE id = ?')
    .get(input.id) as unknown as DiscoveryPageRow;
}

export function listDiscoveryPages(db: DatabaseSync, sessionId: string): DiscoveryPageRow[] {
  return db
    .prepare('SELECT * FROM portal_discovery_pages WHERE session_id = ? ORDER BY seq ASC')
    .all(sessionId) as unknown as DiscoveryPageRow[];
}

const UPDATABLE_COLUMNS = [
  'status',
  'ended_at',
  'page_count',
  'last_validation_json',
  'notes',
] as const;

type UpdatableColumn = (typeof UPDATABLE_COLUMNS)[number];

export function updateDiscoverySession(
  db: DatabaseSync,
  id: string,
  patch: Partial<Pick<DiscoverySessionRow, UpdatableColumn>>,
  now: string,
): DiscoverySessionRow {
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  for (const col of UPDATABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(patch, col)) {
      assignments.push(`${col} = ?`);
      params.push(patch[col] ?? null);
    }
  }
  // A session that moves to a terminal state without an explicit ended_at is stamped now,
  // mirroring how automationRunStore.updateRun stamps updated_at.
  if (
    (patch.status === 'ended' || patch.status === 'aborted') &&
    !Object.prototype.hasOwnProperty.call(patch, 'ended_at')
  ) {
    assignments.push('ended_at = ?');
    params.push(now);
  }
  if (assignments.length > 0) {
    params.push(id);
    db.prepare(
      `UPDATE portal_discovery_sessions SET ${assignments.join(', ')} WHERE id = ?`,
    ).run(...params);
  }
  return getDiscoverySession(db, id)!;
}

/**
 * Mark every `active` discovery session `aborted`. Called once at server
 * startup: a discovery session's headed browser context lives only in the
 * in-process {@link DiscoveryController} and cannot outlive the process, so any
 * row still `active` after a (re)start is a zombie — it would otherwise block
 * every new session for its adapter with `409 SESSION_ACTIVE` and offer no way
 * back. Returns the number of sessions reconciled.
 */
export function abortStaleDiscoverySessions(db: DatabaseSync, now: string): number {
  const res = db
    .prepare(
      `UPDATE portal_discovery_sessions
         SET status = 'aborted', ended_at = COALESCE(ended_at, ?)
       WHERE status = 'active'`,
    )
    .run(now);
  return Number(res.changes ?? 0);
}
