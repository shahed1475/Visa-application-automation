# Phase 5 — India Visa Browser Automation — end-of-phase report

**Status:** Complete. Gate green. Whole-branch review (opus): **APPROVE-WITH-FIXES** — 0 Critical, 8 Important, 12 Minor; the 4 must-fix items landed in one wave (see §14). All 8 hard safety rails PASS.
**Branch:** `phase-5-browser-automation` (cut from `phase-0-portal-settings` at `f13ab3a`; Phases 0–4 already on `origin`).
**Range:** spec `3648ffd`, plan `edaef78`, **29 implementation / fix / test commits** `de5df96 … b062521`, the report/`ARCHITECTURE.md` docs commit `dd350e6`, then the whole-branch-review must-fix wave (`I1`/`I2`/`I4`/`I8` + this report update). Several tasks took one fix round; Task 12 also took a pre-review critical fix and one dead-implementer re-dispatch.
**Last verified:** 2026-09-06 — `npm run typecheck` (4 tsc projects), `npm run lint` (0 warnings), `npm test` (**971 passed / 91 files**), `npm run build` (web bundle **445.69 kB JS / 113.56 kB gzip**, css 13.07 kB / 2.95 kB gzip, html 0.40 kB) all green. Baseline entering the phase: 783 tests. (Task 21 was interrupted by a power outage and resumed in a fresh session; the fix wave added +4 tests over the 967 at `dd350e6`.)
**Spec:** `docs/superpowers/specs/2026-09-06-phase-5-browser-automation-design.md`
**Plan:** `docs/superpowers/plans/2026-09-06-phase-5-browser-automation.md`
**SDD ledger:** `.superpowers/sdd/2026-09-06-phase-5-browser-automation/progress.md`

Phase 5 turns a `readyForAutomation` application plan into a **portal form-fill up to a
human-controlled submit**. A pure shared core describes *what* to do (a run state
machine, a closed event vocabulary, a `FieldPlan → portal-control` mapper); a
server-side Playwright engine does it against a portal reached only through a
`PortalAdapter`. The engine detects each page, fills and re-reads every field,
checks page validation and document readiness, clicks the inter-page control, and
**stops at `review_ready`** — there is deliberately no `submitted`/`completed`
state and no code path that submits. OTP / CAPTCHA / MFA / anti-bot are
**detected only**, never solved: the run pauses, foregrounds the browser, and
waits for `POST /resume`. The engine is proven end-to-end against a local fixture
portal + a fixture adapter; the shipped India adapter is a **structurally complete
scaffold with `'TODO:discover'` selectors** — a real run needs a user-driven
discovery pass first.

```
Automatic final visa submission: NOT IMPLEMENTED
OTP/CAPTCHA bypass: NOT IMPLEMENTED
```

---

## 1. What was built

### 1.1 The shared pure core — `src/shared/automation/` (`de5df96`, `fe23b67`)

| File | Content |
|---|---|
| `types.ts` | `RunStatus` (7), `WaitingReason` (11), `PortalState` (`'UNKNOWN'` reserved), `ControlKind` (10), `PortalFieldSpec` / `PortalFieldMap` (key = `FieldPlan.appliesTo`), `PageIdentity` / `SignalMatch`, `MappedField`, `VerificationOutcome` / `VerificationResult`, `RunSummary`, and the DB row shapes `AutomationRunRow` (18 columns) / `AutomationEventRow` (10 columns) |
| `states.ts` | `RUN_STATES`, `TERMINAL_STATES = ['review_ready','failed','aborted']`, `LEGAL_TRANSITIONS` (a `Record<RunStatus, RunStatus[]>` — `review_ready`/`failed`/`aborted` map to `[]`), `isTerminal`, `assertTransition(from, to)` (throws `illegal automation run transition: …`) |
| `events.ts` | `EVENT_TYPES` — a `… as const` tuple of **36** literals → a closed `EventType` union; `EVENT_MESSAGES: Record<EventType, string>` (compile-exhaustive), fixed English, **no value interpolation** (a purity test asserts no `${`/placeholder); `isEventType` |
| `fieldMapping.ts` | `mapFields(sections, portalFieldMap, activeStateSectionIds) → MappedField[]` — pure. Iterates applicable + in-state sections; for each field with `effectiveRequirement !== 'not_applicable'` attaches `spec = portalFieldMap[field.appliesTo]` (or `spec: null` when unmapped) and `expected = spec.transform ? spec.transform(value) : value`; skips `appliesTo === null` synthetic rows. No portal knowledge, no I/O |
| `index.ts` | barrel re-export |

`test/automation/architectureGuard.test.ts` greps every `.ts` here and fails on a
`node:` / `playwright` / `fastify` / `react` / `../server/` import.

### 1.2 The server engine — `src/server/automation/`

| File | Role | Commit |
|---|---|---|
| `engine/browserManager.ts` (extended) | `launch(opts)` (default `env.PW_HEADLESS`), `newPage()` (fresh context each run), `bringToFront()` | `08f8c3d` |
| `engine/pageActions.ts` | 9 **condition-based** Playwright primitives — `readControl`, `fillText`, `selectNative`, `selectCustom`, `setRadio`, `setCheckbox`, `setDate`, `typeAutocomplete`, `waitForPageSettled`; `SelectorNotFoundError` / `OptionNotFoundError`. No `waitForTimeout` anywhere (guarded); `requireSelector` uses a bounded `waitFor({state:'attached', timeout:10_000})` | `a7ee5a0`, `c73b276` |
| `engine/fieldActions.ts` | `verifyControl(page, spec, expected)` + `applyField(page, mappedField)` — control→writer dispatch over all 10 `ControlKind`s, exactly one retry on a mismatch, `alreadySet` short-circuit. Returns `{ filled, outcome, alreadySet }` — **never the read value** | `0b42b24` |
| `engine/pageDetector.ts` | `detectPage(page, adapter, inspection)` — calls `adapter.getPageIdentity`, forces `UNKNOWN` when `state === UNKNOWN` **or** `confidence < 0.6` | `7179008` |
| `engine/checkpointDetector.ts` | `detectCheckpoint(inspection, page, hints?) → Checkpoint | null` — precedence `captcha > anti_bot > mfa > otp`, from `securityChallengeFlags` + adapter hints + a visible-OTP-input heuristic. **Detect-only** — a DESIGN NOTE names every forbidden API; a source guard asserts no `.fill`/`.click`/`.type`/`.press`/`.check`/solver-lib | `ce2cf2b` |
| `checkpoints/checkpointManager.ts` | `Map<runId, resolver>`; `awaitResume` / `signalResume` (exactly-once) / `hasPending` / `stillBlocked(page, inspection, hints)`. No timeout, no auto-resume | `49a4e9e` |
| `engine/automationEngine.ts` | **the run loop** `runLoop(ctx)` — `for(;;)` over portal pages, 8 stop-point returns, `MAX_ITERATIONS = 60`. No submit path; `EngineContext` has injectable deps (`inspect`/`detectPage`/`applyField`/`readControl`/`settle`) so it unit-tests without a browser. Returns `EngineStop`; does **not** persist terminal status | `b8ef62d`, `fa24a61` |
| `automationService.ts` | `AutomationService` (one per process, one `AutomationRunner | null`, one `BrowserManager`) + `AutomationRunner` (async state machine, fire-and-forget). `startRun` / `getRun` / `listEvents` / `listRunsForApplication` / `getLive` / `resumeRun` / `abortRun` / `dispose`. Every DB-re-read transition guarded by `assertTransition`; `error_message = e.name` only. `AUTOMATION_EVIDENCE=screenshots` capture on `NOTABLE_EVENTS`, relative path only | `a2929cf`, `f7a029c`, `7974f6e`, `900f3df`, `ddfbc94` |
| `state/automationRunStore.ts` | 7 prepared-statement functions over `DatabaseSync` — `createRun` / `getRun` / `listRunsForApplication` / `findActiveRun` / `updateRun` (allow-listed `SET` builder) / `appendEvent` (`seq = COALESCE(MAX(seq),0)+1`) / `listEvents(runId, afterSeq?)`. No HTTP, no engine logic | `0d1fde3` |
| `routes/automation.ts` (`src/server/routes/`) | the 7 endpoints + `mapAutomationError` (8 typed errors → sanitized envelopes; `NOT_READY` carries `.blockers`). Registered in `app.ts` after the application routes | `29ee61b` |
| `adapters/baseAdapter.ts` (extended) | `PortalAdapter` — `entryUrl` / `getPageIdentity` / `sectionIdsForState` / `documentIdsForState` / `getFieldMap` / `canContinue` / `clickNext` / `isFinalReview` / `checkpointHints?` / `readonly submitSelector: null` | `463d82f`, `b8ef62d` |
| `adapters/genericAdapter.ts` (updated) | match-all fallback — every page → `UNKNOWN` / confidence 0, empty section & document lists, no next control | `463d82f` |
| `adapters/india/indiaPortalMap.ts` | 12 states, 26 canonical field paths, **all `selector: 'TODO:discover'`, `selectorConfidence: 'fragile'`**; `matchesUrl` host-anchored to `indianvisaonline.gov.in` / `ivacbd.com`; `uploadStates: ['DOCUMENTS']`; `checkpointHints`; `submitSelector: null` (literal) | `b9ed55e`, `b062521` |
| `adapters/india/indiaAdapter.ts` | `PortalAdapter` over the map — read-only `getPageIdentity` (heading match, confidence 0.7), read-only `canContinue`; `clickNext` **throws** on a `'TODO:discover'` selector (fails closed) | `b9ed55e` |
| `adapters/registry.ts` (updated) | `[indiaAdapter]` tried first, `genericAdapter` the match-all fallback | `b9ed55e` |
| `discovery/portalDiscovery.ts` | `captureDiscovery(page) → DiscoveryReport` — **read-only**, attaches to a Page the user already navigated, enumerates candidate controls per the §8.1 selector ladder + a page fingerprint, writes a findings section. DESIGN NOTE + a source guard forbid `fill`/`click`/`type`/`press`/`goto`/`selectOption`/`check`/`setInputFiles`/`hover`/`form.submit` | `b9ed55e` |
| migration 5 (`db/migrations.ts`) | `automation_runs` + `automation_events`; `LATEST_SCHEMA_VERSION → 5` | `0d1fde3` |
| `env.ts` / `.gitignore` / `logger.ts` | `AUTOMATION_HEADLESS` / `AUTOMATION_EVIDENCE` / derived `AUTOMATION_DIR`; `data/` (covers `data/automation/`); `REDACT_PATHS += expected/actual/otp/otpCode/otp_code/captcha/captchaText` + `*.` variants | `08f8c3d` |

