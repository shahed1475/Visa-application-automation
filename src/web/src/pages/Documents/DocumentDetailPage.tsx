import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DocumentDetail, ExtractionMethod } from '../../../../shared/documents/types';
import { api } from '../../api/client';
import { ExtractedFieldsTable } from './ExtractedFieldsTable';

const METHOD_LABEL: Record<ExtractionMethod, string> = {
  mrz: 'MRZ',
  ocr: 'OCR',
  mrz_ocr: 'MRZ+OCR',
};

function methodLabel(m: ExtractionMethod | null): string {
  return m ? METHOD_LABEL[m] : '—';
}

// User-facing wording for a failed extraction. Anything not listed falls through
// as the raw code so a new failure mode is still legible.
function friendly(code: string | null): string {
  switch (code) {
    case 'pdf_encrypted':
      return 'the PDF is password-protected';
    case 'pdf_unsupported':
      return "the PDF format isn't supported — upload the photo page as a JPEG or PNG";
    case 'unreadable':
      return 'the image could not be read';
    default:
      return code ?? 'unknown error';
  }
}

function runMrzText(run: DocumentDetail['runs'][number]): string {
  if (run.mrzValid) return 'MRZ valid';
  if (run.mrzDetected) return 'MRZ invalid';
  return 'no MRZ';
}

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'idle' | 'extracting' | 'deleting'>('idle');

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.getDocument(id);
      setDetail(res.document);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the document');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading && !detail) return <p>Loading…</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!detail || !id) return <p>Document not found.</p>;

  const isImage = detail.mimeType.startsWith('image/');
  const unlinked = detail.applicantId === null;

  async function reExtract() {
    setBusy('extracting');
    try {
      await api.extractDocument(id!);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-extraction failed');
    } finally {
      setBusy('idle');
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${detail!.originalName ?? 'this document'}"? This cannot be undone.`)) {
      return;
    }
    setBusy('deleting');
    try {
      await api.deleteDocument(id!);
      navigate('/documents');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setBusy('idle');
    }
  }

  return (
    <section>
      <p><Link to="/documents">← All documents</Link></p>

      <div className="section-head">
        <h2>{detail.originalName ?? 'Document'}</h2>
        <div className="row-actions">
          <button onClick={() => void reExtract()} disabled={busy !== 'idle' || unlinked}>
            {busy === 'extracting' ? 'Extracting…' : 'Re-extract'}
          </button>
          <button onClick={() => void remove()} disabled={busy !== 'idle'}>
            Delete
          </button>
        </div>
      </div>

      <p className="doc-meta">
        <span className={`badge badge--${detail.kind}`}>{detail.kind}</span>
        {detail.classificationConfidence != null && (
          <span>Classification {Math.round(detail.classificationConfidence * 100)}%</span>
        )}
        {detail.latestExtractionMethod && (
          <span>Method {methodLabel(detail.latestExtractionMethod)}</span>
        )}
        {detail.latestOcrMeanConfidence != null && (
          <span>OCR mean {detail.latestOcrMeanConfidence}</span>
        )}
      </p>

      {unlinked && (
        <p className="hint">
          This document isn't linked to an applicant. Re-upload it from an applicant's page to
          run extraction.
        </p>
      )}

      {detail.status === 'failed' && (
        <p className="error">Extraction failed: {friendly(detail.errorCode)}</p>
      )}

      <div className="doc-original">
        {isImage ? (
          <img src={api.documentFileUrl(id)} alt="uploaded document" style={{ maxWidth: '360px' }} />
        ) : (
          <a href={api.documentFileUrl(id)} target="_blank" rel="noreferrer">Open the PDF</a>
        )}
      </div>

      <h3>Extraction runs</h3>
      {detail.runs.length === 0 ? (
        <p className="hint">No extraction has run yet.</p>
      ) : (
        <ul className="doc-runs">
          {detail.runs.map((run) => (
            <li key={run.id}>
              #{run.attempt} · {methodLabel(run.method)} · {runMrzText(run)} · {run.fieldCount} fields
              {' '}· {run.status} · {new Date(run.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      )}

      <h3>Extracted fields</h3>
      <ExtractedFieldsTable detail={detail} onChange={reload} />
    </section>
  );
}
