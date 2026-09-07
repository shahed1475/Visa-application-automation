import { describe, expect, it } from 'vitest';
import { buildApplicationPlan } from '../../../src/shared/application/buildApplicationPlan.js';
import { loadKnowledgeBase } from '../../../src/shared/visa-kb/loader.js';
import { getCategory } from '../../../src/shared/visa-kb/queries.js';
import type { BuildApplicationPlanInput, FieldPlan } from '../../../src/shared/application/types.js';
import {
  coverageWith,
  emptyDocumentCoverage,
  syntheticApplicant,
  syntheticSelection,
} from '../../helpers/applicationFixtures.js';

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

function findField(sections: ReturnType<typeof buildApplicationPlan>['sections'], sectionId: string, fieldId: string): FieldPlan | undefined {
  return sections.find((s) => s.id === sectionId)?.fields.find((f) => f.id === fieldId);
}

describe('buildApplicationPlan', () => {
  it('builds a full plan for regular.tourist with the synthetic applicant', () => {
    const plan = buildApplicationPlan(baseInput());

    expect(plan.category?.id).toBe('regular.tourist');

    const familySection = plan.sections.find((s) => s.id === 'family');
    expect(familySection?.applicable).toBe(true);

    const businessSection = plan.sections.find((s) => s.id === 'business_details');
    expect(businessSection?.applicable).toBe(false);

    const category = getCategory('regular.tourist', kb);
    expect(category).not.toBeNull();
    const requiredIds = category!.requiredDocuments.map((d) => d.id);
    expect(plan.documents.length).toBeGreaterThanOrEqual(requiredIds.length);
    for (const id of requiredIds) {
      const docPlan = plan.documents.find((d) => d.id === id);
      expect(docPlan).toBeDefined();
      expect(docPlan?.requirement).toBe('required');
    }

    expect(plan.eligibility.status).toBe('eligible');
    expect(plan.eligibility.unmetConditions.length).toBe(0);

    expect(plan.provenance.kbVersion).toBe(kb.meta.kbVersion);
    expect(plan.provenance.schemaVersion).toBe(kb.meta.schemaVersion);
  });

  it('is deterministic across two calls with the same now', () => {
    const input = baseInput();
    const planA = buildApplicationPlan(input);
    const planB = buildApplicationPlan(input);
    expect(planA).toEqual(planB);
  });

  it('returns the exact unknown-category shape when categoryId is not found', () => {
    const input = baseInput({ selection: syntheticSelection({ categoryId: 'bogus.does_not_exist' }) });
    const plan = buildApplicationPlan(input);

    expect(plan.category).toBeNull();
    expect(plan.eligibility.status).toBe('unknown');
    expect(plan.sections).toEqual([]);
    expect(plan.documents).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.readyForAutomation).toEqual({
      ready: false,
      blockers: [{ kind: 'eligibility', text: 'unknown visa category', source: null }],
    });
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0]?.severity).toBe('warn');
  });

  it('fills the synthetic india_references_min field by counting in_country_host references', () => {
    const bizCategory = getCategory('regular.business', kb);
    expect(bizCategory).not.toBeNull();
    const rule = bizCategory!.formRules.fieldRules.find(
      (r) => r.sectionId === 'references' && r.fieldId === 'india_references_min',
    );
    expect(rule?.count).toBe(2);

    const counts = [0, 1, 2];
    for (const n of counts) {
      const applicant = syntheticApplicant({
        references: Array.from({ length: n }, (_, i) => ({
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
        })),
      });
      const plan = buildApplicationPlan(
        baseInput({ applicant, selection: syntheticSelection({ categoryId: 'regular.business' }) }),
      );
      const field = findField(plan.sections, 'references', 'india_references_min');
      expect(field).toBeDefined();
      expect(field?.value).toBe(String(n));
      expect(field?.present).toBe(n >= 2);
      expect(field?.verified).toBe(false);
    }
  });

  it('honors verification from fieldMeta', () => {
    const applicant = syntheticApplicant({
      fieldMeta: [
        {
          id: 'fm-1',
          applicantId: 'applicant-1',
          fieldPath: 'identity.religion',
          source: 'manual',
          confidence: null,
          rawValue: null,
          verified: true,
          verifiedAt: '2026-01-01T00:00:00.000Z',
          documentId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const plan = buildApplicationPlan(baseInput({ applicant }));
    const field = findField(plan.sections, 'personal_particulars', 'religion');
    expect(field?.present).toBe(true);
    expect(field?.verified).toBe(true);
  });

  it('honors verification from documentCoverage.fieldCoverage', () => {
    const plan = buildApplicationPlan(
      baseInput({ documentCoverage: coverageWith(['identity.education']) }),
    );
    const field = findField(plan.sections, 'personal_particulars', 'education');
    expect(field?.verified).toBe(true);
  });

  it('computes real missing/verification/readyForAutomation values for the found-category path', () => {
    const plan = buildApplicationPlan(baseInput());

    // No documentCoverage was supplied, so every required document is missing.
    const category = getCategory('regular.tourist', kb)!;
    const missingDocIds = plan.missing.filter((m) => m.kind === 'document').map((m) => m.id);
    expect(missingDocIds.sort()).toEqual(category.requiredDocuments.map((d) => d.id).sort());

    // regular.tourist has no india_references_min FieldRule (unlike regular.business), so that
    // synthetic field never appears here at all.
    const missingFieldIds = plan.missing.filter((m) => m.kind === 'field').map((m) => m.id);
    expect(missingFieldIds).not.toContain('india_references_min');

    // The synthetic applicant fully populates the six 1:1 profile sections and has a
    // references row, so the "satisfied by multiple mapped profile fields" block-style fields
    // (appliesTo: null, standardBlock: true -- standard_personal_block/standard_passport_block/
    // standard_address_block/home_country_reference) all resolve present:true here and must NOT
    // appear in missing (buildApplicationPlan.ts's BLOCK_FIELD_PRESENCE table). But
    // `baseInput()` leaves `applicationValues` empty, so the `application.*`-backed required
    // fields of regular.tourist's visa_details/previous_visits sections are still genuinely
    // missing -- exactly these four, no more, no less.
    expect(missingFieldIds.sort()).toEqual(
      ['intended_arrival_date', 'port_of_arrival', 'purpose', 'visited_india_before'].sort(),
    );
    expect(missingFieldIds).not.toContain('standard_personal_block');
    expect(missingFieldIds).not.toContain('standard_passport_block');
    expect(missingFieldIds).not.toContain('standard_address_block');
    expect(missingFieldIds).not.toContain('home_country_reference');

    // Verification: nothing is ever verified in this fixture (fieldMeta: [], empty document
    // coverage), so every required field's `verified` is false.
    expect(plan.verification.requiredTotal).toBeGreaterThan(0);
    expect(plan.verification.requiredVerified).toBe(0);
    expect(plan.verification.ratio).toBe(0);
    expect(plan.verification.label).toBe('unverified');

    // Readiness: eligibility is 'eligible' with no unmet conditions (asserted above) and there
    // are no plan-level warnings for the found-category path, so every blocker traces back to a
    // missing required field/document -- one blocker per `missing` entry, in lock-step.
    expect(plan.readyForAutomation.ready).toBe(false);
    expect(plan.readyForAutomation.blockers.length).toBe(plan.missing.length);
    expect(plan.readyForAutomation.blockers.every((b) => b.kind === 'field' || b.kind === 'document')).toBe(true);
  });

  it('standard_personal_block resolves present:false and is missing when one of its 6 mapped fields is absent', () => {
    const applicant = syntheticApplicant({
      identity: { ...syntheticApplicant().identity, placeOfBirth: null },
    });
    const plan = buildApplicationPlan(baseInput({ applicant }));

    const field = findField(plan.sections, 'personal_particulars', 'standard_personal_block');
    expect(field?.present).toBe(false);

    const missingFieldIds = plan.missing.filter((m) => m.kind === 'field').map((m) => m.id);
    expect(missingFieldIds).toContain('standard_personal_block');
  });

  it('reaches readyForAutomation.ready:true for regular.tourist when every required field and document is supplied', () => {
    const category = getCategory('regular.tourist', kb)!;
    const requiredDocIds = category.requiredDocuments.map((d) => d.id);

    const documentCoverage = {
      fieldCoverage: {},
      documents: requiredDocIds.map((id) => ({
        id: `uploaded-${id}`,
        kind: 'unknown',
        originalName: `${id}.pdf`,
        fields: [],
      })),
    };

    // The four application.*-backed required fields left unset by `baseInput()` (see the test
    // above) -- filling all of them, plus every required document, should be sufficient to
    // reach `ready: true` given the synthetic applicant is otherwise fully eligible and
    // fully populated.
    const applicationValues = {
      'application.purpose': { value: 'recreation', verified: false },
      'application.portOfArrival': { value: 'Delhi', verified: false },
      'application.intendedArrivalDate': { value: '2027-01-15', verified: false },
      'application.visitedIndiaBefore': { value: 'false', verified: false },
    };

    const plan = buildApplicationPlan(baseInput({ documentCoverage, applicationValues }));

    expect(plan.missing).toEqual([]);
    expect(plan.readyForAutomation).toEqual({ ready: true, blockers: [] });
  });
});
