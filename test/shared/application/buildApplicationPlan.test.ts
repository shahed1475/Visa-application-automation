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

  it('returns the placeholder literals for missing/verification/readyForAutomation on the found-category path', () => {
    const plan = buildApplicationPlan(baseInput());
    expect(plan.missing).toEqual([]);
    expect(plan.verification).toEqual({
      requiredVerified: 0,
      requiredTotal: 0,
      ratio: 0,
      label: 'unverified',
      bySection: {},
    });
    expect(plan.readyForAutomation).toEqual({ ready: false, blockers: [] });
  });
});
