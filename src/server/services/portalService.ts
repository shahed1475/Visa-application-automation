import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { PortalInput } from '../../shared/schemas.js';
import type { VisaPortal } from '../../shared/types.js';
import { PortalDisabledError, PortalNotFoundError } from './errors.js';

const ACTIVE_KEY = 'active_portal_id';

interface PortalRow {
  id: string;
  name: string;
  url: string;
  portal_type: 'regular' | 'evisa' | 'custom';
  country: string | null;
  application_type: string | null;
  notes: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToPortal(row: PortalRow): VisaPortal {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    portalType: row.portal_type,
    country: row.country,
    applicationType: row.application_type,
    notes: row.notes,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPortal(db: DatabaseSync, input: PortalInput): VisaPortal {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO visa_portals
       (id, name, url, portal_type, country, application_type, notes, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.url,
    input.portalType,
    input.country,
    input.applicationType,
    input.notes,
    input.enabled ? 1 : 0,
    now,
    now,
  );
  return getPortal(db, id)!;
}

export function listPortals(db: DatabaseSync): VisaPortal[] {
  return db
    .prepare('SELECT * FROM visa_portals ORDER BY created_at DESC, rowid DESC')
    .all()
    .map((r) => rowToPortal(r as unknown as PortalRow));
}

export function getPortal(db: DatabaseSync, id: string): VisaPortal | null {
  const row = db.prepare('SELECT * FROM visa_portals WHERE id = ?').get(id) as
    | PortalRow
    | undefined;
  return row ? rowToPortal(row) : null;
}

export function updatePortal(
  db: DatabaseSync,
  id: string,
  input: PortalInput,
): VisaPortal | null {
  const existing = getPortal(db, id);
  if (!existing) return null;
  db.prepare(
    `UPDATE visa_portals SET
       name = ?, url = ?, portal_type = ?, country = ?,
       application_type = ?, notes = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name,
    input.url,
    input.portalType,
    input.country,
    input.applicationType,
    input.notes,
    input.enabled ? 1 : 0,
    new Date().toISOString(),
    id,
  );
  return getPortal(db, id);
}

export function deletePortal(db: DatabaseSync, id: string): boolean {
  // Sequential check-then-act: single-user local app, no concurrent writers.
  // (DatabaseSync has no db.transaction() helper — see Amendment 01.)
  if (getActivePortalId(db) === id) {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(ACTIVE_KEY);
  }
  const { changes } = db.prepare('DELETE FROM visa_portals WHERE id = ?').run(id);
  return changes > 0;
}

export function getActivePortalId(db: DatabaseSync): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(ACTIVE_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function getActivePortal(db: DatabaseSync): VisaPortal | null {
  const id = getActivePortalId(db);
  return id ? getPortal(db, id) : null;
}

export function setActivePortal(db: DatabaseSync, portalId: string | null): void {
  if (portalId === null) {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(ACTIVE_KEY);
    return;
  }
  const portal = getPortal(db, portalId);
  if (!portal) throw new PortalNotFoundError(portalId);
  if (!portal.enabled) throw new PortalDisabledError(portalId);
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(ACTIVE_KEY, portalId);
}
