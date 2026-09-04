import { describe, expect, it } from 'vitest';
import {
  metaSchema, sourceSchema, visaCategorySchema, eligibilityRecordSchema,
  conditionSchema, knowledgeBaseSchema, APPLICATION_MODES, ENTRY_TYPES,
  formConditionSchema, formFieldSchema, formSectionSchema, formModelSchema,
  fieldRuleSchema, formRulesSchema, conditionalDocSchema, SOURCE_CONFIDENCE,
} from '../../../src/shared/visa-kb/schema.js';
import metaJson from '../../../src/shared/visa-kb/data/india/meta.json' with { type: 'json' };

const validSource = {
  officialUrl: 'https://indianvisaonline.gov.in/evisa/', retrievedAt: '2026-09-02', confidence: 'official_derived',
};

const emptyFormRules = { applicableSections: [], fieldRules: [] };

const validFormModel = {
  sections: [
    {
      id: 'personal_particulars',
      label: 'Personal particulars',
      fields: [
        {
          id: 'standard_personal_block', label: 'Standard personal particulars',
          appliesTo: null, dataType: 'text', standardBlock: true, source: validSource,
        },
      ],
      source: validSource,
    },
  ],
};

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
  conditionalDocuments: [],
  formRules: emptyFormRules,
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
    expect(metaSchema.parse(metaJson)).toMatchObject({ destination: 'IND', schemaVersion: 2 });
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
  it('requires a confidence value from SOURCE_CONFIDENCE', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to drop `confidence`
    const { confidence, ...noConfidence } = validSource;
    expect(sourceSchema.safeParse(noConfidence).success).toBe(false);
    expect(sourceSchema.safeParse({ ...validSource, confidence: 'guesswork' }).success).toBe(false);
    for (const c of SOURCE_CONFIDENCE) {
      expect(sourceSchema.safeParse({ ...validSource, confidence: c }).success).toBe(true);
    }
  });
});

describe('formCondition', () => {
  const variants = [
    { type: 'purpose_in', value: ['business'] },
    { type: 'entry_type_in', value: ['multiple'] },
    { type: 'applicant_married' },
    { type: 'visited_india_before' },
    { type: 'age_lt', value: 18 },
    { type: 'age_gte', value: 65 },
    { type: 'stay_days_gt', value: 180 },
    { type: 'sub_category_is', value: 'e-Tourist (30 days)' },
    { type: 'custom', text: 'FRRO registration within 14 days' },
  ];
  it('accepts every declared variant', () => {
    for (const v of variants) {
      expect(formConditionSchema.safeParse(v).success, JSON.stringify(v)).toBe(true);
    }
  });
  it('rejects an unknown condition type', () => {
    expect(formConditionSchema.safeParse({ type: 'weather_is_nice' }).success).toBe(false);
  });
  it('rejects extra keys on a variant (strict)', () => {
    expect(formConditionSchema.safeParse({ type: 'applicant_married', extra: 1 }).success).toBe(false);
    expect(formConditionSchema.safeParse({ type: 'purpose_in', value: ['business'], extra: 1 }).success).toBe(false);
  });
  it('rejects an empty value array where one is required', () => {
    expect(formConditionSchema.safeParse({ type: 'purpose_in', value: [] }).success).toBe(false);
  });
});

describe('fieldRule', () => {
  const base = { sectionId: 'personal_particulars', fieldId: 'standard_personal_block', source: validSource };
  it('accepts a plain requirement without a condition', () => {
    expect(fieldRuleSchema.safeParse({ ...base, requirement: 'required' }).success).toBe(true);
  });
  it('rejects requirement:"conditional" without a condition', () => {
    expect(fieldRuleSchema.safeParse({ ...base, requirement: 'conditional' }).success).toBe(false);
  });
  it('accepts requirement:"conditional" with a condition', () => {
    const r = fieldRuleSchema.safeParse({
      ...base, requirement: 'conditional', condition: { type: 'applicant_married' },
    });
    expect(r.success).toBe(true);
  });
  it('rejects unknown keys (strict)', () => {
    expect(fieldRuleSchema.safeParse({ ...base, requirement: 'optional', extra: 1 }).success).toBe(false);
  });
});

describe('formSection / formModel', () => {
  const field = {
    id: 'standard_personal_block', label: 'Standard personal particulars',
    appliesTo: null, dataType: 'text', standardBlock: true, source: validSource,
  };
  it('parses a valid section', () => {
    expect(formSectionSchema.parse({ id: 'address', label: 'Address', fields: [field], source: validSource }).id)
      .toBe('address');
  });
  it('rejects an unknown section id', () => {
    expect(formSectionSchema.safeParse({ id: 'star_sign', label: 'x', fields: [], source: validSource }).success)
      .toBe(false);
  });
  it('rejects a field with an unknown dataType', () => {
    expect(formFieldSchema.safeParse({ ...field, dataType: 'colour' }).success).toBe(false);
  });
  it('formModel requires at least one section', () => {
    expect(formModelSchema.safeParse({ sections: [] }).success).toBe(false);
  });
});

describe('formRules / conditionalDoc', () => {
  it('formRules accepts empty arrays', () => {
    expect(formRulesSchema.parse({ applicableSections: [], fieldRules: [] })).toEqual({
      applicableSections: [], fieldRules: [],
    });
  });
  it('conditionalDoc = doc + condition + source, strict', () => {
    const ok = conditionalDocSchema.safeParse({
      id: 'marriage_certificate', label: 'Marriage certificate',
      condition: { type: 'applicant_married' }, source: validSource,
    });
    expect(ok.success).toBe(true);
    expect(conditionalDocSchema.safeParse({
      id: 'x', label: 'x', condition: { type: 'applicant_married' }, source: validSource, extra: 1,
    }).success).toBe(false);
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
    const kb = knowledgeBaseSchema.parse({
      meta: metaJson, categories: [validCategory], eligibility: [validEligibility], formModel: validFormModel,
    });
    expect(kb.categories).toHaveLength(1);
    expect(kb.formModel.sections).toHaveLength(1);
  });
});

it('APPLICATION_MODES and ENTRY_TYPES are the expected tuples', () => {
  expect([...APPLICATION_MODES]).toEqual(['evisa', 'regular']);
  expect([...ENTRY_TYPES]).toEqual(['single', 'double', 'multiple']);
});
