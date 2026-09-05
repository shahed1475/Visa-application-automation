import type {
  ApplicationPlan,
  Blocker,
  DocumentPlan,
  EligibilityPlan,
  MissingItem,
  SectionPlan,
  Selection,
  VerificationRollup,
} from '../../../../shared/application/types';

/** The four dashboard status-chip values (spec §10.1). */
export type StatusChip = 'ok' | 'attention' | 'blocked' | 'review';

/**
 * Visa selection — `attention` when the category is unknown to the KB or a
 * selection field the rest of the plan depends on (purpose / entry type /
 * arrival date) is still blank; otherwise `ok`.
 */
export function chipForVisaSelection(plan: Pick<ApplicationPlan, 'category' | 'selection'>): StatusChip {
  if (plan.category === null) return 'attention';
  const s: Selection = plan.selection;
  if (!s.purpose || !s.entryType || !s.intendedArrivalDate) return 'attention';
  return 'ok';
}

/**
 * Eligibility — `blocked` when ineligible / not offered, `review` when the app
 * cannot determine the outcome (status unknown, or any condition still `null`),
 * `attention` when conditional with an unmet condition, else `ok`.
 */
export function chipForEligibility(eligibility: EligibilityPlan): StatusChip {
  if (eligibility.status === 'ineligible' || eligibility.status === 'not_offered') return 'blocked';
  if (eligibility.status === 'unknown') return 'review';
  if (eligibility.conditions.some((c) => c.conditionMet === null)) return 'review';
  if (eligibility.unmetConditions.length > 0) return 'attention';
  return 'ok';
}

/**
 * Required information — `blocked` when an applicable, effectively-required
 * field has no value; `review` when an applicable conditional field cannot be
 * resolved (`conditionMet === null`); else `ok`.
 */
export function chipForRequiredInfo(sections: SectionPlan[]): StatusChip {
  const fields = sections.filter((s) => s.applicable).flatMap((s) => s.fields);
  if (fields.some((f) => f.effectiveRequirement === 'required' && !f.present)) return 'blocked';
  if (fields.some((f) => f.requirement === 'conditional' && f.conditionMet === null)) return 'review';
  return 'ok';
}

/**
 * Required documents — `blocked` when an effectively-required document is not
 * uploaded; `review` when a conditional document's condition cannot be resolved
 * (`conditionMet === null`); else `ok`.
 */
export function chipForRequiredDocuments(documents: DocumentPlan[]): StatusChip {
  if (documents.some((d) => d.effectiveRequirement === 'required' && !d.uploaded)) return 'blocked';
  if (documents.some((d) => d.requirement === 'conditional' && d.conditionMet === null))
    return 'review';
  return 'ok';
}

/**
 * Missing information — a roll-up view, not a new severity. `ok` when the flat
 * `missing[]` is empty; else `attention` (the individual items already drive the
 * Eligibility / Required-information / Ready chips).
 */
export function chipForMissingInfo(missing: MissingItem[]): StatusChip {
  return missing.length === 0 ? 'ok' : 'attention';
}

/**
 * Verification — `ok` when nothing is required to verify (`requiredTotal === 0`)
 * or everything required is verified; else `attention`. Never `blocked`:
 * verification is explicitly NOT a readiness gate (Global Constraint).
 */
export function chipForVerification(v: VerificationRollup): StatusChip {
  if (v.requiredTotal === 0) return 'ok';
  return v.label === 'verified' ? 'ok' : 'attention';
}

/**
 * Ready for automation — mirrors `plan.readyForAutomation.ready` directly (never
 * recomputed): `ok` when ready, else `blocked`.
 */
export function chipForReadyForAutomation(r: { ready: boolean; blockers: Blocker[] }): StatusChip {
  return r.ready ? 'ok' : 'blocked';
}

const CHIP_LABEL: Record<StatusChip, string> = {
  ok: 'OK',
  attention: 'Attention',
  blocked: 'Blocked',
  review: 'Review',
};

export function Chip({ status }: { status: StatusChip }) {
  return <span className={`status-chip status-chip--${status}`}>{CHIP_LABEL[status]}</span>;
}
