# Phase 5 — India Visa Browser Automation — design

**Status:** approved 2026-09-06. Branch `phase-5-browser-automation` off `phase-0-portal-settings`.
**Supersedes nothing.** Extends Phases 0–4; introduces no second source of truth.

---

## 1. Mission and non-goals

Take a `visa_application` that passes the Phase 4 readiness gate and use server-side
browser automation to assist the user through the **configured** visa portal:
open it, navigate the flow, detect the current page, map the application plan's
canonical fields to portal controls, fill carefully, verify every value, pause for
mandatory human checkpoints (OTP / CAPTCHA / MFA), resume on the user's signal,
persist progress, and **stop at the final review — never submit.**

**Non-goals (hard):**
- No CAPTCHA/OTP/MFA solving, retrieval, interception, or bypass.
- No anti-bot evasion, fingerprint spoofing, IP rotation, or throttle-dodging (`automation-risks.md` cross-cutting #4).
- No automatic final submission, ever (`automation-risks.md` cross-cutting #7).
- No account creation or credential entry by the tool.
- No autonomous interaction with the **authenticated** real India portal in this phase — the engine is proven against a local fixture portal; the India adapter ships as a config-driven scaffold; real selector discovery is a separate **user-driven** activity (`automation-risks.md` R15, `visa-form-analysis.md` §1.2).
- No Phase 6. Stop after Phase 5 is implemented, tested, reviewed, documented.

## 2. What Phase 5 consumes (do NOT rebuild)

| Need | Source (Phases 0–4) |
|---|---|
| Configured portal URL | `portalService.getActivePortal(db)` → `VisaPortal \| null` (`.url`). Never hard-code (spec §9a / ADR-0002). |
| Application + plan | `applicationService.getApplication(db, id)` → `{ application, plan }`. |
| Per-field targets | `plan.sections[].fields[]` — each `FieldPlan` has `appliesTo`, `value`, `present`, `verified`, `effectiveRequirement`, `sectionId`. |
| Documents required | `plan.documents[]` (`DocumentPlan` — `uploaded`, `matchedDocumentId`, `effectiveRequirement`). |
| Readiness gate | `plan.readyForAutomation` — `{ ready: boolean, blockers: Blocker[] }`. |
| Document files | `documentService` + `storage.ts` (`readOriginal(storagePath)`, `env.DOCUMENTS_DIR`). |
| Browser | `src/server/automation/engine/browserManager.ts` — `BrowserManager` (Playwright `chromium`). |
| Page snapshot + challenge flags | `src/server/automation/engine/pageInspector.ts` — `inspectPage(page)` → `PageInspection`. |
| Adapter seam | `src/server/automation/adapters/baseAdapter.ts` — `PortalAdapter` (expanded here), `registry.ts` `resolveAdapter(url)`. |
| Migrations | `src/server/db/migrations.ts` — array of `{version, up}`, `LATEST_SCHEMA_VERSION` derived, `runMigrations(db, upTo?)`. Current latest = 4. |
| Stateful service pattern | `app.decorate('ocr', …)` + `app.addHook('onClose', …)` in `app.ts`. |
| Redaction | `logger.ts` `REDACT_PATHS`; `redactQueryString`. |
| Route pattern | `routes/*.ts` — Zod `safeParse` → service → `errors.ts` sanitized envelope; per-domain error mapper (e.g. `mapApplicationError`). |
| Test infra | `test/helpers/tempDb.ts`, `fixtureServer.ts` (single-page HTTP fixture — extended here), `applicationFixtures.ts`. Gate: `npm run typecheck` (×4 tsc projects) · `lint` · `test` (vitest) · `build`. |

## 3. Architecture

Portal-agnostic engine ⇄ portal-specific adapter, mirroring the existing split and
`automation-risks.md` cross-cutting #6 ("portal knowledge lives in the adapter").

```
src/shared/automation/                 PURE (no node:/playwright/fastify/react)
  types.ts          RunStatus, WaitingReason, PortalState, EventType, EventStatus,
                    PageIdentity, SignalMatch, MappedField, ControlKind,
                    VerificationResult, RunSummary
  states.ts         RUN_STATES, LEGAL_TRANSITIONS (declarative), assertTransition()
  fieldMapping.ts   mapFields(sections, portalFieldMap, activeStateSectionIds) → MappedField[]
                    (pure; flags unmapped-but-present; excludes not_applicable/absent)
  events.ts         EVENT_MESSAGES — the CLOSED message vocabulary (value-free strings)

src/server/automation/
  engine/
    browserManager.ts      EXISTING — extend: newContext(opts), bringToFront(), headed toggle
    pageActions.ts         primitives over a Playwright Page — all condition-based, no bare sleeps:
                           readControl, fillText, selectNative, selectCustom, setRadio,
                           setCheckbox, setDate, typeAutocomplete, waitForPageSettled
    fieldActions.ts        one strategy per ControlKind; applyField(page, mapped, expected)
                           → fills, re-reads, returns VerificationResult
    pageDetector.ts        detectPage(page, adapter) → PageIdentity (multi-signal + confidence)
    checkpointDetector.ts  detectCheckpoint(inspection, page) → Checkpoint | null
                           (kind: otp | captcha | mfa | anti_bot | unknown)
    automationEngine.ts    the loop (§5). Pure-ish: takes (page, adapter, plan, emit, signals).
  adapters/
    baseAdapter.ts         EXPANDED PortalAdapter interface (§4)
    genericAdapter.ts      EXISTING — unknown portal ⇒ getPageIdentity returns UNKNOWN ⇒ engine stops
    india/
      indiaAdapter.ts      implements PortalAdapter for the India portal
      indiaPortalMap.ts    typed config: states → signals/sectionIds/nextSelector/isFinalReview;
                           fields: PortalFieldMap; checkpointHints. SHIPS WITH PLACEHOLDER
                           SELECTORS + a "populate from user-driven discovery, never guess" header.
                           submitSelector: null (explicit).
    registry.ts            EXISTING — register indiaAdapter
  checkpoints/
    checkpointManager.ts   on detect: persist waiting_for_user + reason, page.bringToFront(),
                           emit event; awaitResume() promise resolved by the resume route;
                           on resume: re-run detectCheckpoint — still present ⇒ stay waiting
  state/
    automationRunStore.ts  DB CRUD over DatabaseSync for automation_runs + automation_events
                           (mirrors extractionRuns). Pure over the handle; no HTTP types.
  automationService.ts     orchestrator, decorated app.automation; disposed on close.
                           startRun(db, applicationId) · getRun(db, id) · listRuns(db, applicationId?)
                           · resumeRun(db, id) · abortRun(db, id). Holds ≤1 active AutomationRunner
                           + one BrowserManager. Typed errors → mapAutomationError.
  discovery/
    testConnection.ts      EXISTING — untouched
    portalDiscovery.ts     read-only, user-driven: given a live Page the user has navigated,
                           dump candidate fields (selector-priority ladder §8.1) + page signals
                           to a report for docs/portals/india.md. No fill/click/submit.

src/server/routes/automation.ts
src/web/src/pages/Automation/AutomationRunPage.tsx (+ small sections)
src/web/src/api/client.ts                          (+ automation methods)

test/helpers/fixturePortal.ts                      multi-page fixture portal (extends fixtureServer)
test/fixtures/india-portal/*.html                  the 11 fixture pages
test/automation/**                                 unit + integration + security + e2e
```

**Layering rules (mirror `ARCHITECTURE.md`):** `shared/automation` imports nothing
from `server`/`web`. `automationEngine` imports no `PortalAdapter` implementation
directly — only the interface; the concrete adapter is passed in. Routes never
touch Playwright or SQL. India selectors appear **only** under `adapters/india/`
— a guard test greps for portal-URL and India-selector literals outside it.

## 4. The `PortalAdapter` interface (expanded)

`baseAdapter.ts` keeps `id` / `matches(url)` and adds:

```ts
interface PortalAdapter {
  readonly id: string;
  matches(url: string): boolean;

  /** Entry URL to open for this application (usually the configured portal URL,
   *  optionally a deep link the adapter derives — still from the DB row, never a constant). */
  entryUrl(portalUrl: string): string;

  /** Multi-signal page identification. Returns UNKNOWN + low confidence when unsure. */
  getPageIdentity(page: Page, inspection: PageInspection): Promise<PageIdentity>;

  /** Which plan section ids the given portal state collects. */
  sectionIdsForState(state: PortalState): string[];

  /** appliesTo → portal control mapping for the whole portal (pure data getter). */
  getFieldMap(): PortalFieldMap;

  /** Is the engine allowed to advance from this page? (validation errors present ⇒ false) */
  canContinue(page: Page): Promise<{ ok: boolean; reason?: string }>;

  /** Advance to the next page. NEVER the final submit. */
  clickNext(page: Page): Promise<void>;

  /** True on the final review page — the engine STOPS here. */
  isFinalReview(state: PortalState): boolean;

  /** Optional checkpoint hints beyond the generic detector. */
  checkpointHints?: CheckpointHints;

  /** Explicitly no submit affordance. */
  readonly submitSelector: null;
}
```

`genericAdapter`: `getPageIdentity` always returns `{ state: 'UNKNOWN', confidence: 0 }`
⇒ the engine pauses immediately. It is the safe default for any unrecognised portal.

`PortalFieldMap = Record<string /*appliesTo*/, {
  selector: string; fallbackSelector?: string; control: ControlKind;
  selectorConfidence: 'stable'|'moderate'|'fragile';
  transform?: (canonical: string) => string;   // e.g. ISO date → portal format
  optionMatch?: 'exact'|'label'|'value';        // for selects / custom dropdowns
}>`

`ControlKind = 'text'|'textarea'|'native_select'|'custom_select'|'radio'|'checkbox'|'date'|'number'|'autocomplete'|'searchable_select'`

## 5. The run loop (`automationEngine.ts`)

`run.status` ∈ `pending | running | waiting_for_user | paused | review_ready | failed | aborted`.
`review_ready` is the normal terminal success — the engine reached the final review
page and stopped. There is deliberately no `completed`/`submitted` status.
`run.waiting_reason` ∈ `otp | captcha | mfa | anti_bot | unknown_page |
missing_field_mapping | value_mismatch | document_upload_required | session_expired |
validation_error | user_paused | null`.
`missing_document` is an **`error_code` on a `failed` run**, not a waiting reason.

Per portal page:

1. `waitForPageSettled(page)` (condition-based: load state + adapter-named anchor selector visible). Then `inspectPage` + `adapter.getPageIdentity` → `PageIdentity`.
   - `state === UNKNOWN` or `confidence < THRESHOLD` (0.6) → **pause** `unknown_page`; emit `UNKNOWN_PORTAL_STATE`; STOP the loop (resume re-enters here).
2. `detectCheckpoint` → non-null → **pause** with the matching reason; `page.bringToFront()`; emit `OTP_REQUIRED` / `CAPTCHA_REQUIRED` / `MFA_REQUIRED` / `ANTI_BOT_DETECTED`; STOP.
3. `sectionIds = adapter.sectionIdsForState(state)`; `fields = mapFields(plan.sections, adapter.getFieldMap(), sectionIds)` restricted to `applicable && present`.
   - For each mapped field: `readControl` → if the current value already equals expected (normalised) → emit `FIELD_ALREADY_SET`, skip. Else `applyField` → re-read → `VerificationResult`.
     - `verified` → emit `FIELD_VERIFIED`.
     - `mismatch` → one retry → still mismatch → emit `FIELD_MISMATCH`; if the field is `effectiveRequirement === 'required'` → **pause** `value_mismatch`; STOP. (Optional fields: emit and continue.)
     - `unreadable` → emit `FIELD_UNVERIFIABLE`; treat as required-mismatch if required.
   - `present && !verified` (plan says the value was never user-verified) → still fill, but emit `FIELD_FILLED_UNVERIFIED` and add to `RunSummary.unverifiedFields`.
   - Unmapped but `present && required` on this page → emit `FIELD_UNMAPPED`; **pause** `missing_field_mapping` (can't safely proceed without a selector). Unmapped optional → emit only.
4. Documents this state needs (adapter declares which `plan.documents[].id` belong to `state`): each required document must be `uploaded` with a resolvable file. Any missing → emit `BLOCKED_MISSING_DOCUMENT`; set `status = failed`, `error_code = missing_document`; STOP. If all are available but the portal page needs a file *attached in the portal* → emit `DOCUMENT_READY` per doc, then **pause** `document_upload_required` for the user to attach the files in the browser (driving the portal file chooser is out of scope — §12). Resume continues from the same page.
5. `adapter.canContinue(page)` → `{ ok: false }` (validation errors on the page) → emit `VALIDATION_ERROR`; **pause** `validation_error`; STOP.
6. `adapter.isFinalReview(state)` → true → set `status = review_ready`, emit `REVIEW_READY`; **STOP — the loop never calls submit.**
7. Else `adapter.clickNext(page)` → `waitForPageSettled` → emit `NAVIGATION_STARTED` / `NAVIGATION_COMPLETED`; loop to 1. If the state does not change after `clickNext` + settle timeout → emit `NAVIGATION_STALLED`; **pause** `unknown_page`.

Progress counters (`fields_total`, `fields_verified`, `documents_total`, `documents_ready`)
are recomputed from the plan + events after every page and persisted.

**Resume (`resumeRun`):** relaunch a fresh browser context, `goto` the adapter
entry URL (or the last known URL if the portal keeps server-side session — the
adapter says which), `getPageIdentity`. If a login/landing page is shown →
**pause** `session_expired`. Otherwise **reconcile**: continue the loop from the
*observed* state, never replaying earlier pages. `POST /resume` on an
`otp/captcha/mfa` wait first re-runs `detectCheckpoint`; still present → stays
waiting with a `CHECKPOINT_STILL_PRESENT` event.

## 6. No-auto-submit — enforced four ways

1. **Structural:** `clickNext` targets only the adapter's inter-page control; the loop `return`s at `isFinalReview` before any further action. `PortalAdapter.submitSelector` is typed `null`.
2. **Guard test** (`test/automation/noAutoSubmit.test.ts`): greps `src/server/automation/**` + `src/shared/automation/**` (comment-stripped) for `submit(`, `.click(` on a name containing submit/confirm/lodge/pay, `form.evaluate(f=>f.submit())`, `page.on('dialog'` auto-accept. Zero matches.
3. **Fixture E2E:** the fixture portal's `final-review.html` has a real `Submit` button POSTing to `/__fixture/submit`; `fixturePortal.submitCount` MUST be `0` after a full happy-path run.
4. **India config:** `indiaPortalMap` carries no submit selector; the `FINAL_REVIEW` state entry has `isFinalReview: true` and no `nextSelector`.

## 7. Field mapping (`shared/automation/fieldMapping.ts`, pure)

`mapFields(sections, portalFieldMap, activeStateSectionIds)`:
- iterate `sections` where `section.applicable && activeStateSectionIds.includes(section.id)`
- for each `field` where `field.effectiveRequirement !== 'not_applicable'`:
  - `map = portalFieldMap[field.appliesTo]`
  - `map` undefined → `{ ...field, mapping: null, unmapped: true }`
  - else → `{ ...field, mapping: map, expected: map.transform ? map.transform(field.value) : field.value }`
- fields with `field.appliesTo === null` (synthetic rows) are skipped (nothing to fill).
- returns `MappedField[]`; the engine decides what to do with `unmapped`/`!present`.

No portal knowledge, no I/O — unit-tested against the shipped `PortalFieldMap` shape
with a synthetic map.

## 8. Verification (`fieldActions.ts` + `verifyField`)

After every fill, re-read the control's effective state and compare:
- text/textarea/number/date/autocomplete → normalised string compare (trim; date via the same `transform`)
- native_select / custom_select / searchable_select → compare the *selected option's* label or value per `optionMatch`
- radio → the checked value; checkbox → boolean checked state

`VerificationResult = { status: 'verified' | 'mismatch' | 'unreadable', fieldPath }`.
**Raw expected/actual values never leave memory** — not into the result, not into
events, not into logs. The live UI reads a mismatch's values from the in-memory
runner (see §10).

## 9. Data model — migration 5

```sql
CREATE TABLE automation_runs (
  id                    TEXT PRIMARY KEY,
  application_id        TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
  portal_id             TEXT REFERENCES visa_portals(id) ON DELETE SET NULL,
  portal_url_snapshot   TEXT NOT NULL,           -- the URL used, captured at start
  adapter_id            TEXT NOT NULL,           -- 'india' | 'generic'
  status                TEXT NOT NULL CHECK (status IN
                          ('pending','running','waiting_for_user','paused','review_ready','failed','aborted')),
  waiting_reason        TEXT CHECK (waiting_reason IN
                          ('otp','captcha','mfa','anti_bot','unknown_page','missing_field_mapping',
                           'value_mismatch','document_upload_required','session_expired',
                           'validation_error','user_paused')
                          OR waiting_reason IS NULL),
  current_portal_state  TEXT,
  current_section_id    TEXT,
  fields_total          INTEGER NOT NULL DEFAULT 0,
  fields_verified       INTEGER NOT NULL DEFAULT 0,
  documents_total       INTEGER NOT NULL DEFAULT 0,
  documents_ready       INTEGER NOT NULL DEFAULT 0,
  error_code            TEXT,
  error_message         TEXT,                    -- sanitized, value-free
  started_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  ended_at              TEXT                     -- set on review_ready | failed | aborted
);
CREATE INDEX idx_automation_runs_application ON automation_runs(application_id);

CREATE TABLE automation_events (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  type          TEXT NOT NULL,                   -- EventType (closed set, §11)
  portal_state  TEXT,
  field_path    TEXT,                            -- canonical appliesTo, never a value
  status        TEXT,                            -- 'ok'|'blocked'|'mismatch'|'skipped'|'info'
  message       TEXT NOT NULL,                   -- from EVENT_MESSAGES (closed vocabulary)
  evidence_path TEXT,                            -- relative path under AUTOMATION_DIR, or NULL
  UNIQUE (run_id, seq)
);
CREATE INDEX idx_automation_events_run ON automation_events(run_id);
```

`LATEST_SCHEMA_VERSION` → 5. A v4→v5 upgrade test uses `runMigrations(db, 4)` then
migrates and asserts the tables + a live run insert.

**One active run per application:** `startRun` throws `run_in_progress` (→ 409) if a
run for that application is `pending|running|waiting_for_user|paused`. A run in any
other application that is non-terminal → `another_run_active` (→ 409). Terminal
states: `review_ready | failed | aborted`.

## 10. Execution & resume model

- `automationService` is `app.decorate('automation', …)`, holds a single
  `AutomationRunner | null` and one `BrowserManager`. Disposed on `onClose`
  (abort the runner, close the browser).
- `AutomationRunner` is an async state machine. On each page it persists run +
  events **before** any suspension, so a crash leaves a resumable DB record
  (`automation-risks.md` R18).
- A checkpoint / pause `await`s a promise held by `checkpointManager`; `POST
  /resume` resolves it. There is no polling loop and no job queue
  (consistent with Phase 3's "async work, no queue").
- Single local user ⇒ at most one `AutomationRunner` process-wide. `startRun`
  while any non-terminal run exists for another application → `409
  another_run_active`; for the same application → `409 run_in_progress`.
- **Value mismatches for the live UI:** the runner exposes an in-memory
  `getLiveDetail(runId)` returning `{ mismatches: [{ fieldPath, expected, actual }] }`
  read straight from the last verification pass. This is **not persisted, not
  logged**, served by `GET /automation-runs/:id/live` only while the run is in
  memory, and is the user's own data on the user's own screen (R19 is about
  logs / DB / screenshots, not the live control surface).

## 11. Event vocabulary (`shared/automation/events.ts`)

`EventType` (closed): `RUN_STARTED · PAGE_DETECTED · UNKNOWN_PORTAL_STATE ·
CHECKPOINT_DETECTED · OTP_REQUIRED · CAPTCHA_REQUIRED · MFA_REQUIRED ·
ANTI_BOT_DETECTED · CHECKPOINT_STILL_PRESENT · USER_ACTION_REQUIRED ·
RUN_RESUMED · FIELD_MAP_RESOLVED · FIELD_UNMAPPED · FIELD_ALREADY_SET ·
FIELD_FILL_STARTED · FIELD_FILLED · FIELD_FILLED_UNVERIFIED · FIELD_VERIFIED ·
FIELD_MISMATCH · FIELD_UNVERIFIABLE · FIELD_NOT_FOUND · SELECTOR_STALE ·
DROPDOWN_OPTION_MISSING · VALIDATION_ERROR · NAVIGATION_STARTED ·
NAVIGATION_COMPLETED · NAVIGATION_STALLED · NAVIGATION_FAILED ·
DOCUMENT_READY · BLOCKED_MISSING_DOCUMENT · SESSION_EXPIRED · PORTAL_UNAVAILABLE ·
REVIEW_READY · RUN_PAUSED · RUN_ABORTED · RUN_FAILED`

`EVENT_MESSAGES: Record<EventType, string>` — fixed English strings, **no
interpolation of values**. `field_path` and `portal_state` columns carry the only
per-event specificity, and both are non-sensitive identifiers.

## 12. Explicit scope boundaries within Phase 5

- **Portal file upload is verification-only.** The engine confirms each required
  document is `uploaded` in Phase 3 with a resolvable file, records
  `DOCUMENT_READY` / `BLOCKED_MISSING_DOCUMENT`, and — on portal pages that need
  an upload — **pauses** (`user_paused`, message "attach documents in the
  browser") for the user to attach files themselves. Driving the portal's file
  chooser is deferred (portal file inputs are high-variance; `automation-risks.md`
  R14). The India adapter scaffold has an `uploadStates: PortalState[]` list so
  this can be added later without engine changes.
- **India selectors are placeholders.** `indiaPortalMap` ships structurally
  complete with `selector: 'TODO:discover'` values and `selectorConfidence:
  'fragile'`. The engine + fixture prove the mechanism. A real run against the
  live portal requires the user to run `portalDiscovery` on the authenticated
  flow and fill the map — documented in `docs/portals/india.md` and the Phase 5
  report.
- **`portalDiscovery` is read-only and user-driven.** It attaches to a Page the
  user has already navigated, lists candidate controls per the §8.1 selector
  ladder + the page fingerprint, and writes a findings section. No fill, no
  click, no submit, no auth, honours `robots.txt` for any URL it is pointed at.

## 13. PII & security (maps to `automation-risks.md`)

| Risk | Mechanism |
|---|---|
| R7 CAPTCHA/OTP/MFA | detect-only → pause → foreground browser → user completes → resume re-checks. No solver/retrieval/bypass anywhere (guard test). |
| R11 wrong value accepted | re-read + verify every field; required mismatch → pause. |
| R12 locale/date/mask | per-field `transform`; verify the *rendered* value, not the typed one. |
| R13 duplicate submission | no submit path at all; one active run per application. |
| R15 ToS / robots | discovery = public, read-only, user-paced, honours robots; authenticated flow user-driven; per-portal ToS position recorded in `docs/portals/india.md`; if ToS prohibits assisted automation → record and stop. |
| R17 fingerprinting | no evasion; plain Playwright chromium; human-paced timing config, not stealth. |
| R18 stale resume | persist before suspend; resume re-detects and continues from observed state, never replays. |
| R19 data leakage | engine never logs values; `automation_events.message` closed vocabulary; screenshots off by default, gitignored when on, path-only in events; `FIELD_NOT_FOUND` DOM diagnostics strip every `value`/`checked`/text node of inputs; `REDACT_PATHS` += `expected`, `actual`, `otp`, `otpCode`, `captcha`, `*.expected`, `*.actual`. |
| cross-applicant isolation | every route loads the run via `application_id` scoping; a run id for application A cannot expose application B; tested. |

`env` additions: `AUTOMATION_HEADLESS` (`'true'|'false'`, default `'false'`),
`AUTOMATION_EVIDENCE` (`'off'|'screenshots'`, default `'off'`), derived
`AUTOMATION_DIR = <DATA_DIR>/automation`. `AUTOMATION_DIR` is added to
`.gitignore`. Vitest setup forces `AUTOMATION_HEADLESS=true`.

## 14. REST API (`routes/automation.ts`)

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/api/applications/:id/automation-runs` | — | `201 { run }` · `409 run_in_progress` / `another_run_active` · `409 not_ready` `{ blockers }` · `404` |
| GET | `/api/applications/:id/automation-runs` | — | `200 { runs }` |
| GET | `/api/automation-runs/:id` | — | `200 { run, events }` · `404` |
| GET | `/api/automation-runs/:id/events?after=<seq>` | — | `200 { events }` (incremental poll) |
| GET | `/api/automation-runs/:id/live` | — | `200 { mismatches }` (in-memory only; `409 not_active` if the run isn't loaded) |
| POST | `/api/automation-runs/:id/resume` | — | `202 { run }` · `409 not_waiting` · `409 checkpoint_still_present` |
| POST | `/api/automation-runs/:id/abort` | — | `202 { run }` |

Zod-validated params; `mapAutomationError` → sanitized envelopes (mirrors
`mapApplicationError`). Registered in `app.ts` after the application routes.

## 15. Web UI

- **`/applications/:id`** — the existing disabled "Start automation" button in
  `ReadyForAutomationSection.tsx` is wired: `plan.readyForAutomation.ready` →
  enabled → `POST …/automation-runs` → `navigate('/automation-runs/' + run.id)`.
  `!ready` → unchanged (disabled + blockers list, already built). The verbatim
  helper text stays.
- **`/automation-runs/:id`** — `AutomationRunPage`:
  - header: applicant name, application (category display), portal, `adapter_id`
  - status badge + `waiting_reason`
  - progress: `fields_verified / fields_total`, `documents_ready / documents_total`, `current_portal_state`
  - a value-free live event log (polls `/events?after=`)
  - **ACTION REQUIRED** panel when `waiting_for_user`: the reason in plain words
    ("Complete the OTP in the browser window", "Review the highlighted values"),
    a **Resume automation** button (`POST …/resume`), and — for `value_mismatch`
    — the `/live` mismatch list (expected vs portal) rendered inline.
  - **SAFE STOP** banner at `review_ready`: *"Automation completed the
    preparation. Final submission requires your review and action in the
    browser."* — no submit control anywhere in the UI.
  - `Abort` button (any non-terminal state).
- `api/client.ts` gains `startAutomationRun`, `getAutomationRun`,
  `getAutomationEvents`, `getAutomationLive`, `resumeAutomationRun`,
  `abortAutomationRun`.

## 16. Fixture portal (`test/helpers/fixturePortal.ts` + `test/fixtures/india-portal/`)

11 static pages served from a route table, each with a heading, labelled controls,
and a "Save & Continue" button linking to the next:

`personal` (text, native select) → `passport` (text, date) → `address`
(text, textarea, native select) → `family` (radio, native select, conditional
spouse text) → `occupation` (text, custom JS dropdown) → `visa-details` (native
select, date, number) → `references` (repeatable text rows) → `documents`
(checkboxes "I have attached X" + a real `<input type=file>` that the engine does
NOT drive) → `challenge` (serves an OTP input by default; `?challenge=captcha`
renders a `<div class="g-recaptcha">` instead; `?challenge=ok` renders neither, so
resume finds it cleared) → `review` (read-only summary) → `final-review` (read-only
summary + a real **Submit Application** button POSTing to `/__fixture/submit`).

`startFixturePortal()` → `{ url, submitCount, requests, setPage(name), close }`.
`submitCount` MUST stay `0` in every test.

A **fixture adapter** (`test/automation/support/fixtureIndiaAdapter.ts`) implements
the real `PortalAdapter` against the fixture selectors so the **real engine** runs
end-to-end. This is the E2E harness; it is test code, not shipped.

## 17. Testing

**Unit** (`test/automation/*.unit` or by module):
- `states.ts` — legal/illegal transitions, `assertTransition` throws on illegal.
- `fieldMapping.ts` — mapped / unmapped / not_applicable / `appliesTo:null` / transform applied / section-scoping.
- `pageDetector` — known state, `UNKNOWN`, below-threshold confidence, multi-signal agreement.
- `checkpointDetector` — reCAPTCHA / hCaptcha / Turnstile / Cloudflare / OTP-label / MFA, and the clean-page negative.
- `fieldActions` — per `ControlKind`: fill → verify pass; a seeded wrong value → `mismatch`; an unreadable control → `unreadable`.
- `automationRunStore` — CRUD, `seq` monotonicity, `UNIQUE(run_id, seq)`, cascade delete with the application.
- `EVENT_MESSAGES` — every `EventType` has a message; no message contains `${` or a format placeholder.

**Integration** (fixture portal + real engine + fixture adapter, headless):
1. Happy path: ready application → run → every page detected → all fields filled + verified → `challenge` page pauses (`OTP_REQUIRED`, `waiting_reason = otp`) → `/resume` re-checks (fixture now `?challenge=ok`) → review → `REVIEW_READY` → `status = review_ready` → `submitCount === 0` → no event `type` is a submit.
2. CAPTCHA variant: `challenge` page with `?challenge=captcha` → `CAPTCHA_REQUIRED`, `waiting_reason = captcha` → `/resume` while still present → `409 checkpoint_still_present` + `CHECKPOINT_STILL_PRESENT` event → clear → resume → proceeds.
3. Missing required field: a `present` FieldPlan is forced to `present: false` (empty value) → the field is not filled → `adapter.canContinue` returns `{ ok: false }` (portal shows the required-field error) → emit `VALIDATION_ERROR` → pause `validation_error`. Assert no navigation past that page.
4. Missing required document → `BLOCKED_MISSING_DOCUMENT` → `status = failed`, `error_code = missing_document`, `waiting_reason` NULL.
5. Unknown page: the fixture serves an unrecognised page → `getPageIdentity` returns `UNKNOWN` → `UNKNOWN_PORTAL_STATE` → pause `unknown_page`. No fills attempted.
6. Value mismatch: a fixture control rewrites its value on blur → fill → re-read → retry → `FIELD_MISMATCH` → pause `value_mismatch`; `GET …/live` returns the `{ fieldPath, expected, actual }`; the persisted events contain neither value.
7. Crash/resume: run to the `challenge` pause, dispose the service (kill runner + browser), build a fresh service from the same DB, `resumeRun` → relaunch → re-detect the `challenge` page → still present → stays `waiting_for_user` → clear → resume → reaches `review_ready`.
8. `readyForAutomation.ready === false` → `POST …/automation-runs` → `409 not_ready` with `blockers`; no `automation_runs` row created.

**Security** (`test/automation/security.test.ts` + `noAutoSubmit.test.ts`):
- no-auto-submit source grep (§6.2).
- no CAPTCHA/OTP solver: grep for `2captcha|anti-captcha|solveRecaptcha|recaptcha.*token|imap|otpauth|speakeasy|totp` in automation source ⇒ zero.
- full-run redaction: run integration test 1 with a capturing pino stream; assert the output contains no fixture field value, no OTP string, no `expected`/`actual` key with a value; assert every emitted `automation_events.message` is in `EVENT_MESSAGES`.
- cross-applicant isolation: run for app A; `GET /automation-runs/:runA` while authenticated context is app B's — the route resolves by run id but the run carries `application_id`; a test asserts a run list for app B does not include run A and `getRun` does not leak app A's application fields beyond the run row.
- invalid application id → 404; malformed run id → 404.
- `AUTOMATION_EVIDENCE=screenshots` run: screenshot files land under `AUTOMATION_DIR/<runId>/`, `evidence_path` is relative, no absolute path in the DB, dir is gitignored.

**E2E evidence:** integration test 1 also `console.log`s the ordered event trace
and explicitly asserts `submitCount === 0`, that the fixture never received a
POST to `/__fixture/submit`, and that no `automation_events.type` denotes a
submit.

## 18. Acceptance criteria (task-independent; every item needs evidence in the report)

1. `npm run typecheck` (×4), `lint`, `test`, `build` green; full Phase 0–4 regression green.
2. Migration 5 creates `automation_runs` + `automation_events`; `LATEST_SCHEMA_VERSION === 5`; fresh DB and a v4→v5 upgrade both succeed (real v4-stop test).
3. Phase 5 consumes `getApplication` / `plan` / `getActivePortal` / `documentService` — no duplicate applicant/application/document/visa-rule model; a guard test asserts no KB category-id or portal-URL literal in the engine.
4. Engine is portal-agnostic: `automationEngine.ts` imports no concrete adapter; India selectors appear only under `adapters/india/` (grep test).
5. `startRun` refuses when `readyForAutomation.ready === false`, returning the blockers; refuses a second concurrent run.
6. Page detection: a known fixture page → correct `PortalState` with confidence ≥ threshold; an unknown page → `UNKNOWN` → pause. No field interaction on an unknown page.
7. Every filled field is re-read and verified; a required mismatch pauses the run and is visible (value-free in events; values only via `/live`).
8. OTP and CAPTCHA fixture checkpoints (the `challenge` page's two variants) each pause the run with the matching `waiting_reason`, `page.bringToFront()` is called, and progress requires `POST /resume`; resume re-checks the checkpoint and refuses (`409 checkpoint_still_present`) while it is present; no solver/retrieval/bypass code exists (grep test).
9. Missing required information and missing required documents each block the run with the specific reason.
10. **No automatic submission:** the four enforcement mechanisms of §6 all in place; `submitCount === 0` in the E2E; guard test green.
11. Crash mid-run leaves a resumable DB record; `resumeRun` re-detects and continues from the observed state without replaying earlier pages.
12. PII: full-run redaction test passes; `automation_events.message` vocabulary is closed; screenshots (when enabled) are gitignored and path-only in the DB; `REDACT_PATHS` extended.
13. UI: `/applications/:id` start button wired to readiness; `/automation-runs/:id` shows status, progress, a value-free event log, the ACTION REQUIRED panel with Resume, and the SAFE STOP banner. No submit control in the UI.
14. India adapter scaffold present and typed; `indiaPortalMap` selectors are explicit placeholders; `docs/portals/india.md` created from the `visa-form-analysis` appendix template with the ToS/robots position section; `portalDiscovery` is read-only (grep: no `fill`/`click`/`type`/`goto` to an auth URL beyond user-supplied).
15. `docs/PHASE-5-REPORT.md` with the §32 contents, stating explicitly: *Automatic final visa submission: NOT IMPLEMENTED* and *OTP/CAPTCHA bypass: NOT IMPLEMENTED*. `docs/ARCHITECTURE.md` §3 gains a Phase 5 paragraph.

## 19. Execution

`superpowers:subagent-driven-development`, one task at a time, task review after
each, whole-branch review (opus) at the end. TDD throughout. Plan target ≈ 20
tasks:

1. `shared/automation` types + states + events vocabulary (+ unit tests)
2. migration 5 + `automationRunStore` (+ v4→v5 test)
3. `pageActions` primitives (+ unit tests against a tiny inline fixture)
4. `fieldActions` per control family + `verifyField` (+ unit tests)
5. `fieldMapping.ts` pure mapper (+ unit tests)
6. expanded `PortalAdapter` interface + `genericAdapter` update
7. `pageDetector` (+ unit tests)
8. `checkpointDetector` (+ unit tests)
9. `checkpointManager` + resume-signal plumbing
10. `automationEngine` loop — happy path + stop conditions (+ unit tests with a fake adapter/page)
11. `automationService` + `AutomationRunner` + `app` decoration + dispose
12. `routes/automation.ts` + `mapAutomationError` + `app.ts` wiring
13. `env` additions + `.gitignore` + logger `REDACT_PATHS`
14. `test/helpers/fixturePortal.ts` + the 11 fixture pages + `fixtureIndiaAdapter`
15. integration suite (the 7 scenarios of §17)
16. security suite + `noAutoSubmit` guard + redaction test
17. `api/client.ts` methods + `/applications/:id` start-button wiring
18. `AutomationRunPage.tsx` + sections (+ web tests)
19. `adapters/india/` scaffold (`indiaAdapter` + `indiaPortalMap` placeholders) + `portalDiscovery.ts` + `docs/portals/india.md`
20. `docs/PHASE-5-REPORT.md` + `ARCHITECTURE.md` paragraph + manual smoke against the fixture portal via the real server + UI

## 20. Open follow-ups (recorded, not done in Phase 5)

- Real India selector discovery + `indiaPortalMap` population (user-driven).
- Portal file-upload automation (deferred; `uploadStates` hook is in place).
- Multi-run history / comparison UI.
- Phase 4 value-bridge decision (still open, unrelated to Phase 5).
