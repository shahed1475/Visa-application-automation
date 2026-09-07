import { describe, expect, it } from 'vitest';
import { buildApplicationPlan } from '../../../src/shared/application/buildApplicationPlan.js';
import { loadKnowledgeBase } from '../../../src/shared/visa-kb/loader.js';
import { getCategory } from '../../../src/shared/visa-kb/queries.js';
import type { BuildApplicationPlanInput } from '../../../src/shared/application/types.js';
import {
  emptyDocumentCoverage,
  syntheticApplicant,
  syntheticSelection,
} from '../../helpers/applicationFixtures.js';

// Spec §11.4 (eligibility / passport-validity failure) + §11.6 (fully-populated -> ready ->
// remove one required field/document -> not ready). Acceptance items 7 and 13. Every
// assertion is on the plan object returned by `buildApplicationPlan`.

const kb = loadKnowledgeBase();
const NOW = new Date('2026-09-05T00:00:00.000Z');
const ARRIVAL = '2027-01-15';

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

describe('readiness — eligibility / passport validity (spec §11.4)', () => {
  it('passport expiring inside the required validity window -> unmet condition + sourced eligibility blocker + not ready', () => {
    const category = getCategory('regular.tourist', kb)!;
    const monthsMin = category.travelRequirements.passportValidityMonthsMin!;
    expect(monthsMin).toBeGreaterThan(0);

    // Arrival 2027-01-15 + 6 months => passport must be valid to at least 2027-07-15; make it
    // expire well before that.
    const applicant = syntheticApplicant({
      passport: { ...syntheticApplicant().passport, expiryDate: '2027-03-01' },
    });
    const plan = buildApplicationPlan(
      baseInput({
        applicant,
        selection: syntheticSelection({ categoryId: 'regular.tourist', intendedArrivalDate: ARRIVAL }),
      }),
    );

    expect(plan.eligibility.unmetConditions.length).toBeGreaterThan(0);
    const unmet = plan.eligibility.unmetConditions.find(
      (v) => v.condition.type === 'passport_validity_months_min',
    );
    expect(unmet).toBeDefined();
    expect(unmet?.conditionMet).toBe(false);

    const eligibilityBlocker = plan.readyForAutomation.blockers.find((b) => b.kind === 'eligibility');
    expect(eligibilityBlocker).toBeDefined();
    expect(eligibilityBlocker?.source).not.toBeNull();

    expect(plan.readyForAutomation.ready).toBe(false);
  });

  it('a comfortably-valid passport produces no passport-validity unmet condition', () => {
    // Guards against the assertion above being vacuous: the default synthetic passport is valid
    // to 2030 and must NOT trip the check.
    const plan = buildApplicationPlan(
      baseInput({
        selection: syntheticSelection({ categoryId: 'regular.tourist', intendedArrivalDate: ARRIVAL }),
      }),
    );
    expect(
      plan.eligibility.unmetConditions.some((v) => v.condition.type === 'passport_validity_months_min'),
    ).toBe(false);
  });
});

// ---- §11.6: fully-populated -> ready -> remove one required field / document ---------------

/** A fully-populated, fully-satisfiable `regular.tourist` input: every required document
 *  matched by an uploaded file and every `application.*`-backed required field supplied.
 *  Mirrors buildApplicationPlan.test.ts's `ready: true` scenario. */
function readyBaseInput(): BuildApplicationPlanInput {
  const category = getCategory('regular.tourist', kb)!;
  const requiredDocIds = category.requiredDocuments.map((d) => d.id);
  return baseInput({
    selection: syntheticSelection({ categoryId: 'regular.tourist', intendedArrivalDate: ARRIVAL }),
    documentCoverage: {
      fieldCoverage: {},
      documents: requiredDocIds.map((id) => ({
        id: `uploaded-${id}`,
        kind: 'unknown',
        originalName: `${id}.pdf`,
        fields: [],
      })),
    },
    applicationValues: {
      'application.purpose': { value: 'recreation', verified: false },
      'application.portOfArrival': { value: 'Delhi', verified: false },
      'application.intendedArrivalDate': { value: ARRIVAL, verified: false },
      'application.visitedIndiaBefore': { value: 'false', verified: false },
    },
  });
}

describe('readiness — fully-populated then a single removal (spec §11.6)', () => {
  it('fully-populated regular.tourist -> ready with no blockers and nothing missing', () => {
    const plan = buildApplicationPlan(readyBaseInput());
    expect(plan.missing).toEqual([]);
    expect(plan.readyForAutomation).toEqual({ ready: true, blockers: [] });
  });

  it('removing exactly one required field -> not ready, and that field is named in missing/blockers', () => {
    const input = readyBaseInput();
    input.applicationValues = Object.fromEntries(
      Object.entries(input.applicationValues).filter(([k]) => k !== 'application.purpose'),
    );

    const plan = buildApplicationPlan(input);
    expect(plan.readyForAutomation.ready).toBe(false);

    const missingField = plan.missing.find((m) => m.kind === 'field' && m.id === 'purpose');
    expect(missingField).toBeDefined();
    expect(plan.readyForAutomation.blockers.some((b) => b.text.includes(missingField!.label))).toBe(true);

    // Nothing else regressed: purpose is the only missing item.
    expect(plan.missing).toHaveLength(1);
  });

  it('removing exactly one required document -> not ready, and that document is named in missing/blockers', () => {
    const input = readyBaseInput();
    input.documentCoverage = {
      ...input.documentCoverage,
      documents: input.documentCoverage.documents.filter((d) => d.id !== 'uploaded-passport'),
    };

    const plan = buildApplicationPlan(input);
    expect(plan.readyForAutomation.ready).toBe(false);

    const missingDoc = plan.missing.find((m) => m.kind === 'document' && m.id === 'passport');
    expect(missingDoc).toBeDefined();
    expect(plan.readyForAutomation.blockers.some((b) => b.text.includes(missingDoc!.label))).toBe(true);

    expect(plan.missing).toHaveLength(1);
  });
});
