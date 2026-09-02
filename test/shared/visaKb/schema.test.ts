import { describe, expect, it } from 'vitest';
import {
  metaSchema, sourceSchema, visaCategorySchema, eligibilityRecordSchema,
  conditionSchema, knowledgeBaseSchema, APPLICATION_MODES, ENTRY_TYPES,
} from '../../../src/shared/visa-kb/schema.js';
import metaJson from '../../../src/shared/visa-kb/data/india/meta.json' with { type: 'json' };

const validSource = { officialUrl: 'https://indianvisaonline.gov.in/evisa/', retrievedAt: '2026-09-02' };

const validCategory = {
  id: 'evisa.tourist.30d',
  applicationMode: 'evisa',
  category: 'tourist',
  subCategory: 'e-Tourist (30 days)',
  officialCode: 'e-T1V',
  displayName: 'e-Tourist Visa — 30 days',
  purpose: ['recreation', 'sightseeing'],
  validity: { amount: 30, unit: 'days', from: 'first_arrival' },
  entries: 'multiple',
  stayLimitations: { notes: 'Single continuous stay; no aggregate cap on the 30-day variant.' },
  extendable: false,
  convertible: false,
  applicationTiming: { minLeadDays: 4, maxLeadDays: 120 },
  travelRequirements: { passportValidityMonthsMin: 6, passportBlankPagesMin: 2, onwardOrReturnTicket: true },
  requiredDocuments: [{ id: 'passport_bio_page', label: 'Passport bio-data page scan' }],
  optionalDocuments: [],
  specialConditions: ['Biometrics captured on arrival'],
  restrictions: ['No employment', 'Cannot be extended or converted'],
  source: validSource,
  lastVerified: '2026-09-02',
};

const validEligibility = {
  nationality: 'BGD',
  applicationMode: 'evisa',
  categoryId: 'evisa.tourist.30d',
  status: 'eligible',
  conditions: [
    { type: 'passport_type_not_in', value: ['diplomatic', 'official'] },
    { type: 'no_prohibited_background', value: ['defence', 'military', 'police'] },
    { type: 'purpose_in', value: ['recreation', 'sightseeing', 'casual_visit'] },
  ],
  basis: 'Bangladesh is on India’s e-Visa eligible-nationalities list.',
  source: validSource,
  lastVerified: '2026-09-02',
};

describe('meta', () => {
  it('parses the shipped meta.json', () => {
    expect(metaSchema.parse(metaJson)).toMatchObject({ destination: 'IND', schemaVersion: 1 });
  });
  it('rejects a non-alpha-3 destination', () => {
    expect(metaSchema.safeParse({ ...metaJson, destination: 'India' }).success).toBe(false);
  });
  it('rejects a malformed revisionDate', () => {
    expect(metaSchema.safeParse({ ...metaJson, revisionDate: '2026-13-40' }).success).toBe(false);
  });
});

describe('source', () => {
  it('requires an http(s) officialUrl and an ISO retrievedAt', () => {
    expect(sourceSchema.safeParse(validSource).success).toBe(true);
    expect(sourceSchema.safeParse({ ...validSource, officialUrl: 'not-a-url' }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...validSource, retrievedAt: '09/02/2026' }).success).toBe(false);
  });
  it('rejects unknown keys (strict)', () => {
    expect(sourceSchema.safeParse({ ...validSource, extra: 1 }).success).toBe(false);
  });
});

describe('visaCategory', () => {
  it('parses a valid category', () => {
    expect(visaCategorySchema.parse(validCategory).id).toBe('evisa.tourist.30d');
  });
  it('rejects an unknown applicationMode', () => {
    expect(visaCategorySchema.safeParse({ ...validCategory, applicationMode: 'walk_in' }).success).toBe(false);
  });
  it('rejects an unknown category enum', () => {
    expect(visaCategorySchema.safeParse({ ...validCategory, category: 'holiday' }).success).toBe(false);
  });
  it('rejects an id without a dot segment', () => {
    expect(visaCategorySchema.safeParse({ ...validCategory, id: 'tourist' }).success).toBe(false);
  });
  it('rejects a category missing its source', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to drop `source`
    const { source, ...noSource } = validCategory;
    expect(visaCategorySchema.safeParse(noSource).success).toBe(false);
  });
});

describe('condition', () => {
  it('accepts each known condition type', () => {
    expect(conditionSchema.safeParse({ type: 'not_endorsed_on_relative_passport' }).success).toBe(true);
    expect(conditionSchema.safeParse({ type: 'min_age', value: 18 }).success).toBe(true);
    expect(conditionSchema.safeParse({ type: 'custom', text: 'FRRO registration within 14 days' }).success).toBe(true);
  });
  it('rejects an unknown condition type', () => {
    expect(conditionSchema.safeParse({ type: 'must_be_left_handed' }).success).toBe(false);
  });
});

describe('eligibilityRecord', () => {
  it('parses a valid record', () => {
    expect(eligibilityRecordSchema.parse(validEligibility).status).toBe('eligible');
  });
  it('requires an alpha-3 nationality', () => {
    expect(eligibilityRecordSchema.safeParse({ ...validEligibility, nationality: 'Bangladesh' }).success).toBe(false);
  });
});

describe('knowledgeBase', () => {
  it('parses a minimal KB', () => {
    const kb = knowledgeBaseSchema.parse({ meta: metaJson, categories: [validCategory], eligibility: [validEligibility] });
    expect(kb.categories).toHaveLength(1);
  });
});

it('APPLICATION_MODES and ENTRY_TYPES are the expected tuples', () => {
  expect([...APPLICATION_MODES]).toEqual(['evisa', 'regular']);
  expect([...ENTRY_TYPES]).toEqual(['single', 'double', 'multiple']);
});
