import { useCallback, useEffect, useState } from 'react';
import type { VisaPortal } from '../../../../shared/types';
import { api } from '../../api/client';
import { PortalForm } from './PortalForm';
import { TestConnectionPanel } from './TestConnectionPanel';
import { IndiaPortalCard } from './IndiaPortalCard';

type Editing = { mode: 'create' } | { mode: 'edit'; portal: VisaPortal } | null;

export function PortalsPage() {
  const [portals, setPortals] = useState<VisaPortal[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const activePortal = portals.find((p) => p.id === activeId) ?? null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, active] = await Promise.all([
        api.listPortals(),
        api.getActivePortal(),
      ]);
      setPortals(list.portals);
      setActiveId(active.activePortalId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load portals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function makeActive(id: string | null) {
    try {
      await api.setActivePortal(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set active portal');
    }
  }

  async function remove(portal: VisaPortal) {
    if (!window.confirm(`Delete portal "${portal.name}"?`)) return;
    try {
      await api.deletePortal(portal.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete portal');
    }
  }

  if (editing) {
    return (
      <PortalForm
        initial={editing.mode === 'edit' ? editing.portal : undefined}
        onCancel={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
      />
    );
  }

  return (
    <section>
      <div className="section-head">
        <h2>Visa Portals</h2>
        <button onClick={() => setEditing({ mode: 'create' })}>Add portal</button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && portals.length === 0 && (
        <p>No visa portals configured yet. Add one to get started.</p>
      )}

      {portals.length > 0 && (
        <table className="portals">
          <thead>
            <tr>
              <th>Active</th><th>Name</th><th>URL</th><th>Type</th>
              <th>Country</th><th>Application</th><th>Enabled</th><th></th>
            </tr>
          </thead>
          <tbody>
            {portals.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    type="radio"
                    name="active-portal"
                    aria-label={`Set ${p.name} active`}
                    checked={activeId === p.id}
                    disabled={!p.enabled}
                    onChange={() => makeActive(p.id)}
                  />
                </td>
                <td>{p.name}</td>
                <td className="mono">{p.url}</td>
                <td>{p.portalType}</td>
                <td>{p.country ?? '—'}</td>
                <td>{p.applicationType ?? '—'}</td>
                <td>{p.enabled ? 'Yes' : 'No'}</td>
                <td className="row-actions">
                  <button onClick={() => setEditing({ mode: 'edit', portal: p })}>
                    Edit
                  </button>
                  <button onClick={() => remove(p)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {activeId && (
        <>
          <button className="link" onClick={() => makeActive(null)}>
            Clear active portal
          </button>
          <TestConnectionPanel portalId={activeId} />
          {activePortal && <IndiaPortalCard portal={activePortal} />}
        </>
      )}
    </section>
  );
}
