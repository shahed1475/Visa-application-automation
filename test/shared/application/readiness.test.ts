import { describe, expect, it } from 'vitest';
import { computeMissing, computeReadiness, computeVerification } from '../../../src/shared/application/readiness.js';
import type {
  DocumentPlan,
  EligibilityConditionView,
  EligibilityPlan,
  FieldPlan,
  SectionPlan,
  Warning,
} from '../../../src/shared/application/types.js';
import type { Source } from '../../../src/shared/visa-kb/schema.js';

// ---- fixtures -----------------------------------------------------------------------------

const SOURCE: Source = {
  officialUrl: 'https://example.gov.in/source',
  retrievedAt: '2026-01-01',
  confidence: 'official_derived',
};

function makeField(over: Partial<FieldPlan> = {}): FieldPlan {
  return {
    id: 'field_1',
    label: 'Field One',
    sectionId: 'section_1',
    requirement: 'required',
    condition: null,
    conditionMet: null,
    effectiveRequirement: 'required',
    appliesTo: 'section_1.field_1',
    value: null,
    present: false,
    verified: false,
    source: SOURCE,
    ...over,
  };
}

function makeDocument(over: Partial<DocumentPlan> = {}): DocumentPlan {
  return {
    id: 'doc_1',
    label: 'Document One',
    requirement: 'required',
    condition: null,
    conditionMet: null,
    effectiveRequirement: 'required',
    uploaded: false,
    matchedDocumentId: null,
    source: SOURCE,
    ...over,
  };
}

function makeSection(id: string, fields: FieldPlan[], over: Partial<SectionPlan> = {}): SectionPlan {
  return {
    id,
    label: `Section ${id}`,
    applicable: true,
    source: SOURCE,
    fields,
    ...over,
  };
}

function makeEligibility(over: Partial<EligibilityPlan> = {}): EligibilityPlan {
  return {
    status: 'eligible',
    conditions: [],
    unmetConditions: [],
    warnings: [],
    basis: null,
    source: SOURCE,
    ...over,
  };
}

function makeConditionView(over: Partial<EligibilityConditionView> = {}): EligibilityConditionView {
  return {
    condition: { type: 'min_age', value: 18 },
    conditionMet: false,
    text: 'Unmet condition text',
    source: SOURCE,
    ...over,
  };
}

function makeWarning(over: Partial<Warning> = {}): Warning {
  return { text: 'A warning', severity: 'blocker', source: SOURCE, ...over };
}

// ---- computeMissing -------------------------------------------------------------------------

describe('computeMissing', () => {
  it('a required, absent field produces one MissingItem with the exact expected shape', () => {
    const field = makeField({
      id: 'surname',
      label: 'Surname',
      sectionId: 'personal_particulars',
      appliesTo: 'identity.surname',
      present: false,
    });
    const section = makeSection('personal_particulars', [field]);
    const missing = computeMissing([section], []);
    expect(missing).toEqual([
      {
        kind: 'field',
        id: 'surname',
        label: 'Surname',
        sectionId: 'personal_particulars',
        appliesTo: 'identity.surname',
        source: SOURCE,
      },
    ]);
  });

  it('a required, absent document produces one MissingItem with no sectionId/appliesTo keys', () => {
    const doc = makeDocument({ id: 'passport_copy', label: 'Passport copy', uploaded: false });
    const missing = computeMissing([], [doc]);
    expect(missing).toEqual([{ kind: 'document', id: 'passport_copy', label: 'Passport copy', source: SOURCE }]);
    expect(missing[0]).not.toHaveProperty('sectionId');
    expect(missing[0]).not.toHaveProperty('appliesTo');
  });

  it('a required, present field is not in missing', () => {
    const field = makeField({ present: true });
    const section = makeSection('s', [field]);
    expect(computeMissing([section], [])).toEqual([]);
  });

  it('a required, uploaded document is not in missing', () => {
    const doc = makeDocument({ uploaded: true });
    expect(computeMissing([], [doc])).toEqual([]);
  });

  it('an optional field, absent, is not in missing', () => {
    const field = makeField({ requirement: 'optional', effectiveRequirement: 'optional', present: false });
    const section = makeSection('s', [field]);
    expect(computeMissing([section], [])).toEqual([]);
  });

  it('a conditional field with conditionMet:null (effectiveRequirement:not_applicable) is not in missing regardless of present', () => {
    const notPresent = makeField({
      requirement: 'conditional',
      conditionMet: null,
      effectiveRequirement: 'not_applicable',
      present: false,
    });
    const present = makeField({
      id: 'field_2',
      requirement: 'conditional',
      conditionMet: null,
      effectiveRequirement: 'not_applicable',
      present: true,
    });
    const section = makeSection('s', [notPresent, present]);
    expect(computeMissing([section], [])).toEqual([]);
  });

  it('dedup: a section with two FieldPlans sharing the same id (regular.business duplicate case) yields exactly one MissingItem', () => {
    const dup1 = makeField({ id: 'india_references_min', present: false });
    const dup2 = makeField({ id: 'india_references_min', present: false });
    const section = makeSection('references', [dup1, dup2]);
    const missing = computeMissing([section], []);
    expect(missing.length).toBe(1);
    expect(missing[0]?.id).toBe('india_references_min');
  });
});

