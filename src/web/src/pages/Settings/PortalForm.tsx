import { useState, type FormEvent } from 'react';
import type { PortalType, VisaPortal } from '../../../../shared/types';
import type { PortalInput } from '../../../../shared/schemas';
import { isHttpUrl } from '../../../../shared/url';
import { PORTAL_TYPE_OPTIONS } from '../../lib/portalTypes';
import { api } from '../../api/client';

interface Props {
  initial?: VisaPortal;
  onCancel: () => void;
  onSaved: (portal: VisaPortal) => void | Promise<void>;
}

export function PortalForm({ initial, onCancel, onSaved }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [portalType, setPortalType] = useState<PortalType>(
    initial?.portalType ?? 'evisa',
  );
  const [country, setCountry] = useState(initial?.country ?? '');
  const [applicationType, setApplicationType] = useState(
    initial?.applicationType ?? '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setSubmitError(null);
    if (name.trim().length === 0) {
      setFieldError('Portal name is required.');
      return;
    }
    if (!isHttpUrl(url.trim())) {
      setFieldError('Portal URL must be a valid http(s) URL.');
      return;
    }
    const payload: PortalInput = {
      name: name.trim(),
      url: url.trim(),
      portalType,
      country: country.trim() || null,
      applicationType: applicationType.trim() || null,
      notes: notes.trim() || null,
      enabled,
    };
    setSaving(true);
    try {
      const res = initial
        ? await api.updatePortal(initial.id, payload)
        : await api.createPortal(payload);
      await onSaved(res.portal);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save portal.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="portal-form" onSubmit={handleSubmit}>
      <h2>{initial ? 'Edit portal' : 'Add portal'}</h2>

      <label>
        Portal name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label>
        Portal URL
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          required
        />
      </label>

      <label>
        Portal type
        <select
          value={portalType}
          onChange={(e) => setPortalType(e.target.value as PortalType)}
        >
          {PORTAL_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Country
        <input value={country} onChange={(e) => setCountry(e.target.value)} />
      </label>

      <label>
        Application / visa type
        <input
          value={applicationType}
          onChange={(e) => setApplicationType(e.target.value)}
        />
      </label>

      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enabled
      </label>

      {fieldError && <p className="error" role="alert">{fieldError}</p>}
      {submitError && <p className="error" role="alert">{submitError}</p>}

      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
