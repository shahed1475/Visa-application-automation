import { useState } from 'react';
import type {
  DocumentDetail,
  DocumentExtractedFieldView,
} from '../../../../shared/documents/types';
import { api } from '../../api/client';
import { FIELD_SOURCE_LABELS } from '../../lib/applicantOptions';

interface Props {
  detail: DocumentDetail;
  onChange: () => void | Promise<void>;
}

const STATUS_LABEL: Record<DocumentExtractedFieldView['status'], string> = {
  applied: 'Applied',
  held: 'Held — needs your decision',
  dismissed: 'Dismissed',
  proposed: 'Proposed',
};

// Amendment 2: confidence is a labelled heuristic trust score, never a
// probability that the value is correct. The chip names the structural signal
// behind the number; the tooltip spells the caveat out.
const CONFIDENCE_TITLE = 'Heuristic trust score — not a probability of correctness.';

function confidenceChip(f: DocumentExtractedFieldView): string {
  if (f.checkDigitOk === true) return '✓ check digit';
  if (f.checkDigitOk === false) return '✗ check digit';
  if (f.source === 'passport_mrz') return 'MRZ field';
  return 'OCR';
}

function confirmDisabledReason(f: DocumentExtractedFieldView): string | null {
  if (f.verified) return 'This field is already verified.';
  if (!f.profileMatches) {
    return f.status === 'applied'
      ? "The profile value differs from what was extracted — reconcile it first."
      : 'Apply this value to the profile before you can confirm it.';
  }
  return null;
}

export function ExtractedFieldsTable({ detail, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>) {
    setError(null);
    setBusy(key);
    try {
      await action();
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error && <p className="error" role="alert">{error}</p>}
      <table className="extracted-fields">
        <thead>
          <tr>
            <th>Field</th>
            <th>Extracted value</th>
            <th>Source</th>
            <th>Confidence</th>
            <th>In profile?</th>
            <th>Verified?</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {detail.fields.map((f) => {
            const disabledReason = confirmDisabledReason(f);
            const rowBusy = busy?.startsWith(`${f.fieldPath}:`) ?? false;
            return (
              <tr key={f.id} className={f.status === 'dismissed' ? 'row--dismissed' : undefined}>
                <td>{f.fieldPath}</td>
                <td>
                  <span>{f.value ?? '—'}</span>
                  {f.value === null && f.normalizationNote && (
                    <span className="muted">
                      {' '}
                      {f.raw} (couldn't read: {f.normalizationNote})
                    </span>
                  )}
                </td>
                <td>{FIELD_SOURCE_LABELS[f.source]}</td>
                <td>
                  {f.confidence.toFixed(2)}{' '}
                  <span className="confidence-chip" title={CONFIDENCE_TITLE}>
                    {confidenceChip(f)}
                  </span>
                </td>
                <td>
                  <span className={`badge badge--${f.status}`}>{STATUS_LABEL[f.status]}</span>
                </td>
                <td>{f.verified ? '✓ Verified' : '—'}</td>
                <td className="row-actions">
                  <button
                    onClick={() =>
                      void run(`${f.fieldPath}:confirm`, () =>
                        api.setFieldMeta(detail.applicantId!, {
                          fieldPath: f.fieldPath,
                          verified: true,
                        }),
                      )
                    }
                    disabled={disabledReason !== null || rowBusy || detail.applicantId === null}
                    title={disabledReason ?? undefined}
                  >
                    Confirm
                  </button>
                  {f.status === 'held' && f.value !== null && (
                    <button
                      onClick={() =>
                        void run(`${f.fieldPath}:apply`, () =>
                          api.applyDocumentField(detail.id, f.fieldPath),
                        )
                      }
                      disabled={rowBusy}
                    >
                      Apply
                    </button>
                  )}
                  {f.status !== 'dismissed' && (
                    <button
                      className="link"
                      onClick={() =>
                        void run(`${f.fieldPath}:dismiss`, () =>
                          api.dismissDocumentField(detail.id, f.fieldPath),
                        )
                      }
                      disabled={rowBusy}
                    >
                      Dismiss
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
