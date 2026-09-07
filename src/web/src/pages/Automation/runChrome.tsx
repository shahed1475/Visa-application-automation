import { EVENT_MESSAGES } from '../../../../shared/automation/events';
import type { AutomationEventRow } from '../../../../shared/automation/types';
import type { IndiaDiagnostics } from '../../../../shared/discovery/types';

type Mismatch = { fieldPath: string; expected: string; actual: string };

const STATUS_TEXT: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  waiting_for_user: 'Waiting for you',
  paused: 'Paused',
  review_ready: 'Ready for your review',
  failed: 'Failed',
  aborted: 'Aborted',
};

const WAITING_REASON_TEXT: Record<string, string> = {
  otp: 'OTP required',
  captcha: 'CAPTCHA required',
  mfa: 'MFA required',
  anti_bot: 'Anti-bot challenge',
  unknown_page: 'Unrecognised page',
  missing_field_mapping: 'Missing field mapping',
  stale_mapping: 'Mapping needs re-validation',
  option_unavailable: 'Dropdown option unavailable',
  value_mismatch: 'Value needs review',
  value_conflict: 'Value conflict — decision needed',
  document_upload_required: 'Attach documents',
  session_expired: 'Session expired',
  validation_error: 'Portal validation error',
  user_paused: 'Paused',
};

const REASON_INSTRUCTION: Record<string, string> = {
  otp: 'Complete the OTP in the browser window, then resume.',
  captcha: 'Complete the CAPTCHA in the browser window, then resume.',
  mfa: 'Complete the MFA in the browser window, then resume.',
  anti_bot: 'Complete the anti-bot challenge in the browser window, then resume.',
  value_mismatch:
    'Review the values below, fix them in the portal or the applicant profile, then resume.',
  value_conflict:
    'The portal already holds a different value for this field. Choose which value to keep, or edit the application.',
  document_upload_required: 'Attach the required documents in the browser, then resume.',
  missing_field_mapping:
    'A field has no portal mapping. Enter it in the browser, then resume or abort.',
  stale_mapping:
    'A required portal mapping is stale or not yet validated. Re-validate it (run discovery, then Validate Adapter) before resuming.',
  option_unavailable:
    'The portal dropdown does not offer the expected option. Fix the value in the portal or the application, then resume.',
  unknown_page:
    'The portal is not where the automation expected. Check the browser, then resume or abort.',
  session_expired:
    'The portal is not where the automation expected. Check the browser, then resume or abort.',
  validation_error: 'The portal rejected the page. Fix it in the browser, then resume.',
  user_paused: 'The run is paused. Resume when you are ready.',
};

export function StatusBadge({
  status,
  waitingReason,
}: {
  status: string;
  waitingReason: string | null;
}) {
  const text = STATUS_TEXT[status] ?? status;
  const reason = waitingReason ? WAITING_REASON_TEXT[waitingReason] ?? waitingReason : null;
  return (
    <span className={`run-badge run-badge--${status}`}>
      {text}
      {reason ? ` — ${reason}` : ''}
    </span>
  );
}

export function ProgressBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = max ? (value / max) * 100 : 0;
  return (
    <div className="progress">
      <span className="progress__label">{label}</span>
      <div
        className="progress__track"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress__text">
        {value} / {max}
      </span>
    </div>
  );
}

export function EventLog({ events }: { events: AutomationEventRow[] }) {
  return (
    <ol className="event-log">
      {events.map((e) => (
        <li key={e.id ?? e.seq}>
          <span className="event-log__msg">
            {EVENT_MESSAGES[e.type as keyof typeof EVENT_MESSAGES] ?? e.message}
          </span>
          {e.field_path ? <span className="event-log__field">{e.field_path}</span> : null}
          {e.portal_state ? <span className="event-log__state">{e.portal_state}</span> : null}
          <time dateTime={e.created_at}>{e.created_at}</time>
        </li>
      ))}
    </ol>
  );
}

