import { expect, it, describe } from 'vitest';
import { indiaPortalMap } from '../../src/server/automation/adapters/india/indiaPortalMap.js';
import { classifyMapping } from '../../src/server/automation/adapters/india/mappingLifecycle.js';

describe('india mapping provenance', () => {
  it('every field ships as placeholder / TODO:discover until discovery', () => {
    for (const [k, m] of Object.entries(indiaPortalMap.fields)) {
      if (m.selector === 'TODO:discover') expect(m.status, k).toBe('placeholder');
    }
  });
  it('a non-placeholder selector is impossible without discovery provenance', () => {
    for (const [k, m] of Object.entries(indiaPortalMap.fields)) {
      if (m.selector !== 'TODO:discover') {
        expect(m.status, k).not.toBe('placeholder');
        expect(m.discoverySessionRef, `${k} has a real selector but no discoverySessionRef`).toBeTruthy();
        if (m.status === 'validated') {
          expect(m.validatedAt, k).toBeTruthy();
          expect(
            m.validatedAgainstRevision,
            `${k} is validated but has no validatedAgainstRevision`,
          ).toBeTruthy();
        }
      }
    }
  });
  it('the same rule holds for every state nextSelector', () => {
    for (const [s, cfg] of Object.entries(indiaPortalMap.states)) {
      if (cfg.nextSelector && cfg.nextSelector !== 'TODO:discover') {
        expect(cfg.nextSelectorStatus, s).not.toBe('placeholder');
        expect(
          cfg.nextSelectorDiscoverySessionRef,
          `${s} has a real nextSelector but no nextSelectorDiscoverySessionRef`,
        ).toBeTruthy();
        if (cfg.nextSelectorStatus === 'validated') {
          expect(cfg.nextSelectorValidatedAt, s).toBeTruthy();
          expect(
            cfg.nextSelectorValidatedAgainstRevision,
            `${s} nextSelector is validated but has no nextSelectorValidatedAgainstRevision`,
          ).toBeTruthy();
        }
      }
    }
  });
  it('carries version metadata', () => {
    expect(indiaPortalMap.adapterVersion).toMatch(/\d/);
    expect(indiaPortalMap.mappingRevision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('classifyMapping flags a stale validated mapping (the revision guard is non-vacuous)', () => {
    const stale = {
      selector: '#x',
      control: 'text',
      selectorConfidence: 'stable',
      status: 'validated',
      discoverySessionRef: 's',
      validatedAt: 't',
      validatedAgainstRevision: 'an-old-revision',
    } as const;
    expect(classifyMapping(stale, indiaPortalMap.mappingRevision)).toBe('stale');
  });
});
