import { checkEligibility, getCategory } from '../visa-kb/queries.js';
import { PASSPORT_TYPES, type EligibilityCondition, type KnowledgeBase } from '../visa-kb/schema.js';
import type { EligibilityConditionView, EligibilityPlan, FlatApplicant, Selection } from './types.js';

/** Everything `evaluateEligibilityCondition` needs to resolve one v1 `EligibilityCondition`.
 *  `applicationValues` mirrors Task 7's `ConditionContext` for signature symmetry with the
 *  broader engine (Task 11) and future extension — no current `EligibilityCondition` type reads
 *  it, so `evaluateEligibility`'s body never touches it. */
export interface EligibilityInput {
  nationality: string | null;
  selection: Selection;
  applicant: FlatApplicant;
  applicationValues: Record<string, { value: string | null; verified: boolean }>;
  kb: KnowledgeBase;
  now: Date;
}

const PASSPORT_TYPE_VALUES = new Set<string>(PASSPORT_TYPES);

/** Age in whole completed years as of `at`, using real birthday arithmetic (not a naive
 *  year subtraction). Duplicated locally from Task 7's `conditions.ts` (same rationale as Task
 *  6's locally-duplicated Zod helpers — this module stays self-contained). */
function ageAt(dob: string | null, at: Date): number | null {
  if (dob === null) return null;
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  let age = at.getUTCFullYear() - y;
  const atMonth = at.getUTCMonth() + 1;
  const atDate = at.getUTCDate();
  if (atMonth < m || (atMonth === m && atDate < d)) {
    age -= 1;
  }
  return age;
}

function referenceDate(selection: Selection, now: Date): Date {
  return selection.intendedArrivalDate !== null
    ? new Date(`${selection.intendedArrivalDate}T00:00:00Z`)
    : now;
}

/** Required-by date for a passport-validity check: `ref` plus `monthsRequired` calendar
 *  months, using JS's normal month/day overflow rules (UTC calendar arithmetic). */
function requiredByIsoDate(ref: Date, monthsRequired: number): string {
  const requiredBy = new Date(
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + monthsRequired, ref.getUTCDate()),
  );
  return requiredBy.toISOString().slice(0, 10);
}

/** Evaluates one v1 `EligibilityCondition` against the application context. `true` = evaluated
 *  and satisfied. `false` = evaluated and not satisfied. `null` = the engine cannot determine it
 *  (missing input, or one of the five genuinely non-auto-evaluable types). `null` is never
 *  conflated with `false` — this function never infers ineligibility from missing data. */
export function evaluateEligibilityCondition(
  cond: EligibilityCondition,
  ctx: { applicant: FlatApplicant; selection: Selection; now: Date },
): { conditionMet: boolean | null; text: string } {
  switch (cond.type) {
    case 'passport_validity_months_min': {
      const text = `Passport must be valid for at least ${cond.value} months after arrival.`;
      const expiryDate = ctx.applicant.passport.expiryDate;
      if (expiryDate === null) return { conditionMet: null, text };
      const ref = referenceDate(ctx.selection, ctx.now);
      const requiredByIso = requiredByIsoDate(ref, cond.value);
      return { conditionMet: expiryDate >= requiredByIso, text };
    }
    case 'min_age': {
      const text = `Applicant must be at least ${cond.value} years old at arrival.`;
      const age = ageAt(ctx.applicant.identity.dateOfBirth, referenceDate(ctx.selection, ctx.now));
      if (age === null) return { conditionMet: null, text };
      return { conditionMet: age >= cond.value, text };
    }
    case 'max_age': {
      const text = `Applicant must be at most ${cond.value} years old at arrival.`;
      const age = ageAt(ctx.applicant.identity.dateOfBirth, referenceDate(ctx.selection, ctx.now));
      if (age === null) return { conditionMet: null, text };
      return { conditionMet: age <= cond.value, text };
    }
    case 'purpose_in': {
      const text = `Purpose of visit must be one of: ${cond.value.join(', ')}.`;
      if (ctx.selection.purpose === null) return { conditionMet: null, text };
      return { conditionMet: cond.value.includes(ctx.selection.purpose), text };
    }
    case 'purpose_not_in': {
      const text = `Purpose of visit must not be one of: ${cond.value.join(', ')}.`;
      if (ctx.selection.purpose === null) return { conditionMet: null, text };
      return { conditionMet: !cond.value.includes(ctx.selection.purpose), text };
    }
    case 'passport_type_in': {
      const text = `Passport type must be one of: ${cond.value.join(', ')}.`;
      const documentType = ctx.applicant.passport.documentType;
      if (documentType === null || !PASSPORT_TYPE_VALUES.has(documentType)) {
        return { conditionMet: null, text };
      }
      return { conditionMet: (cond.value as string[]).includes(documentType), text };
    }
    case 'passport_type_not_in': {
      const text = `Passport type must not be one of: ${cond.value.join(', ')}.`;
      const documentType = ctx.applicant.passport.documentType;
      if (documentType === null || !PASSPORT_TYPE_VALUES.has(documentType)) {
        return { conditionMet: null, text };
      }
      return { conditionMet: !(cond.value as string[]).includes(documentType), text };
    }
    case 'no_prohibited_background': {
      return {
        conditionMet: null,
        text: `You must confirm: no prohibited background (${cond.value.join(', ')}).`,
      };
    }
    case 'not_endorsed_on_relative_passport': {
      return {
        conditionMet: null,
        text: "You must confirm: applicant is not endorsed on a relative's passport.",
      };
    }
    case 'requires_supporting_institution_letter': {
      return {
        conditionMet: null,
        text: 'You must confirm: a supporting institution letter is provided.',
      };
    }
    case 'salary_min_inr_per_annum': {
      return {
        conditionMet: null,
        text: `You must confirm: minimum annual salary of INR ${cond.value} is met.`,
      };
    }
    case 'custom': {
      return { conditionMet: null, text: `You must confirm: ${cond.text}` };
    }
    default: {
      const _exhaustive: never = cond;
      return _exhaustive;
    }
  }
}

