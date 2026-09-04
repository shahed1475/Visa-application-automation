import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DocumentSummary } from '../../../../shared/documents/types';
import { api } from '../../api/client';

type Busy = 'idle' | 'uploading' | 'extracting';

export function DocumentsSubsection({ applicantId }: { applicantId: string }) {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<Busy>('idle');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.listDocuments(applicantId);
      setDocuments(res.documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents');
    }
  }, [applicantId]);

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
      const { document } = await api.uploadDocument(file, applicantId);
      setBusy('extracting');
      await api.extractDocument(document.id);
      navigate(`/documents/${document.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setBusy('idle');
    }
  }

  return (
    <section className="child-section">
      <h3>Documents</h3>

      {documents.length === 0 ? (
        <p>No documents uploaded.</p>
      ) : (
        <ul className="documents-subsection__list">
          {documents.map((d) => (
            <li key={d.id}>
              <Link to={`/documents/${d.id}`}>{d.originalName ?? 'Document'}</Link>{' '}
              <span className={`badge badge--${d.kind}`}>{d.kind}</span>{' '}
              {d.status} · {d.fieldCount} fields
            </li>
          ))}
        </ul>
      )}

      <form className="inline-form" onSubmit={onSubmit}>
        <div>
          <label htmlFor="applicant-doc-file">Add a document</label>
          <input
            id="applicant-doc-file"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <button type="submit" disabled={busy !== 'idle'}>
          {busy === 'uploading' ? 'Uploading…' : busy === 'extracting' ? 'Extracting…' : 'Upload'}
        </button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
