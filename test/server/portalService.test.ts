import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import * as svc from '../../src/server/services/portalService.js';
import { PortalDisabledError, PortalNotFoundError } from '../../src/server/services/errors.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let db: DatabaseSync;
let dbPath: string;
const input = {
  name: 'Example Visa',
  url: 'https://example.com/apply',
  portalType: 'evisa' as const,
  country: null,
  applicationType: null,
  notes: null,
  enabled: true,
};

beforeEach(() => {
  dbPath = makeTempDbPath();
  db = openDatabase(dbPath);
  runMigrations(db);
});
afterEach(() => {
  db.close();
  cleanupTempDb(dbPath);
});

it('creates and reads back a portal', () => {
  const created = svc.createPortal(db, input);
  expect(created.id).toMatch(/[0-9a-f-]{36}/);
  expect(created.url).toBe(input.url);
  expect(svc.getPortal(db, created.id)).toEqual(created);
});

it('lists newest first', () => {
  const a = svc.createPortal(db, { ...input, name: 'A' });
  const b = svc.createPortal(db, { ...input, name: 'B' });
  const names = svc.listPortals(db).map((p) => p.name);
  expect(names.slice(0, 2)).toEqual(['B', 'A']);
  void a;
  void b;
});

it('updates a portal and bumps updatedAt', async () => {
  const created = svc.createPortal(db, input);
  await new Promise((r) => setTimeout(r, 5));
  const updated = svc.updatePortal(db, created.id, { ...input, name: 'Renamed' });
  expect(updated?.name).toBe('Renamed');
  expect(updated?.createdAt).toBe(created.createdAt);
  expect(updated?.updatedAt).not.toBe(created.createdAt);
});

it('returns null updating a missing portal', () => {
  expect(svc.updatePortal(db, 'nope', input)).toBeNull();
});

it('deletes a portal and clears it as active', () => {
  const created = svc.createPortal(db, input);
  svc.setActivePortal(db, created.id);
  expect(svc.getActivePortalId(db)).toBe(created.id);
  expect(svc.deletePortal(db, created.id)).toBe(true);
  expect(svc.getActivePortalId(db)).toBeNull();
  expect(svc.deletePortal(db, created.id)).toBe(false);
});

it('rejects activating a missing or disabled portal', () => {
  expect(() => svc.setActivePortal(db, 'missing')).toThrow(PortalNotFoundError);
  const disabled = svc.createPortal(db, { ...input, enabled: false });
  expect(() => svc.setActivePortal(db, disabled.id)).toThrow(PortalDisabledError);
});

it('setActivePortal(null) clears the setting', () => {
  const created = svc.createPortal(db, input);
  svc.setActivePortal(db, created.id);
  svc.setActivePortal(db, null);
  expect(svc.getActivePortal(db)).toBeNull();
});

it('persists across a reopen of the same file', () => {
  const created = svc.createPortal(db, input);
  db.close();
  // Reassign the shared handle so afterEach closes it exactly once
  // (node:sqlite's DatabaseSync throws on a double close()).
  db = openDatabase(dbPath);
  runMigrations(db);
  expect(svc.getPortal(db, created.id)?.name).toBe('Example Visa');
});