### 1.3 The web — `src/web/`

- **`api/client.ts`** (`df1416e`) — 7 methods: `startAutomationRun`, `listAutomationRuns`,
  `getAutomationRun`, `getAutomationEvents(runId, afterSeq)`, `getAutomationLive`,
  `resumeAutomationRun`, `abortAutomationRun`. Body-less POSTs.
- **`pages/Applications/ReadyForAutomationSection.tsx`** (`df1416e`) — the previously
  inert "Start automation" button wired: `plan.readyForAutomation.ready` → enabled →
  `startAutomationRun` → `navigate('/automation-runs/' + run.id)`; a `409` renders as
  an inline `role="alert"`. `!ready` path unchanged (disabled, blockers list, verbatim
  helper text). No submit control.
- **`pages/Automation/AutomationRunPage.tsx`** + **`runChrome.tsx`** (`f4bb8ef`) —
  header (applicant / category / portal / `adapter_id`), `StatusBadge` +
  `waiting_reason`, `ProgressBar` (fields verified / total), documents-ready line,
  current-page line, a **value-free** `EventLog` (polls `/events?after=` every
  1500 ms, cleared at terminal + on unmount, overlap-guarded), an **ACTION REQUIRED**
  `role="alert"` panel when `waiting_for_user` (reason in plain words, **Resume**
  button, and for `value_mismatch` the `/live` expected-vs-portal list inline), a
  **SAFE STOP** banner at `review_ready` (verbatim text), an **Abort** button in any
  non-terminal state. No `<form>`, no `type="submit"`, no submit control anywhere.
- **`main.tsx`** — route `automation-runs/:id`.

### 1.4 Test infrastructure — `test/`

- **`test/helpers/fixturePortal.ts`** + **`test/fixtures/india-portal/*.html`** (`86d49cd`) —
  a `node:http` server serving 11 static pages (`personal → passport → address →
  family → occupation → visa-details → references → documents → challenge → review →
  final-review`), each with labelled controls and a `Save & Continue` link. `/challenge`
  renders an OTP input by default, `?challenge=captcha` a `.g-recaptcha`, `?challenge=ok`
  neither; `final-review.html` has a **real** `Submit Application` button POSTing to
  `/__fixture/submit`. `startFixturePortal()` → `{ url, submitCount, requests,
  setChallenge, close }`.
- **`test/automation/support/fixtureIndiaAdapter.ts`** (`86d49cd`) — a full real
  `PortalAdapter` over the fixture selectors (13-field map, path→state map,
  `submitSelector: null`) so the **real engine** runs end-to-end. Test code, not shipped.
- **`docs/portals/india.md`** (`b9ed55e`) — the `visa-form-analysis` §14 appendix
  template; Discovery stage **`NOT STARTED`**; a **ToS / robots.txt position** section
  (R15). All tables carry column headers only.

---

## 2. Tasks completed

| # | Deliverable | Commit range | Fix rounds |
|---|---|---|---|
| 1 | shared `types` / `states` / closed `events` vocabulary | `edaef78..de5df96` | 0 (3 minor deferred) |
| 2 | pure `mapFields` `FieldPlan → portal-control` mapper | `de5df96..fe23b67` | 0 |
| 3 | migration 5 + `automationRunStore` (7 fns) + v4→v5 test | `fe23b67..0d1fde3` | 0 |
| 4 | `env` + `.gitignore` + `REDACT_PATHS` + `browserManager` context/foreground | `0d1fde3..08f8c3d` | 0 (1 flagged whole-branch) |
| 5 | expanded `PortalAdapter` + `genericAdapter` stop-on-unknown | `08f8c3d..463d82f` | 0 |
| 6 | 9 condition-based Playwright control primitives | `463d82f..c73b276` | 1 (2 Important) |
| 7 | `applyField` + read-back `verifyControl` | `c73b276..0b42b24` | 0 |
| 8 | `pageDetector` with a 0.6 confidence floor | `0b42b24..7179008` | 0 (zero findings) |
| 9 | detect-only OTP/CAPTCHA/MFA/anti-bot `checkpointDetector` | `7179008..ce2cf2b` | 0 |
| 10 | `checkpointManager` pause/resume signalling | `ce2cf2b..49a4e9e` | 0 (zero findings) |
| 11 | **the run loop** — detect / fill / verify / navigate / stop at review | `49a4e9e..fa24a61` | 1 (2 Important) |
| 12 | `AutomationService` + background `AutomationRunner` + app wiring | `fa24a61..f7a029c` | 1 (+1 critical pre-review, +1 dead-implementer re-dispatch) |
| 13 | 7 REST endpoints + `mapAutomationError` | `f7a029c..29ee61b` | 0 |
| 14 | fixture portal (11 pages) + fixture India adapter | `29ee61b..86d49cd` | 0 |
| 15 | integration suite — 8 spec-§17 scenarios, real engine + chromium | `86d49cd..945aba2` (5 commits: 2 source fixes + suite + 2 fix-round) | 1 (1 Important) |
| 16 | `noAutoSubmit` + `architectureGuard` source guards | `945aba2..c6a46ec` | 1 (2 vacuous guards) |
| 17 | `AUTOMATION_EVIDENCE=screenshots` + behavioural security suite | `c6a46ec..6a49287` | 0 |
| 18 | automation API client + wire the Start button | `6a49287..df1416e` | 0 |
| 19 | `AutomationRunPage` + run-chrome sub-components + route | `df1416e..f4bb8ef` | 0 |
| 20 | India adapter scaffold + `portalDiscovery` + `docs/portals/india.md` | `f4bb8ef..b062521` | 1 (1 Important) |
| 21 | this report + `ARCHITECTURE.md` §3/§6 + fixture smoke | this commit | — |

---

## 3. DB changes — migration 5

