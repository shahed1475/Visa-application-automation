import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Blocker } from '../../../../shared/application/types';
import { api } from '../../api/client';
import { SourceLine } from './provenance';

const PHASE_5_HELPER =
  'Available in Phase 5. This does not submit anything, and does not mean the visa is approved.';

interface Props {
  readyForAutomation: { ready: boolean; blockers: Blocker[] };
  applicationId: string;
}

export function ReadyForAutomationSection({ readyForAutomation, applicationId }: Props) {
  const { ready, blockers } = readyForAutomation;
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function start() {
    setStartError(null);
    setStarting(true);
    try {
      const { run } = await api.startAutomationRun(applicationId);
      navigate('/automation-runs/' + run.id);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Could not start automation');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="ready-for-automation">
      <p className={`ready-line ready-line--${ready ? 'ready' : 'blocked'}`}>
        {ready
          ? 'The local preparation data meets the automation prerequisites.'
          : 'Not ready — resolve the blockers below.'}
      </p>

      {blockers.length > 0 && (
        <ul className="blocker-list">
          {blockers.map((b, i) => (
            <li key={i} className={`blocker blocker--${b.kind}`}>
              <div className="blocker__head">
                <span className="blocker__kind">{b.kind}</span>
                <span className="blocker__text">{b.text}</span>
              </div>
              <SourceLine source={b.source} />
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="start-automation"
        disabled={!ready || starting}
        onClick={ready ? () => void start() : undefined}
      >
        {ready ? (starting ? 'Starting…' : 'Start automation') : 'Start automation (Phase 5)'}
      </button>
      {startError && (
        <p className="error" role="alert">
          {startError}
        </p>
      )}
      <p className="hint">{PHASE_5_HELPER}</p>
      <p className="hint">
        Readiness reflects only the local preparation data against the current knowledge base. It is
        not a submission and not an approval.
      </p>
    </div>
  );
}
