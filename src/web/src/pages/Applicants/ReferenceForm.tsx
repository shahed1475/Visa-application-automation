import { useState } from 'react';
import type { Reference } from '../../../../shared/applicant/types';
import { REFERENCE_KIND_OPTIONS } from '../../lib/applicantOptions';

const FIELDS: { key: keyof Reference & string; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'relationship', label: 'Relationship' },
  { key: 'organization', label: 'Organization' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface Props {
  initial?: Reference;
  onCancel: () => void;
  onSubmit: (values: Record<string, string | null>) => Promise<void>;
}

export function ReferenceForm({ initial, onCancel, onSubmit }: Props) {
  const [kind, setKind] = useState<string>(initial?.kind ?? 'other');
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, (initial?.[f.key] as string | null) ?? ''])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const emailVal = (draft.email ?? '').trim();
    if (emailVal.length > 0 && !EMAIL_RE.test(emailVal)) {
      setError('Email must be a valid email address');
      return;
    }
    const values: Record<string, string | null> = { kind };
    for (const f of FIELDS) {
      const v = (draft[f.key] ?? '').trim();
      values[f.key] = v.length > 0 ? v : null;
    }
    setSaving(true);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="child-form">
      {error && <p className="error" role="alert">{error}</p>}
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {REFERENCE_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {FIELDS.map((f) => (
        <label key={f.key}>
          {f.label}
          <input value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
        </label>
      ))}
      <div className="form-actions">
        <button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
