import type { FormCondition, VisaCategory } from '../visa-kb/schema.js';
import type { FlatApplicant, Selection } from './types.js';

/** Everything `evaluateCondition` needs to resolve a `FormCondition` against one in-progress
 *  application. Assembled by callers (Tasks 8/9/10) from the applicant record, the in-progress
 *  selection/answers, and the resolved KB category. */
export interface ConditionContext {
  applicant: FlatApplicant;
  selection: Selection;
  /** `application.*` field path -> current value + verification state. */
  applicationValues: Record<string, { value: string | null; verified: boolean }>;
  category: VisaCategory;
  now: Date;
}

/** Age in whole completed years as of `at`, using real birthday arithmetic (not a naive
 *  year subtraction) — so e.g. DOB `2008-06-15` is age 17 the day before the birthday and
 *  18 on/after it. `dob` and `at` are both interpreted as calendar dates (UTC). */
export function ageAt(dob: string | null, at: Date): number | null {
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

function ageAtSelectionOrNow(applicant: FlatApplicant, selection: Selection, now: Date): number | null {
  const at = selection.intendedArrivalDate !== null
    ? new Date(`${selection.intendedArrivalDate}T00:00:00Z`)
    : now;
  return ageAt(applicant.identity.dateOfBirth, at);
}

/** Evaluates one declarative `FormCondition` against the application context.
 *  `true` = evaluated and satisfied. `false` = evaluated and not satisfied.
 *  `null` = the engine cannot determine it (missing input, or `custom`, which is never
 *  auto-evaluable). `null` is never conflated with `false`. */
export function evaluateCondition(cond: FormCondition, ctx: ConditionContext): boolean | null {
  switch (cond.type) {
    case 'purpose_in': {
      if (ctx.selection.purpose === null) return null;
      return cond.value.includes(ctx.selection.purpose);
    }
    case 'entry_type_in': {
      if (ctx.selection.entryType === null) return null;
      return cond.value.includes(ctx.selection.entryType);
    }
    case 'applicant_married': {
      const status = ctx.applicant.family.maritalStatus;
      if (status === null) return null;
      return status === 'married';
    }
    case 'visited_india_before': {
      const entry = ctx.applicationValues['application.visitedIndiaBefore'];
      const value = entry?.value;
      if (value === 'yes') return true;
      if (value === 'no') return false;
      return null;
    }
    case 'age_lt': {
      const age = ageAtSelectionOrNow(ctx.applicant, ctx.selection, ctx.now);
      if (age === null) return null;
      return age < cond.value;
    }
    case 'age_gte': {
      const age = ageAtSelectionOrNow(ctx.applicant, ctx.selection, ctx.now);
      if (age === null) return null;
      return age >= cond.value;
    }
    case 'stay_days_gt': {
      if (ctx.selection.intendedStayDays === null) return null;
      return ctx.selection.intendedStayDays > cond.value;
    }
    case 'sub_category_is': {
      return ctx.category.subCategory === cond.value || ctx.category.id === cond.value;
    }
    case 'custom':
      return null;
    default: {
      const _exhaustive: never = cond;
      return _exhaustive;
    }
  }
}
