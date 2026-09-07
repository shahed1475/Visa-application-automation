import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentPlan } from '../../../../shared/application/types';
import { api } from '../../api/client';
import { SourceLine } from './provenance';

const REVIEW_TEXT = 'Review required — the app cannot determine whether this applies';

type Busy = 'idle' | 'uploading' | 'extracting';

function DocumentRow({ doc }: { doc: DocumentPlan }) {
  const unresolvedConditional = doc.requirement === 'conditional' && doc.conditionMet === null;
  // The chip must show `effectiveRequirement`, the value the gate actually uses — the same
  // thing field rows show. Rendering the base `requirement` labelled a return-ticket document
  // "optional" while Missing info and the blocker list called it required.
  const promoted = doc.effectiveRequirement !== doc.requirement;
  return (
    <li className="doc-row">
      <div className="doc-row__head">
        <span className="doc-row__label">{doc.label}</span>
        <span className={`req-chip req-chip--${doc.effectiveRequirement}`}>
          {doc.effectiveRequirement.replace(/_/g, ' ')}
        </span>
        {promoted && (
          <span className="doc-row__flag">listed as {doc.requirement}</span>
        )}
        {doc.uploaded ? (
          <span className="doc-row__flag doc-row__flag--present">uploaded</span>
        ) : (
          <span className="doc-row__flag doc-row__flag--missing">not uploaded</span>
        )}
      </div>

      {unresolvedConditional && <p className="review-note">{REVIEW_TEXT}</p>}

      {doc.matchedDocumentId !== null && (
        <p className="doc-row__match">
          Matched to an uploaded document —{' '}
          <Link to={`/documents/${doc.matchedDocumentId}`}>view document</Link>
        </p>
      )}

      <SourceLine source={doc.source} />
    </li>
  );
}

interface Props {
  documents: DocumentPlan[];
  applicantId: string;
  onChanged: () => void | Promise<void>;
}

export function RequiredDocumentsSection({ documents, applicantId, onChanged }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<Busy>('idle');
  const [error, setError] = useState<string | null>(null);

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
      setFile(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy('idle');
    }
  }

  return (
    <div className="required-documents">
      {documents.length === 0 ? (
        <p className="hint">No documents are required for this visa category yet.</p>
      ) : (
        <ul className="doc-rows">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
        </ul>
      )}

      <form className="inline-form" onSubmit={onSubmit}>
        <div>
          <label htmlFor="application-doc-file">Add a document</label>
          <input
            id="application-doc-file"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <button type="submit" disabled={busy !== 'idle'}>
          {busy === 'uploading' ? 'Uploading…' : busy === 'extracting' ? 'Extracting…' : 'Upload'}
        </button>
      </form>
      <p className="hint">
        Uploads are attached to this applicant and matched against the required list on reload.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