`LATEST_SCHEMA_VERSION → 5` (derived from the `migrations` array, no manual bump). A
fresh DB and a **genuine** v4→v5 upgrade both succeed:
`test/automation/automationMigrations.test.ts` (8 tests) does
`runMigrations(db, 4)` → seed applicant / identity / application rows →
`runMigrations(db)` → asserts `user_version === 5`, data preserved, both tables +
both indexes present, a live `automation_runs` insert then a dependent
`automation_events` insert, `DELETE FROM visa_applications` cascades both to 0,
`status='completed'` rejected by CHECK, a bad `waiting_reason` rejected, duplicate
`(run_id, seq)` rejected. `test/server/applicantMigrations.test.ts` /
`applicationMigrations.test.ts` carry the `LATEST_SCHEMA_VERSION === 5` canary.

```
automation_runs
  id PK · application_id NOT NULL → visa_applications(id) ON DELETE CASCADE
  portal_id → visa_portals(id) ON DELETE SET NULL
  portal_url_snapshot NOT NULL · adapter_id NOT NULL          -- 'india' | 'generic'
  status  NOT NULL CHECK IN (pending, running, waiting_for_user, paused,
                             review_ready, failed, aborted)   -- NO 'completed'/'submitted'
  waiting_reason CHECK IN (otp, captcha, mfa, anti_bot, unknown_page,
                           missing_field_mapping, value_mismatch,
                           document_upload_required, session_expired,
                           validation_error, user_paused) OR NULL  -- NO 'missing_document'
  current_portal_state · current_section_id
  fields_total · fields_verified · documents_total · documents_ready  (INTEGER NOT NULL DEFAULT 0)
  error_code · error_message                                  -- sanitized, value-free
  started_at NOT NULL · updated_at NOT NULL · ended_at         -- ended_at set on review_ready|failed|aborted
  INDEX idx_automation_runs_application(application_id)

automation_events
  id PK · run_id NOT NULL → automation_runs(id) ON DELETE CASCADE
  seq INTEGER NOT NULL · created_at NOT NULL
  type NOT NULL                     -- EventType (closed set, §11)
  portal_state · field_path         -- canonical appliesTo, NEVER a value
  status                            -- 'ok'|'blocked'|'mismatch'|'skipped'|'info'
  message NOT NULL                  -- from EVENT_MESSAGES (closed vocabulary)
  evidence_path                     -- relative path under AUTOMATION_DIR, or NULL
  UNIQUE (run_id, seq) · INDEX idx_automation_events_run(run_id)
```

`review_ready` is the normal terminal success. `missing_document` is an
**`error_code` on a `failed` run**, not a waiting reason. Neither table has a
column for a field value.

---

## 4. API changes — `routes/automation.ts`

| Method | Path | Result |
|---|---|---|
| POST | `/api/applications/:id/automation-runs` | `201 { run }` · `409 NOT_READY {blockers}` / `RUN_IN_PROGRESS` / `ANOTHER_RUN_ACTIVE` / `NO_ACTIVE_PORTAL` · `404` |
| GET | `/api/applications/:id/automation-runs` | `200 { runs }` (scoped by `application_id`) |
| GET | `/api/automation-runs/:id` | `200 { run, events }` · `404` |
| GET | `/api/automation-runs/:id/events?after=<seq>` | `200 { events }` (incremental poll) · `400` on a bad `after` · `404` |
| GET | `/api/automation-runs/:id/live` | `200 { mismatches }` (in-memory only) · `409 NOT_ACTIVE` |
| POST | `/api/automation-runs/:id/resume` | `202 { run }` · `409 NOT_WAITING` / `CHECKPOINT_STILL_PRESENT` |
| POST | `/api/automation-runs/:id/abort` | `202 { run }` |

`mapAutomationError` has an `instanceof` branch for each of the 8 typed service
errors and returns `undefined` for anything else (→ route rethrows → `app.ts`
`setErrorHandler` → sanitized `500 INTERNAL`). Thin layer — no DB SQL, no engine,
no chromium. Cross-app isolation is enforced at the SQL `WHERE application_id = ?`
and proven by `automationRoutes.test.ts` case 8 and `security.test.ts` test 3.

---

## 5. UI changes

