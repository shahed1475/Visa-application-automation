import { describe, expect, it } from 'vitest';
import { matchDocument, resolveDocumentPlans } from '../../../src/shared/application/documentRules.js';
import type { ConditionContext } from '../../../src/shared/application/conditions.js';
import type { DocumentCoverage, DocumentCoverageEntry, FlatApplicant, Selection } from '../../../src/shared/application/types.js';
import type { Source, VisaCategory } from '../../../src/shared/visa-kb/schema.js';

// ---- fixtures -----------------------------------------------------------------------------

function src(tag: string): Source {
  return {
    officialUrl: `https://example.gov.in/${tag}`,
    retrievedAt: '2026-01-01',
    confidence: 'official_derived',
  };
}

const CATEGORY_SOURCE = src('category');
const MARRIAGE_CERT_SOURCE = src('doc-marriage-cert');

function makeCategory(overrides: {
  requiredDocuments?: VisaCategory['requiredDocuments'];
  optionalDocuments?: VisaCategory['optionalDocuments'];
  conditionalDocuments?: VisaCategory['conditionalDocuments'];
  travelRequirements?: VisaCategory['travelRequirements'];
}): VisaCategory {
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
    travelRequirements: overrides.travelRequirements ?? {},
    requiredDocuments: overrides.requiredDocuments ?? [],
    optionalDocuments: overrides.optionalDocuments ?? [],
    conditionalDocuments: overrides.conditionalDocuments ?? [],
    formRules: { applicableSections: [], fieldRules: [] },
    specialConditions: [],
    restrictions: [],
    source: CATEGORY_SOURCE,
    lastVerified: '2026-02-02',
  };
}

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

function coverageEntry(overrides: Partial<DocumentCoverageEntry>): DocumentCoverageEntry {
  return {
    id: 'd1',
    kind: 'unknown',
    originalName: null,
    fields: [],
    ...overrides,
  };
}

function makeCoverage(documents: DocumentCoverageEntry[]): DocumentCoverage {
  return { fieldCoverage: {}, documents };
}

// ---- matchDocument --------------------------------------------------------------------------

describe('matchDocument', () => {
  it('Rule A: kind "passport" matches KB doc id starting with "passport", even with no textual overlap', () => {
    const uploaded = [coverageEntry({ id: 'd1', kind: 'passport', originalName: 'img_0001.jpg' })];
    const result = matchDocument({ id: 'passport', label: 'Passport bio page' }, uploaded);
    expect(result).toBe('d1');
  });

  it('Rule B: token overlap of length >= 4 between originalName and kb id matches', () => {
    const uploaded = [coverageEntry({ id: 'd1', kind: 'unknown', originalName: 'passport-scan.jpg' })];
    const result = matchDocument({ id: 'passport', label: 'Passport bio page' }, uploaded);
    expect(result).toBe('d1');
  });

  it('no match when neither rule applies', () => {
    const uploaded = [coverageEntry({ id: 'd2', kind: 'unknown', originalName: 'random.png' })];
    const result = matchDocument({ id: 'invitation_letter_indian_company', label: 'Invitation letter' }, uploaded);
    expect(result).toBeNull();
  });

  it('a shared token shorter than 4 characters does not count as a match', () => {
    // "letter" (originalName) vs "invitation_letter" kb id would share "letter" (>=4, matches);
    // to prove the threshold, use a doc whose only shared token is 3 chars or fewer.
    const uploaded = [coverageEntry({ id: 'd3', kind: 'unknown', originalName: 'itr-doc-2024.pdf' })];
    const result = matchDocument({ id: 'itr_copy', label: 'ITR copy' }, uploaded);
    // "itr" is 3 chars -- shared token length < 4, must NOT match despite the overlap.
    expect(result).toBeNull();
  });

  it('returns the first matching entry id, iterating uploadedDocs in array order', () => {
    const uploaded = [
      coverageEntry({ id: 'first', kind: 'unknown', originalName: 'random.png' }),
      coverageEntry({ id: 'second', kind: 'passport', originalName: 'img.jpg' }),
      coverageEntry({ id: 'third', kind: 'passport', originalName: 'img2.jpg' }),
    ];
    const result = matchDocument({ id: 'passport', label: 'Passport bio page' }, uploaded);
    expect(result).toBe('second');
  });

  it('originalName: null skips Rule B for that doc but Rule A can still apply', () => {
    const uploaded = [coverageEntry({ id: 'd1', kind: 'passport', originalName: null })];
    const result = matchDocument({ id: 'passport', label: 'Passport' }, uploaded);
    expect(result).toBe('d1');
  });
});

