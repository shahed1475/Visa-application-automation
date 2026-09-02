import type { ApplicantDetail, SectionKey } from '../../../../shared/applicant/types';

const SECTION_LABELS: Record<SectionKey, string> = {
  identity: 'Identity',
  passport: 'Passport',
  contact: 'Contact',
  address: 'Address',
  travel: 'Travel',
  references: 'References',
};

export function CompletenessHeader({ detail }: { detail: ApplicantDetail }) {
  const pct = Math.round(detail.completeness.overall * 100);
  return (
    <div className="completeness-header">
      <div className="completeness-header__overall">
        <strong>{pct}% complete</strong>
        <span className={`badge badge--${detail.verification.label}`}>
          {detail.verification.verified}/{detail.verification.total} fields verified
        </span>
      </div>
      <ul className="completeness-header__chips">
        {(Object.keys(SECTION_LABELS) as SectionKey[]).map((key) => (
          <li key={key} className="chip">
            {SECTION_LABELS[key]}: {Math.round(detail.completeness.bySection[key] * 100)}%
          </li>
        ))}
      </ul>
      {detail.warnings.length > 0 && (
        <ul className="completeness-header__warnings">
          {detail.warnings.map((w, i) => (
            <li key={i} className="warning">{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
