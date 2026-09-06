import type { DatabaseSync } from 'node:sqlite';
import type { AutomationEventRow, AutomationRunRow } from '../../../shared/automation/types.js';
import { TERMINAL_STATES } from '../../../shared/automation/states.js';

/** Plain prepared-statement store over `automation_runs` / `automation_events` (migration 5).
 *  No HTTP types, no engine logic — the caller supplies every id. */

interface RawRunRow {
  id: string;
  application_id: string;
  portal_id: string | null;
  portal_url_snapshot: string;
  adapter_id: string;
  status: string;
  waiting_reason: string | null;
  current_portal_state: string | null;
  current_section_id: string | null;
  fields_total: number;
  fields_verified: number;
  documents_total: number;
  documents_ready: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

interface RawEventRow {
  id: string;
  run_id: string;
  seq: number;
  created_at: string;
  type: string;
  portal_state: string | null;
  field_path: string | null;
  status: string | null;
  message: string;
  evidence_path: string | null;
}

function rowToRun(r: RawRunRow): AutomationRunRow {
  return {
    id: r.id,
    application_id: r.application_id,
    portal_id: r.portal_id,
    portal_url_snapshot: r.portal_url_snapshot,
    adapter_id: r.adapter_id,
    status: r.status as AutomationRunRow['status'],
    waiting_reason: r.waiting_reason as AutomationRunRow['waiting_reason'],
    current_portal_state: r.current_portal_state,
    current_section_id: r.current_section_id,
    fields_total: r.fields_total,
    fields_verified: r.fields_verified,
    documents_total: r.documents_total,
    documents_ready: r.documents_ready,
    error_code: r.error_code,
    error_message: r.error_message,
    started_at: r.started_at,
    updated_at: r.updated_at,
    ended_at: r.ended_at,
  };
}

function rowToEvent(r: RawEventRow): AutomationEventRow {
  return {
    id: r.id,
    run_id: r.run_id,
    seq: r.seq,
    created_at: r.created_at,
    type: r.type,
    portal_state: r.portal_state,
    field_path: r.field_path,
    status: r.status,
    message: r.message,
    evidence_path: r.evidence_path,
  };
}

export function createRun(
  db: DatabaseSync,
  input: {
    id: string;
    applicationId: string;
    portalId: string | null;
    portalUrlSnapshot: string;
    adapterId: string;
    now: string;
  },
): AutomationRunRow {
  db.prepare(
    `INSERT INTO automation_runs
       (id, application_id, portal_id, portal_url_snapshot, adapter_id, status, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    input.id,
    input.applicationId,
    input.portalId,
    input.portalUrlSnapshot,
    input.adapterId,
    input.now,
    input.now,
  );
  return getRun(db, input.id)!;
}

export function getRun(db: DatabaseSync, id: string): AutomationRunRow | null {
  const row = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as
    | RawRunRow
    | undefined;
  return row ? rowToRun(row) : null;
}

export function listRunsForApplication(
  db: DatabaseSync,
  applicationId: string,
): AutomationRunRow[] {
  const rows = db
    .prepare('SELECT * FROM automation_runs WHERE application_id = ? ORDER BY started_at DESC, id DESC')
    .all(applicationId) as unknown as RawRunRow[];
  return rows.map(rowToRun);
}

export function findActiveRun(
  db: DatabaseSync,
  opts?: { applicationId?: string },
): AutomationRunRow | null {
  const placeholders = TERMINAL_STATES.map(() => '?').join(', ');
  const params: string[] = [...TERMINAL_STATES];
  let sql = `SELECT * FROM automation_runs WHERE status NOT IN (${placeholders})`;
  if (opts?.applicationId !== undefined) {
    sql += ' AND application_id = ?';
    params.push(opts.applicationId);
  }
  sql += ' ORDER BY started_at DESC, id DESC LIMIT 1';
  const row = db.prepare(sql).get(...params) as RawRunRow | undefined;
  return row ? rowToRun(row) : null;
}

const UPDATABLE_COLUMNS = [
  'status',
  'waiting_reason',
  'current_portal_state',
  'current_section_id',
  'fields_total',
  'fields_verified',
  'documents_total',
  'documents_ready',
  'error_code',
  'error_message',
  'ended_at',
] as const;

type UpdatableColumn = (typeof UPDATABLE_COLUMNS)[number];

export function updateRun(
  db: DatabaseSync,
  id: string,
  patch: Partial<Pick<AutomationRunRow, UpdatableColumn>>,
  now: string,
): AutomationRunRow {
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  for (const col of UPDATABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(patch, col)) {
      assignments.push(`${col} = ?`);
      params.push(patch[col] ?? null);
    }
  }
  assignments.push('updated_at = ?');
  params.push(now);
  params.push(id);
  db.prepare(`UPDATE automation_runs SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  return getRun(db, id)!;
}

export function appendEvent(
  db: DatabaseSync,
  input: {
    id: string;
    runId: string;
    type: string;
    portalState?: string | null;
    fieldPath?: string | null;
    status?: string | null;
    message: string;
    evidencePath?: string | null;
    now: string;
  },
): AutomationEventRow {
  const { seq } = db
    .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM automation_events WHERE run_id = ?')
    .get(input.runId) as { seq: number };
  db.prepare(
    `INSERT INTO automation_events
       (id, run_id, seq, created_at, type, portal_state, field_path, status, message, evidence_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.runId,
    seq,
    input.now,
    input.type,
    input.portalState ?? null,
    input.fieldPath ?? null,
    input.status ?? null,
    input.message,
    input.evidencePath ?? null,
  );
  const row = db
    .prepare('SELECT * FROM automation_events WHERE id = ?')
    .get(input.id) as RawEventRow | undefined;
  return rowToEvent(row!);
}

export function listEvents(
  db: DatabaseSync,
  runId: string,
  afterSeq?: number,
): AutomationEventRow[] {
  const rows = db
    .prepare(
      'SELECT * FROM automation_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC',
    )
    .all(runId, afterSeq ?? 0) as unknown as RawEventRow[];
  return rows.map(rowToEvent);
}
