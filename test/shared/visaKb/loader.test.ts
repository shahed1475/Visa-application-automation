import { afterEach, describe, expect, it } from 'vitest';
import { parseKnowledgeBase, loadKnowledgeBase, reload, KnowledgeBaseError } from '../../../src/shared/visa-kb/loader.js';

const meta = { schemaVersion: 2, kbVersion: '2026-09-02', destination: 'IND', revisionDate: '2026-09-02' };
const src = {
  officialUrl: 'https://indianvisaonline.gov.in/evisa/', retrievedAt: '2026-09-02', confidence: 'secondary_guidance',
};

const emptyFormRules = { applicableSections: [], fieldRules: [] };

function field(over: Record<string, unknown> = {}) {
  return {
    id: 'standard_personal_block', label: 'Standard personal particulars',
    appliesTo: null, dataType: 'text', standardBlock: true, source: src, ...over,
  };
}
function section(over: Record<string, unknown> = {}) {
  return { id: 'personal_particulars', label: 'Personal particulars', fields: [field()], source: src, ...over };
}
function formModel(over: Record<string, unknown> = {}) {
  return { sections: [section()], ...over };
}

function cat(over: Record<string, unknown> = {}) {
  return {
    id: 'evisa.tourist.30d', applicationMode: 'evisa', category: 'tourist',
    subCategory: null, officialCode: 'e-T1V', displayName: 'e-Tourist 30d',
    purpose: ['recreation'], validity: { amount: 30, unit: 'days', from: 'first_arrival' },
    entries: 'multiple', stayLimitations: {}, extendable: false, convertible: false,
    applicationTiming: {}, travelRequirements: {}, requiredDocuments: [], optionalDocuments: [],
    conditionalDocuments: [], formRules: emptyFormRules,
    specialConditions: [], restrictions: [], source: src, lastVerified: '2026-09-02', ...over,
  };
}
function elig(over: Record<string, unknown> = {}) {
  return {
    nationality: 'BGD', applicationMode: 'evisa', categoryId: 'evisa.tourist.30d',
    status: 'eligible', conditions: [], basis: 'listed', source: src, lastVerified: '2026-09-02', ...over,
  };
}
function rawKb(over: Record<string, unknown> = {}) {
  return { meta, categories: [cat()], eligibility: [], formModel: formModel(), ...over };
}

afterEach(() => reload());

describe('parseKnowledgeBase', () => {
  it('accepts a valid KB and deep-freezes it', () => {
    const parsed = parseKnowledgeBase(rawKb({ eligibility: [elig()] }));
    expect(parsed.categories[0]!.id).toBe('evisa.tourist.30d');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.categories[0])).toBe(true);
    expect(() => { (parsed.categories as unknown[]).push({}); }).toThrow();
  });

  it('throws KnowledgeBaseError on a schema violation, naming the field', () => {
    expect(() => parseKnowledgeBase(rawKb({ categories: [cat({ entries: 'triple' })] })))
      .toThrow(KnowledgeBaseError);
  });

  it('rejects an unknown schemaVersion', () => {
    expect(() => parseKnowledgeBase(rawKb({ meta: { ...meta, schemaVersion: 99 }, categories: [] })))
      .toThrow(/schemaVersion/i);
  });

  it('rejects duplicate category ids', () => {
    expect(() => parseKnowledgeBase(rawKb({ categories: [cat(), cat()] })))
      .toThrow(/duplicate .*id/i);
  });

  it('rejects an eligibility record pointing at a missing category', () => {
    expect(() => parseKnowledgeBase(rawKb({ eligibility: [elig({ categoryId: 'evisa.ghost' })] })))
      .toThrow(/evisa\.ghost/);
  });

  it('rejects an eligibility record whose mode differs from its category', () => {
    expect(() => parseKnowledgeBase(rawKb({ eligibility: [elig({ applicationMode: 'regular' })] })))
      .toThrow(/mode/i);
  });

  it('rejects duplicate (nationality, mode, categoryId) eligibility tuples', () => {
    expect(() => parseKnowledgeBase(rawKb({ eligibility: [elig(), elig()] })))
      .toThrow(/duplicate .*eligibility/i);
  });

  it('rejects a category whose id prefix disagrees with its applicationMode', () => {
    expect(() => parseKnowledgeBase(rawKb({
      categories: [cat({ id: 'regular.tourist', applicationMode: 'evisa' })],
    }))).toThrow(/prefix|mode/i);
    expect(() => parseKnowledgeBase(rawKb({
      categories: [cat({ id: 'evisa.tourist.30d', applicationMode: 'regular' })],
    }))).toThrow(/prefix|mode/i);
  });

  it('rejects a non-IND destination', () => {
    expect(() => parseKnowledgeBase(rawKb({ meta: { ...meta, destination: 'BGD' }, categories: [] })))
      .toThrow(/destination/i);
  });
});

