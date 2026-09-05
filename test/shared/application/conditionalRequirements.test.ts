import { describe, expect, it } from 'vitest';
import { buildApplicationPlan } from '../../../src/shared/application/buildApplicationPlan.js';
import { loadKnowledgeBase } from '../../../src/shared/visa-kb/loader.js';
import { getCategory } from '../../../src/shared/visa-kb/queries.js';
import type { BuildApplicationPlanInput, FieldPlan } from '../../../src/shared/application/types.js';
import {
  emptyDocumentCoverage,
  syntheticApplicant,
  syntheticSelection,
} from '../../helpers/applicationFixtures.js';

// Spec §11.3 — conditional-requirement resolution (acceptance item 12). Asserted on the plan
// object: married -> spouse required; minor -> guardian required; a non-auto-evaluable
// (`custom`) condition -> conditionMet null, kept as a review item, never gating.

const kb = loadKnowledgeBase();
const NOW = new Date('2026-09-05T00:00:00.000Z');

function baseInput(overrides?: Partial<BuildApplicationPlanInput>): BuildApplicationPlanInput {
  return {
    applicant: syntheticApplicant(),
    documentCoverage: emptyDocumentCoverage(),
    selection: syntheticSelection(),
    applicationValues: {},
    kb,
    now: NOW,
    ...overrides,
  };
}

function findField(
  sections: ReturnType<typeof buildApplicationPlan>['sections'],
  sectionId: string,
  fieldId: string,
): FieldPlan | undefined {
  return sections.find((s) => s.id === sectionId)?.fields.find((f) => f.id === fieldId);
}

describe('conditional requirements (spec §11.3)', () => {
  describe('marital status -> spouse fields', () => {
    it('married applicant -> spouse_name effectiveRequirement "required"', () => {
      // The synthetic applicant is married by default; assert the driving condition is real.
      const rule = getCategory('regular.tourist', kb)!.formRules.fieldRules.find(
        (r) => r.sectionId === 'family' && r.fieldId === 'spouse_name',
      );
      expect(rule?.condition?.type).toBe('applicant_married');

      const plan = buildApplicationPlan(baseInput());
      const spouse = findField(plan.sections, 'family', 'spouse_name');
      expect(spouse?.requirement).toBe('conditional');
      expect(spouse?.conditionMet).toBe(true);
      expect(spouse?.effectiveRequirement).toBe('required');
    });

    it('single applicant -> spouse_name not_applicable and absent from missing', () => {
      const applicant = syntheticApplicant({
        family: { ...syntheticApplicant().family, maritalStatus: 'single', spouseName: null },
      });
      const plan = buildApplicationPlan(baseInput({ applicant }));
      const spouse = findField(plan.sections, 'family', 'spouse_name');
      expect(spouse?.requirement).toBe('conditional');
      expect(spouse?.conditionMet).toBe(false);
      expect(spouse?.effectiveRequirement).toBe('not_applicable');
      expect(plan.missing.some((m) => m.id === 'spouse_name')).toBe(false);
      expect(plan.readyForAutomation.blockers.some((b) => /spouse/i.test(b.text))).toBe(false);
    });
  });

  describe('age < 18 -> guardian / father-name field', () => {
    // regular.tourist carries the `age_lt: 18` guardian rule on family.father_name.
    const selection = syntheticSelection({ categoryId: 'regular.tourist', intendedArrivalDate: '2027-01-15' });

    it('minor at intendedArrivalDate -> father_name required', () => {
      const rule = getCategory('regular.tourist', kb)!.formRules.fieldRules.find(
        (r) => r.sectionId === 'family' && r.fieldId === 'father_name',
      );
      expect(rule?.condition).toEqual({ type: 'age_lt', value: 18 });

      const applicant = syntheticApplicant({
        identity: { ...syntheticApplicant().identity, dateOfBirth: '2012-06-01' }, // age 14 at arrival
      });
      const plan = buildApplicationPlan(baseInput({ applicant, selection }));
      const father = findField(plan.sections, 'family', 'father_name');
      expect(father?.requirement).toBe('conditional');
      expect(father?.conditionMet).toBe(true);
      expect(father?.effectiveRequirement).toBe('required');
    });

    it('adult at intendedArrivalDate -> father_name not forced by the conditional', () => {
      // Default synthetic applicant DOB 1990-05-20 -> comfortably an adult at arrival.
      const plan = buildApplicationPlan(baseInput({ selection }));
      const father = findField(plan.sections, 'family', 'father_name');
      expect(father?.conditionMet).toBe(false);
      expect(father?.effectiveRequirement).toBe('not_applicable');
      expect(plan.missing.some((m) => m.id === 'father_name')).toBe(false);
    });
  });

  describe('non-auto-evaluable ("custom") condition', () => {
    // regular.business carries a conditional document gated on a `custom` condition
    // ("if requested by the mission"), which the engine can never auto-evaluate.
    const selection = syntheticSelection({ categoryId: 'regular.business', purpose: 'business' });

    it('resolves conditionMet null, stays a review item, and never gates readiness', () => {
      const kbDoc = getCategory('regular.business', kb)!.conditionalDocuments.find(
        (d) => d.condition.type === 'custom',
      );
      expect(kbDoc).toBeDefined();
      const docId = kbDoc!.id;

      const plan = buildApplicationPlan(baseInput({ selection }));
      const doc = plan.documents.find((d) => d.id === docId);
      expect(doc).toBeDefined();
      expect(doc?.requirement).toBe('conditional');
      expect(doc?.condition?.type).toBe('custom');
      expect(doc?.conditionMet).toBeNull();
      // `effectiveRequirement` is the 3-value gating enum (required | optional | not_applicable);
      // an unknown conditional is never promoted to `required`. The item stays visibly a
      // conditional/review item via `requirement` + `conditionMet: null` (spec acceptance item 6).
      expect(doc?.effectiveRequirement).toBe('not_applicable');

      expect(plan.missing.some((m) => m.id === docId)).toBe(false);
      expect(plan.readyForAutomation.blockers.some((b) => b.text.includes(kbDoc!.label))).toBe(false);
    });
  });
});
