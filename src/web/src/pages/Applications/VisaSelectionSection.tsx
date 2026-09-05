import { useEffect, useState, type FormEvent } from 'react';
import type { VisaApplication } from '../../../../shared/application/types';
import type { ApplicationPut } from '../../../../shared/application/schemas';
import {
  ENTRY_TYPES,
  PURPOSE_TAGS,
  getCategoriesForMode,
  type ApplicationMode,
  type PurposeTag,
} from '../../../../shared/visa-kb/index';
import type { EntryType } from '../../../../shared/application/types';
import { api } from '../../api/client';

function humanize(tag: string): string {
  return tag.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

interface Props {
  application: VisaApplication;
  onSaved: () => void | Promise<void>;
}

interface FormState {
  applicationMode: ApplicationMode;
  categoryId: string;
  purpose: string;
  entryType: string;
  intendedArrivalDate: string;
  intendedStayDays: string;
  portOfArrival: string;
}

function toForm(a: VisaApplication): FormState {
  return {
    applicationMode: a.applicationMode,
    categoryId: a.categoryId,
    purpose: a.purpose ?? '',
    entryType: a.entryType ?? '',
    intendedArrivalDate: a.intendedArrivalDate ?? '',
    intendedStayDays: a.intendedStayDays == null ? '' : String(a.intendedStayDays),
    portOfArrival: a.portOfArrival ?? '',
  };
}

export function VisaSelectionSection({ application, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(application));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from props after the page reloads the plan post-save.
  useEffect(() => {
    setForm(toForm(application));
  }, [application]);

  const categories = getCategoriesForMode(form.applicationMode);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function changeMode(mode: ApplicationMode) {
    setForm((f) => ({ ...f, applicationMode: mode, categoryId: '' }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const patch: ApplicationPut = {
      applicationMode: form.applicationMode,
      categoryId: form.categoryId,
      purpose: (form.purpose || null) as PurposeTag | null,
      entryType: (form.entryType || null) as EntryType | null,
      intendedArrivalDate: form.intendedArrivalDate || null,
      intendedStayDays: form.intendedStayDays.trim() ? Number(form.intendedStayDays) : null,
      portOfArrival: form.portOfArrival || null,
    };
    try {
      await api.updateApplication(application.id, patch);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the visa selection');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="selection-form" onSubmit={onSubmit}>
      <div className="field-grid">
        <label>
          <span>Mode</span>
          <select
            value={form.applicationMode}
            onChange={(e) => changeMode(e.target.value as ApplicationMode)}
          >
            <option value="evisa">e-Visa</option>
            <option value="regular">Regular</option>
          </select>
        </label>
        <label>
          <span>Visa category</span>
          <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">— choose —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Purpose</span>
          <select value={form.purpose} onChange={(e) => set('purpose', e.target.value)}>
            <option value="">— none —</option>
            {PURPOSE_TAGS.map((p) => (
              <option key={p} value={p}>
                {humanize(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Entry type</span>
          <select value={form.entryType} onChange={(e) => set('entryType', e.target.value)}>
            <option value="">— none —</option>
            {ENTRY_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Intended arrival date</span>
          <input
            type="date"
            value={form.intendedArrivalDate}
            onChange={(e) => set('intendedArrivalDate', e.target.value)}
          />
        </label>
        <label>
          <span>Intended stay (days)</span>
          <input
            type="number"
            min="1"
            value={form.intendedStayDays}
            onChange={(e) => set('intendedStayDays', e.target.value)}
          />
        </label>
        <label>
          <span>Port of arrival</span>
          <input
            type="text"
            value={form.portOfArrival}
            onChange={(e) => set('portOfArrival', e.target.value)}
          />
        </label>
      </div>

      <p className="hint">
        Purpose, port of arrival and the intended dates set here also answer the matching questions in
        Required information.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save selection'}
      </button>
    </form>
  );
}
