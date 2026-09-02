import { afterEach, describe, expect, it } from 'vitest';
import { parseKnowledgeBase, reload } from '../../../src/shared/visa-kb/loader.js';
import { getVersion, listCategories, getCategory, getCategoriesForMode } from '../../../src/shared/visa-kb/queries.js';

const src = { officialUrl: 'https://indianvisaonline.gov.in/evisa/', retrievedAt: '2026-09-02' };
const base = {
  subCategory: null, officialCode: null, purpose: ['recreation'],
  validity: { amount: 1, unit: 'years', from: 'eta_grant' }, entries: 'multiple',
  stayLimitations: {}, extendable: false, convertible: false, applicationTiming: {},
  travelRequirements: {}, requiredDocuments: [], optionalDocuments: [],
  specialConditions: [], restrictions: [], source: src, lastVerified: '2026-09-02',
};
const KB = parseKnowledgeBase({
  meta: { schemaVersion: 1, kbVersion: '2026-09-02', destination: 'IND', revisionDate: '2026-09-02' },
  categories: [
    { ...base, id: 'evisa.tourist.30d', applicationMode: 'evisa', category: 'tourist', displayName: 'e-Tourist 30d' },
    { ...base, id: 'evisa.business', applicationMode: 'evisa', category: 'business', displayName: 'e-Business' },
    { ...base, id: 'regular.tourist', applicationMode: 'regular', category: 'tourist', displayName: 'Tourist (paper)' },
  ],
  eligibility: [],
});

afterEach(() => reload());

describe('getVersion', () => {
  it('returns the meta version fields', () => {
    expect(getVersion(KB)).toEqual({
      schemaVersion: 1, kbVersion: '2026-09-02', revisionDate: '2026-09-02', destination: 'IND',
    });
  });
});

describe('category lookup', () => {
  it('getCategory returns the entry or null', () => {
    expect(getCategory('evisa.business', KB)?.displayName).toBe('e-Business');
    expect(getCategory('evisa.nope', KB)).toBeNull();
  });
  it('listCategories with no filter returns every entry', () => {
    expect(listCategories({}, KB).map((c) => c.id).sort())
      .toEqual(['evisa.business', 'evisa.tourist.30d', 'regular.tourist']);
  });
  it('listCategories filters by category name', () => {
    expect(listCategories({ category: 'tourist' }, KB).map((c) => c.id).sort())
      .toEqual(['evisa.tourist.30d', 'regular.tourist']);
  });
});

describe('application-mode filtering', () => {
  it('getCategoriesForMode returns only that mode', () => {
    const evisa = getCategoriesForMode('evisa', KB);
    expect(evisa.map((c) => c.id).sort()).toEqual(['evisa.business', 'evisa.tourist.30d']);
    expect(evisa.every((c) => c.applicationMode === 'evisa')).toBe(true);
  });
  it('never leaks the other mode', () => {
    expect(getCategoriesForMode('regular', KB).some((c) => c.applicationMode === 'evisa')).toBe(false);
  });
  it('listCategories({ applicationMode }) agrees with getCategoriesForMode', () => {
    expect(listCategories({ applicationMode: 'evisa' }, KB).map((c) => c.id).sort())
      .toEqual(getCategoriesForMode('evisa', KB).map((c) => c.id).sort());
  });
});
