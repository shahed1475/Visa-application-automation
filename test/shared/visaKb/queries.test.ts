import { afterEach, describe, expect, it } from 'vitest';
import { parseKnowledgeBase, reload } from '../../../src/shared/visa-kb/loader.js';
import { getVersion, listCategories, getCategory, getCategoriesForMode } from '../../../src/shared/visa-kb/queries.js';
import { checkEligibility, listEligibleCategories, getDocumentRequirements } from '../../../src/shared/visa-kb/queries.js';

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

const KB2 = parseKnowledgeBase({
  meta: { schemaVersion: 1, kbVersion: '2026-09-02', destination: 'IND', revisionDate: '2026-09-02' },
  categories: [
    { ...base, id: 'evisa.tourist.30d', applicationMode: 'evisa', category: 'tourist', displayName: 'e-Tourist 30d',
      requiredDocuments: [{ id: 'passport_bio_page', label: 'Passport bio page' }, { id: 'photo', label: 'Photo' }],
      optionalDocuments: [{ id: 'itinerary', label: 'Travel itinerary' }] },
    { ...base, id: 'evisa.journalist', applicationMode: 'evisa', category: 'journalist', displayName: 'e-Journalist' },
    { ...base, id: 'regular.employment', applicationMode: 'regular', category: 'employment', displayName: 'Employment' },
  ],
  eligibility: [
    { nationality: 'BGD', applicationMode: 'evisa', categoryId: 'evisa.tourist.30d', status: 'eligible',
      conditions: [{ type: 'purpose_in', value: ['recreation'] }], basis: 'listed', source: src, lastVerified: '2026-09-02' },
    { nationality: 'BGD', applicationMode: 'evisa', categoryId: 'evisa.journalist', status: 'not_offered',
      conditions: [], basis: 'e-Visa is not allowed for journalism', source: src, lastVerified: '2026-09-02' },
    { nationality: 'BGD', applicationMode: 'regular', categoryId: 'regular.employment', status: 'conditional',
      conditions: [{ type: 'salary_min_inr_per_annum', value: 1625000 }], basis: 'salary floor', source: src, lastVerified: '2026-09-02' },
  ],
});

describe('nationality eligibility', () => {
  it('returns the explicit record for a known tuple', () => {
    const r = checkEligibility('BGD', 'evisa', 'evisa.tourist.30d', KB2);
    expect(r.status).toBe('eligible');
    if (r.status !== 'unknown') expect(r.conditions).toEqual([{ type: 'purpose_in', value: ['recreation'] }]);
  });
  it('returns unknown — never inferred — when no record exists', () => {
    const r = checkEligibility('BGD', 'regular', 'regular.employment', KB2); // exists
    expect(r.status).toBe('conditional');
    const missing = checkEligibility('BGD', 'evisa', 'evisa.tourist.30d', parseKnowledgeBase({
      meta: { schemaVersion: 1, kbVersion: 'x', destination: 'IND', revisionDate: '2026-09-02' },
      categories: [{ ...base, id: 'evisa.tourist.30d', applicationMode: 'evisa', category: 'tourist', displayName: 'x' }],
      eligibility: [],
    }));
    expect(missing.status).toBe('unknown');
    if (missing.status === 'unknown') expect(missing.reason).toMatch(/no eligibility rule/i);
  });
  it('surfaces an explicit not_offered / ineligible rather than hiding it', () => {
    expect(checkEligibility('BGD', 'evisa', 'evisa.journalist', KB2).status).toBe('not_offered');
  });
  it('listEligibleCategories returns only eligible/conditional, with the joined category', () => {
    const list = listEligibleCategories('BGD', 'evisa', KB2);
    expect(list.map((x) => x.category.id)).toEqual(['evisa.tourist.30d']); // journalist is not_offered
  });
});

describe('document requirements', () => {
  it('returns required + optional for a known category', () => {
    expect(getDocumentRequirements('evisa.tourist.30d', KB2)).toEqual({
      required: [{ id: 'passport_bio_page', label: 'Passport bio page' }, { id: 'photo', label: 'Photo' }],
      optional: [{ id: 'itinerary', label: 'Travel itinerary' }],
    });
  });
  it('returns { required, optional: [] } for a category with no optional docs', () => {
    expect(getDocumentRequirements('evisa.journalist', KB2)).toEqual({ required: [], optional: [] });
  });
  it('returns null for an unknown category', () => {
    expect(getDocumentRequirements('evisa.nope', KB2)).toBeNull();
  });
});
