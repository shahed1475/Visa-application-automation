import { useState } from 'react';
import type {
  AdapterValidationReport,
  DiscoveryFieldCandidateDTO,
  IndiaDiagnostics,
  MappingStatusCounts,
  PromotedMappingEdit,
} from '../../../../shared/discovery/types';

/**
 * Phase 6 §5.5 presentational sub-components for the discovery session page.
 * Every one of these is value-free: it renders labels, selectors, control kinds,
 * timestamps and counts only — never a portal field value.
 */

const STATUS_TEXT: Record<string, string> = {
  active: 'Active',
  ended: 'Ended',
  aborted: 'Aborted',
};

export function DiscoveryStatusBadge({ status }: { status: string }) {
  return (
    <span className={`run-badge run-badge--${status}`}>{STATUS_TEXT[status] ?? status}</span>
  );
}

export function DiagnosticsPanel({ diagnostics }: { diagnostics: IndiaDiagnostics }) {
  const m = diagnostics.mappings;
  return (
    <section className="adapter-diagnostics" role="status">
      <h3>Adapter diagnostics</h3>
      <dl className="adapter-diagnostics__grid">
        <dt>Adapter</dt>
        <dd>
          {diagnostics.adapterId} v{diagnostics.adapterVersion}
        </dd>
        <dt>Mapping revision</dt>
        <dd>{diagnostics.mappingRevision}</dd>
        <dt>Last discovery</dt>
        <dd>{diagnostics.lastDiscoveryAt ?? '—'}</dd>
        <dt>Pages discovered</dt>
        <dd>{diagnostics.pagesDiscovered}</dd>
        <dt>Fields discovered</dt>
        <dd>{diagnostics.fieldsDiscovered}</dd>
        <dt>Mappings</dt>
        <dd>
          {m.validated} validated · {m.discovered} discovered · {m.placeholder} placeholder /{' '}
          {m.total} total · {m.requiredRemaining} remaining
        </dd>
        <dt>Unknown pages encountered</dt>
        <dd>{diagnostics.unknownPagesEncountered}</dd>
        <dt>Last validation</dt>
        <dd>
          {diagnostics.lastValidation
            ? `${diagnostics.lastValidation.ok ? 'passed' : 'failed'} at ${diagnostics.lastValidation.ranAt}`
            : '—'}
        </dd>
      </dl>
    </section>
  );
}

export function MappingCountsLine({ counts }: { counts: MappingStatusCounts }) {
  return (
    <p className="muted">
      {counts.validated} validated · {counts.discovered} discovered · {counts.placeholder}{' '}
      placeholder / {counts.total} total
    </p>
  );
}

export function CandidateTable({
  pageSeq,
  candidates,
  placeholderPaths,
  promoted,
  onPromote,
}: {
  pageSeq: number;
  candidates: DiscoveryFieldCandidateDTO[];
  placeholderPaths: string[];
  promoted: Record<string, PromotedMappingEdit>;
  onPromote: (pageSeq: number, candidateIndex: number, canonicalFieldPath: string) => void;
}) {
  return (
    <table className="candidate-table">
      <thead>
        <tr>
          <th>Label</th>
          <th>Primary selector</th>
          <th>Control</th>
          <th>Selector confidence</th>
          <th>Promote to</th>
        </tr>
      </thead>
      <tbody>
        {candidates.map((c, i) => (
          <CandidateRow
            key={`${pageSeq}:${i}`}
            pageSeq={pageSeq}
            index={i}
            candidate={c}
            placeholderPaths={placeholderPaths}
            promoted={promoted[`${pageSeq}:${i}`]}
            onPromote={onPromote}
          />
        ))}
      </tbody>
    </table>
  );
}

function CandidateRow({
  pageSeq,
  index,
  candidate,
  placeholderPaths,
  promoted,
  onPromote,
}: {
  pageSeq: number;
  index: number;
  candidate: DiscoveryFieldCandidateDTO;
  placeholderPaths: string[];
  promoted: PromotedMappingEdit | undefined;
  onPromote: (pageSeq: number, candidateIndex: number, canonicalFieldPath: string) => void;
}) {
  const [path, setPath] = useState('');
  return (
    <>
      <tr>
        <td>{candidate.label || '—'}</td>
        <td className="mono">{candidate.primarySelector}</td>
        <td>{candidate.control}</td>
        <td>{candidate.selectorConfidence}</td>
        <td className="candidate-table__promote">
          <select
            aria-label={`Canonical field for candidate ${index + 1}`}
            value={path}
            onChange={(e) => setPath(e.target.value)}
          >
            <option value="">Choose a field…</option>
            {placeholderPaths.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!path}
            onClick={() => onPromote(pageSeq, index, path)}
          >
            Promote
          </button>
        </td>
      </tr>
      {promoted ? (
        <tr>
          <td colSpan={5}>
            <pre className="candidate-table__literal">{promoted.literal}</pre>
            {promoted.warnings.length > 0 ? (
              <ul className="candidate-table__warnings">
                {promoted.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function ValidationReport({ report }: { report: AdapterValidationReport }) {
  return (
    <section className="validation-report" data-testid="validation-report">
      <h3>
        Adapter validation — {report.ok ? 'PASS' : 'issues found'} ({report.ranAt})
      </h3>
      <ul className="validation-report__list">
        {report.fields.map((f) => (
          <li key={`f:${f.fieldPath}`}>
            {f.fieldPath}: {f.resolvable && f.controlMatches ? 'pass' : 'fail'}
            {f.note ? ` — ${f.note}` : ''}
          </li>
        ))}
        {report.states.map((s) => (
          <li key={`s:${s.state}`}>
            {s.state} (next): {s.nextResolvable ? 'pass' : 'fail'}
          </li>
        ))}
      </ul>
    </section>
  );
}
