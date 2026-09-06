import { expect, it, describe } from 'vitest';
import { indiaPortalMap } from '../../src/server/automation/adapters/india/indiaPortalMap.js';

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
        if (m.status === 'validated') expect(m.validatedAt, k).toBeTruthy();
      }
    }
  });
  it('the same rule holds for every state nextSelector', () => {
    for (const [s, cfg] of Object.entries(indiaPortalMap.states)) {
      if (cfg.nextSelector && cfg.nextSelector !== 'TODO:discover') {
        expect(cfg.nextSelectorStatus, s).not.toBe('placeholder');
      }
    }
  });
  it('carries version metadata', () => {
    expect(indiaPortalMap.adapterVersion).toMatch(/\d/);
    expect(indiaPortalMap.mappingRevision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
