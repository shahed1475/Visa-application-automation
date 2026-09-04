# ADR-0004: Test Connection is navigate-only / report-only by design

## Status: Accepted

## Context

Phase 0 introduces the first browser automation: **Test Connection**. It must
prove the configured portal URL is reachable and report basic page facts —
without ever behaving like an applicant. The master constraints and the risk
register (R7, R13, cross-cutting #3/#7) forbid submitting anything and forbid
solving or bypassing CAPTCHA / OTP / MFA / anti-bot controls. Security
challenges are to be **detected and delegated to the user**, never automated.

## Decision

`runConnectionTest(url)` (in `src/server/automation/discovery/testConnection.ts`)
does exactly this and nothing more:

1. `browserManager.launch()` — Chromium, `headless` from `PW_HEADLESS` (default
   `true`), a **fresh context with no stored state and no credentials**.
2. `page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })`.
3. `genericAdapter.inspect(page)` collects, read-only: page title; element counts
   (forms, inputs by kind, selects, buttons, links); and **boolean**
   `securityChallengeFlags` for reCAPTCHA / hCaptcha / Turnstile / Cloudflare
   interstitial / generic OTP / MFA text.
4. One full-page screenshot to `data/screenshots/` (best-effort).
5. `browserManager.close()`.
6. Return a `ConnectionTestResult`; on failure, `error` is **sanitized** to
   `host + reason code` (`DNS_LOOKUP_FAILED` / `CONNECTION_REFUSED` / `TIMEOUT` /
   `TLS_ERROR` / `NAVIGATION_ERROR`) — no stack, no internal paths.

**Enforced by the absence of the code paths:** the module contains no
`page.fill`, `page.type`, `page.click` on a control, no `form.submit`, no
submit-button click, no CAPTCHA/OTP/MFA solver, no third-party solver call, no
fingerprint/anti-bot evasion. A `DESIGN NOTE` comment records this;
`test/automation/testConnection.test.ts` asserts the fixture server only ever
receives `GET` and that a form is never submitted.

## Consequences

- **Positive:** the security posture is structural, not a runtime check that
  could be toggled. `securityChallengeFlags` are surfaced in the UI with an
  explicit "you handle these manually" note.
- **Positive:** the sanitizer is the single client-facing error boundary for the
  engine; internal detail goes only to the server log.
- **Negative:** Test Connection is a single shot with a 30 s navigation timeout
  and no retry — adequate for a reachability probe, not a monitoring tool.
- **Future:** portal discovery in later phases stays **public-pages only,
  read-only, human-paced**, and stops at any registration / login / OTP /
  CAPTCHA / MFA / anti-bot boundary. Authenticated navigation is user-driven;
  final submission is always a human action.
