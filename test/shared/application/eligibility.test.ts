import { describe, expect, it } from 'vitest';
import {
  evaluateEligibility,
  evaluateEligibilityCondition,
  type EligibilityInput,
} from '../../../src/shared/application/eligibility.js';
import type { FlatApplicant, Selection } from '../../../src/shared/application/types.js';
import type {
  EligibilityCondition,
  EligibilityRecord,
  KnowledgeBase,
  Source,
  VisaCategory,
} from '../../../src/shared/visa-kb/schema.js';

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
  categoryId: 'evisa.tourist.30d',
  purpose: null,
  entryType: null,
  intendedArrivalDate: null,
  intendedStayDays: null,
  portOfArrival: null,
};

const RECORD_SOURCE: Source = {
  officialUrl: 'https://example.gov.in/eligibility',
  retrievedAt: '2026-01-01',
  confidence: 'official_verbatim',
};

const CATEGORY_SOURCE: Source = {
  officialUrl: 'https://example.gov.in/category',
  retrievedAt: '2026-02-02',
  confidence: 'official_derived',
};

const BASE_CATEGORY: VisaCategory = {
  id: 'evisa.tourist.30d',
  applicationMode: 'evisa',
  category: 'tourist',
  subCategory: '30d',
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
  source: CATEGORY_SOURCE,
  lastVerified: '2026-02-02',
};

function makeRecord(overrides: {
  status?: EligibilityRecord['status'];
  conditions?: EligibilityCondition[];
  nationality?: string;
}): EligibilityRecord {
  return {
    nationality: overrides.nationality ?? 'BGD',
    applicationMode: 'evisa',
    categoryId: 'evisa.tourist.30d',
    status: overrides.status ?? 'conditional',
    conditions: overrides.conditions ?? [],
    basis: 'test basis',
    source: RECORD_SOURCE,
    lastVerified: '2026-01-01',
  };
}

function makeKb(opts: {
  records?: EligibilityRecord[];
  category?: VisaCategory;
}): KnowledgeBase {
  return {
    meta: {
      schemaVersion: 2,
      kbVersion: 'test-1',
      destination: 'IND',
      revisionDate: '2026-01-01',
    },
    categories: [opts.category ?? BASE_CATEGORY],
    eligibility: opts.records ?? [],
    formModel: { sections: [] },
  };
}

function makeInput(overrides: {
  nationality?: string | null;
  applicant?: {
    identity?: Partial<FlatApplicant['identity']>;
    passport?: Partial<FlatApplicant['passport']>;
  };
  selection?: Partial<Selection>;
  kb: KnowledgeBase;
  now?: Date;
}): EligibilityInput {
  const identity = { ...BASE_APPLICANT.identity, ...overrides.applicant?.identity };
  const passport = { ...BASE_APPLICANT.passport, ...overrides.applicant?.passport };
  const applicant: FlatApplicant = { ...BASE_APPLICANT, identity, passport };
  const selection: Selection = { ...BASE_SELECTION, ...overrides.selection };
  return {
    nationality: overrides.nationality === undefined ? 'BGD' : overrides.nationality,
    selection,
    applicant,
    applicationValues: {},
    kb: overrides.kb,
    now: overrides.now ?? new Date('2026-09-05T00:00:00Z'),
  };
}

const NOW = new Date('2026-09-05T00:00:00Z');

// ---- evaluateEligibility ---------------------------------------------------------------------