// ---- computeVerification --------------------------------------------------------------------

describe('computeVerification', () => {
  it('two required fields, one present && verified, one not -> ratio 0.5, label partial', () => {
    const verified = makeField({ id: 'a', present: true, verified: true });
    const unverified = makeField({ id: 'b', present: true, verified: false });
    const section = makeSection('s', [verified, unverified]);
    const rollup = computeVerification([section]);
    expect(rollup.requiredTotal).toBe(2);
    expect(rollup.requiredVerified).toBe(1);
    expect(rollup.ratio).toBe(0.5);
    expect(rollup.label).toBe('partial');
  });

  it('all required fields verified -> label verified, ratio 1', () => {
    const a = makeField({ id: 'a', present: true, verified: true });
    const b = makeField({ id: 'b', present: true, verified: true });
    const section = makeSection('s', [a, b]);
    const rollup = computeVerification([section]);
    expect(rollup.ratio).toBe(1);
    expect(rollup.label).toBe('verified');
  });

  it('zero required fields verified (requiredTotal > 0) -> label unverified', () => {
    const a = makeField({ id: 'a', present: false, verified: false });
    const section = makeSection('s', [a]);
    const rollup = computeVerification([section]);
    expect(rollup.requiredVerified).toBe(0);
    expect(rollup.requiredTotal).toBe(1);
    expect(rollup.label).toBe('unverified');
  });

  it('requiredTotal === 0 -> ratio 0, label unverified (not NaN)', () => {
    const optional = makeField({ requirement: 'optional', effectiveRequirement: 'optional' });
    const section = makeSection('s', [optional]);
    const rollup = computeVerification([section]);
    expect(rollup.requiredTotal).toBe(0);
    expect(rollup.ratio).toBe(0);
    expect(rollup.label).toBe('unverified');
  });

  it('optional/not_applicable fields never counted toward requiredTotal', () => {
    const required = makeField({ id: 'a', present: true, verified: true });
    const optional = makeField({ id: 'b', requirement: 'optional', effectiveRequirement: 'optional' });
    const notApplicable = makeField({
      id: 'c',
      requirement: 'conditional',
      conditionMet: null,
      effectiveRequirement: 'not_applicable',
    });
    const section = makeSection('s', [required, optional, notApplicable]);
    const rollup = computeVerification([section]);
    expect(rollup.requiredTotal).toBe(1);
  });

  it('bySection includes a section with 0 required fields as { verified: 0, total: 0 }', () => {
    const optional = makeField({ requirement: 'optional', effectiveRequirement: 'optional' });
    const section = makeSection('empty_section', [optional]);
    const rollup = computeVerification([section]);
    expect(rollup.bySection.empty_section).toEqual({ verified: 0, total: 0 });
  });

  it('dedup: the duplicate-id fixture counts the field once, not twice', () => {
    const dup1 = makeField({ id: 'india_references_min', present: true, verified: true });
    const dup2 = makeField({ id: 'india_references_min', present: true, verified: true });
    const section = makeSection('references', [dup1, dup2]);
    const rollup = computeVerification([section]);
    expect(rollup.requiredTotal).toBe(1);
    expect(rollup.requiredVerified).toBe(1);
  });
});

// ---- computeReadiness ------------------------------------------------------------------------

