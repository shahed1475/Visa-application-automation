import { useState } from 'react';
import type { Reference } from '../../../../shared/applicant/types';
import { api } from '../../api/client';
import { REFERENCE_KIND_OPTIONS } from '../../lib/applicantOptions';
import { ReferenceForm } from './ReferenceForm';

interface Props {
  applicantId: string;
  records: Reference[];
  onChange: () => Promise<void>;
}

const kindLabel = (k: string) => REFERENCE_KIND_OPTIONS.find((o) => o.value === k)?.label ?? k;

export function ReferenceSection({ applicantId, records, onChange }: Props) {
  const [mode, setMode] = useState<{ kind: 'add' } | { kind: 'edit'; id: string } | null>(null);

  async function add(values: Record<string, string | null>) {
    await api.addReference(applicantId, values as never);
    setMode(null);
    await onChange();
  }
  async function edit(id: string, values: Record<string, string | null>) {
    await api.updateReference(applicantId, id, values as never);
    setMode(null);
    await onChange();
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this reference?')) return;
    await api.deleteReference(applicantId, id);
    await onChange();
  }

  return (
    <section className="child-section">
      <div className="section-head">
        <h3>References</h3>
        {mode?.kind !== 'add' && <button onClick={() => setMode({ kind: 'add' })}>+ Add Reference</button>}
      </div>

      {mode?.kind === 'add' && <ReferenceForm onCancel={() => setMode(null)} onSubmit={add} />}

      {records.length === 0 && mode?.kind !== 'add' && <p>No references.</p>}

      {records.map((r) =>
        mode?.kind === 'edit' && mode.id === r.id ? (
          <ReferenceForm key={r.id} initial={r} onCancel={() => setMode(null)} onSubmit={(v) => edit(r.id, v)} />
        ) : (
          <div key={r.id} className="reference-card">
            <div className="reference-card__body">
              <strong>{r.name ?? '(no name)'}</strong>
              <span>{kindLabel(r.kind)} · {r.organization ?? '—'}</span>
            </div>
            <div className="row-actions">
              <button onClick={() => setMode({ kind: 'edit', id: r.id })}>Edit</button>
              <button onClick={() => remove(r.id)}>Delete</button>
            </div>
          </div>
        ),
      )}
    </section>
  );
}
