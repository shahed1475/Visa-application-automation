import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { VisaPortal } from '../../../../shared/types';
import type { IndiaDiagnostics, MappingStatusCounts } from '../../../../shared/discovery/types';
import { api } from '../../api/client';

/**
 * Phase 6 §5.5 — Settings card for the India portal adapter. Shows the adapter's
 * lifecycle status and launches a discovery session. Value-free: it renders only
 * the adapter version, mapping counts and a derived status label.
 *
 * Self-hides when the adapter read model is unavailable (the active portal is not
 * the India adapter, or the route 404s).
 */

type CardStatus =
  | 'Needs Discovery'
  | 'Needs Mapping'
  | 'Needs Validation'
  | 'Ready'
  | 'Mapping in progress';

export function deriveCardStatus(
  counts: MappingStatusCounts,
  diagnostics: IndiaDiagnostics,
): CardStatus {
  if (diagnostics.pagesDiscovered === 0 && diagnostics.lastDiscoveryAt === null) {
    return 'Needs Discovery';
  }
  if (counts.discovered === 0 && counts.validated === 0) return 'Needs Mapping';
  if (counts.discovered > 0 && counts.validated === 0) return 'Needs Validation';
  if (counts.requiredRemaining === 0 && counts.validated === counts.total) return 'Ready';
  return 'Mapping in progress';
}

const STATUS_HINT: Record<CardStatus, string> = {
  'Needs Discovery': 'Run a discovery session against the authenticated portal to capture its pages.',
  'Needs Mapping': 'Pages were captured — promote discovered selectors onto the canonical fields.',
  'Needs Validation': 'Selectors are mapped — run adapter validation against a live page.',
  Ready: 'Every mapping is validated. The adapter is ready to drive an autofill run.',
  'Mapping in progress': 'Some mappings are still discovered or placeholder.',
};

function isTosError(message: string): boolean {
  return /terms of service|acknowledge/i.test(message);
}

export function IndiaPortalCard({ portal }: { portal: VisaPortal }) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [counts, setCounts] = useState<MappingStatusCounts | null>(null);
  const [diagnostics, setDiagnostics] = useState<IndiaDiagnostics | null>(null);
  const [needsAck, setNeedsAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ status }, { diagnostics: d }] = await Promise.all([
          api.getAdapterMappings(portal.id),
          api.getAdapterDiagnostics(portal.id),
        ]);
        if (cancelled) return;
        if (!status || d?.adapterId !== 'india') {
          setHidden(true);
          return;
        }
        setCounts(status);
        setDiagnostics(d);
      } catch {
        if (!cancelled) setHidden(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portal.id]);

  const startDiscovery = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { session } = await api.startDiscoverySession(portal.id);
      navigate(`/discovery/${session.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not start discovery.';
      if (isTosError(msg)) {
        setNeedsAck(true);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }, [portal.id, navigate]);

  const confirmAck = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.recordPolicyAck(portal.id);
      setNeedsAck(false);
      const { session } = await api.startDiscoverySession(portal.id);
      navigate(`/discovery/${session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not acknowledge the portal Terms.');
    } finally {
      setBusy(false);
    }
  }, [portal.id, navigate]);

  if (hidden) return null;
  if (!counts || !diagnostics) return null;

  const status = deriveCardStatus(counts, diagnostics);

  return (
    <section className="india-portal-card">
      <div className="section-head">
        <h3>India portal adapter</h3>
        <span className={`run-badge india-portal-card__status india-portal-card__status--${status.replace(/\s+/g, '-').toLowerCase()}`}>
          {status}
        </span>
      </div>
      <p className="muted">
        {portal.name} · adapter v{diagnostics.adapterVersion} · mapping {diagnostics.mappingRevision}
      </p>
      <p>{STATUS_HINT[status]}</p>
      <p className="muted">
        {counts.validated} validated · {counts.discovered} discovered · {counts.placeholder}{' '}
        placeholder / {counts.total} total · {counts.requiredRemaining} remaining
      </p>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {needsAck ? (
        <div className="india-portal-card__ack" role="alert">
          <p>
            The portal&rsquo;s Terms of Service must be acknowledged before a discovery session can
            start.
          </p>
          <button type="button" onClick={confirmAck} disabled={busy}>
            Acknowledge and start discovery
          </button>
        </div>
      ) : (
        <div className="india-portal-card__actions">
          <button type="button" onClick={startDiscovery} disabled={busy}>
            Start Discovery
          </button>
        </div>
      )}
    </section>
  );
}
