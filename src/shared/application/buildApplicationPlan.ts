import type { ConditionContext } from './conditions.js';
import { resolveDocumentPlans } from './documentRules.js';
import { resolveFieldPlans, type ResolveValueResult } from './formRules.js';
import { evaluateEligibility } from './eligibility.js';
import { computeMissing, computeReadiness, computeVerification } from './readiness.js';
import type {
  ApplicationPlan,
  BuildApplicationPlanInput,
  DocumentCoverage,
  FlatApplicant,
  SectionPlan,
  Warning,
} from './types.js';
import { getCategory, getFormModel } from '../visa-kb/queries.js';

/** The six 1:1 profile sections `flattenApplicant` projects into `<section>.<camelField>`
 *  paths -- matches `PROFILE_FIELD_PATHS`'s coverage exactly (excludes `travel`/`references`,
 *  which are list-keyed, not static paths). */
const FLAT_SECTIONS = ['identity', 'passport', 'contact', 'address', 'family', 'occupation'] as const;

/** Projects the six 1:1 profile sections of a `FlatApplicant` into a flat
 *  `<section>.<camelField>` -> { value, present, verified } map, matching `PROFILE_FIELD_PATHS`
 *  exactly. `verified` is true iff either `fieldMeta` records that path as verified (same
 *  pattern as `applicantCompleteness.ts`'s `computeVerification`) or `documentCoverage`
 *  reports it as verified. */
export function flattenApplicant(
  applicant: FlatApplicant,
  documentCoverage: DocumentCoverage,
): Record<string, ResolveValueResult> {
  const verifiedPaths = new Set(applicant.fieldMeta.filter((m) => m.verified).map((m) => m.fieldPath));

  const flat: Record<string, ResolveValueResult> = {};
  for (const section of FLAT_SECTIONS) {
    const sectionValue = applicant[section] as unknown as Record<string, string | null>;
    for (const [field, value] of Object.entries(sectionValue)) {
      const path = `${section}.${field}`;
      const verified = verifiedPaths.has(path) || documentCoverage.fieldCoverage[path]?.verified === true;
      flat[path] = { value, present: value !== null, verified };
    }
  }
  return flat;
}

export function buildApplicationPlan(input: BuildApplicationPlanInput): ApplicationPlan {
  const category = getCategory(input.selection.categoryId, input.kb);

  if (category === null) {
    return {
      selection: input.selection,
      category: null,
      eligibility: {
        status: 'unknown',
        reason: 'visa category not found in knowledge base',
        conditions: [],
        unmetConditions: [],
        warnings: [],
        basis: null,
        source: null,
      },
      sections: [],
      documents: [],
      missing: [],
      verification: { requiredVerified: 0, requiredTotal: 0, ratio: 0, label: 'unverified', bySection: {} },
      readyForAutomation: {
        ready: false,
        blockers: [{ kind: 'eligibility', text: 'unknown visa category', source: null }],
      },
      provenance: {
        kbVersion: input.kb.meta.kbVersion,
        kbRevisionDate: input.kb.meta.revisionDate,
        schemaVersion: input.kb.meta.schemaVersion,
        computedAt: input.now.toISOString(),
      },
      warnings: [
        {
          text: `Visa category '${input.selection.categoryId}' was not found in the knowledge base.`,
          severity: 'warn',
          source: null,
        },
      ],
    };
  }

  const categoryView: ApplicationPlan['category'] = {
    id: category.id,
    displayName: category.displayName,
    applicationMode: category.applicationMode,
    officialCode: category.officialCode,
    subCategory: category.subCategory,
    entries: category.entries,
    extendable: category.extendable,
    convertible: category.convertible,
    validity: category.validity,
    stayLimitations: category.stayLimitations,
  };

  const ctx: ConditionContext = {
    applicant: input.applicant,
    selection: input.selection,
    applicationValues: input.applicationValues,
    category,
    now: input.now,
  };

  const flat = flattenApplicant(input.applicant, input.documentCoverage);

  function resolveValue(appliesTo: string): ResolveValueResult {
    if (appliesTo.startsWith('application.')) {
      const entry = input.applicationValues[appliesTo];
      const value = entry?.value ?? null;
      return { value, present: value !== null, verified: entry?.verified ?? false };
    }
    return flat[appliesTo] ?? { value: null, present: false, verified: false };
  }

  const rawSections = resolveFieldPlans({ category, formModel: getFormModel(input.kb), ctx, resolveValue });

  const hostRefCount = input.applicant.references.filter((r) => r.kind === 'in_country_host').length;

  const sections: SectionPlan[] = rawSections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      if (field.id !== 'india_references_min') return field;
      const rule = category.formRules.fieldRules.find(
        (r) => r.sectionId === section.id && r.fieldId === 'india_references_min',
      );
      // The `india_references_min` FormField is listed in every applicable `references`
      // section regardless of whether the category defines a count-bearing FieldRule for it
      // (e.g. regular.tourist has none). Only a category with such a rule makes this field
      // meaningful; absent one, leave Task 9's default resolution (value: null, present: false)
      // untouched rather than fabricate a count threshold that doesn't exist.
      if (rule?.count === undefined) return field;
      return {
        ...field,
        value: String(hostRefCount),
        present: hostRefCount >= rule.count,
      };
    }),
  }));

  const documents = resolveDocumentPlans({ category, ctx, documentCoverage: input.documentCoverage });

  const eligibility = evaluateEligibility({
    nationality: input.applicant.identity.nationality,
    selection: input.selection,
    applicant: input.applicant,
    applicationValues: input.applicationValues,
    kb: input.kb,
    now: input.now,
  });

  const missing = computeMissing(sections, documents);
  const verification = computeVerification(sections);
  // Plan-level warnings for the found-category path: currently always empty (the only
  // engine-level plan warning is the category-not-found case, which already returned above).
  // A local variable (not two separate `[]` literals) keeps this and the returned `warnings`
  // field from drifting apart if a future change ever needs to populate it here.
  const warnings: Warning[] = [];
  const readyForAutomation = computeReadiness(eligibility, missing, warnings);

  return {
    selection: input.selection,
    category: categoryView,
    eligibility,
    sections,
    documents,
    missing,
    verification,
    readyForAutomation,
    provenance: {
      kbVersion: input.kb.meta.kbVersion,
      kbRevisionDate: input.kb.meta.revisionDate,
      schemaVersion: input.kb.meta.schemaVersion,
      computedAt: input.now.toISOString(),
    },
    warnings,
  };
}