describe('computeReadiness', () => {
  it('fully satisfied -> ready:true, blockers:[]', () => {
    const eligibility = makeEligibility({ status: 'eligible', unmetConditions: [] });
    const result = computeReadiness(eligibility, [], []);
    expect(result).toEqual({ ready: true, blockers: [] });
  });

  it("eligibility.status: 'ineligible' -> ready:false, exact ineligible text", () => {
    const eligibility = makeEligibility({ status: 'ineligible' });
    const result = computeReadiness(eligibility, [], []);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      {
        kind: 'eligibility',
        text: 'Not eligible for this visa category based on the recorded eligibility rules.',
        source: SOURCE,
      },
    ]);
  });

  it("eligibility.status: 'not_offered' -> the not_offered text", () => {
    const eligibility = makeEligibility({ status: 'not_offered' });
    const result = computeReadiness(eligibility, [], []);
    expect(result.blockers[0]?.text).toBe('This visa category is not offered for this nationality.');
  });

  it("eligibility.status: 'unknown' with a reason set -> blocker text equals the reason verbatim", () => {
    const eligibility = makeEligibility({ status: 'unknown', reason: 'Nationality not recognized in the KB.' });
    const result = computeReadiness(eligibility, [], []);
    expect(result.blockers[0]?.text).toBe('Nationality not recognized in the KB.');
  });

  it('a non-empty unmetConditions (status still eligible) -> one blocker per unmet condition', () => {
    const view1 = makeConditionView({ text: 'Condition A unmet', source: SOURCE });
    const view2 = makeConditionView({ text: 'Condition B unmet', source: SOURCE });
    const eligibility = makeEligibility({ status: 'eligible', unmetConditions: [view1, view2] });
    const result = computeReadiness(eligibility, [], []);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      { kind: 'eligibility', text: 'Condition A unmet', source: SOURCE },
      { kind: 'eligibility', text: 'Condition B unmet', source: SOURCE },
    ]);
  });

  it('a missing field item -> ready:false, a field blocker with "<label> is required"', () => {
    const eligibility = makeEligibility();
    const missing = [
      { kind: 'field' as const, id: 'surname', label: 'Surname', sectionId: 's', appliesTo: 'identity.surname', source: SOURCE },
    ];
    const result = computeReadiness(eligibility, missing, []);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([{ kind: 'field', text: 'Surname is required', source: SOURCE }]);
  });

  it('a missing document item -> ready:false, a document blocker with "<label> is required"', () => {
    const eligibility = makeEligibility();
    const missing = [{ kind: 'document' as const, id: 'passport_copy', label: 'Passport copy', source: SOURCE }];
    const result = computeReadiness(eligibility, missing, []);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([{ kind: 'document', text: 'Passport copy is required', source: SOURCE }]);
  });

  it('a blocker-severity warning -> ready:false, a warning blocker', () => {
    const eligibility = makeEligibility();
    const warning = makeWarning({ severity: 'blocker', text: 'Stale KB pin', source: SOURCE });
    const result = computeReadiness(eligibility, [], [warning]);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([{ kind: 'warning', text: 'Stale KB pin', source: SOURCE }]);
  });

  it('an info or warn severity warning produces no blocker and does not affect ready', () => {
    const eligibility = makeEligibility();
    const infoWarning = makeWarning({ severity: 'info' });
    const warnWarning = makeWarning({ severity: 'warn' });
    const result = computeReadiness(eligibility, [], [infoWarning, warnWarning]);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('verification is not part of readiness: a 0.5/0 ratio does not make ready:false', () => {
    const verified = makeField({ id: 'a', present: true, verified: true });
    const unverified = makeField({ id: 'b', present: true, verified: false });
    const section = makeSection('s', [verified, unverified]);
    const rollup = computeVerification([section]);
    expect(rollup.ratio).toBe(0.5);

    const eligibility = makeEligibility();
    // Both fields are present, so computeMissing (not exercised directly here) would report
    // nothing missing for this section; readiness is satisfied even though verification is
    // only partial -- computeReadiness doesn't even take verification as a parameter.
    const result = computeReadiness(eligibility, [], []);
    expect(result.ready).toBe(true);
  });

  it('multiple simultaneous blocker sources -> one entry per source, ready:false', () => {
    const eligibility = makeEligibility({ status: 'ineligible' });
    const missing = [
      { kind: 'field' as const, id: 'surname', label: 'Surname', sectionId: 's', appliesTo: 'identity.surname', source: SOURCE },
    ];
    const result = computeReadiness(eligibility, missing, []);
    expect(result.ready).toBe(false);
    expect(result.blockers.length).toBe(2);
    expect(result.blockers[0]?.kind).toBe('eligibility');
    expect(result.blockers[1]?.kind).toBe('field');
  });
});
