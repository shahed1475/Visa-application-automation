import type {
  Blocker,
  DocumentPlan,
  EligibilityPlan,
  FieldPlan,
  MissingItem,
  SectionPlan,
  VerificationRollup,
  Warning,
} from './types.js';

/** Defence in depth against a duplicate `(sectionId, id)` pair reaching the tallies. The
 *  `india_references_min` duplicate that originally motivated this is now fixed at source --
 *  the field has no `FormField` in `form-model.json`, so `resolveFieldPlans`'s synthetic push
 *  is its only producer -- but a KB edit that re-adds a field id already emitted synthetically
 *  would otherwise silently double a category's required-field count and its missing list.
 *  This does not mutate `section.fields`; only this module's own counting logic dedupes. */
function uniqueFields(section: SectionPlan): FieldPlan[] {
  const seen = new Set<string>();
  const out: FieldPlan[] = [];
  for (const field of section.fields) {
    const key = `${section.id}::${field.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(field);
  }
  return out;
}

/** Every effective-required-absent `FieldPlan`/`DocumentPlan` -- excludes optional and
 *  `effectiveRequirement: 'not_applicable'` (the resolution a `conditionMet: null` conditional
 *  field/doc gets per Tasks 9/10) simply by checking `=== 'required'`, no special-casing needed.
 *  Ordering (fields in `sections`/field order, then documents in `documents` order) is a
 *  determinism/test-stability choice, not a spec requirement. */
export function computeMissing(sections: SectionPlan[], documents: DocumentPlan[]): MissingItem[] {
  const items: MissingItem[] = [];

  for (const section of sections) {
    for (const field of uniqueFields(section)) {
      if (field.effectiveRequirement !== 'required' || field.present) continue;
      items.push({
        kind: 'field',
        id: field.id,
        label: field.label,
        sectionId: section.id,
        appliesTo: field.appliesTo,
        source: field.source,
      });
    }
  }

  for (const doc of documents) {
    if (doc.effectiveRequirement !== 'required' || doc.uploaded) continue;
    items.push({ kind: 'document', id: doc.id, label: doc.label, source: doc.source });
  }

  return items;
}

/** Required-only verification rollup. Mirrors `applicantCompleteness.ts`'s `computeVerification`
 *  ratio/label formula exactly (the one other verification-rollup implementation in this
 *  codebase), adapted here to count only `effectiveRequirement === 'required'` fields rather
 *  than "any set field". */
export function computeVerification(sections: SectionPlan[]): VerificationRollup {
  let requiredVerified = 0;
  let requiredTotal = 0;
  const bySection: Record<string, { verified: number; total: number }> = {};

  for (const section of sections) {
    let sv = 0;
    let st = 0;
    for (const field of uniqueFields(section)) {
      if (field.effectiveRequirement !== 'required') continue;
      st += 1;
      if (field.present && field.verified) sv += 1;
    }
    bySection[section.id] = { verified: sv, total: st };
    requiredVerified += sv;
    requiredTotal += st;
  }

  const ratio = requiredTotal === 0 ? 0 : requiredVerified / requiredTotal;
  const label: VerificationRollup['label'] =
    requiredTotal > 0 && ratio === 1 ? 'verified' : requiredVerified === 0 ? 'unverified' : 'partial';

  return { requiredVerified, requiredTotal, ratio, label, bySection };
}

const ELIGIBILITY_STATUS_TEXT: Record<'ineligible' | 'not_offered' | 'unknown', (eligibility: EligibilityPlan) => string> = {
  ineligible: () => 'Not eligible for this visa category based on the recorded eligibility rules.',
  not_offered: () => 'This visa category is not offered for this nationality.',
  unknown: (eligibility) =>
    eligibility.reason ?? 'Eligibility could not be determined for this nationality and visa category.',
};

/** Spec Sec.6.6's 5-condition readiness gate. Takes `computeMissing`'s already-computed output
 *  rather than re-deriving required-absent fields/documents a second time from raw
 *  `sections`/`documents` (the brief's illustrative signature is
 *  `computeReadiness(eligibility, sections, documents, warnings)`): conditions 3 and 4 are the
 *  exact same predicate `computeMissing` already evaluates, so re-deriving it here would
 *  duplicate that logic -- and the dedup fix above -- in two places, with two chances to drift
 *  out of sync. Deriving readiness's field/document blockers from `missing` keeps the dedup fix
 *  applying once, in one place, and keeps both outputs in lock-step by construction. */
export function computeReadiness(
  eligibility: EligibilityPlan,
  missing: MissingItem[],
  warnings: Warning[],
): { ready: boolean; blockers: Blocker[] } {
  const blockers: Blocker[] = [];

  // 1. Eligibility status.
  if (eligibility.status !== 'eligible' && eligibility.status !== 'conditional') {
    const textFor = ELIGIBILITY_STATUS_TEXT[eligibility.status];
    blockers.push({ kind: 'eligibility', text: textFor(eligibility), source: eligibility.source });
  }

  // 2. Unmet eligibility conditions.
  for (const view of eligibility.unmetConditions) {
    blockers.push({ kind: 'eligibility', text: view.text, source: view.source });
  }

  // 3 & 4. Missing required fields/documents -- ordering follows `missing`'s own order
  // (fields first, then documents; see computeMissing), a determinism choice, not a spec
  // requirement.
  for (const item of missing) {
    const text = `${item.label} is required`;
    if (item.kind === 'field') {
      blockers.push({ kind: 'field', text, source: item.source });
    } else {
      blockers.push({ kind: 'document', text, source: item.source });
    }
  }

  // 5. Blocker-severity plan-level warnings.
  for (const warning of warnings) {
    if (warning.severity !== 'blocker') continue;
    blockers.push({ kind: 'warning', text: warning.text, source: warning.source });
  }

  return { ready: blockers.length === 0, blockers };
}
