import { describe, expect, it } from 'vitest';
import {
  FIXTURE_INDIA_PORTAL_MAP_V3,
  makeFixtureIndiaAdapter,
} from './support/fixtureIndiaAdapter.js';

const rev = FIXTURE_INDIA_PORTAL_MAP_V3.mappingRevision;

describe('FIXTURE_INDIA_PORTAL_MAP_V3', () => {
  it('every field is validated against the current revision — except the one deliberate stale entry', () => {
    for (const [k, m] of Object.entries(FIXTURE_INDIA_PORTAL_MAP_V3.fields)) {
      expect(m.status, k).toBe('validated');
      if (m.notes === 'intentionally-stale') {
        expect(m.validatedAgainstRevision, k).not.toBe(rev);
      } else {
        expect(m.validatedAgainstRevision, k).toBe(rev);
      }
    }
  });

  it('exactly one entry is the intentional stale one', () => {
    const stale = Object.entries(FIXTURE_INDIA_PORTAL_MAP_V3.fields).filter(
      ([, m]) => m.notes === 'intentionally-stale',
    );
    expect(stale.map(([k]) => k)).toEqual(['family.spouseName']);
  });

  it('date fields carry an explicit transform + readBackParse (native <input type=date>: ISO in/out)', () => {
    for (const path of ['application.intendedArrivalDate', 'passport.expiryDate'] as const) {
      const m = FIXTURE_INDIA_PORTAL_MAP_V3.fields[path]!;
      expect(typeof m.transform, path).toBe('function');
      expect(typeof m.readBackParse, path).toBe('function');
      expect(m.transform!('2026-10-15'), path).toBe('2026-10-15');
      expect(m.readBackParse!('2026-10-15'), path).toBe('2026-10-15');
      expect(() => m.readBackParse!('not-a-date'), path).toThrow();
    }
  });

  it('identity.surname carries an explicit fallbackSelector', () => {
    expect(FIXTURE_INDIA_PORTAL_MAP_V3.fields['identity.surname']!.fallbackSelector).toBe(
      '[name="surname"]',
    );
  });
});

describe('makeFixtureIndiaAdapter — lifecycleMap mode (Phase 7)', () => {
  it('getFieldMap() exposes production-usable mappings and excludes the stale one', () => {
    const a = makeFixtureIndiaAdapter('http://x', { lifecycleMap: FIXTURE_INDIA_PORTAL_MAP_V3 });
    const map = a.getFieldMap();
    expect(map['identity.surname']?.selector).toBe('#surname');
    expect(map['identity.surname']?.fallbackSelector).toBe('[name="surname"]');
    expect(map['passport.expiryDate']?.readBackParse).toBeTypeOf('function');
    expect(map['family.spouseName']).toBeUndefined(); // stale -> filtered out
  });

  it('mappingReadiness classifies production / stale / unmapped', () => {
    const a = makeFixtureIndiaAdapter('http://x', { lifecycleMap: FIXTURE_INDIA_PORTAL_MAP_V3 });
    expect(a.mappingReadiness!('identity.surname')).toBe('production');
    expect(a.mappingReadiness!('family.spouseName')).toBe('stale');
    expect(a.mappingReadiness!('nope.nope')).toBe('unmapped');
  });

  it('without lifecycleMap the legacy plain field map + no mappingReadiness is unchanged', () => {
    const a = makeFixtureIndiaAdapter('http://x');
    expect(a.getFieldMap()['identity.surname']?.selector).toBe('#surname');
    expect(a.getFieldMap()['family.spouseName']?.selector).toBe('#spouse-name'); // present in legacy map
    expect(a.mappingReadiness).toBeUndefined();
  });
});
