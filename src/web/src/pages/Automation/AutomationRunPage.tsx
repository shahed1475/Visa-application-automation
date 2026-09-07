import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { isTerminal } from '../../../../shared/automation/states';
import type {
  RunStatus,
  AutomationRunRow,
  AutomationEventRow,
} from '../../../../shared/automation/types';
import type { IndiaDiagnostics } from '../../../../shared/discovery/types';
import {
  ActionRequiredPanel,
  AdapterProvenance,
  EventLog,
  ProgressBar,
  SafeStopBanner,
  StaleMappingWarning,
  StatusBadge,
  ValueConflictPanel,
} from './runChrome';

type Mismatch = { fieldPath: string; expected: string; actual: string };

const POLL_MS = 1500;

function bySeq(a: AutomationEventRow, b: AutomationEventRow) {
  return a.seq - b.seq;
}

function maxSeq(rows: AutomationEventRow[], fallback: number): number {
  return rows.reduce((acc, r) => Math.max(acc, r.seq), fallback);
}

export function AutomationRunPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<AutomationRunRow | null>(null);
  const [events, setEvents] = useState<AutomationEventRow[]>([]);
  const [headerNames, setHeaderNames] = useState<{ applicant?: string; category?: string }>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mismatches, setMismatches] = useState<Mismatch[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<IndiaDiagnostics | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lastSeq = useRef(0);
  const inFlight = useRef(false);

  // ---- initial load (+ best-effort header names) -------------------------
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const { run: r, events: evs } = await api.getAutomationRun(id);
        if (cancelled) return;
        const sorted = [...evs].sort(bySeq);
        setRun(r);
        setEvents(sorted);
        lastSeq.current = maxSeq(sorted, 0);
        setLoadError(null);
        // Value-free adapter provenance for an India run. Best-effort — the
        // provenance line and stale-mapping warning just stay hidden on failure.
        if (r.adapter_id === 'india' && r.portal_id) {
          const portalId = r.portal_id;
          void (async () => {
            try {
              const { diagnostics: d } = await api.getAdapterDiagnostics(portalId);
              if (!cancelled) setDiagnostics(d);
            } catch {
              /* best-effort */
            }
          })();
        }
        try {
          const { application, plan } = await api.getApplication(r.application_id);
          if (cancelled) return;
          const next: { applicant?: string; category?: string } = {
            category: plan?.category?.displayName ?? undefined,
          };
          try {
            const { applicant } = await api.getApplicant(application.applicantId);
            if (!cancelled) next.applicant = applicant.displayName;
          } catch {
            /* best-effort — leave the id showing */
          }
          if (!cancelled) setHeaderNames(next);
        } catch {
          /* best-effort — leave the ids showing */
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Failed to load the automation run.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // ---- one polling tick -------------------------------------------------
  const poll = useCallback(async () => {
    if (!id || inFlight.current) return;
    inFlight.current = true;
    try {
      const [{ events: fresh }, { run: freshRun }] = await Promise.all([
        api.getAutomationEvents(id, lastSeq.current),
        api.getAutomationRun(id),
      ]);
      if (fresh.length > 0) {
        const sorted = [...fresh].sort(bySeq);
        setEvents((prev) => [...prev, ...sorted]);
        lastSeq.current = maxSeq(sorted, lastSeq.current);
      }
      setRun(freshRun);
    } catch {
      /* transient — keep polling */
    } finally {
      inFlight.current = false;
    }
  }, [id]);

  // ---- polling lifecycle: run while non-terminal, clear at terminal -----
  const status: RunStatus | null = run ? run.status : null;
  useEffect(() => {
    if (!id || !status || isTerminal(status)) return;
    const timer = setInterval(() => {
      void poll();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, status, poll]);

  // ---- value_mismatch: pull the in-memory mismatch list ----------------
  const waitingReason = run?.waiting_reason ?? null;
  const needsLive = waitingReason === 'value_mismatch' || waitingReason === 'value_conflict';
  useEffect(() => {
    if (!id || !needsLive) {
      if (!needsLive) setMismatches(null);
      return;
    }
    let cancelled = false;
    api
      .getAutomationLive(id)
      .then((r) => {
        if (!cancelled) setMismatches(r.mismatches);
      })
      .catch(() => {
        /* best-effort — the panel still shows the instruction */
      });
    return () => {
      cancelled = true;
    };
  }, [id, needsLive]);

  const handleResume = useCallback(
    async (decision?: 'use_application' | 'keep_portal') => {
      if (!id) return;
      setBusy(true);
      setResumeError(null);
      try {
        if (decision) await api.resumeAutomationRun(id, decision);
        else await api.resumeAutomationRun(id);
        const { run: fresh } = await api.getAutomationRun(id);
        setRun(fresh);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Resume failed.';
        setResumeError(
          /checkpoint/i.test(msg)
            ? 'The challenge is still on the page — complete it in the browser, then resume.'
            : msg,
        );
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  const handleEditApplication = useCallback(async () => {
    if (!id || !run) return;
    try {
      await api.abortAutomationRun(id);
    } catch {
      /* proceed to the editor regardless — the run is a dead end here */
    }
    navigate(`/applications/${run.application_id}`);
  }, [id, run, navigate]);

  const handleAbort = useCallback(async () => {
    if (!id) return;
    try {
      await api.abortAutomationRun(id);
      const { run: fresh } = await api.getAutomationRun(id);
      setRun(fresh);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not abort the run.');
    }
  }, [id]);

  if (loadError && !run) {
    return (
      <p className="error" role="alert">
        {loadError}
      </p>
    );
  }
  if (!run) return <p>Loading…</p>;

  const nonTerminal = !isTerminal(run.status);

  return (
    <section className="automation-run">
      <h1>Automation run</h1>
      <p className="muted">
        {headerNames.applicant ?? run.application_id}
        {headerNames.category ? ` · ${headerNames.category}` : ''} · {run.portal_url_snapshot} ·
        adapter: {run.adapter_id}
      </p>

      <AdapterProvenance diagnostics={diagnostics} />
      {nonTerminal && <StaleMappingWarning diagnostics={diagnostics} />}

      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}

      <StatusBadge status={run.status} waitingReason={run.waiting_reason} />

      <ProgressBar label="Fields verified" value={run.fields_verified} max={run.fields_total} />
      <p className="ready-line automation-run__docs">
        Documents ready: {run.documents_ready} / {run.documents_total}
      </p>
      <p className="muted">Current page: {run.current_portal_state ?? '—'}</p>

      <EventLog events={events} />

      {run.status === 'waiting_for_user' && run.waiting_reason === 'value_conflict' && (
        <ValueConflictPanel
          // The engine records the conflict pair immediately before it pauses,
          // so on a value_conflict wait the LAST mismatch is this field's — an
          // earlier non-required value_mismatch may still sit at [0].
          mismatch={mismatches?.at(-1) ?? null}
          resumeError={resumeError}
          busy={busy}
          onUseApplication={() => void handleResume('use_application')}
          onKeepPortal={() => void handleResume('keep_portal')}
          onEditApplication={() => void handleEditApplication()}
        />
      )}

      {run.status === 'waiting_for_user' && run.waiting_reason !== 'value_conflict' && (
        <ActionRequiredPanel
          reason={run.waiting_reason}
          mismatches={mismatches}
          resumeError={resumeError}
          busy={busy}
          onResume={() => void handleResume()}
          onAbort={handleAbort}
        />
      )}

      {run.status === 'review_ready' && <SafeStopBanner />}

      {run.status === 'failed' && (
        <p className="error">The run failed ({run.error_code ?? 'unknown error'}).</p>
      )}

      {nonTerminal && (
        <button type="button" className="automation-run__abort" onClick={handleAbort}>
          Abort automation
        </button>
      )}
    </section>
  );
}
