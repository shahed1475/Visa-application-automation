import type { FieldRule, FormField, FormModel, FormSection, Source, VisaCategory } from '../visa-kb/schema.js';
import { evaluateCondition, type ConditionContext } from './conditions.js';
import type { FieldPlan, SectionPlan } from './types.js';

export interface ResolveValueResult {
  value: string | null;
  present: boolean;
  verified: boolean;
}

type ResolveValueFn = (appliesTo: string) => ResolveValueResult;

/** The requirement/condition/source portion of a `FieldPlan`, shared between real
 *  `FormField`-backed plans and the synthetic `india_references_min` plan. */
interface RequirementResolution {
  requirement: FieldPlan['requirement'];
  condition: FieldPlan['condition'];
  conditionMet: boolean | null;
  effectiveRequirement: FieldPlan['effectiveRequirement'];
  source: Source;
}

/** Resolves an explicit `FieldRule`'s requirement (spec §4.3 step 1). Non-conditional
 *  requirements pass through unchanged with `effectiveRequirement` mirroring `requirement`.
 *  A conditional rule is evaluated via Task 7's `evaluateCondition`: met -> `required`,
 *  unmet -> `not_applicable`, unknown (`null`) -> `not_applicable` for gating purposes while
 *  `requirement` stays `'conditional'` and `conditionMet` stays `null` so the UI can render a
 *  distinct "review required" state. */
function resolveFromRule(rule: FieldRule, ctx: ConditionContext, ruleLabel: string): RequirementResolution {
  if (rule.requirement !== 'conditional') {
    return {
      requirement: rule.requirement,
      condition: null,
      conditionMet: null,
      effectiveRequirement: rule.requirement,
      source: rule.source,
    };
  }
  // The KB schema's `.refine` guarantees a conditional FieldRule carries a condition; narrow
  // defensively rather than assume with a bare `!`.
  const condition = rule.condition;
  if (condition === undefined) {
    throw new Error(`FieldRule ${ruleLabel} has requirement 'conditional' but no condition`);
  }
  const conditionMet = evaluateCondition(condition, ctx);
  const effectiveRequirement: FieldPlan['effectiveRequirement'] = conditionMet === true ? 'required' : 'not_applicable';
  return { requirement: 'conditional', condition, conditionMet, effectiveRequirement, source: rule.source };
}

function findFieldRule(rules: FieldRule[], sectionId: string, fieldId: string): FieldRule | undefined {
  return rules.find((r) => r.sectionId === sectionId && r.fieldId === fieldId);
}

function resolveValuePart(appliesTo: string | null, resolveValue: ResolveValueFn): ResolveValueResult {
  if (appliesTo === null) return { value: null, present: false, verified: false };
  return resolveValue(appliesTo);
}

/** Builds one `FieldPlan` for a real `FormField`, applying spec §4.3's precedence: explicit
 *  `FieldRule` > applicable-section `standardBlock` default > `not_applicable`. */
function buildFieldPlan(args: {
  section: FormSection;
  field: FormField;
  rule: FieldRule | undefined;
  applicable: boolean;
  ctx: ConditionContext;
  resolveValue: ResolveValueFn;
}): FieldPlan {
  const { section, field, rule, applicable, ctx, resolveValue } = args;

  let resolution: RequirementResolution;
  if (rule !== undefined) {
    resolution = resolveFromRule(rule, ctx, `${section.id}.${field.id}`);
  } else if (applicable) {
    const requirement: FieldPlan['requirement'] = field.standardBlock ? 'required' : 'optional';
    resolution = { requirement, condition: null, conditionMet: null, effectiveRequirement: requirement, source: field.source };
  } else {
    resolution = {
      requirement: 'not_applicable',
      condition: null,
      conditionMet: null,
      effectiveRequirement: 'not_applicable',
      source: field.source,
    };
  }

  return {
    id: field.id,
    label: field.label,
    sectionId: section.id,
    appliesTo: field.appliesTo,
    ...resolution,
    ...resolveValuePart(field.appliesTo, resolveValue),
  };
}

/** Builds the synthetic `india_references_min` `FieldPlan` from its `FieldRule` alone -- there
 *  is deliberately no backing `FormField` in `form-model.json` (the loader's
 *  `SYNTHETIC_FIELD_IDS` allow-list exists for exactly this), so this is the field's *sole*
 *  producer and `plan.sections` can never carry two entries under the same id. The
 *  rule's `count` is guaranteed present per the KB's authoring convention for this rule; a
 *  missing `count` is a KB data defect, not a runtime input this pure function should paper
 *  over, so it throws rather than silently defaulting. */
function buildReferencesFieldPlan(rule: FieldRule, sectionId: string, ctx: ConditionContext): FieldPlan {
  if (rule.count === undefined) {
    throw new Error(`FieldRule ${sectionId}.india_references_min has no 'count'`);
  }
  const resolution = resolveFromRule(rule, ctx, `${sectionId}.india_references_min`);
  return {
    id: 'india_references_min',
    label: `India references (minimum ${rule.count})`,
    sectionId,
    appliesTo: null,
    ...resolution,
    value: null,
    present: false,
    verified: false,
  };
}

/** Pure form-rule resolver: turns a category's `formRules` + the KB's `formModel` into
 *  `SectionPlan[]`/`FieldPlan[]` per spec §4.2/§4.3. Deterministic and side-effect free --
 *  applicant-data resolution is delegated entirely to the `resolveValue` callback so this
 *  module stays isolated from the applicant-flattening detail (Task 11's concern). */
export function resolveFieldPlans(input: {
  category: VisaCategory;
  formModel: FormModel;
  ctx: ConditionContext;
  resolveValue: ResolveValueFn;
}): SectionPlan[] {
  const { category, formModel, ctx, resolveValue } = input;

  return formModel.sections.map((section) => {
    const applicable = category.formRules.applicableSections.includes(section.id);

    const fields: FieldPlan[] = section.fields.map((field) => {
      const rule = findFieldRule(category.formRules.fieldRules, section.id, field.id);
      return buildFieldPlan({ section, field, rule, applicable, ctx, resolveValue });
    });

    const referencesRule = category.formRules.fieldRules.find(
      (r) => r.sectionId === section.id && r.fieldId === 'india_references_min',
    );
    if (referencesRule !== undefined) {
      fields.push(buildReferencesFieldPlan(referencesRule, section.id, ctx));
    }

    return {
      id: section.id,
      label: section.label,
      applicable,
      source: section.source,
      fields,
    };
  });
}
