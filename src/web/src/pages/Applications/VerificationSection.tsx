import { useState } from 'react';
import type { FieldPlan, SectionPlan, VerificationRollup } from '../../../../shared/application/types';
import { api } from '../../api/client';
import { SourceLine } from './provenance';

function isApplicationScoped(f: FieldPlan): boolean {
  return f.appliesTo !== null && f.appliesTo.startsWith('application.');
}

interface RowProps {
  field: FieldPlan;
  applicationId: string;
  applicantId: string;
  onChanged: () => void | Promise<void>;
}

function VerifyRow({ field, applicationId, applicantId, onChanged }: RowProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A synthetic row (e.g. the references minimum) has no field path and so no
  // verify path — it is shown for context only.
  const canVerify = field.appliesTo !== null;

  async function verify() {
    if (field.appliesTo === null) return;
    setError(null);
    setSaving(true);
    try {
      if (isApplicationScoped(field)) {
        await api.setApplicationFieldValue(applicationId, {
          fieldPath: field.appliesTo,
          verified: true,
        });
      } else {
        await api.setFieldMeta(applicantId, { fieldPath: field.appliesTo, verified: true });
      }
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record verification');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="verify-row">
      <div className="verify-row__head">
        <span className="verify-row__label">{field.label}</span>
        {field.verified ? (
          <span className="field-row__flag field-row__flag--verified">verified</span>
        ) : (
          <span className="field-row__flag">not verified</span>
        )}
        {!field.present && (
          <span className="field-row__flag field-row__flag--missing">no value yet</span>
        )}
      </div>

      {canVerify ? (
        <button
          type="button"
          onClick={() => void verify()}
          disabled={saving || field.verified || !field.present}
        >
          {field.verified ? 'Verified' : saving ? 'Verifying…' : 'Verify'}
        </button>
      ) : (
        <p className="hint">No verifiable field — shown for context.</p>
      )}
      {canVerify && !field.present && !field.verified && (
        <p className="hint">Add a value before verifying.</p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <SourceLine source={field.source} />
    </li>
  );
}

interface Props {
  verification: VerificationRollup;
  sections: SectionPlan[];
  applicationId: string;
  applicantId: string;
  onChanged: () => void | Promise<void>;
}

export function VerificationSection({
  verification,
  sections,
  applicationId,
  applicantId,
  onChanged,
}: Props) {
  const applicable = sections.filter((s) => s.applicable);
  const sectionLabel = (id: string) => applicable.find((s) => s.id === id)?.label ?? id;
  const requiredFields = applicable
    .flatMap((s) => s.fields)
    .filter((f) => f.effectiveRequirement === 'required');

  return (
    <div className="verification">
      <p className="verification__rollup">
        <strong>
          {verification.requiredVerified} of {verification.requiredTotal}
        </strong>{' '}
        required fields verified —{' '}
        <span className={`status-badge status-badge--${verification.label}`}>
          {verification.label}
        </span>
      </p>

      <p className="hint">
        Verification is a manual confidence check. It is recorded here but is not part of the
        readiness gate — an unverified field never blocks automation.
      </p>

      {Object.keys(verification.bySection).length > 0 && (
        <ul className="verification__by-section">
          {Object.entries(verification.bySection).map(([sectionId, c]) => (
            <li key={sectionId}>
              {sectionLabel(sectionId)}: {c.verified} of {c.total}
            </li>
          ))}
        </ul>
      )}

      {requiredFields.length === 0 ? (
        <p className="hint">No required fields to verify yet.</p>
      ) : (
        <ul className="verify-rows">
          {requiredFields.map((field) => (
            <VerifyRow
              key={field.id}
              field={field}
              applicationId={applicationId}
              applicantId={applicantId}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
