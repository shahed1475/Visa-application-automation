import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FieldMeta } from '../../../../shared/applicant/types';
import { FIELD_SOURCE_LABELS } from '../../lib/applicantOptions';

export interface SectionField {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'select' | 'email';
  options?: { value: string; label: string }[];
}

interface Props {
  title: string;
  sectionKey: 'identity' | 'passport' | 'contact' | 'address';
  fields: SectionField[];
  values: Record<string, string | null>;
  fieldMeta: FieldMeta[];
  onSave: (patch: Record<string, string | null>) => Promise<void>;
  onVerify: (fieldPath: string, verified: boolean) => Promise<void>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function SectionCard({ title, sectionKey, fields, values, fieldMeta, onSave, onVerify }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? ''])));
    setError(null);
    setEditing(true);
  }

  async function save() {
    for (const f of fields) {
      const v = (draft[f.key] ?? '').trim();
      if (f.type === 'date' && v.length > 0 && !DATE_RE.test(v)) {
        setError(`${f.label} must be YYYY-MM-DD`);
        return;
      }
      if (f.type === 'email' && v.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
        setError(`${f.label} must be a valid email address`);
        return;
      }
    }
    const patch: Record<string, string | null> = {};
    for (const f of fields) {
      const v = (draft[f.key] ?? '').trim();
      patch[f.key] = v.length > 0 ? v : null;
    }
    setSaving(true);
    try {
      await onSave(patch);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // The verify toggle is the one action whose promise used to float; route it
  // through the same inline `error` slot every other action in this card uses.
  async function verify(path: string, next: boolean) {
    setError(null);
    try {
      await onVerify(path, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update verification');
    }
  }

  const verifiedPaths = new Set(fieldMeta.filter((m) => m.verified).map((m) => m.fieldPath));

  return (
    <div className="section-card">
      <div className="section-card__head">
        <h3>{title}</h3>
        {!editing && <button onClick={startEdit}>Edit</button>}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {editing ? (
        <div className="section-card__form">
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.type === 'select' ? (
                <select value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={draft[f.key] ?? ''}
                  placeholder={f.type === 'date' ? 'YYYY-MM-DD' : ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              )}
            </label>
          ))}
          <div className="form-actions">
            <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="link" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <dl className="section-card__view">
          {fields.map((f) => {
            const value = values[f.key];
            const path = `${sectionKey}.${f.key}`;
            const isVerified = verifiedPaths.has(path);
            const meta = fieldMeta.find((m) => m.fieldPath === path);
            return (
              <div key={f.key} className="section-card__row">
                <dt>{f.label}</dt>
                <dd>
                  {value ?? '—'}
                  {meta && meta.source !== 'manual' && value != null && (
                    <span className="provenance-hint">
                      {FIELD_SOURCE_LABELS[meta.source]}
                      {meta.confidence != null && ` · ${meta.confidence.toFixed(2)}`}
                      {meta.documentId != null && (
                        <> · <Link to={`/documents/${meta.documentId}`}>source document</Link></>
                      )}
                    </span>
                  )}
                </dd>
                <dd className="section-card__verify">
                  {value == null ? null : (
                    <button
                      className={isVerified ? 'verify verify--on' : 'verify'}
                      aria-pressed={isVerified}
                      onClick={() => void verify(path, !isVerified)}
                    >
                      {isVerified ? '✓ Verified' : 'Confirm'}
                    </button>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
