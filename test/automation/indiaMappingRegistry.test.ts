import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import {
  appendDiscoveryPage,
  createDiscoverySession,
} from '../../src/server/automation/discovery/discoverySessionStore.js';
import { indiaPortalMap } from '../../src/server/automation/adapters/india/indiaPortalMap.js';
import {
  DiscoveryCandidateNotFoundError,
  getIndiaMappings,
  getIndiaMappingStatus,
  promoteCandidate,
} from '../../src/server/automation/adapters/india/indiaMappingRegistry.js';
import { DiscoverySessionNotFoundError } from '../../src/server/automation/discovery/discoveryController.js';

const FIELD_COUNT = Object.keys(indiaPortalMap.fields).length;

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

function seedSession(): string {
  const id = randomUUID();
  createDiscoverySession(db, { id, portalId: null, adapterId: 'india', now: new Date().toISOString() });
  return id;
}

function seedPage(sessionId: string, candidates: unknown[]): void {
  appendDiscoveryPage(db, {
    id: randomUUID(),
    sessionId,
    now: new Date().toISOString(),
    stateGuess: 'PERSONAL_DETAILS',
    urlPattern: '/personal',
    pageTitle: 'Personal Details',
    headingsJson: '[]',
    fingerprintJson: '{}',
    candidatesJson: JSON.stringify(candidates),
    signalsJson: '[]',
  });
}

describe('getIndiaMappings', () => {
  it('returns one value-free row per indiaPortalMap.fields key, all placeholder today', () => {
    const rows = getIndiaMappings();
    expect(rows).toHaveLength(FIELD_COUNT);
    for (const row of rows) {
      expect(indiaPortalMap.fields[row.canonicalFieldPath]).toBeDefined();
      expect(row.status).toBe('placeholder');
      expect(row.selector).toBe('TODO:discover');
      // value-free: only path/label/selector/control/status/confidence/refs
      expect(Object.keys(row).sort()).toStrictEqual(
        ['canonicalFieldPath', 'confidence', 'control', 'label', 'selector', 'status'].sort(),
      );
      expect(row).not.toHaveProperty('value');
    }
  });
});

describe('getIndiaMappingStatus', () => {
  it('counts every field as placeholder today', () => {
    const status = getIndiaMappingStatus();
    expect(status).toStrictEqual({
      placeholder: FIELD_COUNT,
      discovered: 0,
      validated: 0,
      total: FIELD_COUNT,
      requiredRemaining: FIELD_COUNT,
    });
  });
});

describe('promoteCandidate', () => {
  it('renders a paste-ready literal for a known field with no warnings', () => {
    const sessionId = seedSession();
    seedPage(sessionId, [
      {
        label: 'Surname',
        primarySelector: '#f_surname',
        fallbackSelector: null,
        selectorConfidence: 'stable',
        control: 'text',
      },
    ]);

    const edit = promoteCandidate(db, sessionId, {
      pageSeq: 1,
      candidateIndex: 0,
      canonicalFieldPath: 'identity.surname',
    });

    expect(edit.canonicalFieldPath).toBe('identity.surname');
    expect(edit.literal).toContain("'identity.surname'");
    expect(edit.literal).toContain("selector: '#f_surname'");
    expect(edit.literal).toContain("status: 'discovered'");
    expect(edit.literal).toContain(`discoverySessionRef: '${sessionId}'`);
    expect(edit.literal).toContain('discoveredAt:');
    expect(edit.literal).not.toContain('fallbackSelector'); // null → omitted
    expect(edit.warnings).toStrictEqual([]);
  });

  it('includes fallbackSelector when the candidate has one', () => {
    const sessionId = seedSession();
    seedPage(sessionId, [
      {
        label: 'Surname',
        primarySelector: '#f_surname',
        fallbackSelector: "input[name='surname']",
        selectorConfidence: 'moderate',
        control: 'text',
      },
    ]);
    const edit = promoteCandidate(db, sessionId, {
      pageSeq: 1,
      candidateIndex: 0,
      canonicalFieldPath: 'identity.surname',
    });
    expect(edit.literal).toContain("fallbackSelector: 'input[name=\\'surname\\']'");
  });

  it('warns on an unknown canonical field', () => {
    const sessionId = seedSession();
    seedPage(sessionId, [
      {
        label: 'Mystery',
        primarySelector: '#x',
        fallbackSelector: null,
        selectorConfidence: 'stable',
        control: 'text',
      },
    ]);
    const edit = promoteCandidate(db, sessionId, {
      pageSeq: 1,
      candidateIndex: 0,
      canonicalFieldPath: 'not.a.real.field',
    });
    expect(edit.warnings).toContain('unknown canonical field');
  });

  it('warns on a fragile selector', () => {
    const sessionId = seedSession();
    seedPage(sessionId, [
      {
        label: 'Surname',
        primarySelector: '#f_surname',
        fallbackSelector: null,
        selectorConfidence: 'fragile',
        control: 'text',
      },
    ]);
    const edit = promoteCandidate(db, sessionId, {
      pageSeq: 1,
      candidateIndex: 0,
      canonicalFieldPath: 'identity.surname',
    });
    expect(edit.warnings.some((w) => w.includes('fragile'))).toBe(true);
  });

  it('warns on a control mismatch against the placeholder expected kind', () => {
    const sessionId = seedSession();
    seedPage(sessionId, [
      {
        label: 'Sex',
        primarySelector: '#f_sex',
        fallbackSelector: null,
        selectorConfidence: 'stable',
        control: 'radio',
      },
    ]);
    // indiaPortalMap.fields['identity.sex'] expects 'native_select'
    const edit = promoteCandidate(db, sessionId, {
      pageSeq: 1,
      candidateIndex: 0,
      canonicalFieldPath: 'identity.sex',
    });
    expect(edit.warnings).toContain(
      "control mismatch: candidate 'radio' vs expected 'native_select'",
    );
  });

  it('throws DiscoverySessionNotFoundError for an unknown session', () => {
    expect(() =>
      promoteCandidate(db, 'does-not-exist', {
        pageSeq: 1,
        candidateIndex: 0,
        canonicalFieldPath: 'identity.surname',
      }),
    ).toThrow(DiscoverySessionNotFoundError);
  });

  it('throws DiscoveryCandidateNotFoundError for an out-of-range page seq / candidate index', () => {
    const sessionId = seedSession();
    seedPage(sessionId, [
      {
        label: 'Surname',
        primarySelector: '#f_surname',
        fallbackSelector: null,
        selectorConfidence: 'stable',
        control: 'text',
      },
    ]);
    expect(() =>
      promoteCandidate(db, sessionId, { pageSeq: 9, candidateIndex: 0, canonicalFieldPath: 'identity.surname' }),
    ).toThrow(DiscoveryCandidateNotFoundError);
    expect(() =>
      promoteCandidate(db, sessionId, { pageSeq: 1, candidateIndex: 5, canonicalFieldPath: 'identity.surname' }),
    ).toThrow(DiscoveryCandidateNotFoundError);
  });
});
