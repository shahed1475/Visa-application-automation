import { useState } from 'react';
import type { TravelRecord } from '../../../../shared/applicant/types';
import { TRIP_TYPE_OPTIONS } from '../../lib/applicantOptions';

const FIELDS: { key: keyof TravelRecord & string; label: string; type?: 'date' | 'select' | 'textarea' }[] = [
  { key: 'tripType', label: 'Trip type', type: 'select' },
  { key: 'purpose', label: 'Purpose' },
  { key: 'destinationCountry', label: 'Destination country' },
  { key: 'cities', label: 'Cities / locations' },
  { key: 'arrivalDate', label: 'Planned arrival date', type: 'date' },
  { key: 'departureDate', label: 'Planned departure date', type: 'date' },
  { key: 'portOfEntry', label: 'Port of entry' },
  { key: 'portOfExit', label: 'Port of exit' },
  { key: 'accommodation', label: 'Accommodation' },
  { key: 'previousTravel', label: 'Previous travel (summary)', type: 'textarea' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  initial?: TravelRecord;
  onCancel: () => void;
  onSubmit: (values: Record<string, string | null>) => Promise<void>;
}

export function TravelRecordForm({ initial, onCancel, onSubmit }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, (initial?.[f.key] as string | null) ?? ''])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    for (const f of FIELDS) {
      const v = (draft[f.key] ?? '').trim();
      if (f.type === 'date' && v.length > 0 && !DATE_RE.test(v)) {
        setError(`${f.label} must be YYYY-MM-DD`);
        return;
      }
    }
    const values: Record<string, string | null> = {};
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
      {FIELDS.map((f) => (
        <label key={f.key}>
          {f.label}
          {f.type === 'select' ? (
            <select value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
              <option value="">—</option>
              {TRIP_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea rows={2} value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
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
        <button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
