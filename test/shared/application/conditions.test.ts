import { describe, expect, it } from 'vitest';
import { ageAt, evaluateCondition, type ConditionContext } from '../../../src/shared/application/conditions.js';
import type { FlatApplicant, Selection } from '../../../src/shared/application/types.js';
import type { VisaCategory } from '../../../src/shared/visa-kb/schema.js';

// ---- fixtures -----------------------------------------------------------------------------

const BASE_APPLICANT: FlatApplicant = {
  identity: {
    surname: 'Applicant',
    givenNames: 'Test',
    fullNameAsInPassport: 'TEST APPLICANT',
    dateOfBirth: null,
    sex: null,
    placeOfBirth: null,
    nationality: null,
    otherNationalities: null,
    religion: null,
    education: null,
    nationalId: null,
    visibleMarks: null,
    nationalityAtBirth: null,
  },
  passport: {
    documentType: null,
    number: null,
    issuingState: null,
    issueDate: null,
    expiryDate: null,
    placeOfIssue: null,
    issuingAuthority: null,
  },
  contact: { email: null, phone: null, altPhone: null },
  address: { line1: null, line2: null, city: null, region: null, postalCode: null, country: null },
  family: {
    fatherName: null,
    fatherNationality: null,
    fatherPrevNationality: null,
    fatherPlaceOfBirth: null,
    motherName: null,
    motherNationality: null,
    motherPrevNationality: null,
    motherPlaceOfBirth: null,
    maritalStatus: null,
    spouseName: null,
    spouseNationality: null,
    spousePrevNationality: null,
    spousePlaceOfBirth: null,
    pakistanAncestry: null,
  },
  occupation: {
    occupation: null,
    employerName: null,
    employerAddress: null,
    designation: null,
    militaryPolice: null,
  },
  travel: [],
  references: [],
  fieldMeta: [],
};

const BASE_SELECTION: Selection = {
  destination: 'IND',
  applicationMode: 'evisa',
  categoryId: 'evisa.tourist.thirty_day',
  purpose: null,
  entryType: null,
  intendedArrivalDate: null,
  intendedStayDays: null,
  portOfArrival: null,
};

const BASE_CATEGORY: VisaCategory = {
  id: 'evisa.tourist.thirty_day',
  applicationMode: 'evisa',
  category: 'tourist',
  subCategory: 'thirty_day',
  officialCode: null,
  displayName: 'Tourist e-Visa (30 days)',
  purpose: ['sightseeing'],
  validity: { amount: 30, unit: 'days', from: 'first_arrival' },
  entries: 'double',
  stayLimitations: {},
  extendable: false,
  convertible: false,
  applicationTiming: {},
  travelRequirements: {},
  requiredDocuments: [],
  optionalDocuments: [],
  conditionalDocuments: [],
  formRules: { applicableSections: [], fieldRules: [] },
  specialConditions: [],
  restrictions: [],
  source: {
    officialUrl: 'https://example.gov.in/visa',
    retrievedAt: '2026-01-01',
    confidence: 'official_verbatim',
  },
  lastVerified: '2026-01-01',
};

const BASE_CONTEXT: ConditionContext = {
  applicant: BASE_APPLICANT,
  selection: BASE_SELECTION,
  applicationValues: {},
  category: BASE_CATEGORY,
  now: new Date('2026-09-05T00:00:00Z'),
};

function ctx(overrides: {
  applicant?: {
    identity?: Partial<FlatApplicant['identity']>;
    family?: Partial<FlatApplicant['family']>;
  };
  selection?: Partial<Selection>;
  applicationValues?: Record<string, { value: string | null; verified: boolean }>;
  category?: Partial<VisaCategory>;
  now?: Date;
}): ConditionContext {
  const identity: FlatApplicant['identity'] = { ...BASE_APPLICANT.identity, ...overrides.applicant?.identity };
  const family: FlatApplicant['family'] = { ...BASE_APPLICANT.family, ...overrides.applicant?.family };
  const applicant: FlatApplicant = { ...BASE_APPLICANT, identity, family };
  const selection: Selection = { ...BASE_SELECTION, ...overrides.selection };
  const category: VisaCategory = { ...BASE_CATEGORY, ...overrides.category };
  return {
    applicant,
    selection,
    applicationValues: overrides.applicationValues ?? {},
    category,
    now: overrides.now ?? BASE_CONTEXT.now,
  };
}

// ---- ageAt ---------------------------------------------------------------------------------