export function ActionRequiredPanel({
  reason,
  mismatches,
  resumeError,
  busy,
  onResume,
  onAbort,
}: {
  reason: string | null;
  mismatches: Mismatch[] | null;
  resumeError: string | null;
  busy: boolean;
  onResume: () => void;
  onAbort: () => void;
}) {
  const instruction =
    (reason && REASON_INSTRUCTION[reason]) ??
    'The run needs an action from you in the browser. Check the browser, then resume or abort.';
  return (
    <section className="action-required" role="alert">
      <h2>Action required</h2>
      <p>{instruction}</p>
      {mismatches && mismatches.length > 0 ? (
        <ul className="mismatch-list">
          {mismatches.map((m) => (
            <li key={m.fieldPath}>
              {m.fieldPath}: expected <code>{m.expected}</code>, portal shows <code>{m.actual}</code>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="action-required__buttons">
        <button type="button" onClick={onResume} disabled={busy}>
          Resume automation
        </button>
        <button type="button" onClick={onAbort}>
          Abort
        </button>
      </div>
      {resumeError ? <p className="error">{resumeError}</p> : null}
    </section>
  );
}

/**
 * Phase 6 §13.25 — the dedicated `value_conflict` decision panel. The portal
 * already holds a value for a field that differs from the application's. The
 * operator picks which value wins, or bails out to edit the application.
 *
 * This is the ONLY run-page surface that shows applicant values, and only the
 * single in-memory `/live` pair (already the `value_mismatch` pattern). No
 * `<form>`, no `type="submit"`, no submit-labelled control — the Phase 5 web
 * guard greps this page for those.
 */
export function ValueConflictPanel({
  mismatch,
  resumeError,
  busy,
  onUseApplication,
  onKeepPortal,
  onEditApplication,
}: {
  mismatch: Mismatch | null;
  resumeError: string | null;
  busy: boolean;
  onUseApplication: () => void;
  onKeepPortal: () => void;
  onEditApplication: () => void;
}) {
  return (
    <section className="action-required value-conflict" role="alert">
      <h2>Value conflict</h2>
      <p>{REASON_INSTRUCTION.value_conflict}</p>
      {mismatch ? (
        <ul className="mismatch-list">
          <li>
            {mismatch.fieldPath}: application has <code>{mismatch.expected}</code>, portal shows{' '}
            <code>{mismatch.actual}</code>
          </li>
        </ul>
      ) : null}
      <div className="action-required__buttons">
        <button type="button" onClick={onUseApplication} disabled={busy}>
          Use application value
        </button>
        <button type="button" onClick={onKeepPortal} disabled={busy}>
          Keep portal value
        </button>
        <button type="button" onClick={onEditApplication} disabled={busy}>
          Edit application
        </button>
      </div>
      {resumeError ? <p className="error">{resumeError}</p> : null}
    </section>
  );
}

export function SafeStopBanner() {
  return (
    <section className="safe-stop">
      <h2>Preparation complete</h2>
      <p>
        <strong>Prepared — NOT submitted.</strong> Submission is your responsibility in the portal:
        review every field there, then submit the application yourself.
      </p>
    </section>
  );
}

/** Value-free run provenance: adapter version, mapping revision, how many
 *  mappings are production-ready. Never renders applicant data. */
export function AdapterProvenance({ diagnostics }: { diagnostics: IndiaDiagnostics | null }) {
  if (!diagnostics) return null;
  const d = diagnostics;
  return (
    <p className="muted adapter-provenance" role="status">
      India adapter v{d.adapterVersion} · mapping rev {d.mappingRevision} ·{' '}
      {d.productionUsableMappings} / {d.mappings.total} production-ready
    </p>
  );
}

/** Shown when the India adapter has stale mappings, or no production-usable
 *  mapping at all — a real run would pause on `stale_mapping`. */
export function StaleMappingWarning({ diagnostics }: { diagnostics: IndiaDiagnostics | null }) {
  if (!diagnostics) return null;
  if (diagnostics.staleMappings === 0 && diagnostics.productionUsableMappings > 0) return null;
  return (
    <p className="warning" role="alert">
      Some required portal mappings are stale or not yet validated. Automation cannot safely continue
      until they are re-validated.
    </p>
  );
}