- **`/applications/:id`** — the Start button is enabled iff
  `plan.readyForAutomation.ready`; it starts a run and navigates to it. `!ready`
  keeps the disabled button + blockers list + verbatim helper text
  ("Available in Phase 5. This does not submit anything, and does not mean the visa
  is approved.").
- **`/automation-runs/:id`** (`AutomationRunPage`) — status badge + `waiting_reason`,
  a `fields_verified / fields_total` progress bar, a `documents_ready / documents_total`
  line, `current_portal_state`, a **value-free** event log (renders only
  `EVENT_MESSAGES[type]`, `field_path`, `portal_state`, `created_at` — `AutomationEventRow`
  has no value member), an **ACTION REQUIRED** panel (reason in plain words +
  **Resume automation** + Abort; for `value_mismatch` the `/live` `{fieldPath,
  expected, actual}` list rendered inline — the *only* value surface, in-memory,
  never persisted/logged), a **SAFE STOP** banner at `review_ready`
  (*"Automation completed the preparation. Final submission requires your review and
  action in the browser."*).
- **No submit control anywhere in the UI** — `AutomationRunPage.test.tsx` test (d)
  asserts no `button[name=/submit/i]`, no `<form>`, no `button[type="submit"]`.

---

## 6. The portal adapter model

The engine never imports a concrete adapter. It receives a `PortalAdapter`
(resolved by `AutomationService` from the active portal URL via the registry) and
speaks only to its members:

- `entryUrl(portalUrl)` · `getPageIdentity(page, inspection)` · `sectionIdsForState` ·
  `documentIdsForState` · `getFieldMap()` · `canContinue(page)` · `clickNext(page)` ·
  `isFinalReview(state)` · `checkpointHints?` · `readonly submitSelector: null`.

Three implementations:

| Adapter | Role |
|---|---|
| `genericAdapter` | match-all fallback. Every page → `UNKNOWN` / confidence 0 → the loop pauses `unknown_page` and stops. A portal with no specific adapter is safe by construction. |
| `fixtureIndiaAdapter` (test) | a full real adapter over the local fixture portal — the E2E harness. Not shipped. |
| `indiaAdapter` (shipped scaffold) | structurally complete over `indiaPortalMap`: 12 states, 26 field paths, **all selectors `'TODO:discover'` / `'fragile'`**, `submitSelector: null`. `clickNext` **throws** on a `'TODO:discover'` next-selector, so a real run cannot advance past page 1 until discovery fills the map — it fails closed. |

`registry.ts` tries `indiaAdapter` first (host-anchored `matchesUrl` on
`new URL(url).hostname`), `genericAdapter` last.

---

## 7. Browser behaviour — the run loop (spec §5)

`runLoop(ctx)` emits `RUN_STARTED` once, then `for(;;)` over portal pages
(`MAX_ITERATIONS = 60` backstop). Per page:

1. `waitForPageSettled` (load state + adapter anchor) → `inspectPage` +
   `detectPage`. `state === UNKNOWN` **or** confidence < 0.6, or the state did not
   change after the previous `clickNext` (`NAVIGATION_STALLED`) → emit
   `UNKNOWN_PORTAL_STATE` / `NAVIGATION_STALLED`, pause `unknown_page`, **stop**.
   Else emit `PAGE_DETECTED` and report progress (location).
2. `detectCheckpoint` non-null → `page.bringToFront()`, emit
   `OTP_REQUIRED` / `CAPTCHA_REQUIRED` / `MFA_REQUIRED` / `ANTI_BOT_DETECTED`,
   pause with the matching reason, **stop**.
3. `mapFields(plan.sections, adapter.getFieldMap(), sectionIdsForState(state))`
   restricted to `applicable && present`. Per field: `readControl` → if already
   equal → `FIELD_ALREADY_SET`, skip. Else `applyField` → re-read → outcome:
   `verified` → `FIELD_VERIFIED`; `mismatch` → one retry → still mismatch →
   `FIELD_MISMATCH`, and if the field is required → pause `value_mismatch`, **stop**
   (the engine re-reads `actual` itself for the in-memory `getLiveDetail`, never
   into an event); `unreadable` → `FIELD_UNVERIFIABLE`, treated as a required
   mismatch. Unmapped + required + present → `FIELD_UNMAPPED`, pause
   `missing_field_mapping`, **stop**. Then report progress (counters).
4. `documentIdsForState(state)` ∩ required docs: any not `uploaded` → emit
   `BLOCKED_MISSING_DOCUMENT` (`field_path` = doc id), set `status = failed`,
   `error_code = missing_document`, **stop**. All present but the page needs an
   in-portal attach → `DOCUMENT_READY` per doc, pause `document_upload_required`.
5. `!adapter.canContinue(page).ok` → `VALIDATION_ERROR`, pause `validation_error`, **stop**.
6. `adapter.isFinalReview(state)` → `status = review_ready`, emit `REVIEW_READY`,
   **STOP — the loop never calls submit.**
7. Else emit `NAVIGATION_STARTED` → `adapter.clickNext(page)` → `waitForPageSettled`
   → `NAVIGATION_COMPLETED` → loop.

All waits are condition-based (load state + a named anchor selector); there is no
`waitForTimeout` / `setTimeout` in the engine (a guard test greps for it). Progress
counters (`fields_total`/`fields_verified` are required-only, so the ratio cannot
overflow; `documents_total`/`documents_ready`) are recomputed and persisted after
every page — **before** any suspension, so a crash leaves a resumable record.

---

## 8. Human checkpoints (spec §13, R7)

`detectCheckpoint` runs on every page before any field interaction. It reads
`inspection.securityChallengeFlags` + adapter `checkpointHints` + a visible-OTP-input
heuristic, with precedence `captcha > anti_bot > mfa > otp`. On a hit the loop
**pauses**, `page.bringToFront()` foregrounds the browser, and the run stays
`waiting_for_user` until `POST /automation-runs/:id/resume`. Resume on an
`otp/captcha/mfa/anti_bot` wait **re-runs `detectCheckpoint` first**: still present
→ append a `CHECKPOINT_STILL_PRESENT` event and return `409 checkpoint_still_present`;
cleared → `signalResume` wakes the parked runner (or, after a process restart,
a fresh runner is started — see §12 limitation). There is **no solver, no OTP
retrieval (IMAP/SMS), no CAPTCHA service, no anti-bot evasion** anywhere:
`noAutoSubmit.test.ts` greps the automation source (comment-stripped) for
`2captcha|anti-captcha|capsolver|solveRecaptcha|speakeasy|otplib|otpauth|node-imap|…`
→ zero. `checkpointDetector.ts` carries a DESIGN NOTE naming every forbidden API and
a source guard for `.fill`/`.click`/`.type`/`.press`/`.check`.

---

## 9. Tests

**Baseline 783 → 967 (+184).** By area:

| Area | Files | +Tests | Coverage |
|---|---|---|---|
| Unit — shared core + engine primitives + detectors + india adapter | `states`, `events`, `fieldMapping`, `env`, `browserManager`, `genericAdapter`, `pageActions`, `fieldActions`, `pageDetector`, `checkpointDetector`, `checkpointManager`, `automationEngine`, `indiaAdapter` | **97** | transitions / vocabulary purity / mapper rules / per-`ControlKind` fill→verify / confidence floor / checkpoint precedence + detect-only / loop stop-points |
| DB / store | `automationMigrations` (8), `automationRunStore` (12) | **20** | v4→v5 real stop-at-4, CHECK rejections, cascade, `seq` monotonicity + `UNIQUE`, allow-listed `updateRun` |
| Integration (real engine + real headless chromium + fixture portal) | `automationService` (9), `automationRoutes` (8), `integration` (8) | **25** | the 8 §17 scenarios + orchestration + route envelopes + cross-app isolation |
| Fixture infra | `fixturePortal` (15) | **15** | 11 pages, challenge variants, `submitCount`, the fixture adapter contract |
| Guard | `noAutoSubmit` (6), `architectureGuard` (5), `portalDiscovery` (2) | **13** | no-submit source grep (non-vacuous), shared-purity import bans, engine imports no concrete adapter, discovery read-only |
| Security (behavioural) | `security` (4) | **4** | full-run redaction, evidence path safety, in-memory isolation, not-ready refusal |
| Web (jsdom) | `ReadyForAutomationSection` (5), `AutomationRunPage` (5) | **10** | button readiness gating + 409 alert; value-free log, ACTION REQUIRED + Resume, SAFE STOP, no submit control |

**The 8 integration scenarios** (`test/automation/integration.test.ts`, real chromium ×8, ~10 s):
1. happy path → every page → OTP pause → `/resume` → `review_ready` → `submitCount === 0`.
2. CAPTCHA → pause → `/resume` while present → `409 CHECKPOINT_STILL_PRESENT` → clear → proceeds.
3. missing required field on FAMILY → `canContinue: false` → `VALIDATION_ERROR`, no navigation past FAMILY.
4. missing required document → `BLOCKED_MISSING_DOCUMENT` → `failed` / `missing_document`, `waiting_reason` NULL.
5. entry URL at `/nonsense` → `UNKNOWN_PORTAL_STATE` → pause `unknown_page`, no fills.
6. self-mutating control → `FIELD_MISMATCH` → pause `value_mismatch`; `/live` returns `{fieldPath, expected, actual}`; the persisted events contain **neither** value.
7. crash / resume — dispose the service mid-pause, rebuild from the same DB → resumes → `review_ready`.
8. `readyForAutomation.ready === false` → `409 NOT_READY` with `blockers`, **no** `automation_runs` row created.

Every scenario asserts `portal.submitCount === 0` and that no event `type` matches
`/submit|confirm|lodge|pay/i`.

---

## 10. Fixture verification — the Step-2 smoke

A throwaway script (scratchpad, **not committed**) built the **real Fastify server**
on a temp DB with an `AutomationService` whose `BrowserManager` was wrapped to force
`headless: true`, `resolveAdapter` → `makeFixtureIndiaAdapter(portal.url)`, and
`getApplication` → a hand-built ready plan over the 13 contract paths. It seeded a
portal row (`createPortal` + `setActivePortal`) + a `visa_applications` row,
`POST`ed `/api/applications/app1/automation-runs`, polled to the OTP wait,
`portal.setChallenge('ok')`, `POST`ed `/resume`, and polled to `review_ready`.

```
[SMOKE] after start: status=waiting_for_user waiting_reason=otp
[SMOKE] resume status=202

[SMOKE] ordered automation_events (type | portal_state | field_path | message):
   1  RUN_STARTED              | -                | -                                  | The automation run started.
   2  PAGE_DETECTED            | PERSONAL_DETAILS | -                                  | The current portal page was recognised.
   3  FIELD_FILL_STARTED       | -                | identity.surname                   | The run began filling this field.
   4  FIELD_VERIFIED           | -                | identity.surname                   | The field read back as expected.
   5  FIELD_FILL_STARTED       | -                | identity.givenNames                | The run began filling this field.
   6  FIELD_VERIFIED           | -                | identity.givenNames                | The field read back as expected.
   7  FIELD_FILL_STARTED       | -                | identity.sex                       | The run began filling this field.
   8  FIELD_VERIFIED           | -                | identity.sex                       | The field read back as expected.
   9  NAVIGATION_STARTED       | PERSONAL_DETAILS | -                                  | The run moved to the next portal page.
  10  NAVIGATION_COMPLETED     | PERSONAL_DETAILS | -                                  | The next portal page finished loading.
  11  PAGE_DETECTED            | PASSPORT_DETAILS | -                                  | The current portal page was recognised.
  12  FIELD_FILL_STARTED       | -                | passport.number                    | The run began filling this field.
  13  FIELD_VERIFIED           | -                | passport.number                    | The field read back as expected.
  14  FIELD_FILL_STARTED       | -                | passport.expiryDate                | The run began filling this field.
  15  FIELD_VERIFIED           | -                | passport.expiryDate                | The field read back as expected.
  16  NAVIGATION_STARTED       | PASSPORT_DETAILS | -                                  | The run moved to the next portal page.
  17  NAVIGATION_COMPLETED     | PASSPORT_DETAILS | -                                  | The next portal page finished loading.
  18  PAGE_DETECTED            | ADDRESS          | -                                  | The current portal page was recognised.
  19  FIELD_FILL_STARTED       | -                | address.line1                      | The run began filling this field.
  20  FIELD_VERIFIED           | -                | address.line1                      | The field read back as expected.
  21  FIELD_FILL_STARTED       | -                | address.city                       | The run began filling this field.
  22  FIELD_VERIFIED           | -                | address.city                       | The field read back as expected.
  23  NAVIGATION_STARTED       | ADDRESS          | -                                  | The run moved to the next portal page.
  24  NAVIGATION_COMPLETED     | ADDRESS          | -                                  | The next portal page finished loading.
  25  PAGE_DETECTED            | FAMILY           | -                                  | The current portal page was recognised.
  26  FIELD_FILL_STARTED       | -                | family.maritalStatus               | The run began filling this field.
  27  FIELD_VERIFIED           | -                | family.maritalStatus               | The field read back as expected.
  28  FIELD_FILL_STARTED       | -                | family.spouseName                  | The run began filling this field.
  29  FIELD_VERIFIED           | -                | family.spouseName                  | The field read back as expected.
  30  NAVIGATION_STARTED       | FAMILY           | -                                  | The run moved to the next portal page.
  31  NAVIGATION_COMPLETED     | FAMILY           | -                                  | The next portal page finished loading.
  32  PAGE_DETECTED            | OCCUPATION       | -                                  | The current portal page was recognised.
  33  FIELD_FILL_STARTED       | -                | occupation.occupation              | The run began filling this field.
  34  FIELD_VERIFIED           | -                | occupation.occupation              | The field read back as expected.
  35  NAVIGATION_STARTED       | OCCUPATION       | -                                  | The run moved to the next portal page.
  36  NAVIGATION_COMPLETED     | OCCUPATION       | -                                  | The next portal page finished loading.
  37  PAGE_DETECTED            | VISA_DETAILS     | -                                  | The current portal page was recognised.
  38  FIELD_FILL_STARTED       | -                | application.purpose                | The run began filling this field.
  39  FIELD_VERIFIED           | -                | application.purpose                | The field read back as expected.
  40  FIELD_FILL_STARTED       | -                | application.intendedArrivalDate    | The run began filling this field.
  41  FIELD_VERIFIED           | -                | application.intendedArrivalDate    | The field read back as expected.
  42  FIELD_FILL_STARTED       | -                | application.visitedIndiaBefore     | The run began filling this field.
  43  FIELD_VERIFIED           | -                | application.visitedIndiaBefore     | The field read back as expected.
  44  NAVIGATION_STARTED       | VISA_DETAILS     | -                                  | The run moved to the next portal page.
  45  NAVIGATION_COMPLETED     | VISA_DETAILS     | -                                  | The next portal page finished loading.
  46  PAGE_DETECTED            | REFERENCES       | -                                  | The current portal page was recognised.
  47  NAVIGATION_STARTED       | REFERENCES       | -                                  | The run moved to the next portal page.
  48  NAVIGATION_COMPLETED     | REFERENCES       | -                                  | The next portal page finished loading.
  49  PAGE_DETECTED            | DOCUMENTS        | -                                  | The current portal page was recognised.
  50  NAVIGATION_STARTED       | DOCUMENTS        | -                                  | The run moved to the next portal page.
  51  NAVIGATION_COMPLETED     | DOCUMENTS        | -                                  | The next portal page finished loading.
  52  PAGE_DETECTED            | CHALLENGE        | -                                  | The current portal page was recognised.
  53  OTP_REQUIRED             | CHALLENGE        | -                                  | An OTP challenge is on the page. Complete it in the browser, then resume.
  54  USER_ACTION_REQUIRED     | -                | -                                  | The run needs an action from you in the browser before it can continue.
  55  RUN_RESUMED              | -                | -                                  | The automation run resumed.
  56  RUN_STARTED              | -                | -                                  | The automation run started.
  57  PAGE_DETECTED            | CHALLENGE        | -                                  | The current portal page was recognised.
  58  NAVIGATION_STARTED       | CHALLENGE        | -                                  | The run moved to the next portal page.
  59  NAVIGATION_COMPLETED     | CHALLENGE        | -                                  | The next portal page finished loading.
  60  PAGE_DETECTED            | REVIEW           | -                                  | The current portal page was recognised.
  61  NAVIGATION_STARTED       | REVIEW           | -                                  | The run moved to the next portal page.
  62  NAVIGATION_COMPLETED     | REVIEW           | -                                  | The next portal page finished loading.
  63  PAGE_DETECTED            | FINAL_REVIEW     | -                                  | The current portal page was recognised.
  64  REVIEW_READY             | FINAL_REVIEW     | -                                  | The portal reached the final review page. Preparation is complete; submission is yours.

[SMOKE] final status=review_ready waiting_reason=null
[SMOKE] portal.submitCount=0
[SMOKE] any submit-like event type? false
```

Every `field_path` is a canonical `appliesTo` identifier; no cell carries a value.
`portal.submitCount === 0` — the fixture's real `Submit Application` button was never
clicked. No `automation_events.type` matches `/submit|confirm|lodge|pay/i`. The
smoke revealed **no bug** — it is a report artifact (integration scenario 1 already
exercises the same path).

---

## 11. Real portal verification: NOT PERFORMED

**The engine is fixture-proven; `indiaPortalMap` selectors are placeholders;
discovery is user-driven.** The run loop, the primitives, the detectors, the
checkpoint model, the service, the routes and the UI are all exercised end-to-end
against the local fixture portal + the fixture adapter (8 integration scenarios +
the smoke above, real headless chromium). **No run has ever touched
`indianvisaonline.gov.in` or an IVAC portal.** Every `indiaPortalMap.fields` entry
is `selector: 'TODO:discover'`, `selectorConfidence: 'fragile'`; every form-page
`nextSelector` is `'TODO:discover'`; `indiaAdapter.clickNext` **throws** on such a
selector, so a live run fails on the first form page by design.

Before a real run the user must, per `docs/portals/india.md` and
`docs/visa-form-analysis.md` §1:

1. Confirm the portal's Terms of Service position on assisted automation and record
   it in `docs/portals/india.md`; if it prohibits assisted automation, stop.
2. Navigate the authenticated application flow manually in a browser.
3. On each page, run `portalDiscovery.captureDiscovery(page)` (read-only) and record
   the candidate selectors, the page fingerprint, and the checkpoint markers in
   `docs/portals/india.md`.
4. Fill `indiaPortalMap.states[*].headingPattern` / `anchorField` / `nextSelector`
   and every `indiaPortalMap.fields[*].selector` (+ `selectorConfidence`, `fallbackSelector`,
   `transform`, `optionMatch`) from the discovery findings — never guessed.
5. Re-run the gate; add a live-portal integration check behind an explicit opt-in
   env flag (no live-portal dependency in CI).
6. Only then start a run against the configured India portal, headed
   (`AUTOMATION_HEADLESS=false`), watching every page and completing every checkpoint.

---

## 12. Security findings

### No auto-submit — enforced four ways (spec §6)

1. **Structural** — `PortalAdapter.submitSelector` is typed `readonly null`
   (interface + `genericAdapter` + `fixtureIndiaAdapter` + `indiaPortalMap` all
   literal `null`); the loop `return`s at `isFinalReview` **before** any further
   action; `EngineStop` has no `submitted`/`completed` member; there is no
   `clickSubmit` and no submit selector use anywhere in `runLoop`.
2. **Guard test** (`noAutoSubmit.test.ts`, 6 tests) — greps
   `src/server/automation/**` + `src/shared/automation/**` (comment-stripped) for
   `.click(...submit|confirm|lodge|pay...)`, a `locator|getByRole(...submit|confirm|lodge...)`
   affordance, `form => form.submit()`, `.evaluate(...submit())`, `requestSubmit(`,
   `page.on('dialog'` — **zero matches**; asserts the interface pins
   `submitSelector: null`; asserts no `EVENT_TYPES` identifier is submit-like.
   Both named guards were made **non-vacuous** in fix round 1 (they now bite on a
   synthetic `page.locator('#submit-application').click()` / `'https://…gov.in/…'`).
3. **Fixture E2E** — `final-review.html` has a real `Submit` button POSTing to
   `/__fixture/submit`; `fixturePortal.submitCount === 0` after every integration
   scenario and the smoke.
4. **India config** — `indiaPortalMap` carries no submit selector; `FINAL_REVIEW`
   has `isFinalReview: true` and `nextSelector: null`.

### No evasion / no solver

`noAutoSubmit.test.ts` greps for `2captcha|anti-captcha|deathbycaptcha|capsolver|
solveRecaptcha|speakeasy|otplib|otpauth|imap-simple|node-imap|tesseract.*captcha`
→ zero. Plain Playwright chromium, no stealth plugin, human-paced condition waits
(not `waitForTimeout`). `portalDiscovery.test.ts` reads its own source and asserts
no `fill`/`click`/`type`/`press`/`goto`/`selectOption`/`check`/`setInputFiles`/`hover`/`form.submit`.

### What the guards do and don't catch (Task 16 review)

- **Catch:** every literal submit affordance in the idioms this codebase uses;
  every forbidden import in `shared/`; a concrete-adapter import in `automationEngine.ts`;
  a `https://…visa|gov.in|nic.in…` URL literal (plus `noHardcodedUrl.test.ts`
  forbids *any* `https?://` literal in the tree).
- **Don't catch:** a submit performed via a selector string assembled at runtime
  (backstopped by `submitSelector: null` + the loop's structural stop + the
  behavioural `submitCount === 0`); `import * as` / default-import / registry
  indirection of a concrete adapter in the engine (no current violation);
  `form.submit()` spelled other than `form => form.submit()`.

---

## 13. PII audit (spec §13, R19)

**IS stored / logged:** the event `type` (closed 36-literal set), `portal_state`
(an adapter state name), `field_path` (the canonical `appliesTo` identifier, e.g.
`identity.surname` — never a value), `status` (`ok`/`blocked`/`mismatch`/`skipped`/`info`),
`message` (from `EVENT_MESSAGES`, fixed English, no interpolation), and — only when
`AUTOMATION_EVIDENCE=screenshots` — a **relative** screenshot path
(`<runId>/<ts>-<TYPE>.png`) on `NOTABLE_EVENTS` only. `error_message` is `e.name`
only.

**NEVER stored / logged:** any field value (typed or read back), the expected/actual
pair of a mismatch, OTP / CAPTCHA / MFA text, passwords, portal credentials (none
are stored at all), screenshot *bytes*, any absolute path. The mismatch
`{fieldPath, expected, actual}` list lives **only** in the in-memory runner, served
by `GET /automation-runs/:id/live` while the run is loaded — the user's own data on
the user's own screen — and is never persisted or logged.

**Evidence:** `security.test.ts` test 1 runs the full happy path through a capturing
pino stream and asserts the log contains none of the fixture's surname / passport /
date / spouse values, no `"otp":"<value>"` / `"expected":"<value>"` / `"actual":"<value>"`
shape, every `automation_events.message` ∈ `EVENT_MESSAGES`, every non-null
`field_path` ∈ the contract paths. Test 2 asserts every `evidence_path` is relative,
drive-letter-free, under `AUTOMATION_DIR`, and that `AUTOMATION_DIR` resolves under
`DATA_DIR` (so `.gitignore`'s `data/` covers it). `REDACT_PATHS` gained
`expected`, `actual`, `otp`, `otpCode`, `otp_code`, `captcha`, `captchaText` and
their `*.` wildcard variants (`logger.ts` Phase 5 block). Note (Task 4 review): the
bare `expected` / `actual` keys also match the ICAO `Td3CheckDigit` object's
`expected`/`actual` fields — if an MRZ detail object were ever logged its check
digits (0–9, non-PII) would be redacted; the keys are spec-mandated verbatim and
the automation `{field: {expected, actual}}` shape is the one that matters.

---

## 14. Known limitations (triaged)

Every deferred / parked / flagged item from the SDD ledger, in one list.

### Whole-branch review (opus) — outcome + the must-fix wave

Verdict **APPROVE-WITH-FIXES** (report:
`.superpowers/sdd/2026-09-06-phase-5-browser-automation/whole-branch-review-report.md`).
0 Critical. All 8 hard safety rails PASS — no submit path, no solver, no evasion,
no PII in the DB or the log, no guessed India selector, no hard-coded portal URL
(each probed with a synthetic violation). 8 Important, 12 Minor.

**Four must-fix items landed in one wave** (all on the normal path — every real
India run pauses for an OTP, every operator eventually Ctrl-Cs the server):

| # | Defect | Fix | Tests |
|---|---|---|---|
| **I1** | `fields_verified` reset to 0 on every `runLoop` invocation, so every real run (mandatory OTP pause) reached `review_ready` showing 0 / N verified. | `EngineContext.initialVerifiedCount` carries the count across invocations; `AutomationRunner` feeds back the last reported value. A fresh crash-recovery runner still starts at 0 and re-counts (which also fixes the replay-path counters — §16 item 11). | `automationEngine.test.ts` 10–11, `automationService.test.ts` case 10 |
| **I2** | `dispose()` on a run that was *walking* (not parked) left the row `running` forever → every future `startRun` refused with `ANOTHER_RUN_ACTIVE`, no in-UI recovery. A plain Ctrl-C triggered it. | `AutomationRunner.parkForShutdown()` persists `paused` (which `resumeRun` accepts) when nothing is parked at a checkpoint. | `automationService.test.ts` case 11 |
| **I4** | `EVENT_MESSAGES.FIELD_FILLED_UNVERIFIED` said "could not be read back" — the opposite of its trigger (it fires *after* a successful read-back, for a plan value the user never verified). | Message → *"The field was filled and read back as expected, but you have not verified this entry yet."* | `events.test.ts` (vocabulary purity) |
| **I8** | The no-auto-submit source guard had no pattern for `keyboard.press('Enter')` — implicit form submission, the one submit vector with no selector and no `submit` token. Source is clean today. | Added `/(?:keyboard\.)?\bpress\s*\(\s*['"]Enter['"]/i` to `SUBMIT_PATTERNS` + non-vacuity assertions. | `noAutoSubmit.test.ts` |

**The other four Important findings — kept as documented follow-ups** (all
unreachable with the shipped `india` / `generic` adapters, so no test exercises
them and none can bite before real India discovery):

- **I3** — `document_upload_required` re-pauses forever on resume (`pageRequiredDocs`
  is recomputed from the *plan*, never from the portal DOM, so it is still
  non-empty after the user attaches files). Unreachable: both shipped adapters
  return `[]` from `documentIdsForState`. Fix when the first adapter declares
  document states: track acknowledged document states per run.
- **I5** — `OptionNotFoundError` from `selectNative` / `selectCustom` /
  `typeAutocomplete` is not caught by the engine's `SelectorNotFoundError`-only
  handler, so a missing dropdown option hard-fails the run instead of pausing, and
  `DROPDOWN_OPTION_MISSING` (a specified §11 event) is never emitted. Also: that
  error's `.message` embeds a field value — never logged or persisted today
  (`error_message` is `e.name` only), but a latent PII path. Fix: catch it, emit
  `DROPDOWN_OPTION_MISSING`, pause `value_mismatch` for a required field; make the
  message value-free.
- **I6** — the settle step (`ctx.settle(page)`) is never given an anchor selector;
  `IndiaPortalStateConfig.anchorField` is dead config. Degrades to
  `waitForLoadState('domcontentloaded')` — invisible against the static fixture,
  but the most likely source of flakiness on a real SPA portal. Fix: add
  `anchorSelectorForState(state)` to `PortalAdapter` and pass it to both `settle`
  calls (this is also the natural moment to move `settle` into the injectable dep
  seam).
- **I7** — spec §5's `session_expired` resume detection is not implemented;
  `SESSION_EXPIRED` / `PORTAL_UNAVAILABLE` are never emitted. Degrades safely (a
  login page reads as `unknown_page`, same UI instruction). Fix: on resume, detect
  a login/landing identity and pause `session_expired`.

**Unemitted event types** — 8 of the 36 closed vocabulary literals are never
emitted: `CHECKPOINT_DETECTED`, `FIELD_MAP_RESOLVED`, `FIELD_FILLED`,
`SELECTOR_STALE`, `DROPDOWN_OPTION_MISSING` (I5), `SESSION_EXPIRED` (I7),
`PORTAL_UNAVAILABLE` (I7), `RUN_PAUSED`. Two of those (`DROPDOWN_OPTION_MISSING`,
`SESSION_EXPIRED`) are specified *behaviours*, covered by I5 / I7 above; the rest
are labels reserved for future emit sites.

The 12 Minor findings (guard-regex gaps that miss no current violation,
`RunSummary` now unused, `fields_total` vs `fields_verified` skew with an unmapped
required field, the `GET .../automation-runs` route lacking `safeParse`, the
`Date.now()` screenshot-filename collision, no vitest setup file forcing headless,
…) are recorded in the review report and left for a future cleanup pass.

### Other deferred items (from the per-task reviews — opus review said keep-deferred)

- **Crash-recovery resume re-walks earlier pages** (Task 12; see §15 item 11). When
  the process restarts while a run is `waiting_for_user`, `checkpointManager` has no
  parked resolver, so `resumeRun` starts a **fresh** `AutomationRunner` from the
  adapter entry URL, which re-walks every prior page. It is idempotent
  (`applyField` reports `alreadySet` → `FIELD_ALREADY_SET`, or re-verifies) and
  reconciles to the observed state, but it does replay — where spec §5 says resume
  should "continue from the observed state, never replaying earlier pages". The
  in-process resume (the normal OTP case) does not replay. A targeted resume
  (persist the observed state, re-detect, resume mid-plan) is the clean follow-up.
- ~~**`dispose()` mid-walk leaves a stuck `running` row**~~ — **FIXED** in the
  whole-branch review wave (I2 above).
- **`NAVIGATION_STALLED` same-state false-positive** (Task 11). The stall check
  (`leftState === state` after `clickNext`) fires on a legitimate portal that keeps
  the same logical state across a multi-screen step. No fixture portal does this;
  a real India multi-screen page would need the adapter to disambiguate.
- **`selectNative` label/value match capped at 2 s** (Task 6). `selectOption` for a
  label/value (not index) uses Playwright's default per-option timeout, narrowed to
  2 s here — acceptable because `requireSelector` already waited 10 s for the
  element, but a slow-rendering option list could spuriously miss.
- **`writeControl` switch has no `never` exhaustiveness default** + **8/10 writer
  branches + `'unreadable'` are not unit-tested in `fieldActions.test.ts`** (Task 7).
  `pageActions.test.ts` tests the primitives directly and the integration suite
  covers the branches end-to-end; a 3-line `never` default and per-branch cases are
  cheap hardening.
- **`portalDiscovery` `nth-of-type` counts page-wide** (Task 20), not per parent —
  a positional last-resort selector for a deeply nested control may not resolve 1:1.
  Always flagged `fragile`; a real discovery run records the observed selector anyway.
- **`indiaAdapter.getPageIdentity` heading match returns confidence 0.7** (Task 20),
  above the 0.6 `pageDetector` floor — a heading-only match is trusted. The
  `headingPattern`s are guesses from form knowledge, not observed; only matters once
  selectors exist (until then `clickNext` blocks the run).
- **Same-millisecond screenshot filename collision + silent capture error** (Task 17
  — flagged for whole-branch). `captureEvidence` names files `<Date.now()>-<TYPE>.png`;
  two notable events in the same ms overwrite; any capture failure is swallowed to
  `null` with no signal. Use `hrtime`/a counter and log a debug line.

### Cosmetic / low-risk (report-only)

- Task 1 — `states.ts:19` dead `?.` (Record mapped type, not an index signature);
  `events.test.ts` completeness test spot-checks names rather than
  `toHaveLength(36)` (the `Record` already compile-protects); `satisfies` vs
  annotation on `LEGAL_TRANSITIONS`.
- Task 2 — `MappedField.sectionId` is taken from `field.sectionId`, not `section.id`
  (equal in every Phase 4 plan today; `section.id` is the more robust source, a
  1-token fix); `eslint.config.js` gained a per-file `no-explicit-any: off` for the
  verbatim test (matches the `applicantCompleteness.test.ts` precedent); the
  non-applicable-section exclusion is not independently tested.
- Task 3 — `RawRunRow` / `RawEventRow` re-declare the column list that also lives in
  `types.ts` (drift risk, per the `applicationService` precedent); `appendEvent`'s
  `seq` is a read-then-write, not txn-atomic (bounded by `UNIQUE(run_id, seq)` +
  single-threaded `DatabaseSync`); some v3→v4 test block titles now assert v5.
- Task 4 — `.gitignore` comment placement; the `expected`/`actual` MRZ-key overlap
  (see §13); the env "defaults" test lacks a `stubEnv(name, undefined)` guard.
- Task 5 — ADR-0004 still describes `genericAdapter.inspect(page)` (removed);
  `PortalStateConfig` is exported but only consumed by the India scaffold; `entryUrl`
  is untested (trivial identity).
- Task 6 — `nativeOptionExists` label-branch untested + `allInnerTexts()` on
  `<option>` can be flaky (`allTextContents()` is more robust); `number` /
  `searchable_select` not round-trip-tested; the missing-selector negative test
  takes ~10 s (one-time bounded-wait cost).
- Task 7 — the `alreadySet` short-circuit label-compares even for
  `optionMatch: 'value'` selects (harmless, a missed short-circuit);
  `custom_select` + `optionMatch: 'value'` has a documented latent label-vs-value
  fallback (no fixture).
- Task 9 — the minimal `CSS.escape` shim escapes only `" \ ]` (fail-safe, with
  backstops); the DESIGN NOTE is `//` not `/** */`; the `\d{4,}` hygiene assert runs
  only on the constant OTP signal, not the label-word signal (PII-adjacent path).
- Task 11 — `unverifiedFields` local list is dropped (the `FIELD_FILLED_UNVERIFIED`
  event is the record; Task 12 can rebuild it); `MAX_ITERATIONS` emit omits
  `portalState`; `requiredDocuments` recomputed 3×/page; double settle on navigation.
- Task 12 — `ctx.settle` calls a real page method not in the 5-dep injection seam
  (prod-only concern); `resumeRun`'s immediate return can lag the runner by a
  microtask (clients poll); dual `ended_at` microsecond skew between `abortRun` and
  the runner break-path.
- Task 13 — partial `idParamSchema` use (mirrors `applications.ts`); `/events` does
  `getRun`-then-`listEvents` (a redundant scan); no 404 on an empty app run-list;
  the `NOT_READY` message is hardcoded not `e.message`; `/live` has no dedicated
  test; the route test seeds real `visa_applications` rows (the FK requires it).
- Task 14 — `documentIds` override replaces the default table wholesale (no merge);
  `getFieldMap` returns a shared reference; the heading-check divergence from the
  brief is an intentional contract override; the `?invalid` check is truthy not `=1`.
- Task 15 — scenario 3's title ("missing required field") oversells what the test
  drives (an adapter `canContinue: false` hook, not a real portal rejection); a
  stale `FIELD_ALREADY_SET` comment (fixed); commit-message wording.
- Task 16 — the engine concrete-adapter check misses `import *` / default / registry
  indirection; `form.submit` narrow spelling; the india-literal non-emptiness assert
  was added in fix round 1.
- Task 17 — test 3 opens a second SQLite handle to the same file while the first is
  open (WAL, idle parked runner, no contention seen).
- Task 18 — the "no submit" web test is name-only (no `type="submit"` / `<form>`
  check — Task 19's test covers that).
- Task 19 — a mid-session `loadError` alongside a waiting run would render two
  `role="alert"` regions (`loadError` should be `role="status"`); `role="alert"` on
  the persistent ACTION REQUIRED panel; two Abort buttons in the waiting state; the
  `role="progressbar"` has no accessible name; no poll-failure ceiling (fixed
  1500 ms until the tab closes, errors swallowed).
- Task 20 — `noHardcodedUrl.test.ts` gained an `adapters/india/` carve-out for the
  gov-visa-host check (mirrors the existing `architectureGuard` carve-out; the
  brief mandated the regex); `indiaAdapter.clickNext` throwing maps to
  `failed`/`engine_error` rather than a clean `waiting` reason (brief-sanctioned for
  a not-yet-discovered adapter); the review's suggested `matchesUrl` regex was
  itself flawed (would match `ivac.example.org`) so the implementer anchored to the
  two known full hostnames instead.

---

## 15. Deferred work (spec §20)

- **Real India selector discovery + `indiaPortalMap` population** — user-driven, per
  `docs/portals/india.md` + `docs/visa-form-analysis.md` §1. See §11.
- **Portal file-upload automation** — currently verify-and-pause
  (`DOCUMENT_READY` / `BLOCKED_MISSING_DOCUMENT`, then pause
  `document_upload_required` for the user to attach files in the browser). Driving
  the portal file chooser is deferred (`automation-risks.md` R14); the
  `indiaPortalMap.uploadStates` hook is in place for a later engine-free addition.
- **Multi-run history / comparison UI** — `listRunsForApplication` + the
  `GET /api/applications/:id/automation-runs` endpoint exist; there is no web view
  that lists prior runs for an application.
- **Phase 4 value-bridge** — the "Visa Selection" section and the "Required
  information" list can both ask for the four overlapping `application.*` fields.
  Unrelated to Phase 5, still open.
- Re-verify the Phase 1 `regular.*` KB data against official HCI Dhaka / IVAC
  sources before any operational `regular.*` run (carried from Phases 1/3/4).

---

## 16. Acceptance §18 checklist — 15 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | `typecheck` ×4, `lint`, `test`, `build` green; full Phase 0–4 regression green | **PASS** | §"Last verified" — 4 tsc projects exit 0, `eslint .` 0 warnings, **971 passed / 91 files**, build 445.69 kB / 113.56 kB gzip; baseline 783 → +188 (967 at `dd350e6`, +4 in the whole-branch-review wave) |
| 2 | Migration 5 creates both tables; `LATEST_SCHEMA_VERSION === 5`; fresh DB + a real v4→v5 upgrade both succeed | **PASS** | §3 — `automationMigrations.test.ts` (8): `runMigrations(db, 4)` stop → seed → migrate → `user_version === 5`, tables + indexes, cascade, CHECK rejections; `applicant/applicationMigrations.test.ts` `LATEST_SCHEMA_VERSION === 5` canary |
| 3 | Consumes `getApplication` / `plan` / `getActivePortal` — no duplicate applicant/application/document/visa-rule model; guard asserts no KB category-id or portal-URL literal in the engine | **PASS** | §6 — `AutomationService.startRun` calls `getApplication` + `getActivePortal`; the engine reads `plan.sections` / `plan.documents` / `plan.readyForAutomation` only (document readiness reaches it as `plan.documents[].uploaded`, computed by Phase 4 from Phase 3 data — not re-modelled). `architectureGuard.test.ts` + `noHardcodedUrl.test.ts` + `noAutoSubmit.test.ts` — zero category-id / portal-URL literal in `src/**/automation/**` |
| 4 | Engine portal-agnostic: `automationEngine.ts` imports no concrete adapter; India selectors only under `adapters/india/` | **PASS** | §6 — `architectureGuard.test.ts` "the engine loop imports no concrete adapter" (only `import type { PortalAdapter }`); "India portal knowledge lives only under adapters/india" scans `src/server/automation/**` minus `india/` for the category + visa-URL literal, zero |
| 5 | `startRun` refuses when `!ready` returning blockers; refuses a second concurrent run | **PASS** | `automationService.test.ts` case 1 (`NotReadyError`, `.blockers.length === 2`, `count(automation_runs) === 0`) + case 2 (`RunInProgressError`); integration scenario 8 (`409 NOT_READY`, no row); `automationRoutes.test.ts` case 2 |
| 6 | Known fixture page → correct state, confidence ≥ threshold; unknown page → `UNKNOWN` → pause, no field interaction | **PASS** | `pageDetector.test.ts` (5, incl. the 0.6 boundary); integration scenario 5 (`/nonsense` → `UNKNOWN_PORTAL_STATE`, `FIELD_FILL_STARTED` never emitted); §10 smoke (12 pages each `PAGE_DETECTED` at confidence 0.95) |
| 7 | Every filled field re-read and verified; a required mismatch pauses, value-free in events, values only via `/live` | **PASS** | `fieldActions.test.ts` (fill→verify per `ControlKind`, seeded-wrong → `mismatch`); integration scenario 6 (`FIELD_MISMATCH` → pause `value_mismatch`; `/live` has `{expected:'RANA', actual:'RANAX…'}`; `SELECT * FROM automation_events` contains neither `'RANA'` nor `'RANAX'`); `security.test.ts` test 1 |
| 8 | OTP + CAPTCHA fixture checkpoints each pause with the matching reason; `bringToFront` called; resume re-checks & refuses `409` while present; no solver code | **PASS** | integration scenario 1 (`OTP_REQUIRED`, `waiting_reason = otp`, `/resume` after `setChallenge('ok')` → proceeds) + scenario 2 (`CAPTCHA_REQUIRED`; `/resume` while present → `409 CHECKPOINT_STILL_PRESENT` + event; clear → proceeds); `checkpointDetector.test.ts` (precedence + clean-page negative); `noAutoSubmit.test.ts` solver grep = zero; `automationEngine.test.ts` scenario 3 asserts the `bringToFront` spy |
| 9 | Missing required info and missing required documents each block with the specific reason | **PASS** | integration scenario 3 (`VALIDATION_ERROR` → pause `validation_error`, no navigation past FAMILY) + scenario 4 (`BLOCKED_MISSING_DOCUMENT` → `failed` / `error_code = missing_document`, `waiting_reason` NULL, `field_path` = the doc id) |
| 10 | No automatic submission: the four §6 mechanisms all in place; `submitCount === 0` in E2E; guard green | **PASS** | §12 — `submitSelector: null` (interface + 3 impls); `noAutoSubmit.test.ts` 6/6 (non-vacuous); `submitCount === 0` in all 8 integration scenarios + the §10 smoke; `indiaPortalMap` has no submit selector, `FINAL_REVIEW.nextSelector = null` |
| 11 | Crash mid-run leaves a resumable DB record; `resumeRun` re-detects and continues from the observed state without replaying earlier pages | **PARTIAL** | Resumable record: **yes** — counters + events persisted before every suspension; integration scenario 7 (dispose the service mid-pause → rebuild from the same DB → run reads `waiting_for_user` → `/resume` → `review_ready`). "Without replaying earlier pages": **in-process resume yes** (continues from the challenge page); **crash-recovery resume no** — a fresh `AutomationRunner` re-walks from the entry URL (idempotent via `FIELD_ALREADY_SET` / re-verify, reconciles to the observed state, but replays). Opus review: keep-deferred (replay is idempotent, converges, cannot submit; the honest PARTIAL is the right disclosure). The wave's I1 fix makes the replayed counters correct. See §14 |
| 12 | PII: full-run redaction passes; message vocabulary closed; screenshots gitignored + path-only; `REDACT_PATHS` extended | **PASS** | §13 — `security.test.ts` test 1 (capturing pino: no value / no `otp`/`expected`/`actual` value shape; every `message` ∈ `EVENT_MESSAGES`; every `field_path` ∈ contract paths) + test 2 (`evidence_path` relative, drive-letter-free, under `AUTOMATION_DIR` ⊆ `DATA_DIR`); `logger.ts` Phase 5 `REDACT_PATHS` block; `events.ts` `EVENT_MESSAGES` has no `${` |
| 13 | UI: start button wired to readiness; run page shows status, progress, a value-free event log, the ACTION REQUIRED panel with Resume, the SAFE STOP banner; no submit control | **PASS** | §5 — `ReadyForAutomationSection.test.tsx` (5: enabled when ready → starts + navigates; `409` → `role="alert"`; `!ready` inert; verbatim hints; no submit affordance); `AutomationRunPage.test.tsx` (5: value-free log, "Complete the OTP…" + Resume, `/live` mismatch list in the alert panel, SAFE STOP verbatim + no `<form>`/`type="submit"`, polling halts at terminal) |
| 14 | India adapter scaffold present + typed; `indiaPortalMap` selectors are explicit placeholders; `docs/portals/india.md` created with the ToS/robots section; `portalDiscovery` read-only | **PASS** | §6, §11 — `indiaAdapter.test.ts` (12: every `fields` selector `'TODO:discover'`, `submitSelector` literal `null`, `clickNext` throws on `'TODO:discover'`, host-anchored `matches`); `portalDiscovery.test.ts` (2: source guard — no `fill`/`click`/`type`/`press`/`goto`/`selectOption`/`check`/`setInputFiles`/`hover`/`form.submit`); `docs/portals/india.md` with Discovery `NOT STARTED` + `## ToS / robots.txt position` |
| 15 | `docs/PHASE-5-REPORT.md` with the §32 contents + the two verbatim NOT-IMPLEMENTED lines; `docs/ARCHITECTURE.md` §3 gains a Phase 5 paragraph | **PASS** | this file (all §32 sections + the two lines at the top); `ARCHITECTURE.md` §3 Phase 5 paragraph + §6 migration-5 note (this commit) |

**14 PASS, 1 PARTIAL (item 11 — crash-recovery resume re-walks earlier pages; the
resumable-record guarantee and in-process resume both hold).** The whole-branch
opus review (APPROVE-WITH-FIXES, 0 Critical, all 8 rails PASS) is complete and its
4 must-fix items have landed — see §14.

---

## 17. Verbatim

```
Automatic final visa submission: NOT IMPLEMENTED
OTP/CAPTCHA bypass: NOT IMPLEMENTED
```