describe('ageAt', () => {
  it('returns null when dob is null', () => {
    expect(ageAt(null, new Date('2026-06-15T00:00:00Z'))).toBeNull();
  });

  it('day before the birthday: age has not incremented yet', () => {
    expect(ageAt('2008-06-15', new Date('2026-06-14T00:00:00Z'))).toBe(17);
  });

  it('on the birthday: age increments exactly on the day', () => {
    expect(ageAt('2008-06-15', new Date('2026-06-15T00:00:00Z'))).toBe(18);
  });

  it('day after the birthday: age has incremented', () => {
    expect(ageAt('2008-06-15', new Date('2026-06-16T00:00:00Z'))).toBe(18);
  });

  it('handles a birthday later in the year not yet reached', () => {
    expect(ageAt('2000-12-25', new Date('2026-01-01T00:00:00Z'))).toBe(25);
  });
});

// ---- evaluateCondition -----------------------------------------------------------------------

describe('evaluateCondition', () => {
  describe('purpose_in', () => {
    it('true when selection.purpose is in the list', () => {
      const c = ctx({ selection: { purpose: 'sightseeing' } });
      expect(evaluateCondition({ type: 'purpose_in', value: ['sightseeing', 'business'] }, c)).toBe(true);
    });

    it('false when selection.purpose is not in the list', () => {
      const c = ctx({ selection: { purpose: 'business' } });
      expect(evaluateCondition({ type: 'purpose_in', value: ['sightseeing'] }, c)).toBe(false);
    });

    it('null when selection.purpose is unset, even with a non-empty value list', () => {
      const c = ctx({ selection: { purpose: null } });
      expect(evaluateCondition({ type: 'purpose_in', value: ['sightseeing', 'business'] }, c)).toBeNull();
    });
  });

  describe('entry_type_in', () => {
    it('true when selection.entryType is in the list', () => {
      const c = ctx({ selection: { entryType: 'double' } });
      expect(evaluateCondition({ type: 'entry_type_in', value: ['double', 'multiple'] }, c)).toBe(true);
    });

    it('false when selection.entryType is not in the list', () => {
      const c = ctx({ selection: { entryType: 'single' } });
      expect(evaluateCondition({ type: 'entry_type_in', value: ['double', 'multiple'] }, c)).toBe(false);
    });

    it('null when selection.entryType is unset', () => {
      const c = ctx({ selection: { entryType: null } });
      expect(evaluateCondition({ type: 'entry_type_in', value: ['double'] }, c)).toBeNull();
    });
  });

  describe('applicant_married', () => {
    it('true when maritalStatus is married', () => {
      const c = ctx({ applicant: { family: { maritalStatus: 'married' } } });
      expect(evaluateCondition({ type: 'applicant_married' }, c)).toBe(true);
    });

    it('false when maritalStatus is single', () => {
      const c = ctx({ applicant: { family: { maritalStatus: 'single' } } });
      expect(evaluateCondition({ type: 'applicant_married' }, c)).toBe(false);
    });

    it('false when maritalStatus is divorced', () => {
      const c = ctx({ applicant: { family: { maritalStatus: 'divorced' } } });
      expect(evaluateCondition({ type: 'applicant_married' }, c)).toBe(false);
    });

    it('false when maritalStatus is widowed', () => {
      const c = ctx({ applicant: { family: { maritalStatus: 'widowed' } } });
      expect(evaluateCondition({ type: 'applicant_married' }, c)).toBe(false);
    });

    it('null when maritalStatus is null', () => {
      const c = ctx({ applicant: { family: { maritalStatus: null } } });
      expect(evaluateCondition({ type: 'applicant_married' }, c)).toBeNull();
    });
  });

  describe('visited_india_before', () => {
    it('null when the key is absent from applicationValues', () => {
      const c = ctx({ applicationValues: {} });
      expect(evaluateCondition({ type: 'visited_india_before' }, c)).toBeNull();
    });

    it("true when value is 'yes'", () => {
      const c = ctx({
        applicationValues: { 'application.visitedIndiaBefore': { value: 'yes', verified: false } },
      });
      expect(evaluateCondition({ type: 'visited_india_before' }, c)).toBe(true);
    });

    it("false when value is 'no'", () => {
      const c = ctx({
        applicationValues: { 'application.visitedIndiaBefore': { value: 'no', verified: false } },
      });
      expect(evaluateCondition({ type: 'visited_india_before' }, c)).toBe(false);
    });

    it('null when value is null', () => {
      const c = ctx({
        applicationValues: { 'application.visitedIndiaBefore': { value: null, verified: false } },
      });
      expect(evaluateCondition({ type: 'visited_india_before' }, c)).toBeNull();
    });

    it('null when value is some other string', () => {
      const c = ctx({
        applicationValues: { 'application.visitedIndiaBefore': { value: 'maybe', verified: false } },
      });
      expect(evaluateCondition({ type: 'visited_india_before' }, c)).toBeNull();
    });
  });

  describe('age_lt', () => {
    it('null when dateOfBirth is null', () => {
      const c = ctx({ applicant: { identity: { dateOfBirth: null } }, selection: { intendedArrivalDate: '2026-06-15' } });
      expect(evaluateCondition({ type: 'age_lt', value: 18 }, c)).toBeNull();
    });

    it('true when the applicant is exactly 17 at intendedArrivalDate', () => {
      const c = ctx({
        applicant: { identity: { dateOfBirth: '2008-06-15' } },
        selection: { intendedArrivalDate: '2026-06-14' },
      });
      expect(evaluateCondition({ type: 'age_lt', value: 18 }, c)).toBe(true);
    });

    it('false when the applicant is exactly 18 at intendedArrivalDate (birthday falls on that date)', () => {
      const c = ctx({
        applicant: { identity: { dateOfBirth: '2008-06-15' } },
        selection: { intendedArrivalDate: '2026-06-15' },
      });
      expect(evaluateCondition({ type: 'age_lt', value: 18 }, c)).toBe(false);
    });

    it('falls back to now when intendedArrivalDate is null', () => {
      const c = ctx({
        applicant: { identity: { dateOfBirth: '2010-01-01' } },
        selection: { intendedArrivalDate: null },
        now: new Date('2026-09-05T00:00:00Z'), // age 16, clearly < 18
      });
      expect(evaluateCondition({ type: 'age_lt', value: 18 }, c)).toBe(true);
    });
  });

  describe('age_gte', () => {
    it('null when dateOfBirth is null', () => {
      const c = ctx({ applicant: { identity: { dateOfBirth: null } }, selection: { intendedArrivalDate: '2026-06-15' } });
      expect(evaluateCondition({ type: 'age_gte', value: 18 }, c)).toBeNull();
    });

    it('false when the applicant is exactly 17 at intendedArrivalDate', () => {
      const c = ctx({
        applicant: { identity: { dateOfBirth: '2008-06-15' } },
        selection: { intendedArrivalDate: '2026-06-14' },
      });
      expect(evaluateCondition({ type: 'age_gte', value: 18 }, c)).toBe(false);
    });

    it('true when the applicant is exactly 18 at intendedArrivalDate', () => {
      const c = ctx({
        applicant: { identity: { dateOfBirth: '2008-06-15' } },
        selection: { intendedArrivalDate: '2026-06-15' },
      });
      expect(evaluateCondition({ type: 'age_gte', value: 18 }, c)).toBe(true);
    });
  });

  describe('stay_days_gt', () => {
    it('null when intendedStayDays is null', () => {
      const c = ctx({ selection: { intendedStayDays: null } });
      expect(evaluateCondition({ type: 'stay_days_gt', value: 30 }, c)).toBeNull();
    });

    it('false when intendedStayDays equals the threshold', () => {
      const c = ctx({ selection: { intendedStayDays: 30 } });
      expect(evaluateCondition({ type: 'stay_days_gt', value: 30 }, c)).toBe(false);
    });

    it('false when intendedStayDays is below the threshold', () => {
      const c = ctx({ selection: { intendedStayDays: 10 } });
      expect(evaluateCondition({ type: 'stay_days_gt', value: 30 }, c)).toBe(false);
    });

    it('true when intendedStayDays exceeds the threshold', () => {
      const c = ctx({ selection: { intendedStayDays: 31 } });
      expect(evaluateCondition({ type: 'stay_days_gt', value: 30 }, c)).toBe(true);
    });
  });

  describe('sub_category_is', () => {
    it('true when it matches category.subCategory', () => {
      const c = ctx({ category: { subCategory: 'thirty_day', id: 'evisa.tourist.thirty_day' } });
      expect(evaluateCondition({ type: 'sub_category_is', value: 'thirty_day' }, c)).toBe(true);
    });

    it('true when it matches category.id (subCategory differs)', () => {
      const c = ctx({ category: { subCategory: 'sixty_day', id: 'evisa.tourist.thirty_day' } });
      expect(evaluateCondition({ type: 'sub_category_is', value: 'evisa.tourist.thirty_day' }, c)).toBe(true);
    });

    it('false when it matches neither', () => {
      const c = ctx({ category: { subCategory: 'sixty_day', id: 'evisa.tourist.thirty_day' } });
      expect(evaluateCondition({ type: 'sub_category_is', value: 'ninety_day' }, c)).toBe(false);
    });
  });

  describe('custom', () => {
    it('is always null', () => {
      const c = ctx({});
      expect(evaluateCondition({ type: 'custom', text: 'manual review required' }, c)).toBeNull();
    });
  });
});
