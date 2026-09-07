import type { EligibilityConditionView, EligibilityPlan, Warning } from '../../../../shared/application/types';
import { SourceLine } from './provenance';

const REVIEW_TEXT = 'Review required — the app cannot determine this';

function mark(conditionMet: boolean | null): string {
  if (conditionMet === true) return '✓';
  if (conditionMet === false) return '✗';
  return '?';
}

function ConditionRow({ view }: { view: EligibilityConditionView }) {
  return (
    <li className={`eligibility-condition eligibility-condition--${String(view.conditionMet)}`}>
      <span className="eligibility-condition__mark" aria-hidden="true">
        {mark(view.conditionMet)}
      </span>
      <span className="eligibility-condition__text">{view.text}</span>
      {view.conditionMet === null && <span className="review-note">{REVIEW_TEXT}</span>}
      <SourceLine source={view.source} />
    </li>
  );
}

function WarningRow({ warning }: { warning: Warning }) {
  return (
    <li className={`eligibility-warning eligibility-warning--${warning.severity}`}>
      <span className="eligibility-warning__severity">{warning.severity}</span>
      <span className="eligibility-warning__text">{warning.text}</span>
      <SourceLine source={warning.source} />
    </li>
  );
}

export function EligibilitySection({ eligibility }: { eligibility: EligibilityPlan }) {
  return (
    <div className="eligibility">
      <p>
        <span className={`status-badge status-badge--${eligibility.status}`}>{eligibility.status}</span>
        {eligibility.basis && <span className="muted"> — {eligibility.basis}</span>}
      </p>

      {eligibility.status === 'unknown' && eligibility.reason && (
        <p className="hint">{eligibility.reason}</p>
      )}

      {eligibility.status !== 'unknown' && <SourceLine source={eligibility.source} />}

      {eligibility.conditions.length > 0 && (
        <>
          <h3>Conditions</h3>
          <ul className="eligibility-conditions">
            {eligibility.conditions.map((view, i) => (
              <ConditionRow key={`${view.condition.type}-${i}`} view={view} />
            ))}
          </ul>
        </>
      )}

      {eligibility.warnings.length > 0 && (
        <>
          <h3>Warnings</h3>
          <ul className="eligibility-warnings">
            {eligibility.warnings.map((warning, i) => (
              <WarningRow key={i} warning={warning} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