describe('parseKnowledgeBase — v2 form model cross-checks', () => {
  it('rejects duplicate form section ids', () => {
    expect(() => parseKnowledgeBase(rawKb({ formModel: formModel({ sections: [section(), section()] }) })))
      .toThrow(/duplicate .*section/i);
  });

  it('rejects a duplicate field id within a section', () => {
    expect(() => parseKnowledgeBase(rawKb({
      formModel: formModel({ sections: [section({ fields: [field(), field()] })] }),
    }))).toThrow(/duplicate .*field/i);
  });

  it('rejects a FormField appliesTo that is neither application.* nor a valid field path', () => {
    expect(() => parseKnowledgeBase(rawKb({
      formModel: formModel({ sections: [section({ fields: [field({ appliesTo: 'Not A Path!' })] })] }),
    }))).toThrow(/appliesTo/i);
  });

  it('accepts an application.* appliesTo and a dotted profile path', () => {
    expect(() => parseKnowledgeBase(rawKb({
      formModel: formModel({ sections: [section({ fields: [
        field({ id: 'a', appliesTo: 'application.indiaCompanyName' }),
        field({ id: 'b', appliesTo: 'identity.surname' }),
      ] })] }),
    }))).not.toThrow();
  });

  it('rejects formRules.applicableSections naming an unknown section', () => {
    expect(() => parseKnowledgeBase(rawKb({
      categories: [cat({ formRules: { applicableSections: ['occupation'], fieldRules: [] } })],
    }))).toThrow(/applicableSections|unknown section/i);
  });

  it('rejects a fieldRule whose sectionId is not in the form model', () => {
    expect(() => parseKnowledgeBase(rawKb({
      categories: [cat({ formRules: { applicableSections: [], fieldRules: [
        { sectionId: 'occupation', fieldId: 'employer_name', requirement: 'required', source: src },
      ] } })],
    }))).toThrow(/unknown section/i);
  });

  it('rejects a fieldRule whose fieldId is not in its section and not synthetic', () => {
    expect(() => parseKnowledgeBase(rawKb({
      categories: [cat({ formRules: { applicableSections: [], fieldRules: [
        { sectionId: 'personal_particulars', fieldId: 'no_such_field', requirement: 'optional', source: src },
      ] } })],
    }))).toThrow(/unknown field/i);
  });

  it('allows the synthetic india_references_min field id (section must still exist)', () => {
    const withRefs = formModel({
      sections: [section(), section({ id: 'references', label: 'References', fields: [] })],
    });
    expect(() => parseKnowledgeBase(rawKb({
      formModel: withRefs,
      categories: [cat({ formRules: { applicableSections: ['references'], fieldRules: [
        { sectionId: 'references', fieldId: 'india_references_min', requirement: 'required', count: 2, source: src },
      ] } })],
    }))).not.toThrow();
  });
});

describe('loadKnowledgeBase', () => {
  it('loads the shipped data and caches', () => {
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
