import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import {
  assertPolicyAck, getPolicyAck, recordPolicyAck, isRealIndiaHost, ToSNotAcknowledgedError,
} from '../../src/server/automation/discovery/policyGate.js';

describe('policyGate', () => {
  let db: DatabaseSync; let p: string;
  beforeEach(() => { p = makeTempDbPath(); db = openDatabase(p); runMigrations(db); });
  afterEach(() => { db.close(); cleanupTempDb(p); });

  it('isRealIndiaHost matches the known hosts and not the fixture', () => {
    expect(isRealIndiaHost('https://indianvisaonline.gov.in/visa/')).toBe(true);
    expect(isRealIndiaHost('https://www.ivacbd.com/apply')).toBe(true);
    expect(isRealIndiaHost('http://127.0.0.1:5599/personal')).toBe(false);
  });

  it('assertPolicyAck throws for a real india host with no ack, then passes after recordPolicyAck', () => {
    expect(getPolicyAck(db, 'portal-1').acknowledgedAt).toBeNull();
    expect(() => assertPolicyAck(db, 'portal-1', 'india', 'https://indianvisaonline.gov.in/visa/'))
      .toThrow(ToSNotAcknowledgedError);
    recordPolicyAck(db, 'portal-1');
    expect(getPolicyAck(db, 'portal-1').acknowledgedAt).not.toBeNull();
    expect(() => assertPolicyAck(db, 'portal-1', 'india', 'https://indianvisaonline.gov.in/visa/'))
      .not.toThrow();
  });

  it('assertPolicyAck is a no-op for the generic adapter and for a non-india host', () => {
    expect(() => assertPolicyAck(db, 'p', 'generic', 'https://example.gov/x')).not.toThrow();
    expect(() => assertPolicyAck(db, 'p', 'india', 'http://127.0.0.1:9/personal')).not.toThrow();
  });
});
