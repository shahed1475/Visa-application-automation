import { PROFILE_SECTIONS } from '../../shared/applicant/fieldPaths.js';
import type {
  ApplicantDetail,
  Completeness,
  SectionKey,
  VerificationSummary,
} from '../../shared/applicant/types.js';

type CompletenessInput = Pick<
  ApplicantDetail,
  'identity' | 'passport' | 'contact' | 'address' | 'family' | 'occupation' | 'travel' | 'references'
>;
type VerificationInput = Pick<
  ApplicantDetail,
  'identity' | 'passport' | 'contact' | 'address' | 'family' | 'occupation' | 'fieldMeta'
>;

const ONE_TO_ONE = ['identity', 'passport', 'contact', 'address', 'family', 'occupation'] as const;

function isSet(value: unknown): boolean {
  return value != null && value !== '';
}

function sectionRatio(section: Record<string, unknown>, fields: readonly string[]): number {
  if (fields.length === 0) return 0;
  const filled = fields.filter((f) => isSet(section[f])).length;
  return filled / fields.length;
}

export function computeCompleteness(d: CompletenessInput): Completeness {
  const bySection = {} as Record<SectionKey, number>;
  for (const key of ONE_TO_ONE) {
    bySection[key] = sectionRatio(
      d[key] as unknown as Record<string, unknown>,
      PROFILE_SECTIONS[key],
    );
  }
  bySection.travel = d.travel.some((t) => isSet(t.purpose) && isSet(t.arrivalDate)) ? 1 : 0;
  bySection.references = d.references.some((r) => isSet(r.name)) ? 1 : 0;

  const all = Object.values(bySection);
  const overall = all.reduce((a, b) => a + b, 0) / all.length;
  return { overall, bySection };
}

export function computeVerification(d: VerificationInput): VerificationSummary {
  const verifiedPaths = new Set(d.fieldMeta.filter((m) => m.verified).map((m) => m.fieldPath));
  const bySection = {} as Record<SectionKey, { verified: number; total: number }>;
  let verified = 0;
  let total = 0;

  for (const key of ONE_TO_ONE) {
    const section = d[key] as unknown as Record<string, unknown>;
    let sv = 0;
    let st = 0;
    for (const [field, value] of Object.entries(section)) {
      if (!isSet(value)) continue;
      st += 1;
      if (verifiedPaths.has(`${key}.${field}`)) sv += 1;
    }
    bySection[key] = { verified: sv, total: st };
    verified += sv;
    total += st;
  }
  bySection.travel = { verified: 0, total: 0 };
  bySection.references = { verified: 0, total: 0 };

  const ratio = total === 0 ? 0 : verified / total;
  const label: VerificationSummary['label'] =
    total > 0 && ratio === 1 ? 'verified' : verified === 0 ? 'unverified' : 'partial';
  return { verified, total, ratio, label, bySection };
}

export function collectWarnings(d: Pick<ApplicantDetail, 'passport' | 'travel'>): string[] {
  const w: string[] = [];
  const { issueDate, expiryDate } = d.passport;
  if (issueDate && expiryDate && Date.parse(expiryDate) <= Date.parse(issueDate)) {
    w.push('Passport expiry date is not after the issue date.');
  }
  for (const t of d.travel) {
    if (
      t.arrivalDate &&
      t.departureDate &&
      Date.parse(t.departureDate) < Date.parse(t.arrivalDate)
    ) {
      w.push('Travel record: departure date is before the arrival date.');
    }
  }
  return w;
}
