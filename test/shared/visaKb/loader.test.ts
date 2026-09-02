import { afterEach, describe, expect, it } from 'vitest';
import { parseKnowledgeBase, loadKnowledgeBase, reload, KnowledgeBaseError } from '../../../src/shared/visa-kb/loader.js';

const meta = { schemaVersion: 1, kbVersion: '2026-09-02', destination: 'IND', revisionDate: '2026-09-02' };
const src = { officialUrl: 'https://indianvisaonline.gov.in/evisa/', retrievedAt: '2026-09-02' };

function cat(over: Record<string, unknown> = {}) {
  return {
    id: 'evisa.tourist.30d', applicationMode: 'evisa', category: 'tourist',
    subCategory: null, officialCode: 'e-T1V', displayName: 'e-Tourist 30d',
    purpose: ['recreation'], validity: { amount: 30, unit: 'days', from: 'first_arrival' },
    entries: 'multiple', stayLimitations: {}, extendable: false, convertible: false,
    applicationTiming: {}, travelRequirements: {}, requiredDocuments: [], optionalDocuments: [],
    specialConditions: [], restrictions: [], source: src, lastVerified: '2026-09-02', ...over,
  };
}
function elig(over: Record<string, unknown> = {}) {
  return {
    nationality: 'BGD', applicationMode: 'evisa', categoryId: 'evisa.tourist.30d',
    status: 'eligible', conditions: [], basis: 'listed', source: src, lastVerified: '2026-09-02', ...over,
  };
}

afterEach(() => reload());

describe('parseKnowledgeBase', () => {
  it('accepts a valid KB and deep-freezes it', () => {
    const kb = parseKnowledgeBase({ meta, categories: [cat()], eligibility: [elig()] });
    expect(kb.categories[0]!.id).toBe('evisa.tourist.30d');
    expect(Object.isFrozen(kb)).toBe(true);
    expect(Object.isFrozen(kb.categories[0])).toBe(true);
    expect(() => { (kb.categories as unknown[]).push({}); }).toThrow();
  });

  it('throws KnowledgeBaseError on a schema violation, naming the field', () => {
    expect(() => parseKnowledgeBase({ meta, categories: [cat({ entries: 'triple' })], eligibility: [] }))
      .toThrow(KnowledgeBaseError);
  });

  it('rejects an unknown schemaVersion', () => {
    expect(() => parseKnowledgeBase({ meta: { ...meta, schemaVersion: 99 }, categories: [], eligibility: [] }))
      .toThrow(/schemaVersion/i);
  });

  it('rejects duplicate category ids', () => {
    expect(() => parseKnowledgeBase({ meta, categories: [cat(), cat()], eligibility: [] }))
      .toThrow(/duplicate .*id/i);
  });

  it('rejects an eligibility record pointing at a missing category', () => {
    expect(() => parseKnowledgeBase({ meta, categories: [cat()], eligibility: [elig({ categoryId: 'evisa.ghost' })] }))
      .toThrow(/evisa\.ghost/);
  });

  it('rejects an eligibility record whose mode differs from its category', () => {
    expect(() => parseKnowledgeBase({ meta, categories: [cat()], eligibility: [elig({ applicationMode: 'regular' })] }))
      .toThrow(/mode/i);
  });

  it('rejects duplicate (nationality, mode, categoryId) eligibility tuples', () => {
    expect(() => parseKnowledgeBase({ meta, categories: [cat()], eligibility: [elig(), elig()] }))
      .toThrow(/duplicate .*eligibility/i);
  });

  it('rejects a non-IND destination', () => {
    expect(() => parseKnowledgeBase({ meta: { ...meta, destination: 'BGD' }, categories: [], eligibility: [] }))
      .toThrow(/destination/i);
  });
});

describe('loadKnowledgeBase', () => {
  it('loads the shipped data (empty categories/eligibility for now) and caches', () => {
    const a = loadKnowledgeBase();
    const b = loadKnowledgeBase();
    expect(a).toBe(b);                 // same frozen instance (cached)
    expect(a.meta.destination).toBe('IND');
    expect(Array.isArray(a.categories)).toBe(true);
  });

  it('reload() clears the cache', () => {
    const a = loadKnowledgeBase();
    reload();
    expect(loadKnowledgeBase()).not.toBe(a);
  });
});
