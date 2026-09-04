import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DocumentSummary } from '../../../../shared/documents/types';
import type { ApplicantSummary } from '../../../../shared/applicant/types';
import { api } from '../../api/client';

type Busy = 'idle' | 'uploading' | 'extracting';

export function DocumentsPage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [applicants, setApplicants] = useState<ApplicantSummary[]>([]);
  const [applicantId, setApplicantId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<Busy>('idle');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [docs, apps] = await Promise.all([
        api.listDocuments(),
        api.listApplicants(),
      ]);
      setDocuments(docs.documents);
      setApplicants(apps.applicants);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setError(null);
    setBusy('uploading');
    try {
      const { document } = await api.uploadDocument(file, applicantId || undefined);
      if (applicantId) {
        setBusy('extracting');
        await api.extractDocument(document.id);
      }
      navigate(`/documents/${document.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setBusy('idle');
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2>Documents</h2>
      </div>

      <form className="inline-form" onSubmit={onSubmit}>
        <div>
          <label htmlFor="doc-file">Document file</label>
          <input
            id="doc-file"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label htmlFor="doc-applicant">Applicant</label>
          <select
            id="doc-applicant"
            value={applicantId}
            onChange={(e) => setApplicantId(e.target.value)}
          >
            <option value="">— none —</option>
            {applicants.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy !== 'idle'}>
          {busy === 'uploading' ? 'Uploading…' : busy === 'extracting' ? 'Extracting…' : 'Upload'}
        </button>
      </form>
      {!applicantId && (
        <p className="hint">
          Assign an applicant before extracting — extraction fills that applicant's
          passport fields. Without one, the file is stored but not extracted.
        </p>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && documents.length === 0 && <p>No documents yet.</p>}

      {documents.length > 0 && (
        <table className="documents">
          <thead>
            <tr>
              <th>Document</th><th>Kind</th><th>Status</th>
              <th>Runs</th><th>Fields</th><th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id}>
                <td><Link to={`/documents/${d.id}`}>{d.originalName ?? '—'}</Link></td>
                <td><span className={`badge badge--${d.kind}`}>{d.kind}</span></td>
                <td>{d.status}</td>
                <td>{d.runCount}</td>
                <td>{d.fieldCount}</td>
                <td>{new Date(d.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
