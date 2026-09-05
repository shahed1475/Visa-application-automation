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

// Spec §11.2 — the category-specific "headline" acceptance coverage (acceptance item 11).
// Every assertion is on the plan object returned by `buildApplicationPlan`; category ids are
// hard-coded (these files are exempt from the §11.7 no-literal guard), but section ids, field
// ids, document ids and counts are derived by reading the KB in-test wherever practical.

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

/** A synthetic in-country-host `Reference` row (shape mirrors buildApplicationPlan.test.ts). */
function hostRefs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `ref-${i}`,
    applicantId: 'applicant-1',
    sortOrder: i,
    kind: 'in_country_host' as const,
    name: `Host ${i}`,
    relationship: 'friend',
    organization: null,
    phone: null,
    email: null,
    address: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));
}

describe('categories (spec §11.2)', () => {
  describe('regular.business', () => {
    const selection = syntheticSelection({ categoryId: 'regular.business', purpose: 'business' });

    it('marks business_details, family and occupation sections applicable', () => {
      const plan = buildApplicationPlan(baseInput({ selection }));
      for (const id of ['business_details', 'family', 'occupation']) {
        expect(plan.sections.find((s) => s.id === id)?.applicable).toBe(true);
      }
    });

    it('resolves the India-company business_details fields to effectiveRequirement "required"', () => {
      const plan = buildApplicationPlan(baseInput({ selection }));
      for (const fieldId of ['india_company_name', 'india_company_address', 'nature_of_business']) {
        const field = findField(plan.sections, 'business_details', fieldId);
        expect(field, fieldId).toBeDefined();
        expect(field?.effectiveRequirement, fieldId).toBe('required');
      }
    });

    it('carries an india_references_min field whose presence flips at the KB-defined count (2)', () => {
      const rule = getCategory('regular.business', kb)!.formRules.fieldRules.find(
        (r) => r.sectionId === 'references' && r.fieldId === 'india_references_min',
      );
      const count = rule?.count;
      expect(count).toBe(2);
      expect(rule?.condition).toBeUndefined();

      for (const n of [count! - 1, count!]) {
        const plan = buildApplicationPlan(
          baseInput({ applicant: syntheticApplicant({ references: hostRefs(n) }), selection }),
        );
        const field = findField(plan.sections, 'references', 'india_references_min');
        expect(field, `n=${n}`).toBeDefined();
        expect(field?.effectiveRequirement).toBe('required');
        expect(field?.value).toBe(String(n));
        expect(field?.present, `present at n=${n}`).toBe(n >= count!);
      }
    });

    it('requires the invitation_letter_indian_company document', () => {
      const plan = buildApplicationPlan(baseInput({ selection }));
      const doc = plan.documents.find((d) => d.id === 'invitation_letter_indian_company');
      expect(doc).toBeDefined();
      expect(doc?.effectiveRequirement).toBe('required');
    });
  });

  describe('regular.student', () => {
    const selection = syntheticSelection({ categoryId: 'regular.student', purpose: 'study' });

    it('makes institution name/address and course-of-study effective-required', () => {
      const plan = buildApplicationPlan(baseInput({ selection }));
      for (const fieldId of ['institution_name', 'institution_address', 'course_of_study']) {
        const field = findField(plan.sections, 'study_details', fieldId);
        expect(field, fieldId).toBeDefined();
        expect(field?.effectiveRequirement, fieldId).toBe('required');
      }
    });

    it('requires the admission-letter document', () => {
      const requiredIds = getCategory('regular.student', kb)!.requiredDocuments.map((d) => d.id);
      expect(requiredIds).toContain('admission_letter');
      const plan = buildApplicationPlan(baseInput({ selection }));
      expect(plan.documents.find((d) => d.id === 'admission_letter')?.effectiveRequirement).toBe('required');
    });
  });

  describe('regular.medical', () => {
    const selection = syntheticSelection({ categoryId: 'regular.medical', purpose: 'medical_treatment' });

    it('makes hospital name/address effective-required', () => {
      const plan = buildApplicationPlan(baseInput({ selection }));
      for (const fieldId of ['hospital_name', 'hospital_address']) {
        const field = findField(plan.sections, 'medical_details', fieldId);
        expect(field, fieldId).toBeDefined();
        expect(field?.effectiveRequirement, fieldId).toBe('required');
      }
    });

    it('requires the India hospital-letter document', () => {
      const requiredIds = getCategory('regular.medical', kb)!.requiredDocuments.map((d) => d.id);
      expect(requiredIds).toContain('hospital_letter_india');
      const plan = buildApplicationPlan(baseInput({ selection }));
      expect(plan.documents.find((d) => d.id === 'hospital_letter_india')?.effectiveRequirement).toBe(
        'required',
      );
    });
  });

  describe('regular.transit', () => {
    const selection = syntheticSelection({ categoryId: 'regular.transit', purpose: 'transit' });

    it('is minimal: business_details and study_details sections are not applicable', () => {
      const plan = buildApplicationPlan(baseInput({ selection }));
      expect(plan.sections.find((s) => s.id === 'business_details')?.applicable).toBe(false);
      expect(plan.sections.find((s) => s.id === 'study_details')?.applicable).toBe(false);
    });

    it('forces no India-company or institution fields', () => {
      const plan = buildApplicationPlan(baseInput({ selection }));
      for (const [sectionId, fieldId] of [
        ['business_details', 'india_company_name'],
        ['business_details', 'india_company_address'],
        ['study_details', 'institution_name'],
      ] as const) {
        const field = findField(plan.sections, sectionId, fieldId);
        expect(field?.effectiveRequirement, `${sectionId}.${fieldId}`).toBe('not_applicable');
      }
      expect(plan.missing.some((m) => m.id === 'india_company_name' || m.id === 'institution_name')).toBe(
        false,
      );
    });

    it('requires the onward/return-ticket document', () => {
      const plan = buildApplicationPlan(baseInput({ selection }));
      const doc = plan.documents.find((d) => d.id === 'onward_ticket_third_country');
      expect(doc).toBeDefined();
      expect(doc?.effectiveRequirement).toBe('required');
    });
  });

  describe('evisa.tourist.30d', () => {
    const selection = syntheticSelection({
      categoryId: 'evisa.tourist.30d',
      applicationMode: 'evisa',
      purpose: 'recreation',
    });

    it('has a light required-document set (bio page + photo only)', () => {
      const requiredIds = getCategory('evisa.tourist.30d', kb)!.requiredDocuments.map((d) => d.id);
      expect(requiredIds.sort()).toEqual(['passport_bio_page', 'photo'].sort());

      const plan = buildApplicationPlan(baseInput({ selection }));
      const requiredPlanIds = plan.documents
        .filter((d) => d.requirement === 'required')
        .map((d) => d.id)
        .sort();
      expect(requiredPlanIds).toEqual(['passport_bio_page', 'photo'].sort());
    });

    it('promotes the return-ticket document to effectiveRequirement "required" via the KB travelRequirements flag', () => {
      // The KB models this categorically (travelRequirements.onwardOrReturnTicket === true), not
      // as a per-application FormCondition, so there is no input-reachable "unsatisfied" branch to
      // assert here — the promotion in documentRules.ts is driven purely by this KB flag.
      expect(getCategory('evisa.tourist.30d', kb)!.travelRequirements.onwardOrReturnTicket).toBe(true);

      const plan = buildApplicationPlan(baseInput({ selection }));
      const doc = plan.documents.find((d) => d.id === 'return_ticket');
      expect(doc).toBeDefined();
      expect(doc?.requirement).toBe('optional');
      expect(doc?.effectiveRequirement).toBe('required');
    });

    it('does not promote any optional document for a category whose onwardOrReturnTicket flag is false', () => {
      // regular.tourist has onwardOrReturnTicket === false — negative control for the promotion
      // rule. Assert real engine output: with the flag off, NO optional document is ever lifted
      // to effective-required (would catch a documentRules.ts regression that promoted
      // regardless of the flag). regular.tourist does carry optional docs, so this bites.
      expect(getCategory('regular.tourist', kb)!.travelRequirements.onwardOrReturnTicket).toBe(false);
      const plan = buildApplicationPlan(baseInput());
      const optionalDocs = plan.documents.filter((d) => d.requirement === 'optional');
      expect(optionalDocs.length).toBeGreaterThan(0);
      expect(optionalDocs.every((d) => d.effectiveRequirement === 'optional')).toBe(true);
    });
  });
});
