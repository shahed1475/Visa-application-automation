import { describe, expect, it, vi } from 'vitest';
import { resolveFieldPlans } from '../../../src/shared/application/formRules.js';
import type { ConditionContext } from '../../../src/shared/application/conditions.js';
import type { FlatApplicant, Selection } from '../../../src/shared/application/types.js';
import type { FormModel, Source, VisaCategory } from '../../../src/shared/visa-kb/schema.js';

// ---- fixtures -----------------------------------------------------------------------------

function src(tag: string): Source {
  return {
    officialUrl: `https://example.gov.in/${tag}`,
    retrievedAt: '2026-01-01',
    confidence: 'official_derived',
  };
}

const SECTION_PERSONAL_SOURCE = src('section-personal');
const SECTION_FAMILY_SOURCE = src('section-family');
const SECTION_OCCUPATION_SOURCE = src('section-occupation');
const SECTION_REFERENCES_SOURCE = src('section-references');

const FIELD_SURNAME_SOURCE = src('field-surname');
const FIELD_NICKNAME_SOURCE = src('field-nickname');
const FIELD_NATIONALITY_SOURCE = src('field-nationality');
const FIELD_SPOUSE_SOURCE = src('field-spouse');
const FIELD_EMPLOYER_SOURCE = src('field-employer');

const RULE_NATIONALITY_SOURCE = src('rule-nationality');
const RULE_MARRIED_SOURCE = src('rule-married');
const RULE_REFERENCES_SOURCE = src('rule-references');

const FORM_MODEL: FormModel = {
  sections: [
    {
      id: 'personal_particulars',
      label: 'Personal particulars',
      source: SECTION_PERSONAL_SOURCE,
      fields: [
        {
          id: 'surname',
          label: 'Surname',
          appliesTo: 'identity.surname',
          dataType: 'text',
          standardBlock: true,
          source: FIELD_SURNAME_SOURCE,
        },
        {
          id: 'nickname',
          label: 'Nickname',
          appliesTo: null,
          dataType: 'text',
          standardBlock: false,
          source: FIELD_NICKNAME_SOURCE,
        },
        {
          id: 'nationality',
          label: 'Nationality',
          appliesTo: 'identity.nationality',
          dataType: 'country',
          standardBlock: true,
          source: FIELD_NATIONALITY_SOURCE,
        },
      ],
    },
    {
      id: 'family',
      label: 'Family',
      source: SECTION_FAMILY_SOURCE,
      fields: [
        {
          id: 'spouse_name',
          label: 'Spouse name',
          appliesTo: 'family.spouseName',
          dataType: 'text',
          standardBlock: false,
          source: FIELD_SPOUSE_SOURCE,
        },
      ],
    },
    {
      id: 'occupation',
      label: 'Occupation',
      source: SECTION_OCCUPATION_SOURCE,
      fields: [
        {
          id: 'employer_name',
          label: 'Employer name',
          appliesTo: 'occupation.employerName',
          dataType: 'text',
          standardBlock: true,
          source: FIELD_EMPLOYER_SOURCE,
        },
      ],
    },
    {
      id: 'references',
      label: 'References',
      source: SECTION_REFERENCES_SOURCE,
      fields: [],
    },
  ],
};

const CATEGORY_SOURCE: Source = src('category');

function makeCategory(formRules: VisaCategory['formRules']): VisaCategory {
  return {
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
    formRules,
    specialConditions: [],
    restrictions: [],
    source: CATEGORY_SOURCE,
    lastVerified: '2026-02-02',
  };
}

const CATEGORY_NO_REFS = makeCategory({
  applicableSections: ['personal_particulars', 'family', 'references'],
  fieldRules: [
    {
      sectionId: 'personal_particulars',
      fieldId: 'nationality',
      requirement: 'optional',
      source: RULE_NATIONALITY_SOURCE,
    },
    {
      sectionId: 'family',
      fieldId: 'spouse_name',
      requirement: 'conditional',
      condition: { type: 'applicant_married' },
      source: RULE_MARRIED_SOURCE,
    },
  ],
});

