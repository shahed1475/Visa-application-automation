# Automation Risks — Portal-Agnostic Register

**Status:** Framework / portal-agnostic. No portal has been inspected.
**Date:** 2026-09-02
**Scope:** risks that apply to automating *any* visa portal with Playwright.
Portal-specific risks are added to the relevant portal appendix
(`docs/portals/<slug>.md`) after discovery.

---

## How to read this document

Each risk has: **description**, **likelihood**, **impact**, **detection
signals**, **mitigation** (prevent / reduce), **recovery** (what to do when it
happens), and **residual risk** (what remains after mitigation).

Likelihood / impact scale: `low` · `medium` · `high`.

The guiding principle throughout: **fail safe → pause and hand control to the
user**. Automation never guesses past uncertainty, never bypasses a security
control, and never submits an application (rules 17–19).

---

## Risk register (summary)

| # | Risk | Likelihood | Impact | Primary response |
|---|------|-----------|--------|------------------|
| R1 | Website structure changes | high | high | Selector layering + verification + abort-on-drift |
| R2 | Session / token expiration | high | medium | Detect, persist state, user re-auth, re-attach |
| R3 | Dynamic DOM (SPA re-render, late elements) | high | medium | Wait for explicit signals, never fixed sleeps |
| R4 | Dropdown / async load timing | high | medium | Wait on recorded ready-signal, verify options, bounded timeout |
| R5 | Missing / new / renamed fields | medium | high | Field reconciliation vs appendix; unknown → pause |
| R6 | OCR / MRZ extraction errors | medium | high | Confidence scoring, MRZ check digits, mandatory user verification |
| R7 | Security challenges (CAPTCHA/OTP/MFA/anti-bot) | high | medium | Detect → pause → user handles; never solve/bypass |
| R8 | Browser / Playwright failures | medium | medium | Health checks, restart, resume from checkpoint |
| R9 | Network failures / latency | high | low–medium | Retry with backoff, offline detection, checkpointed resume |
| R10 | Rate limiting / IP blocking | medium | high | Human-paced actions, honour 429/403, stop (no evasion) |
| R11 | Wrong value silently accepted | medium | high | Post-fill DOM re-read + final review page |
| R12 | Locale / date / number format mismatch | medium | high | Detect portal formats, format explicitly, verify masked result |
| R13 | Duplicate application submission | low | high | Never auto-submit; detect "already submitted"; idempotent steps only |
| R14 | File-upload rejection | medium | medium | Pre-validate type/size/dimensions; surface portal error verbatim |
| R15 | Legal / ToS / robots constraints | medium | high | Public-page inspection only; user-driven auth; honour robots; stop on prohibition |
| R16 | Multi-language / translated portals | low | medium | Pin language; label matching by stable id not text |
| R17 | Anti-automation fingerprinting | medium | medium | Accept detection may happen; do not evade; fall back to manual |
| R18 | State/DB corruption or stale resume | low | high | Schema-versioned state, validate on resume, safe re-discovery |
| R19 | Data leakage into logs/screenshots/artifacts | medium | high | Central redaction, screenshot masking, no-value state |
| R20 | User abandons mid-run / conflicting manual edits | medium | medium | Detect external DOM changes, re-verify before each action |

---

## R1 — Website structure changes

**Description.** Government visa portals are redesigned, re-platformed, or patched
without notice. Element ids, DOM hierarchy, step order, field labels, and even
the number of pages can change between the discovery run and an automation run.

**Likelihood:** high (over any multi-month horizon). **Impact:** high — silent
mis-fills or a stalled run.

**Detection signals.** Primary selector not found; fallback selector resolves to
a different-looking element; page title / step heading differs from the appendix;
form control count outside expected range; an unexpected extra page; label text
mismatch on a field whose id still resolves.