/** Maps a v1 `EligibilityRecord`'s conditions to `EligibilityConditionView`s (never inferring
 *  ineligibility from missing data), synthesizes a passport-validity condition from
 *  `travelRequirements` when the record has none, and raises blocker/info warnings for
 *  passport-expiry checks. The record's own `status` is passed through unchanged — this
 *  function only evaluates its conditions, never recomputes the status itself. */
export function evaluateEligibility(input: EligibilityInput): EligibilityPlan {
  if (input.nationality === null) {
    return {
      status: 'unknown',
      reason: 'nationality not set',
      conditions: [],
      unmetConditions: [],
      warnings: [],
      basis: null,
      source: null,
    };
  }

  const result = checkEligibility(
    input.nationality,
    input.selection.applicationMode,
    input.selection.categoryId,
    input.kb,
  );

  if (result.status === 'unknown') {
    return {
      status: 'unknown',
      reason: result.reason,
      conditions: [],
      unmetConditions: [],
      warnings: [],
      basis: null,
      source: null,
    };
  }

  const category = getCategory(input.selection.categoryId, input.kb);
  const ctx = { applicant: input.applicant, selection: input.selection, now: input.now };

  const views: EligibilityConditionView[] = result.conditions.map((cond) => ({
    condition: cond,
    ...evaluateEligibilityCondition(cond, ctx),
    source: result.source,
  }));

  const hasExplicitPassportValidity = result.conditions.some(
    (c) => c.type === 'passport_validity_months_min',
  );
  const travelPassportValidityMin = category?.travelRequirements.passportValidityMonthsMin;
  if (!hasExplicitPassportValidity && typeof travelPassportValidityMin === 'number' && category) {
    const syntheticCondition: EligibilityCondition = {
      type: 'passport_validity_months_min',
      value: travelPassportValidityMin,
    };
    views.push({
      condition: syntheticCondition,
      ...evaluateEligibilityCondition(syntheticCondition, ctx),
      source: category.source,
    });
  }

  const unmetConditions = views.filter((v) => v.conditionMet === false);

  const warnings: EligibilityPlan['warnings'] = [];
  for (const view of views) {
    if (view.condition.type !== 'passport_validity_months_min') continue;
    if (view.conditionMet === false) {
      warnings.push({
        severity: 'blocker',
        text: `Passport expires ${input.applicant.passport.expiryDate}; at least ${view.condition.value} months' validity required after arrival.`,
        source: view.source,
      });
    } else if (view.conditionMet === null) {
      warnings.push({
        severity: 'info',
        text: 'Passport expiry date is not set — cannot verify the minimum validity requirement.',
        source: view.source,
      });
    }
  }

  return {
    status: result.status,
    conditions: views,
    unmetConditions,
    warnings,
    basis: result.basis,
    source: result.source,
  };
}
