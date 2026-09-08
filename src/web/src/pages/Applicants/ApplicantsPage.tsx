import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApplicantSummary } from '../../../../shared/applicant/types';
import { api } from '../../api/client';

export function ApplicantsPage() {
  const [rows, setRows] = useState<ApplicantSummary[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const res = await api.listApplicants(term.trim() || undefined);
      setRows(res.applicants);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applicants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  function onSearch(value: string) {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(value), 200);
  }

  async function create() {
    if (newName.trim().length === 0) return;
    try {
      await api.createApplicant({ displayName: newName.trim() });
      setNewName('');
      setCreating(false);
      await load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create applicant');
    }
  }

  async function remove(row: ApplicantSummary) {
    if (!window.confirm(`Delete applicant "${row.displayName}"? This cannot be undone.`)) return;
    try {
      await api.deleteApplicant(row.id);
      await load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete applicant');
    }
  }

  async function duplicate(row: ApplicantSummary) {
    try {
      await api.duplicateApplicant(row.id);
      await load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to duplicate applicant');
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2>Applicants</h2>
        <button onClick={() => setCreating((v) => !v)}>New applicant</button>
      </div>

      {creating && (
        <div className="inline-form">
          <label htmlFor="new-applicant-name">Display name</label>
          <input
            id="new-applicant-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button onClick={create}>Create</button>
          <button className="link" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      )}

      <label htmlFor="applicant-search">Search applicants</label>
      <input
        id="applicant-search"
        placeholder="name, passport number, nationality, email…"
        value={q}
        onChange={(e) => onSearch(e.target.value)}
      />

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && rows.length === 0 && <p>No applicants yet. Create one to get started.</p>}

      {rows.length > 0 && (
        <table className="applicants">
          <thead>
            <tr>
              <th>Name</th><th>Nationality</th><th>Passport</th>
              <th>Complete</th><th>Verified</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/applicants/${r.id}`}>{r.displayName}</Link></td>
                <td>{r.nationality ?? '—'}</td>
                <td className="mono">{r.passportNumberLast4 ? `••••${r.passportNumberLast4}` : '—'}</td>
                <td>
                  <span className="bar" aria-label={`${Math.round(r.completeness.overall * 100)}% complete`}>
                    <span className="bar__fill" style={{ width: `${r.completeness.overall * 100}%` }} />
                  </span>
                </td>
                <td><span className={`badge badge--${r.verification.label}`}>{r.verification.label}</span></td>
                <td className="row-actions">
                  <Link className="button-link" to={`/applicants/${r.id}`}>View</Link>
                  <button onClick={() => duplicate(r)}>Duplicate</button>
                  <button className="danger" onClick={() => remove(r)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