const CATEGORY_WITH_REFS = makeCategory({
  applicableSections: ['personal_particulars', 'family', 'references'],
  fieldRules: [
    ...CATEGORY_NO_REFS.formRules.fieldRules,
    {
      sectionId: 'references',
      fieldId: 'india_references_min',
      requirement: 'required',
      count: 2,
      source: RULE_REFERENCES_SOURCE,
    },
  ],
});

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

const NOW = new Date('2026-09-05T00:00:00Z');

function makeCtx(overrides: {
  category: VisaCategory;
  maritalStatus?: FlatApplicant['family']['maritalStatus'];
}): ConditionContext {
  const applicant: FlatApplicant = {
    ...BASE_APPLICANT,
    family: { ...BASE_APPLICANT.family, maritalStatus: overrides.maritalStatus ?? null },
  };
  return {
    applicant,
    selection: BASE_SELECTION,
    applicationValues: {},
    category: overrides.category,
    now: NOW,
  };
}

function noopResolveValue() {
  return { value: null, present: false, verified: false };
}

// ---- tests ---------------------------------------------------------------------------------

describe('resolveFieldPlans', () => {
  it('explicit FieldRule wins over standardBlock default (standardBlock:true field ruled optional)', () => {
    const ctx = makeCtx({ category: CATEGORY_NO_REFS });
    const sections = resolveFieldPlans({
      category: CATEGORY_NO_REFS,
      formModel: FORM_MODEL,
      ctx,
      resolveValue: noopResolveValue,
    });
    const personal = sections.find((s) => s.id === 'personal_particulars');
    const nationality = personal?.fields.find((f) => f.id === 'nationality');
    expect(nationality?.requirement).toBe('optional');
    expect(nationality?.effectiveRequirement).toBe('optional');
    expect(nationality?.condition).toBeNull();
    expect(nationality?.conditionMet).toBeNull();
    expect(nationality?.source).toEqual(RULE_NATIONALITY_SOURCE);
  });

  it('applicable-section standardBlock:true field with no explicit rule -> required', () => {
    const ctx = makeCtx({ category: CATEGORY_NO_REFS });
    const sections = resolveFieldPlans({
      category: CATEGORY_NO_REFS,
      formModel: FORM_MODEL,
      ctx,
      resolveValue: noopResolveValue,
    });
    const personal = sections.find((s) => s.id === 'personal_particulars');
    const surname = personal?.fields.find((f) => f.id === 'surname');
    expect(surname?.requirement).toBe('required');
    expect(surname?.effectiveRequirement).toBe('required');
    expect(surname?.condition).toBeNull();
    expect(surname?.conditionMet).toBeNull();
    expect(surname?.source).toEqual(FIELD_SURNAME_SOURCE);
  });

  it('applicable-section standardBlock:false field with no explicit rule -> optional', () => {
    const ctx = makeCtx({ category: CATEGORY_NO_REFS });
    const sections = resolveFieldPlans({
      category: CATEGORY_NO_REFS,
      formModel: FORM_MODEL,
      ctx,
      resolveValue: noopResolveValue,
    });
    const personal = sections.find((s) => s.id === 'personal_particulars');
    const nickname = personal?.fields.find((f) => f.id === 'nickname');
    expect(nickname?.requirement).toBe('optional');
    expect(nickname?.effectiveRequirement).toBe('optional');
    expect(nickname?.source).toEqual(FIELD_NICKNAME_SOURCE);
    expect(nickname?.value).toBeNull();
    expect(nickname?.present).toBe(false);
    expect(nickname?.verified).toBe(false);
  });

  it('non-applicable-section field (no explicit rule) -> not_applicable, and SectionPlan.applicable === false', () => {
    const ctx = makeCtx({ category: CATEGORY_NO_REFS });
    const sections = resolveFieldPlans({
      category: CATEGORY_NO_REFS,
      formModel: FORM_MODEL,
      ctx,
      resolveValue: noopResolveValue,
    });
    const occupation = sections.find((s) => s.id === 'occupation');
    expect(occupation?.applicable).toBe(false);
    const employer = occupation?.fields.find((f) => f.id === 'employer_name');
    expect(employer?.requirement).toBe('not_applicable');
    expect(employer?.effectiveRequirement).toBe('not_applicable');
    expect(employer?.condition).toBeNull();
    expect(employer?.conditionMet).toBeNull();
    expect(employer?.source).toEqual(FIELD_EMPLOYER_SOURCE);
  });

  describe('conditional applicant_married rule', () => {
    it('met (maritalStatus: married) -> effectiveRequirement required, conditionMet true', () => {
      const ctx = makeCtx({ category: CATEGORY_NO_REFS, maritalStatus: 'married' });
      const sections = resolveFieldPlans({
        category: CATEGORY_NO_REFS,
        formModel: FORM_MODEL,
        ctx,
        resolveValue: noopResolveValue,
      });
      const family = sections.find((s) => s.id === 'family');
      const spouse = family?.fields.find((f) => f.id === 'spouse_name');
      expect(spouse?.requirement).toBe('conditional');
      expect(spouse?.conditionMet).toBe(true);
      expect(spouse?.effectiveRequirement).toBe('required');
      expect(spouse?.condition).toEqual({ type: 'applicant_married' });
      expect(spouse?.source).toEqual(RULE_MARRIED_SOURCE);
    });

    it('unmet (maritalStatus: single) -> effectiveRequirement not_applicable, conditionMet false', () => {
      const ctx = makeCtx({ category: CATEGORY_NO_REFS, maritalStatus: 'single' });
      const sections = resolveFieldPlans({
        category: CATEGORY_NO_REFS,
        formModel: FORM_MODEL,
        ctx,
        resolveValue: noopResolveValue,
      });
      const family = sections.find((s) => s.id === 'family');
      const spouse = family?.fields.find((f) => f.id === 'spouse_name');
      expect(spouse?.requirement).toBe('conditional');
      expect(spouse?.conditionMet).toBe(false);
      expect(spouse?.effectiveRequirement).toBe('not_applicable');
    });

    it('unknown (maritalStatus: null) -> requirement conditional, conditionMet null, effectiveRequirement not_applicable', () => {
      const ctx = makeCtx({ category: CATEGORY_NO_REFS, maritalStatus: null });
      const sections = resolveFieldPlans({
        category: CATEGORY_NO_REFS,
        formModel: FORM_MODEL,
        ctx,
        resolveValue: noopResolveValue,
      });
      const family = sections.find((s) => s.id === 'family');
      const spouse = family?.fields.find((f) => f.id === 'spouse_name');
      expect(spouse?.requirement).toBe('conditional');
      expect(spouse?.conditionMet).toBeNull();
      expect(spouse?.effectiveRequirement).toBe('not_applicable');
    });
  });

  describe('synthetic india_references_min field', () => {
    it('category with a references FieldRule produces the synthetic field', () => {
      const ctx = makeCtx({ category: CATEGORY_WITH_REFS });
      const sections = resolveFieldPlans({
        category: CATEGORY_WITH_REFS,
        formModel: FORM_MODEL,
        ctx,
        resolveValue: noopResolveValue,
      });
      const references = sections.find((s) => s.id === 'references');
      expect(references?.fields.length).toBe(1);
      const field = references?.fields[0];
      expect(field?.id).toBe('india_references_min');
      expect(field?.sectionId).toBe('references');
      expect(field?.appliesTo).toBeNull();
      expect(field?.present).toBe(false);
      expect(field?.value).toBeNull();
      expect(field?.verified).toBe(false);
      expect(field?.label).toContain('2');
      expect(field?.requirement).toBe('required');
      expect(field?.effectiveRequirement).toBe('required');
      expect(field?.source).toEqual(RULE_REFERENCES_SOURCE);
    });

    it('category without the rule produces no such field, even with a references FormSection present', () => {
      const ctx = makeCtx({ category: CATEGORY_NO_REFS });
      const sections = resolveFieldPlans({
        category: CATEGORY_NO_REFS,
        formModel: FORM_MODEL,
        ctx,
        resolveValue: noopResolveValue,
      });
      const references = sections.find((s) => s.id === 'references');
      expect(references).toBeDefined();
      expect(references?.fields).toEqual([]);
    });
  });

  it('resolveValue is called with the exact appliesTo string and its result is propagated verbatim', () => {
    const resolveValue = vi.fn((appliesTo: string) => {
      if (appliesTo === 'identity.surname') {
        return { value: 'Applicant', present: true, verified: true };
      }
      return { value: null, present: false, verified: false };
    });
    const ctx = makeCtx({ category: CATEGORY_NO_REFS });
    const sections = resolveFieldPlans({
      category: CATEGORY_NO_REFS,
      formModel: FORM_MODEL,
      ctx,
      resolveValue,
    });
    expect(resolveValue).toHaveBeenCalledWith('identity.surname');
    const personal = sections.find((s) => s.id === 'personal_particulars');
    const surname = personal?.fields.find((f) => f.id === 'surname');
    expect(surname?.value).toBe('Applicant');
    expect(surname?.present).toBe(true);
    expect(surname?.verified).toBe(true);
  });

  it('resolveValue is not called for a field whose appliesTo is null', () => {
    const resolveValue = vi.fn(noopResolveValue);
    const ctx = makeCtx({ category: CATEGORY_NO_REFS });
    resolveFieldPlans({
      category: CATEGORY_NO_REFS,
      formModel: FORM_MODEL,
      ctx,
      resolveValue,
    });
    // nickname (appliesTo: null) must not trigger a call; total calls must equal the count
    // of non-null-appliesTo fields across the whole form model (surname, nationality,
    // spouse_name, employer_name) -- nickname is excluded.
    expect(resolveValue).toHaveBeenCalledTimes(4);
    expect(resolveValue).not.toHaveBeenCalledWith(null);
  });

  it("SectionPlan.source equals the form model section's own source, not a field's or rule's", () => {
    const ctx = makeCtx({ category: CATEGORY_NO_REFS });
    const sections = resolveFieldPlans({
      category: CATEGORY_NO_REFS,
      formModel: FORM_MODEL,
      ctx,
      resolveValue: noopResolveValue,
    });
    const personal = sections.find((s) => s.id === 'personal_particulars');
    expect(personal?.source).toEqual(SECTION_PERSONAL_SOURCE);
    expect(personal?.source).not.toEqual(FIELD_SURNAME_SOURCE);
    expect(personal?.source).not.toEqual(RULE_NATIONALITY_SOURCE);

    const family = sections.find((s) => s.id === 'family');
    expect(family?.source).toEqual(SECTION_FAMILY_SOURCE);

    const occupation = sections.find((s) => s.id === 'occupation');
    expect(occupation?.source).toEqual(SECTION_OCCUPATION_SOURCE);

    const references = sections.find((s) => s.id === 'references');
    expect(references?.source).toEqual(SECTION_REFERENCES_SOURCE);
  });

  it('returns sections in the same order as formModel.sections', () => {
    const ctx = makeCtx({ category: CATEGORY_NO_REFS });
    const sections = resolveFieldPlans({
      category: CATEGORY_NO_REFS,
      formModel: FORM_MODEL,
      ctx,
      resolveValue: noopResolveValue,
    });
    expect(sections.map((s) => s.id)).toEqual([
      'personal_particulars',
      'family',
      'occupation',
      'references',
    ]);
  });
});