**Mitigation.**
- Layered selectors (§8.1 of the analysis doc): primary + fallback + confidence.
- Record a per-page **fingerprint** (title, key headings, field-id set, control
  counts) in the portal appendix; check it at the start of each page.
- Before filling a page, run a lightweight **structure reconciliation**: every
  field the appendix expects must resolve; any unresolved *required* field →
  `abort` (R5). Extra unexpected fields → pause for user.
- Keep discovery data versioned with a discovery date + portal fingerprint hash.
- Re-run discovery (D1/D2) whenever reconciliation fails.

**Recovery.** Stop before touching any field on the changed page; screenshot +
DOM snapshot; classify as `abort`; report which selectors/fingerprints failed;
prompt the user to complete manually and to authorise a re-discovery.

**Residual risk.** A change that keeps ids and layout identical but changes
*meaning* (e.g. a dropdown's option values) can still slip through to the final
review page — where the user catches it.

---

## R2 — Session / token expiration

**Description.** The portal session expires (idle timeout, absolute cap, or
server-side invalidation), often mid-workflow, sometimes silently (next action
redirects to login or returns 401/403).

**Likelihood:** high on long forms. **Impact:** medium — lost unsaved progress,
forced re-auth.

**Detection signals.** Redirect to `/login`; HTTP 401/403 on a navigation;
"session expired" / "please log in again" text; a login form appearing where a
form step was expected; disappearance of an authenticated nav element.

**Mitigation.**
- Persist verified progress after **every** completed step (§13.1 of analysis doc).
- Prefer the portal's own "Save draft" after each step where available.
- Track the observed idle-timeout from discovery; warn the user as it approaches.
- Do not attempt to keep the session alive with synthetic activity (could look
  like automation abuse — R17).

**Recovery.** Detect → persist state → set `pending_user_action =
security-checkpoint` → notify the user to log back in **themselves** → on their
signal, re-attach to the authenticated tab, re-verify the current page against
the appendix, resume from `last_safe_checkpoint`. If the portal issued an
application reference, use its "resume application" path.

**Residual risk.** Portals without server-side draft saving lose the current
page's unsaved fields; those are re-filled on resume (idempotent step) or re-done
by the user.

---

## R3 — Dynamic DOM (SPA re-render, late-mounting elements)

**Description.** Elements mount/unmount after initial load; React/Angular
re-renders replace nodes (stale element handles); "pages" are client routes with
no navigation event; content appears only after XHR.

**Likelihood:** high on modern portals. **Impact:** medium — flaky clicks/fills,
stale-element errors, acting before the page is ready.

**Detection signals.** `element is not attached to the DOM`; element found but
not `visible`/`enabled`; route changed but old content still present; spinner
still visible.

**Mitigation.**
- Never use fixed `sleep`. Wait for **explicit** conditions: element visible +
  enabled + stable (bounding box unchanged for N ms); network idle *for the
  specific request*; a known "ready" marker element; spinner removed.
- Re-query elements immediately before each interaction (no long-held handles).
- Record each step's **advance signal** (§10.3) and **ready signal** in the
  appendix; use those, not heuristics.
- Use Playwright auto-waiting actions; add explicit `expect`/`waitFor` on the
  recorded signal.

**Recovery.** Bounded retry (re-query + wait) → if still failing, `needs-user`
pause with screenshot.

**Residual risk.** A portal with no reliable ready signal (pure timing) forces
conservative long waits and occasional user assists.

---

## R4 — Dropdown / async-load timing

**Description.** Dependent dropdowns (country → state → city) load options via
XHR after the parent changes. Selecting the child before options arrive fails
silently or picks the wrong item; a fixed wait is either too short (flaky) or too
slow.

**Likelihood:** high. **Impact:** medium — wrong or empty selection, cascade
breakage.

**Detection signals.** Child `select` has only the placeholder option; option
count didn't increase after parent change; the recorded XHR hasn't completed;
child value reverts after being set (cascade reset).

**Mitigation.**
- Per §6.3 of the analysis doc: record population mechanism, the parent chain,
  the **ready signal**, placeholder representation, option value-vs-label, and
  cascade-reset behaviour during discovery.
- Autofill algorithm: set parent → wait for recorded ready signal → assert
  `optionCount > 1` (or the specific expected option present) → select child →
  verify selection (§7.3 `option-value`) → next level.
- Match options by **normalised label** or by `value`; never by index/position.
- Bounded timeout per level (e.g. 15 s); on timeout → `needs-user`.

**Recovery.** Abort the chain from the failed level; screenshot; prompt the user
to complete that dropdown chain manually; then re-verify and continue.

**Residual risk.** Typeahead-only comboboxes with server search may need the user
when our value doesn't produce an exact match.

---

## R5 — Missing, new, or renamed fields

**Description.** A field in the appendix is absent at automation time; a new
required field appeared; a field was renamed/re-typed (text → select).

**Likelihood:** medium. **Impact:** high — incomplete application or wrong input
type handling.

**Detection signals.** Structure reconciliation (R1) mismatch; a required
attribute on an element not in the appendix; input `type` differs from recorded.

**Mitigation.**
- Reconcile every page against the appendix before filling (R1).
- Maintain a **required-field manifest** per step; all must be present and
  fillable or the step aborts.
- New optional field → fill nothing, log, continue, surface at review.
- New required field with no known data source → `NON_INFERABLE` → prompt user.

**Recovery.** `abort` (missing required) or `needs-user` (new required) with a
clear list of what changed; recommend re-discovery.

**Residual risk.** A renamed field whose id is unchanged but whose *expected
data* changed (e.g. now wants "city" not "city, country") — caught at review.

---

## R6 — OCR / MRZ extraction errors

**Description.** Passport OCR misreads characters (`0/O`, `1/I`, `5/S`, `8/B`,
`<` runs), especially in the visual zone; MRZ parsing errors; wrong name
split; wrong century for 2-digit years; nationality-code mapping errors;
truncated MRZ names.

**Likelihood:** medium (MRZ is more reliable than VIZ). **Impact:** high — a
wrong passport number or DOB can invalidate the application.

**Detection signals.** MRZ **check digits** fail; DOB after issue date, or age
implausible; expiry in the past; nationality code not in ISO 3166; name contains
digits; field length exceeds passport max; low OCR confidence score.

**Mitigation.**
- Prefer **MRZ** over VIZ; validate every MRZ field with its check digit and the
  composite check digit.
- Cross-field sanity checks: `issue < DOB+relevant`, `issue < expiry`,
  `expiry − issue ∈ {5y, 10y}` (typical), DOB century inference then range check.
- Assign confidence (§7.1 of analysis doc); anything below `high` →
  `autofill+confirm`.
- Show the user the **passport image crop** next to each extracted value during
  verification.
- Never auto-submit with any passport-derived field below `high` confidence
  unconfirmed.

**Recovery.** Flag the field; show image + extracted value; user corrects; store
the corrected value as canonical for the run.

**Residual risk.** A plausible-but-wrong OCR result that passes all checks (e.g.
`O`→`0` in a passport number with no check-digit coverage of that position) —
mitigated only by the mandatory user review of every passport field.

---

## R7 — Security challenges (CAPTCHA / OTP / MFA / anti-bot)

**Description.** reCAPTCHA/hCaptcha/Turnstile, image CAPTCHAs, email/SMS OTP,
authenticator codes, Cloudflare interstitials, device verification, or security
questions appear — often at login, on submit, or after several actions.

**Likelihood:** high. **Impact:** medium — automation cannot proceed unaided (by
design).

**Detection signals.** See §11.2 of the analysis doc (iframe origins, `.g-recaptcha`,
`h-captcha`, `cf-turnstile`, "Just a moment…", OTP input labels, 403 + `cf-mitigated`).

**Mitigation / required behaviour.**
- The system has **no** solver, **no** third-party CAPTCHA service, **no** OTP
  auto-retrieval, **no** evasion. (Rules 17–18.)
- On detection: persist state → screenshot → set `status = paused-for-user` →
  notify → wait for the user to complete the challenge in the visible browser →
  detect completion (recorded completion signal) → resume.
- Bring the browser to the foreground / make it visible when a checkpoint is hit.

**Recovery.** Entirely user-driven; automation only resumes on the user's signal
or an unambiguous completion signal.

**Residual risk.** A portal that challenges on *every* action makes automation
low-value there — acceptable; the tool degrades to assisted manual entry.

---

## R8 — Browser / Playwright failures

**Description.** Chromium crashes, hangs, runs out of memory; Playwright driver
disconnects; a page becomes unresponsive; browser/Playwright version drift breaks
APIs or changes behaviour.

**Likelihood:** medium. **Impact:** medium — run interrupted.

**Detection signals.** `Target closed`, `Browser has been closed`, navigation
timeouts on every action, driver RPC errors, non-zero browser exit.

**Mitigation.**
- Single owned browser lifecycle via `BrowserManager`; health check
  (`browser.isConnected()`) before each step.
- Pin Playwright and the Chromium revision; upgrade deliberately with a
  re-verification pass.
- Keep per-run memory bounded (close contexts/pages promptly; one context).
- Checkpoint after every step so a restart loses at most one page.

**Recovery.** Detect → close everything cleanly → relaunch → for authenticated
flows, `needs-user` (user re-logs in) → re-attach → re-verify current page →
resume from `last_safe_checkpoint`.

**Residual risk.** A reproducible crash on a specific portal page → that page
becomes `manual-only`.

---

## R9 — Network failures / latency

**Description.** DNS failure, connection reset, TLS errors, high latency,
transient 5xx, captive-portal/proxy interference, offline.

**Likelihood:** high (transient). **Impact:** low–medium — usually retryable.

**Detection signals.** `net::ERR_*`, `ENOTFOUND`, `ECONNREFUSED`,
`ECONNRESET`, navigation timeout, 502/503/504, `navigator.onLine === false`.

**Mitigation.**
- Retry idempotent navigations with bounded exponential backoff (e.g. 3 tries).
- Distinguish transient (retry) from structural (DNS of the configured host
  fails → `needs-user`: check the URL in Settings).
- Never retry a POST/submit (we don't submit anyway).
- Pause and wait for connectivity when offline is detected.
- All failure messages sanitised to host + category (no stack, no internals).

**Recovery.** Backoff-retry → on exhaustion, persist state and `needs-user` with
a plain-language cause.

**Residual risk.** A submit-time network failure in real use (post-Phase-0) is
handled by the user, since submission is manual.

---

## R10 — Rate limiting / IP blocking

**Description.** The portal throttles or blocks after rapid or pattern-like
requests; WAF blocks the IP; a temporary ban page appears.

**Likelihood:** medium. **Impact:** high — the user's own IP could be blocked
from a service they genuinely need.

**Detection signals.** HTTP 429; 403 with WAF markers; "unusual traffic" /
"too many requests" pages; sudden CAPTCHA where there was none (R7).

**Mitigation.**
- Human-paced interaction: serial navigation, realistic dwell times, no
  parallel requests, no aggressive link-crawling in discovery (bounded depth,
  stop-list, honour `robots.txt` for the public site).
- Discovery does one page at a time with pauses.
- On the first sign of throttling: **stop**. Do not rotate IP, spoof headers, or
  slow-loop to evade — that is prohibited (R15, rules 17–18).

**Recovery.** Stop, persist state, inform the user, recommend waiting and
completing manually. Record the trigger pattern in the appendix to pace future
runs more conservatively.

**Residual risk.** Even careful pacing can trip an aggressive WAF; the tool then
yields to fully manual use for that portal.

---

## R11 — Wrong value silently accepted

**Description.** Automation fills a field with an incorrect but format-valid
value (wrong dropdown option with a similar label, off-by-one date, wrong name
part); the portal accepts it; the error only surfaces at consular review or not
at all.

**Likelihood:** medium. **Impact:** high.

**Detection signals.** Often none at fill time — this is the dangerous class.
Weak signals: normalised-match succeeded only via fuzzy fallback; multiple
options matched; date parsed ambiguously.

**Mitigation.**
- Mandatory post-fill **DOM re-read + compare** for every field (§7.2).
- Strict match strategies; **fuzzy match is flagged and forces `autofill+confirm`**.
- Ambiguous dates → explicit format from the portal's mask; verify the rendered
  masked value, not just the raw value.
- **Final review page**: every field, every value, shown to the user before the
  user-controlled submit. Nothing submits without that review.
- Keep an in-app record of "intended vs filled" per field for the review screen
  (values held in memory / session, not logged).

**Recovery.** User edits at review; automation re-fills and re-verifies the
corrected field.

**Residual risk.** A user who rubber-stamps the review. Mitigated by surfacing
low-confidence and fuzzy-matched fields prominently and requiring per-field
acknowledgement for those.

---

## R12 — Locale / date / number / encoding format mismatch

**Description.** Portal expects `DD/MMM/YYYY` but we send `YYYY-MM-DD`; decimal
comma vs point; name diacritics stripped or mojibake; uppercase-forced fields;
right-to-left text; different calendar.

**Likelihood:** medium. **Impact:** high (dates especially).

**Detection signals.** Format validation error; the visible value after fill
differs from what we typed (mask); character corruption in the field; date
rejected or interpreted as a different day.

**Mitigation.**
- During discovery record every field's **format mask**, accepted pattern, and
  the portal's overall locale/language.
- Format each value explicitly to the field's mask before filling; never rely on
  the browser locale.
- Pin the portal language where a switch exists.
- Verify the **rendered** value (post-mask) matches intent (§7.3 `date-format`,
  `visible-text`).
- Send Unicode as-is; verify round-trip; if the portal mangles diacritics,
  record that and prompt the user for the portal-preferred spelling.

**Recovery.** On format error, re-format per the verbatim error hint and retry
once; else `needs-user`.

**Residual risk.** Calendar-system or transliteration edge cases → `prompt-user`.

---

## R13 — Duplicate application submission

**Description.** A resumed or retried run creates a second application, or
re-fills a repeatable group twice, or the user already submitted and automation
proceeds anyway.

**Likelihood:** low (submission is manual). **Impact:** high — fees, confusion,
possible flags on the applicant.

**Mitigation.**
- Automation **never** clicks the final submit / pay control (rule 19).
- Detect "application already submitted" / confirmation pages and stop.
- Only steps explicitly marked **idempotent** in the workflow map are re-run on
  resume; repeatable-group fills check existing entries first.
- On resume, re-read the portal's current step and application status before
  acting.

**Recovery.** If a duplicate is detected, stop and report; the user resolves with
the portal.

**Residual risk.** Minimal, given manual submission.

---

## R14 — File-upload rejection

**Description.** Photo/document uploads rejected for dimensions, file size, type,
background, DPI, or content checks.

**Likelihood:** medium. **Impact:** medium — blocks the step.

**Detection signals.** Inline upload error; the file control resets; a validation
message near the upload; step won't advance.

**Mitigation.**
- Record the portal's stated upload constraints during discovery.
- Pre-validate each file (type, byte size, pixel dimensions, aspect ratio)
  against those constraints **before** attaching.
- Attach via the file input only; verify by file name + size (§7.3 `file-name`);
  never assert or log file **contents**.
- Surface the portal's rejection message verbatim to the user.

**Recovery.** `needs-user`: user provides a compliant file; re-attach; re-verify.

**Residual risk.** Server-side content checks (face detection, etc.) can only be
resolved by the user supplying a better document.

---

## R15 — Legal / Terms-of-Service / robots constraints

**Description.** A portal's ToS may prohibit automated access; `robots.txt` may
disallow crawling; some jurisdictions regulate automated interaction with
government systems.

**Likelihood:** medium (varies by portal). **Impact:** high — reputational /
legal / access loss.

**Detection signals.** ToS text prohibiting automation/scraping; `robots.txt`
disallow rules covering the application paths; explicit "no bots" notices;
repeated anti-bot challenges (R7/R10/R17).

**Mitigation.**
- **Discovery = public pages only, read-only, human-paced, honour `robots.txt`.**
- Authenticated flow is **user-driven** (the user logs in and navigates; tooling
  observes) — the human is operating their own account on their own application.
- No account creation, credential entry, OTP handling, or CAPTCHA solving by the
  tool (rules 17–18).
- Final submission is a human action (rule 19).
- If a portal's ToS clearly prohibits assisted automation, **record it and stop**;
  the tool should not be used against that portal.
- Document, per portal, the ToS position and `robots.txt` findings in the
  appendix.

**Recovery.** Cease automated interaction with that portal; the tool falls back
to being a data-organiser / manual-entry aid only.

**Residual risk.** ToS can change; re-check at each discovery run.

---

## R16 — Multi-language / translated portals

**Description.** The portal serves different languages; labels, option text, and
validation messages differ; auto-translation changes the DOM text.

**Likelihood:** low–medium. **Impact:** medium — text-based matching breaks.

**Mitigation.**
- Match fields by **stable id / name**, not visible text, wherever possible.
- Pin the portal language at the start of every run (via its language control or
  a URL/locale param observed in discovery).
- Record labels/messages per language if the user needs multiple.
- Disable browser/machine auto-translate for the automation context.

**Recovery.** If the language isn't what discovery recorded, reset it; if it
can't be pinned, `needs-user`.

**Residual risk.** Portals that only localise server-side by account setting.

---

## R17 — Anti-automation fingerprinting

**Description.** The portal uses bot-detection (navigator properties, timing,
canvas/WebGL fingerprint, behavioural signals) and blocks or challenges
automated browsers.

**Likelihood:** medium. **Impact:** medium.

**Detection signals.** Immediate CAPTCHA/interstitial on a plain navigation;
different content for the automated browser; `webdriver`-gated messaging; blocks
that clear when the user drives manually.

**Mitigation / stance.**
- We **do not** implement evasion (stealth plugins, fingerprint spoofing, input
  humanisation designed to defeat detection). That is prohibited (rules 17–18)
  and adversarial to the portal operator.
- Prefer running **headed**, at human pace, with the user present.
- If detection blocks automation, degrade gracefully to **assisted manual**: the
  tool shows the user each value to enter; the user types it.

**Recovery.** Switch that portal (or that step) to `manual-only`; keep the
data-organisation and verification value.

**Residual risk.** Some portals will simply not be automatable — accepted.

---

## R18 — Local state / DB corruption or stale resume

**Description.** The automation-state DB is corrupted, schema-mismatched after an
app update, or describes a portal session that no longer exists; resuming from it
causes wrong-page actions.

**Likelihood:** low. **Impact:** high.

**Mitigation.**
- Versioned state schema (`user_version`); validate structure and required
  fields on load; refuse to resume from an incompatible/invalid record.
- On resume, **re-verify** the live page against the appendix fingerprint before
  any action; mismatch → discard resume, start fresh discovery/verification.
- WAL + transactional writes for state; never partial-write a checkpoint.
- State holds **no** field values, so a corrupt state can never leak or misfill
  data — worst case is "start this run over."

**Recovery.** Archive the bad state file, notify the user, begin a clean run.

**Residual risk.** Minimal (no sensitive data at stake; re-work only).

---

## R19 — Data leakage into logs / screenshots / diagnostics

**Description.** Passport numbers, DOB, addresses, names, OTPs, or credentials
end up in log lines, screenshots, DOM snapshots, or network HARs.

**Likelihood:** medium (easy to do by accident). **Impact:** high (rules 14–16).

**Detection signals.** Review of artifacts; redaction unit tests; a value
appearing in a log at `info`.

**Mitigation.**
- Central pino redaction (established in Phase 0 §8) covering passport/DOB/
  address/MRZ/applicant/password/token/authorization/cookie paths.
- Automation state stores **field ids + verification outcomes only, never values**.
- Failure diagnostics: DOM snapshots and screenshots pass through a **masking
  pass** (blank inputs, blur known PII regions) before being written; network
  diagnostics record URL + status only, never bodies.
- No `console.log` of field data anywhere; lint/CI check.
- Screenshots during authenticated discovery (D2) are reviewed/redacted before
  storage; better, avoid capturing filled fields at all.

**Recovery.** If a leak is found: purge the artifact, tighten the redaction rule,
add a regression test.

**Residual risk.** A novel field name not in the redaction list — mitigated by
the "no values in state/logs" default and periodic artifact audits.

---

## R20 — User abandons mid-run / makes conflicting manual edits

**Description.** The user closes the tab, navigates away, or edits fields
manually while automation is running or paused, leaving automation's model of the
page stale.

**Likelihood:** medium. **Impact:** medium.

**Detection signals.** Expected element/page gone; a field already has a value
automation didn't set; URL/step changed unexpectedly; tab/target closed (R8).

**Mitigation.**
- Before **every** action, re-read the current field/page state; if it differs
  from automation's model, pause and reconcile.
- When paused for the user, assume the page may change; do a full page
  re-verification on resume.
- Respect user-entered values: never overwrite a non-empty field without
  confirming with the user.
- Clear UI indication of when automation is "driving" vs "paused, safe to edit."

**Recovery.** Reconcile against the live DOM; ask the user which values are
authoritative; re-verify; continue or restart the step.

**Residual risk.** Rapid concurrent editing during an active fill — reduced by
keeping fill bursts short and re-checking between fields.

---

## Cross-cutting principles

1. **Fail safe.** Every unresolved uncertainty → pause and hand to the user.
2. **Verify everything filled.** DOM re-read + compare after each field; full
   review page before the user-controlled submit.
3. **No security bypass, ever.** Detect and delegate CAPTCHA/OTP/MFA/anti-bot.
4. **No evasion.** No fingerprint spoofing, IP rotation, or throttle-dodging.
5. **No values in logs or state.** Ids and outcomes only; central redaction.
6. **Portal knowledge lives in the adapter/appendix**, not the shared engine.
7. **Submission is the user's.** Automation stops at "ready to submit."
8. **Re-discover on drift.** Structure reconciliation gates every page.

---

## Consistency with the Phase 0 specification

| Risk doc | Phase 0 spec |
|----------|--------------|
| R7, cross-cutting #3 | Global Constraints; rules 17–18; ADR-0004; Test Connection is detect-only |
| R1/R5 structure reconciliation, R11 verification | rule 10 (verify every filled field); §7.2 analysis doc |
| R19, cross-cutting #5 | §8 security infrastructure; rules 14–16; pino redaction |
| R2/R8/R18 checkpointed resume | rule 12 (recover from failures); §13 analysis doc |
| R6 | rule guidance on treating passport data as sensitive; OCR components |
| R10/R15/R17 | rule 16 (minimise external transmission); public-page-only discovery |
| R13, cross-cutting #7 | rule 19 (submission user-controlled) |
| Portal knowledge in adapter (cross-cutting #6) | §3.2 engine vs adapters; ADR-0002; §9a |
