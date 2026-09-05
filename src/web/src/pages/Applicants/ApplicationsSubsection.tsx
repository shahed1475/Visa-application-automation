import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { VisaApplicationSummary } from '../../../../shared/application/types';
import { getCategory, getCategoriesForMode, type ApplicationMode } from '../../../../shared/visa-kb/index';
import { api } from '../../api/client';

export function ApplicationsSubsection({ applicantId }: { applicantId: string }) {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<VisaApplicationSummary[]>([]);
  const [mode, setMode] = useState<ApplicationMode>('evisa');
  const [categoryId, setCategoryId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.listApplications(applicantId);
      setApplications(res.applications);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applications');
    }
  }, [applicantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categories = getCategoriesForMode(mode);

  function changeMode(next: ApplicationMode) {
    setMode(next);
    setCategoryId('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      setError('Choose a visa category.');
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const { application } = await api.createApplication(applicantId, { applicationMode: mode, categoryId });
      navigate(`/applications/${application.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create application');
      setCreating(false);
    }
  }

  return (
    <section className="child-section">
      <h3>Applications</h3>

      {applications.length === 0 ? (
        <p>No applications yet.</p>
      ) : (
        <table className="applications">
          <thead>
            <tr><th>Category</th><th>Mode</th><th>Status</th><th>KB version</th><th>Created</th></tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link to={`/applications/${a.id}`}>
                    {getCategory(a.categoryId)?.displayName ?? a.categoryId}
                  </Link>
                </td>
                <td>{a.applicationMode}</td>
                <td>{a.status}</td>
                <td>{a.kbVersion}</td>
                <td>{new Date(a.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="inline-form" onSubmit={onSubmit}>
        <div>
          <label htmlFor="new-app-mode">Mode</label>
          <select
            id="new-app-mode"
            value={mode}
            onChange={(e) => changeMode(e.target.value as ApplicationMode)}
          >
            <option value="evisa">e-Visa</option>
            <option value="regular">Regular</option>
          </select>
        </div>
        <div>
          <label htmlFor="new-app-category">Visa category</label>
          <select id="new-app-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— choose —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={creating}>{creating ? 'Creating…' : 'New application'}</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
