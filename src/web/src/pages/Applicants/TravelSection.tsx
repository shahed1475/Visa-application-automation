import { useState } from 'react';
import type { TravelRecord } from '../../../../shared/applicant/types';
import type { TravelPatchInput } from '../../../../shared/applicant/schemas';
import { api } from '../../api/client';
import { TravelRecordForm } from './TravelRecordForm';

interface Props {
  applicantId: string;
  records: TravelRecord[];
  onChange: () => Promise<void>;
}

export function TravelSection({ applicantId, records, onChange }: Props) {
  const [mode, setMode] = useState<{ kind: 'add' } | { kind: 'edit'; id: string } | null>(null);

  async function add(values: TravelPatchInput) {
    await api.addTravel(applicantId, values);
    setMode(null);
    await onChange();
  }
  async function edit(id: string, values: TravelPatchInput) {
    await api.updateTravel(applicantId, id, values);
    setMode(null);
    await onChange();
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this travel record?')) return;
    await api.deleteTravel(applicantId, id);
    await onChange();
  }

  return (
    <section className="child-section">
      <div className="section-head">
        <h3>Travel Records</h3>
        {mode?.kind !== 'add' && <button onClick={() => setMode({ kind: 'add' })}>+ Add Travel Record</button>}
      </div>

      {mode?.kind === 'add' && <TravelRecordForm onCancel={() => setMode(null)} onSubmit={add} />}

      {records.length === 0 && mode?.kind !== 'add' && <p>No travel records.</p>}

      {records.map((r) =>
        mode?.kind === 'edit' && mode.id === r.id ? (
          <TravelRecordForm key={r.id} initial={r} onCancel={() => setMode(null)} onSubmit={(v) => edit(r.id, v)} />
        ) : (
          <div key={r.id} className="travel-card">
            <div className="travel-card__body">
              <strong>{r.purpose ?? '(no purpose)'}</strong>
              <span>{r.tripType ?? '—'} · {r.destinationCountry ?? '—'} · {r.arrivalDate ?? '—'}</span>
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