// ---- resolveDocumentPlans -------------------------------------------------------------------

describe('resolveDocumentPlans', () => {
  const REQUIRED_DOC = { id: 'passport', label: 'Passport bio page' };
  const OPTIONAL_DOC = { id: 'cover_letter', label: 'Cover letter' };
  const CONDITIONAL_MARRIAGE_DOC = {
    id: 'marriage_certificate',
    label: 'Marriage certificate',
    condition: { type: 'applicant_married' as const },
    source: MARRIAGE_CERT_SOURCE,
  };

  it('a required doc with no matching uploaded document -> required, uploaded:false, matchedDocumentId:null', () => {
    const category = makeCategory({ requiredDocuments: [REQUIRED_DOC] });
    const ctx = makeCtx({ category });
    const plans = resolveDocumentPlans({ category, ctx, documentCoverage: makeCoverage([]) });
    const plan = plans.find((p) => p.id === 'passport');
    expect(plan?.requirement).toBe('required');
    expect(plan?.effectiveRequirement).toBe('required');
    expect(plan?.condition).toBeNull();
    expect(plan?.conditionMet).toBeNull();
    expect(plan?.uploaded).toBe(false);
    expect(plan?.matchedDocumentId).toBeNull();
    expect(plan?.source).toEqual(CATEGORY_SOURCE);
  });

  it('conditional doc, condition met -> effectiveRequirement required, conditionMet true, source is the doc\'s own source', () => {
    const category = makeCategory({ conditionalDocuments: [CONDITIONAL_MARRIAGE_DOC] });
    const ctx = makeCtx({ category, maritalStatus: 'married' });
    const plans = resolveDocumentPlans({ category, ctx, documentCoverage: makeCoverage([]) });
    const plan = plans.find((p) => p.id === 'marriage_certificate');
    expect(plan?.requirement).toBe('conditional');
    expect(plan?.conditionMet).toBe(true);
    expect(plan?.effectiveRequirement).toBe('required');
    expect(plan?.source).toEqual(MARRIAGE_CERT_SOURCE);
    expect(plan?.source).not.toEqual(CATEGORY_SOURCE);
  });

  it('conditional doc, condition unknown (null) -> conditionMet:null, effectiveRequirement:not_applicable', () => {
    const category = makeCategory({ conditionalDocuments: [CONDITIONAL_MARRIAGE_DOC] });
    const ctx = makeCtx({ category, maritalStatus: null });
    const plans = resolveDocumentPlans({ category, ctx, documentCoverage: makeCoverage([]) });
    const plan = plans.find((p) => p.id === 'marriage_certificate');
    expect(plan?.conditionMet).toBeNull();
    expect(plan?.effectiveRequirement).toBe('not_applicable');
  });

  it('conditional doc, condition evaluates false -> conditionMet:false, effectiveRequirement:not_applicable (distinguishable from null case)', () => {
    const category = makeCategory({ conditionalDocuments: [CONDITIONAL_MARRIAGE_DOC] });
    const ctx = makeCtx({ category, maritalStatus: 'single' });
    const plans = resolveDocumentPlans({ category, ctx, documentCoverage: makeCoverage([]) });
    const plan = plans.find((p) => p.id === 'marriage_certificate');
    expect(plan?.conditionMet).toBe(false);
    expect(plan?.effectiveRequirement).toBe('not_applicable');
  });

  describe('return-ticket promotion', () => {
    it('conditional ticket doc whose own condition is false/null is still promoted to required when onwardOrReturnTicket:true', () => {
      const category = makeCategory({
        conditionalDocuments: [
          {
            id: 'onward_return_ticket',
            label: 'Onward or return ticket',
            condition: { type: 'applicant_married' as const },
            source: MARRIAGE_CERT_SOURCE,
          },
        ],
        travelRequirements: { onwardOrReturnTicket: true },
      });
      const ctx = makeCtx({ category, maritalStatus: null });
      const plans = resolveDocumentPlans({ category, ctx, documentCoverage: makeCoverage([]) });
      const plan = plans.find((p) => p.id === 'onward_return_ticket');
      expect(plan?.effectiveRequirement).toBe('required');
      // promotion is additive -- it must not rewrite the condition's own truth value
      expect(plan?.conditionMet).toBeNull();
      expect(plan?.condition).toEqual({ type: 'applicant_married' });
      expect(plan?.requirement).toBe('conditional');
    });

    it('optionalDocuments-sourced ticket doc is promoted to required (requirement itself stays optional)', () => {
      const category = makeCategory({
        optionalDocuments: [{ id: 'return_ticket_copy', label: 'Return ticket copy' }],
        travelRequirements: { onwardOrReturnTicket: true },
      });
      const ctx = makeCtx({ category });
      const plans = resolveDocumentPlans({ category, ctx, documentCoverage: makeCoverage([]) });
      const plan = plans.find((p) => p.id === 'return_ticket_copy');
      expect(plan?.requirement).toBe('optional');
      expect(plan?.effectiveRequirement).toBe('required');
    });

    it('control: onwardOrReturnTicket false/unset -> no promotion, ticket doc keeps its own base effective requirement', () => {
      const category = makeCategory({
        optionalDocuments: [{ id: 'return_ticket_copy', label: 'Return ticket copy' }],
        travelRequirements: { onwardOrReturnTicket: false },
      });
      const ctx = makeCtx({ category });
      const plans = resolveDocumentPlans({ category, ctx, documentCoverage: makeCoverage([]) });
      const plan = plans.find((p) => p.id === 'return_ticket_copy');
      expect(plan?.effectiveRequirement).toBe('optional');
    });

    it('a required-list ticket doc needs no promotion and is unaffected', () => {
      const category = makeCategory({
        requiredDocuments: [{ id: 'onward_ticket', label: 'Onward ticket' }],
        travelRequirements: { onwardOrReturnTicket: true },
      });
      const ctx = makeCtx({ category });
      const plans = resolveDocumentPlans({ category, ctx, documentCoverage: makeCoverage([]) });
      const plan = plans.find((p) => p.id === 'onward_ticket');
      expect(plan?.requirement).toBe('required');
      expect(plan?.effectiveRequirement).toBe('required');
    });
  });

  it('output order: required, then optional, then conditional', () => {
    const category = makeCategory({
      requiredDocuments: [REQUIRED_DOC],
      optionalDocuments: [OPTIONAL_DOC],
      conditionalDocuments: [CONDITIONAL_MARRIAGE_DOC],
    });
    const ctx = makeCtx({ category });
    const plans = resolveDocumentPlans({ category, ctx, documentCoverage: makeCoverage([]) });
    expect(plans.map((p) => p.id)).toEqual(['passport', 'cover_letter', 'marriage_certificate']);
  });

  it('uploaded/matchedDocumentId are populated via matchDocument against documentCoverage.documents', () => {
    const category = makeCategory({ requiredDocuments: [REQUIRED_DOC] });
    const ctx = makeCtx({ category });
    const coverage = makeCoverage([coverageEntry({ id: 'up1', kind: 'passport', originalName: 'scan.jpg' })]);
    const plans = resolveDocumentPlans({ category, ctx, documentCoverage: coverage });
    const plan = plans.find((p) => p.id === 'passport');
    expect(plan?.uploaded).toBe(true);
    expect(plan?.matchedDocumentId).toBe('up1');
  });
});
