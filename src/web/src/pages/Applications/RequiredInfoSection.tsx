import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FieldPlan, SectionPlan } from '../../../../shared/application/types';
import { api } from '../../api/client';
import { SourceLine } from './provenance';

const REVIEW_TEXT = 'Review required — the app cannot determine this';

/** A field is shown when it is effectively required/optional, or when it is a
 *  conditional field the engine could not resolve (`conditionMet === null`). */
function isVisible(f: FieldPlan): boolean {
  return (
    f.effectiveRequirement !== 'not_applicable' ||
    (f.requirement === 'conditional' && f.conditionMet === null)
  );
}

function isApplicationScoped(f: FieldPlan): boolean {
  return f.appliesTo !== null && f.appliesTo.startsWith('application.');
}

interface RowProps {
  field: FieldPlan;
  applicationId: string;
  applicantId: string;
  onChanged: () => void | Promise<void>;
}

function FieldRow({ field, applicationId, applicantId, onChanged }: RowProps) {
  const [draft, setDraft] = useState(field.value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(field.value ?? '');
  }, [field.value]);

  async function save() {
    if (field.appliesTo === null) return;
    setError(null);
    setSaving(true);
    try {
      await api.setApplicationFieldValue(applicationId, {
        fieldPath: field.appliesTo,
        value: draft.trim() ? draft : null,
      });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the value');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="field-row">
      <div className="field-row__head">
        <span className="field-row__label">{field.label}</span>
        <span className={`req-chip req-chip--${field.effectiveRequirement}`}>
          {field.effectiveRequirement.replace(/_/g, ' ')}
        </span>
        {field.present ? (
          <span className="field-row__flag field-row__flag--present">present</span>
        ) : (
          <span className="field-row__flag field-row__flag--missing">not provided</span>
        )}
        {field.verified && <span className="field-row__flag field-row__flag--verified">verified</span>}
      </div>

      {field.requirement === 'conditional' && field.conditionMet === null && (
        <p className="review-note">{REVIEW_TEXT}</p>
      )}

      {isApplicationScoped(field) ? (
        <div className="field-row__edit">
          <input
            aria-label={field.label}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save field'}
          </button>
        </div>
      ) : (
        <div className="field-row__edit">
          <span className="field-row__value">{field.value ?? '—'}</span>
          {field.appliesTo !== null && (
            <Link to={`/applicants/${applicantId}`}>Edit in profile</Link>
          )}
        </div>
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
  sections: SectionPlan[];
  applicationId: string;
  applicantId: string;
  onChanged: () => void | Promise<void>;
}

export function RequiredInfoSection({ sections, applicationId, applicantId, onChanged }: Props) {
  const applicable = sections.filter((s) => s.applicable);

  if (applicable.length === 0) {
    return <p className="hint">No information sections apply to this visa category yet.</p>;
  }

  return (
    <div className="required-info">
      {applicable.map((section) => {
        const rows = section.fields.filter(isVisible);
        return (
          <section key={section.id} className="required-info__section">
            <h3>{section.label}</h3>
            <SourceLine source={section.source} />
            {rows.length === 0 ? (
              <p className="hint">No fields required for this section.</p>
            ) : (
              <ul className="field-rows">
                {rows.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    applicationId={applicationId}
                    applicantId={applicantId}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
