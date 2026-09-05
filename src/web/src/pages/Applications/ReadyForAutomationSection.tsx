import type { Blocker } from '../../../../shared/application/types';
import { SourceLine } from './provenance';

const PHASE_5_HELPER =
  'Available in Phase 5. This does not submit anything, and does not mean the visa is approved.';

interface Props {
  readyForAutomation: { ready: boolean; blockers: Blocker[] };
}

export function ReadyForAutomationSection({ readyForAutomation }: Props) {
  const { ready, blockers } = readyForAutomation;

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

      <button type="button" className="start-automation" disabled>
        Start automation (Phase 5)
      </button>
      <p className="hint">{PHASE_5_HELPER}</p>
      <p className="hint">
        Readiness reflects only the local preparation data against the current knowledge base. It is
        not a submission and not an approval.
      </p>
    </div>
  );
}