describe('evaluateEligibility', () => {
  it('nationality null -> unknown, reason "nationality not set"', () => {
    const kb = makeKb({ records: [makeRecord({})] });
    const plan = evaluateEligibility(makeInput({ nationality: null, kb }));
    expect(plan.status).toBe('unknown');
    expect(plan.reason).toBe('nationality not set');
    expect(plan.conditions).toEqual([]);
    expect(plan.unmetConditions).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.basis).toBeNull();
    expect(plan.source).toBeNull();
  });

  it('no matching eligibility record -> unknown, never ineligible', () => {
    const kb = makeKb({ records: [] });
    const plan = evaluateEligibility(makeInput({ nationality: 'ZZZ', kb }));
    expect(plan.status).toBe('unknown');
    expect(plan.status).not.toBe('ineligible');
    expect(plan.conditions).toEqual([]);
    expect(plan.unmetConditions).toEqual([]);
    expect(plan.basis).toBeNull();
    expect(plan.source).toBeNull();
  });

  describe('passport validity — insufficient (blocker)', () => {
    it('expiry ~3 months out, arrival ~30 days out, min 6 months -> false, 1 unmet, 1 blocker warning', () => {
      const record = makeRecord({
        conditions: [{ type: 'passport_validity_months_min', value: 6 }],
      });
      const kb = makeKb({ records: [record] });
      const input = makeInput({
        kb,
        now: NOW,
        selection: { intendedArrivalDate: '2026-10-05' }, // ~30 days out
        applicant: { passport: { expiryDate: '2026-12-05' } }, // ~3 months out from now/arrival
      });
      const plan = evaluateEligibility(input);
      const view = plan.conditions.find((v) => v.condition.type === 'passport_validity_months_min');
      expect(view).toBeDefined();
      expect(view?.conditionMet).toBe(false);
      expect(plan.unmetConditions.length).toBe(1);
      const blockers = plan.warnings.filter((w) => w.severity === 'blocker');
      expect(blockers.length).toBe(1);
      expect(blockers[0]?.source).not.toBeNull();
    });

    it('expiry ~2 years out -> true, no blocker warning, no unmet conditions', () => {
      const record = makeRecord({
        conditions: [{ type: 'passport_validity_months_min', value: 6 }],
      });
      const kb = makeKb({ records: [record] });
      const input = makeInput({
        kb,
        now: NOW,
        selection: { intendedArrivalDate: '2026-10-05' },
        applicant: { passport: { expiryDate: '2028-09-05' } },
      });
      const plan = evaluateEligibility(input);
      const view = plan.conditions.find((v) => v.condition.type === 'passport_validity_months_min');
      expect(view?.conditionMet).toBe(true);
      expect(plan.unmetConditions.length).toBe(0);
      expect(plan.warnings.filter((w) => w.severity === 'blocker').length).toBe(0);
    });

    it('expiryDate null -> conditionMet null, not in unmetConditions, exactly one info warning', () => {
      const record = makeRecord({
        conditions: [{ type: 'passport_validity_months_min', value: 6 }],
      });
      const kb = makeKb({ records: [record] });
      const input = makeInput({
        kb,
        now: NOW,
        selection: { intendedArrivalDate: '2026-10-05' },
        applicant: { passport: { expiryDate: null } },
      });
      const plan = evaluateEligibility(input);
      const view = plan.conditions.find((v) => v.condition.type === 'passport_validity_months_min');
      expect(view?.conditionMet).toBeNull();
      expect(plan.unmetConditions.length).toBe(0);
      const infos = plan.warnings.filter((w) => w.severity === 'info');
      expect(infos.length).toBe(1);
      expect(infos[0]?.source).not.toBeNull();
      expect(plan.warnings.filter((w) => w.severity === 'blocker').length).toBe(0);
    });
  });

  it('no_prohibited_background -> conditionMet null, text starts with "You must confirm: "', () => {
    const record = makeRecord({
      conditions: [{ type: 'no_prohibited_background', value: ['criminal_record'] }],
    });
    const kb = makeKb({ records: [record] });
    const plan = evaluateEligibility(makeInput({ kb }));
    const view = plan.conditions[0];
    expect(view?.conditionMet).toBeNull();
    expect(view?.text.startsWith('You must confirm: ')).toBe(true);
  });

  describe('min_age / max_age', () => {
    it('min_age: younger than threshold -> false', () => {
      const record = makeRecord({ conditions: [{ type: 'min_age', value: 18 }] });
      const kb = makeKb({ records: [record] });
      const input = makeInput({
        kb,
        now: NOW,
        selection: { intendedArrivalDate: '2026-09-05' },
        applicant: { identity: { dateOfBirth: '2010-01-01' } }, // 16 at arrival
      });
      const plan = evaluateEligibility(input);
      expect(plan.conditions[0]?.conditionMet).toBe(false);
    });

    it('max_age: older than threshold -> false; min_age older -> true', () => {
      const record = makeRecord({
        conditions: [
          { type: 'min_age', value: 18 },
          { type: 'max_age', value: 60 },
        ],
      });
      const kb = makeKb({ records: [record] });
      const input = makeInput({
        kb,
        now: NOW,
        selection: { intendedArrivalDate: '2026-09-05' },
        applicant: { identity: { dateOfBirth: '1990-01-01' } }, // 36
      });
      const plan = evaluateEligibility(input);
      const minView = plan.conditions.find((v) => v.condition.type === 'min_age');
      const maxView = plan.conditions.find((v) => v.condition.type === 'max_age');
      expect(minView?.conditionMet).toBe(true);
      expect(maxView?.conditionMet).toBe(true);
    });

    it('dateOfBirth null -> null for both', () => {
      const record = makeRecord({
        conditions: [
          { type: 'min_age', value: 18 },
          { type: 'max_age', value: 60 },
        ],
      });
      const kb = makeKb({ records: [record] });
      const input = makeInput({ kb, applicant: { identity: { dateOfBirth: null } } });
      const plan = evaluateEligibility(input);
      for (const v of plan.conditions) expect(v.conditionMet).toBeNull();
    });
  });

  it('purpose_in: selection.purpose unset -> null, not false', () => {
    const record = makeRecord({
      conditions: [{ type: 'purpose_in', value: ['sightseeing'] }],
    });
    const kb = makeKb({ records: [record] });
    const plan = evaluateEligibility(makeInput({ kb, selection: { purpose: null } }));
    expect(plan.conditions[0]?.conditionMet).toBeNull();
  });

  describe('passport-validity synthesis from travelRequirements', () => {
    it('no explicit condition, category travelRequirements set -> synthetic view added with category source', () => {
      const record = makeRecord({ conditions: [] });
      const category: VisaCategory = {
        ...BASE_CATEGORY,
        travelRequirements: { passportValidityMonthsMin: 6 },
      };
      const kb = makeKb({ records: [record], category });
      const plan = evaluateEligibility(makeInput({ kb }));
      const view = plan.conditions.find((v) => v.condition.type === 'passport_validity_months_min');
      expect(view).toBeDefined();
      expect(view?.condition.type === 'passport_validity_months_min' && view.condition.value).toBe(6);
      expect(view?.source).toEqual(CATEGORY_SOURCE);
      expect(view?.source).not.toEqual(RECORD_SOURCE);
    });

    it('explicit condition present AND travelRequirements set to a different number -> only one view for that type', () => {
      const record = makeRecord({
        conditions: [{ type: 'passport_validity_months_min', value: 9 }],
      });
      const category: VisaCategory = {
        ...BASE_CATEGORY,
        travelRequirements: { passportValidityMonthsMin: 6 },
      };
      const kb = makeKb({ records: [record], category });
      const plan = evaluateEligibility(makeInput({ kb }));
      const views = plan.conditions.filter((v) => v.condition.type === 'passport_validity_months_min');
      expect(views.length).toBe(1);
      expect(views[0]?.condition.type === 'passport_validity_months_min' && views[0].condition.value).toBe(9);
      expect(views[0]?.source).toEqual(RECORD_SOURCE);
    });
  });

  describe('passport_type_in / passport_type_not_in', () => {
    it('documentType null -> null', () => {
      const record = makeRecord({
        conditions: [{ type: 'passport_type_in', value: ['ordinary'] }],
      });
      const kb = makeKb({ records: [record] });
      const plan = evaluateEligibility(makeInput({ kb, applicant: { passport: { documentType: null } } }));
      expect(plan.conditions[0]?.conditionMet).toBeNull();
    });

    it("documentType 'P' (MRZ, non-PASSPORT_TYPES) -> null", () => {
      const record = makeRecord({
        conditions: [{ type: 'passport_type_not_in', value: ['diplomatic'] }],
      });
      const kb = makeKb({ records: [record] });
      const plan = evaluateEligibility(makeInput({ kb, applicant: { passport: { documentType: 'P' } } }));
      expect(plan.conditions[0]?.conditionMet).toBeNull();
    });

    it('documentType a real PASSPORT_TYPES value -> real boolean', () => {
      const record = makeRecord({
        conditions: [{ type: 'passport_type_in', value: ['ordinary'] }],
      });
      const kb = makeKb({ records: [record] });
      const plan = evaluateEligibility(
        makeInput({ kb, applicant: { passport: { documentType: 'ordinary' } } }),
      );
      expect(plan.conditions[0]?.conditionMet).toBe(true);

      const record2 = makeRecord({
        conditions: [{ type: 'passport_type_not_in', value: ['diplomatic'] }],
      });
      const kb2 = makeKb({ records: [record2] });
      const plan2 = evaluateEligibility(
        makeInput({ kb: kb2, applicant: { passport: { documentType: 'ordinary' } } }),
      );
      expect(plan2.conditions[0]?.conditionMet).toBe(true);
    });
  });

  it('status is passed through unchanged from the KB record even when a condition is unmet', () => {
    const record = makeRecord({
      status: 'conditional',
      conditions: [{ type: 'min_age', value: 18 }],
    });
    const kb = makeKb({ records: [record] });
    const plan = evaluateEligibility(
      makeInput({ kb, applicant: { identity: { dateOfBirth: '2020-01-01' } } }), // young -> false
    );
    expect(plan.status).toBe('conditional');
    expect(plan.unmetConditions.length).toBe(1);
  });

  it('custom condition -> conditionMet null, exact confirm text', () => {
    const record = makeRecord({
      conditions: [{ type: 'custom', text: 'manual review required' }],
    });
    const kb = makeKb({ records: [record] });
    const plan = evaluateEligibility(makeInput({ kb }));
    expect(plan.conditions[0]?.conditionMet).toBeNull();
    expect(plan.conditions[0]?.text).toBe('You must confirm: manual review required');
  });
});

