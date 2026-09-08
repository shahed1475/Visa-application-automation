import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type {
  AdapterValidationReport,
  DiscoveryFieldCandidateDTO,
  DiscoveryPageDTO,
  DiscoverySessionDTO,
  IndiaDiagnostics,
  MappingStatusCounts,
  MappingView,
  PromotedMappingEdit,
} from '../../../../shared/discovery/types';
import {
  CandidateTable,
  DiagnosticsPanel,
  DiscoveryStatusBadge,
  MappingCountsLine,
  ValidationReport,
} from './discoveryChrome';

function parseCandidates(json: string): DiscoveryFieldCandidateDTO[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as DiscoveryFieldCandidateDTO[]) : [];
  } catch {
    return [];
  }
}

export function DiscoverySessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<DiscoverySessionDTO | null>(null);
  const [pages, setPages] = useState<DiscoveryPageDTO[]>([]);
  const [mappings, setMappings] = useState<MappingView[]>([]);
  const [counts, setCounts] = useState<MappingStatusCounts | null>(null);
  const [diagnostics, setDiagnostics] = useState<IndiaDiagnostics | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [promoted, setPromoted] = useState<Record<string, PromotedMappingEdit>>({});
  const [bundleText, setBundleText] = useState<string | null>(null);
  const [report, setReport] = useState<AdapterValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSession = useCallback(async () => {
    if (!sessionId) return;
    const { session: s, pages: p } = await api.getDiscoverySession(sessionId);
    setSession(s);
    setPages(p);
    return s;
  }, [sessionId]);

  const loadAdapter = useCallback(async (portalId: string) => {
    try {
      const [{ mappings: mv, status }, { diagnostics: d }] = await Promise.all([
        api.getAdapterMappings(portalId),
        api.getAdapterDiagnostics(portalId),
      ]);
      setMappings(mv);
      setCounts(status);
      setDiagnostics(d);
    } catch {
      /* adapter panels are best-effort — the session still works */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await loadSession();
        if (cancelled || !s?.portal_id) return;
        await loadAdapter(s.portal_id);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load the discovery session.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSession, loadAdapter]);

  const placeholderPaths = mappings
    .filter((m) => m.status === 'placeholder')
    .map((m) => m.canonicalFieldPath);

  const refreshAdapter = useCallback(() => {
    if (session?.portal_id) void loadAdapter(session.portal_id);
  }, [session, loadAdapter]);

  const handleCapture = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      await api.captureDiscoveryPage(sessionId);
      await loadSession();
      refreshAdapter();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Capture failed.');
    } finally {
      setBusy(false);
    }
  }, [sessionId, loadSession, refreshAdapter]);

  const handlePromote = useCallback(
    async (pageSeq: number, candidateIndex: number, canonicalFieldPath: string) => {
      if (!sessionId) return;
      setError(null);
      try {
        const { mappingEdit } = await api.promoteCandidate(sessionId, {
          pageSeq,
          candidateIndex,
          canonicalFieldPath,
        });
        setPromoted((prev) => ({ ...prev, [`${pageSeq}:${candidateIndex}`]: mappingEdit }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Promote failed.');
      }
    },
    [sessionId],
  );

  const handleCopyAllPromoted = useCallback(async () => {
    if (!sessionId) return;
    const picks = Object.entries(promoted).map(([key, edit]) => {
      const [seqStr, idxStr] = key.split(':');
      return {
        pageSeq: Number(seqStr),
        candidateIndex: Number(idxStr),
        canonicalFieldPath: edit.canonicalFieldPath,
      };
    });
    if (picks.length === 0) return;
    setError(null);
    try {
      const { bundle } = await api.promoteBundle(sessionId, picks);
      setBundleText(bundle.literal);
      try {
        await navigator.clipboard.writeText(bundle.literal);
      } catch {
        /* clipboard blocked — the textarea below is the fallback */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the promoted bundle.');
    }
  }, [sessionId, promoted]);

  const handleValidate = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const { report: r } = await api.validateAdapter(sessionId);
      setReport(r);
      refreshAdapter();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation failed.');
    } finally {
      setBusy(false);
    }
  }, [sessionId, refreshAdapter]);

  const handleEnd = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await api.endDiscoverySession(sessionId);
      navigate('/settings/portals');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end the session.');
      setBusy(false);
    }
  }, [sessionId, navigate]);

  if (error && !session) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (!session) return <p>Loading…</p>;

  const active = session.status === 'active';

  return (
    <section className="discovery-session">
      <div className="section-head">
        <h2>Portal discovery session</h2>
        <DiscoveryStatusBadge status={session.status} />
      </div>
      <p className="muted">
        {session.adapter_id} · started {session.started_at} · {pages.length} page
        {pages.length === 1 ? '' : 's'} captured
      </p>
      {counts ? <MappingCountsLine counts={counts} /> : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="discovery-session__actions">
        <button type="button" onClick={handleCapture} disabled={!active || busy}>
          Capture this page
        </button>
        <button type="button" onClick={handleValidate} disabled={!active || busy}>
          Validate Adapter
        </button>
        <button
          type="button"
          onClick={handleCopyAllPromoted}
          disabled={Object.keys(promoted).length === 0}
        >
          Copy all promoted ({Object.keys(promoted).length})
        </button>
        <button type="button" onClick={handleEnd} disabled={busy}>
          End Session
        </button>
      </div>

      {bundleText !== null ? (
        <textarea
          className="discovery-session__bundle mono"
          readOnly
          rows={12}
          value={bundleText}
          aria-label="All promoted mappings — select and copy"
        />
      ) : null}

      {report ? <ValidationReport report={report} /> : null}

      {pages.length === 0 ? (
        <p>No pages captured yet. Navigate the portal in the browser, then capture each page.</p>
      ) : (
        <ol className="discovery-session__pages">
          {pages.map((p) => {
            const candidates = parseCandidates(p.candidates_json);
            const isOpen = expanded[p.seq] ?? false;
            return (
              <li key={p.id} className="discovery-page">
                <div className="discovery-page__head">
                  <span className="discovery-page__state">{p.state_guess ?? '(unknown state)'}</span>
                  <span className="discovery-page__url mono">{p.url_pattern ?? '—'}</span>
                  <span className="discovery-page__title">{p.page_title ?? '—'}</span>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded((prev) => ({ ...prev, [p.seq]: !isOpen }))}
                  >
                    {isOpen ? 'Hide' : 'Show'} candidates ({candidates.length})
                  </button>
                </div>
                {isOpen ? (
                  <CandidateTable
                    pageSeq={p.seq}
                    candidates={candidates}
                    placeholderPaths={placeholderPaths}
                    promoted={promoted}
                    onPromote={handlePromote}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {diagnostics ? <DiagnosticsPanel diagnostics={diagnostics} /> : null}
    </section>
  );
}
