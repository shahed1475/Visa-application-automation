import type {
  ApplicationPlan,
  EligibilityPlan,
  SectionPlan,
  Selection,
} from '../../../../shared/application/types';

/** The four dashboard status-chip values (spec §10.1). */
export type StatusChip = 'ok' | 'attention' | 'blocked' | 'review';

/**
 * One helper per section. Task 18 adds four more for sections 4–7; the stub
 * sections use {@link STUB_CHIP} until then.
 */
export const STUB_CHIP: StatusChip = 'review';

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

const CHIP_LABEL: Record<StatusChip, string> = {
  ok: 'OK',
  attention: 'Attention',
  blocked: 'Blocked',
  review: 'Review',
};

export function Chip({ status }: { status: StatusChip }) {
  return <span className={`status-chip status-chip--${status}`}>{CHIP_LABEL[status]}</span>;
}