// ---- evaluateEligibilityCondition -------------------------------------------------------------

describe('evaluateEligibilityCondition', () => {
  const baseSelection = BASE_SELECTION;

  it('passport_validity_months_min text is exact', () => {
    const result = evaluateEligibilityCondition(
      { type: 'passport_validity_months_min', value: 6 },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(result.text).toBe('Passport must be valid for at least 6 months after arrival.');
    expect(result.conditionMet).toBeNull(); // expiryDate is null in BASE_APPLICANT
  });

  it('min_age text is exact', () => {
    const result = evaluateEligibilityCondition(
      { type: 'min_age', value: 18 },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(result.text).toBe('Applicant must be at least 18 years old at arrival.');
  });

  it('max_age text is exact', () => {
    const result = evaluateEligibilityCondition(
      { type: 'max_age', value: 60 },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(result.text).toBe('Applicant must be at most 60 years old at arrival.');
  });

  it('purpose_in / purpose_not_in text is exact', () => {
    const inRes = evaluateEligibilityCondition(
      { type: 'purpose_in', value: ['sightseeing', 'business'] },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(inRes.text).toBe('Purpose of visit must be one of: sightseeing, business.');
    const notInRes = evaluateEligibilityCondition(
      { type: 'purpose_not_in', value: ['employment'] },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(notInRes.text).toBe('Purpose of visit must not be one of: employment.');
  });

  it('passport_type_in / passport_type_not_in text is exact', () => {
    const inRes = evaluateEligibilityCondition(
      { type: 'passport_type_in', value: ['ordinary', 'official'] },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(inRes.text).toBe('Passport type must be one of: ordinary, official.');
    const notInRes = evaluateEligibilityCondition(
      { type: 'passport_type_not_in', value: ['diplomatic'] },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(notInRes.text).toBe('Passport type must not be one of: diplomatic.');
  });

  it('no_prohibited_background text is exact and prefixed', () => {
    const result = evaluateEligibilityCondition(
      { type: 'no_prohibited_background', value: ['criminal_record', 'deportation'] },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(result.text).toBe('You must confirm: no prohibited background (criminal_record, deportation).');
    expect(result.conditionMet).toBeNull();
  });

  it('not_endorsed_on_relative_passport text is exact and prefixed', () => {
    const result = evaluateEligibilityCondition(
      { type: 'not_endorsed_on_relative_passport' },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(result.text).toBe("You must confirm: applicant is not endorsed on a relative's passport.");
    expect(result.conditionMet).toBeNull();
  });

  it('requires_supporting_institution_letter text is exact and prefixed', () => {
    const result = evaluateEligibilityCondition(
      { type: 'requires_supporting_institution_letter' },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(result.text).toBe('You must confirm: a supporting institution letter is provided.');
    expect(result.conditionMet).toBeNull();
  });

  it('salary_min_inr_per_annum text is exact and prefixed', () => {
    const result = evaluateEligibilityCondition(
      { type: 'salary_min_inr_per_annum', value: 500000 },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(result.text).toBe('You must confirm: minimum annual salary of INR 500000 is met.');
    expect(result.conditionMet).toBeNull();
  });

  it('custom text is exact and prefixed', () => {
    const result = evaluateEligibilityCondition(
      { type: 'custom', text: 'manual review required' },
      { applicant: BASE_APPLICANT, selection: baseSelection, now: NOW },
    );
    expect(result.text).toBe('You must confirm: manual review required');
    expect(result.conditionMet).toBeNull();
  });
});
