import { useState } from 'react';
import type { ConnectionTestResult } from '../../../../shared/types';
import { api } from '../../api/client';

export function TestConnectionPanel({ portalId }: { portalId: string }) {
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await api.testConnection(portalId);
      setResult(res.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test Connection failed.');
    } finally {
      setRunning(false);
    }
  }

  const flags = result
    ? Object.entries(result.securityChallengeFlags).filter(([, v]) => v)
    : [];

  return (
    <div className="test-connection">
      <h3>Test Connection</h3>
      <p className="hint">
        Navigates to the active portal URL and reports what it sees. It never
        fills or submits anything, and never solves CAPTCHA/OTP/MFA.
      </p>
      <button onClick={run} disabled={running}>
        {running ? 'Testing…' : 'Run Test Connection'}
      </button>

      {error && <p className="error" role="alert">{error}</p>}

      {result && (
        <dl className="result">
          <dt>Outcome</dt>
          <dd>{result.success ? 'Reachable' : `Failed — ${result.error?.message}`}</dd>
          {result.success && (
            <>
              <dt>HTTP status</dt><dd>{result.httpStatus ?? 'n/a'}</dd>
              <dt>Page title</dt><dd>{result.pageTitle ?? '(none)'}</dd>
              <dt>Final URL</dt><dd className="mono">{result.finalUrl}</dd>
              <dt>Redirected</dt><dd>{result.redirected ? 'Yes' : 'No'}</dd>
              <dt>Elements</dt>
              <dd>
                {Object.entries(result.elementCounts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}
              </dd>
              <dt>Security challenges detected</dt>
              <dd>
                {flags.length === 0
                  ? 'None detected'
                  : `${flags.map(([k]) => k).join(', ')} — you handle these manually`}
              </dd>
              <dt>Screenshot</dt>
              <dd className="mono">{result.screenshotPath ?? '(not captured)'}</dd>
              <dt>Duration</dt><dd>{result.durationMs} ms</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
