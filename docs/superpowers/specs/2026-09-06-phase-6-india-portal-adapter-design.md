# Phase 6 — Real Indian Visa Portal Adapter + Live Discovery + Controlled Autofill — design

**Status:** approved (brainstorming, 2026-09-06).
**Branch:** `phase-6-india-portal-adapter` (cut from `phase-5-browser-automation` @ `d61468b`).
**Builds on:** Phase 5 (browser automation). Reuses the Phase 5 engine, service, routes,
run dashboard, and the Phase 4 `readyForAutomation` gate **unchanged** except one
generic addition (§6, value-conflict).

```
Automatic final visa submission: NOT IMPLEMENTED
OTP/CAPTCHA/anti-bot bypass: NOT IMPLEMENTED
```

---

## 1. Mission and non-goals

**Mission.** Connect the portal-agnostic Phase 5 automation engine to the **actual
configured Indian visa portal** through the dedicated India adapter, and add the
supporting machinery the adapter needs to be populated from reality rather than
guessed: a persisted **live discovery** workflow, a **canonical-field → portal-field
mapping** registry with per-mapping provenance and validation state, **controlled
autofill** with read-back verification and pre-existing-value collision handling,
and an **adapter diagnostics** surface. The automation stops at the portal's final
review page. Nothing submits.

**Non-goals (unchanged from Phase 5, restated because they are load-bearing):**

- No automatic final submission. No `submitApplication()`. No fee payment, no
  appointment booking. The terminal automation state stays `review_ready`. No
  `submitted` / `completed` / `payment_completed` / `appointment_booked` state is
  ever introduced.
- OTP / CAPTCHA / MFA / anti-bot are **human checkpoints** — detected, then the run
  pauses and the user acts in the browser. No solver, no OTP retrieval (IMAP/SMS),
  no CAPTCHA service, no stealth / fingerprint-evasion / randomised-behaviour
  anti-detection.
- Discovery is **read-only**. It never fills, clicks, types, navigates, or submits.
  The user drives the browser; the tool observes.
- Phase 6 does not re-model visa requirements. Phase 4's `ApplicationPlan` is the
  single source of truth for what must be filled.
- No parallel automation architecture. The engine, `AutomationService`, the seven
  `/api/automation-runs` routes, and `AutomationRunPage` are reused.

---

## 2. What Phase 6 consumes (do NOT rebuild)

| From | Used for |
|---|---|
| `PortalAdapter` interface (`src/server/automation/adapters/baseAdapter.ts`) | the India adapter already implements it; Phase 6 enriches the India config, not the interface |
| `runLoop` / `EngineContext` / `EngineStop` (`engine/automationEngine.ts`) | the run loop; Phase 6 adds one generic pre-fill branch (§6) |
| `AutomationService` / `AutomationRunner` (`automationService.ts`) | run lifecycle, resume, dispose; Phase 6 threads a per-field conflict decision through it |
| `automationRunStore.ts`, migration 5 tables | run + event persistence |
| `mapFields` (`shared/automation/fieldMapping.ts`, pure) | `FieldPlan → portal-control` projection |
| `EVENT_TYPES` / `EVENT_MESSAGES` (`shared/automation/events.ts`) | closed value-free vocabulary; Phase 6 adds three literals (§6) |
| `captureDiscovery` (`discovery/portalDiscovery.ts`) | the read-only DOM observer; Phase 6 extends it to `captureDiscoveryV2` |
| `inspectPage` (`engine/pageInspector.ts`) | element counts + security-challenge flags |
| `BrowserManager` (`engine/browserManager.ts`) | Chromium lifecycle; Phase 6 adds a headed persistent-context path for discovery |
| `getApplication` + `ApplicationPlan.readyForAutomation` (Phase 4) | the readiness gate — **not** re-implemented |
| `getActivePortal` / `getPortal` (`portalService.ts`) | the configured portal URL (single source of truth, spec §9a) |
| `runConnectionTest` (`discovery/testConnection.ts`) | the existing navigate-only Test Connection |
| `docs/portals/india.md`, `docs/visa-form-analysis.md`, `docs/automation-risks.md` | the discovery template, selector ladder (§8.1), risk register (R7/R14/R15/R17/R18/R19) |

---

## 3. Architecture

```
Applicant → Documents → Visa Selection → ApplicationPlan → readyForAutomation
                                                                │
                                              ┌─────────────────┘
                                              ▼
                              Phase 5 automation engine (portal-agnostic)
                                              │  reaches a portal ONLY through
                                              ▼
                                        PortalAdapter  ──registry──►  indiaAdapter
                                              │                            │
                                              ▼                     indiaPortalMap  (v2:
                                    Indian Visa Portal               per-mapping status +
                                                                     provenance, versions)
                                                                            ▲
                                          populated (never guessed) from ────┘
                                                                            │
   DiscoveryController ── headed browser, user-driven ──► captureDiscoveryV2 (read-only)
        │                                                        │
        ▼                                                        ▼
   portal_discovery_sessions / portal_discovery_pages  ◄── sanitized structure only
   (migration 6)                                            (zero applicant values)
```

**New modules (all server-side, under `src/server/automation/`):**

- `discovery/discoveryController.ts` — session lifecycle: `start` / `capture` / `end` / `abort`.
- `discovery/discoverySessionStore.ts` — prepared-statement CRUD over migration 6.
- `discovery/observe.ts` — `captureDiscoveryV2(page)`: extends `captureDiscovery` with
  headings, radio/checkbox groups, buttons, nav-control candidates, required
  indicators, `<select>` option catalogues, a hardened PII sanitizer.
- `adapters/india/indiaMappingRegistry.ts` — read the enriched map for the UI;
  `promoteCandidate(...)` renders the mapping edit; `getIndiaMappingStatus()`.
- `adapters/india/validateAdapter.ts` — `validateIndiaAdapter(page)` → `AdapterValidationReport`.
- `adapters/india/diagnostics.ts` — assemble the diagnostics payload (map versions +
  discovery-store counts + `automation_events` unknown-page count + last validation).
- `routes/discovery.ts` — discovery + diagnostics + mapping REST endpoints.

**Modified modules:**

- `shared/automation/types.ts` — `WaitingReason` gains `'value_conflict'`.
- `shared/automation/events.ts` — `EVENT_TYPES` gains `VALUE_CONFLICT`,
  `FIELD_CONFLICT_KEPT`, `FIELD_CONFLICT_OVERWRITTEN` (+ their `EVENT_MESSAGES`).
- `engine/automationEngine.ts` — pre-fill collision branch + `EngineContext.conflictDecisions`.
- `engine/browserManager.ts` — `launchPersistentDiscovery({ userDataDir })` (headed only).
- `automationService.ts` — `resumeRun(db, id, decision?)`; thread `conflictDecisions` to the runner.
- `adapters/india/indiaPortalMap.ts` — v2 structure (per-mapping status/provenance, `urlPattern`, versions).
- `adapters/india/indiaAdapter.ts` — identity from URL + heading + anchor; `adapterVersion`.
- `routes/automation.ts` — `/resume` accepts an optional `{ decision }` body.
- `db/migrations.ts` — migration 6.
- `test/helpers/fixturePortal.ts` + `test/automation/support/fixtureIndiaAdapter.ts` — fixture v2.
- `src/web/` — Settings India card, discovery session page, diagnostics panel, conflict panel.

**Layering rules (unchanged, enforced by guard tests):** the engine imports no
concrete adapter; India selectors live only under `adapters/india/`; `shared/automation/`
stays pure (no `node:` / `playwright` / `fastify` / `react`); no `https?://` literal
in `src/server/automation/**` except `adapters/india/`; no submit affordance anywhere.

---

## 4. ToS / robots.txt gate (implementation task 1 — precedes all live work)

`docs/portals/india.md` currently records the ToS position as **"Not yet assessed."**
Before any Phase 6 code connects to a real portal:

1. Fetch and record `robots.txt` for `indianvisaonline.gov.in` and `ivacbd.com`;
   note any `Disallow` covering the application paths.
2. Review each portal's published Terms of Service for a prohibition on
   automated / assisted access.
3. Write a **verdict** into `docs/portals/india.md` ("ToS / robots.txt position"):
   `PERMITTED (with the constraints below)` / `PROHIBITED` / `UNCLEAR`.

**If `PROHIBITED`:** Track B (§10) is not executed. Its tasks are marked
`DO NOT EXECUTE (ToS)` in the plan and the report; Phase 6 ships Track A only. The
tool remains a data-organiser / manual-entry aid for that portal.

**Speed-bump.** `DiscoveryController.start()` and `AutomationService.startRun()`,
when the resolved adapter is `india` and the portal URL host matches a real India
host, require a one-time acknowledgement (a `portal_policy_ack` row keyed by
portal id, or an explicit `acknowledgedToS: true` in the request) citing
`docs/portals/india.md`. The fixture portal host never triggers it.

---

## 5. Live discovery (migration 6 + store + controller + observer + UI)

### 5.1 Migration 6 (`LATEST_SCHEMA_VERSION → 6`)

```sql
CREATE TABLE portal_discovery_sessions (
  id                  TEXT PRIMARY KEY,
  portal_id           TEXT REFERENCES visa_portals(id) ON DELETE SET NULL,
  adapter_id          TEXT NOT NULL,                    -- 'india' | 'generic'
  status              TEXT NOT NULL CHECK (status IN ('active','ended','aborted')),
  started_at          TEXT NOT NULL,
  ended_at            TEXT,
  page_count          INTEGER NOT NULL DEFAULT 0,
  last_validation_json TEXT,                            -- AdapterValidationReport, sanitized
  notes               TEXT
);
-- at most one active session per adapter (partial unique index — SQLite has no partial UNIQUE constraint)
CREATE UNIQUE INDEX idx_discovery_sessions_one_active
  ON portal_discovery_sessions(adapter_id) WHERE status = 'active';

CREATE TABLE portal_discovery_pages (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES portal_discovery_sessions(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  state_guess      TEXT,                                -- adapter state name or 'UNKNOWN'
  url_pattern      TEXT,                                -- host + path with ids/tokens masked
  page_title       TEXT,
  headings_json    TEXT NOT NULL,                       -- string[]
  fingerprint_json TEXT NOT NULL,
  candidates_json  TEXT NOT NULL,                       -- DiscoveryFieldCandidate[] + groups/buttons/nav
  signals_json     TEXT NOT NULL,                       -- securityChallengeFlags
  UNIQUE (session_id, seq)
);
CREATE INDEX idx_discovery_pages_session ON portal_discovery_pages(session_id);
```

The **same migration** rebuilds `automation_runs` to **drop the `waiting_reason`
CHECK constraint** (leaving it a plain `TEXT`). Rationale: `automation_events.type`
— the 36-literal closed vocabulary — is already un-CHECK'd in migration 5 and
guarded only at the TS layer (`EventType` union + `EVENT_MESSAGES` exhaustiveness);
`waiting_reason` is likewise guarded by the `WaitingReason` union, `assertTransition`,
and the store's `UPDATABLE_COLUMNS` allow-list. Dropping the CHECK removes the need
for a constraint-rebuild migration every time a phase adds a reason (§6 adds one).
The rebuild is done with `PRAGMA legacy_alter_table` so `automation_events`'s FK
text resolves to the new table; the migration test asserts a real v5→v6 upgrade
preserves rows and the `ON DELETE CASCADE` still fires.

**PII:** neither discovery table has a column for an applicant value. `url_pattern`
masks path segments that look like ids/tokens/reference numbers. `candidates_json`
and `headings_json` are passed through the §5.3 sanitizer before insert.

### 5.2 `DiscoveryController` + `discoverySessionStore`

- `start(db, portalId, { acknowledgedToS })` → creates an `active` session row
  (rejecting a second active session for the same adapter), launches a **headed**
  Chromium via `browserManager.launchPersistentDiscovery({ userDataDir:
  <DATA_DIR>/discovery/profile })`, opens the configured portal URL **once** (the
  only `goto` — thereafter the user navigates), returns `{ session }`.
- `capture(db, sessionId)` → runs `captureDiscoveryV2` against the current page,
  sanitizes, persists one `portal_discovery_pages` row, bumps `page_count`.
- `end(db, sessionId)` / `abort(db, sessionId)` → close the context, set the
  terminal status.
- **Read-only guard.** `discoveryController.ts` + `observe.ts` carry the
  `portalDiscovery.ts` DESIGN NOTE. `test/automation/discoveryReadOnly.test.ts`
  greps both (comment-stripped) for `fill` / `click` / `type` / `press` /
  `selectOption` / `check` / `setInputFiles` / `hover` / `form.submit` / a second
  `goto` → zero. The single permitted `page.goto` in `start()` targets only the
  portal URL argument (the same assertion `testConnection.ts` gets).
- One `DiscoveryController` per process (`app.discovery`), disposed on app close,
  same pattern as `app.automation`.

### 5.3 `captureDiscoveryV2` + PII sanitizer (`observe.ts`)

Extends the existing `DiscoveryReport` with:

- `headings: string[]` (h1–h4, in document order);
- `groups: { name: string; kind: 'radio' | 'checkbox'; options: string[] }[]`;
- `buttons: { text: string; type: string | null; isNavCandidate: boolean }[]`
  (`isNavCandidate` = text matches `next|save|continue|proceed|submit|confirm`);
  **buttons are enumerated, never clicked**;
- `requiredIndicators: string[]` (selectors of controls carrying `aria-required` /
  `required` / an adjacent `*` / `.required`);
- `selectCatalogue: { selector: string; optionLabels: string[] }[]` (labels only);
- `stableAttributes: Record<string, number>` (counts of `id` / `name` /
  `data-testid` / `aria-label` coverage — a selector-ladder health signal);
- `discoveryVersion: string`.

**Sanitizer (`sanitizeDiscovery`)** — runs on every string before it is persisted:

- input `.value` is **never read** (the observer's `page.evaluate` does not touch it);
- a label / placeholder / heading / option string is dropped (replaced with `''` or
  omitted) when it matches a **value shape**: a run of ≥ 4 digits, an ISO or
  `dd/mm/yyyy` date, an email, a passport-like token (`[A-Z]{1,2}[0-9]{6,8}`), a
  string ≥ 40 chars that is mostly non-alpha;
- `url_pattern` masks `/[0-9a-f]{8,}/`, long digit runs, and query values.

`test/automation/discoverySanitizer.test.ts`: a fixture page pre-filled with fake
PII (surname, passport number, DOB, address, an OTP field with a value) yields a
persisted report containing **none** of those values, while still capturing the
control structure (labels like "Surname", "Passport Number", the control kinds).

### 5.4 Discovery REST API (`routes/discovery.ts`)

| Method | Path | Result |
|---|---|---|
| POST | `/api/portals/:id/discovery-sessions` | `201 { session }` · `409 SESSION_ACTIVE` / `NO_ACTIVE_PORTAL` / `TOS_NOT_ACKNOWLEDGED` |
| GET | `/api/portals/:id/discovery-sessions` | `200 { sessions }` |
| GET | `/api/discovery-sessions/:id` | `200 { session, pages }` · `404` |
| POST | `/api/discovery-sessions/:id/capture` | `201 { page }` · `409 SESSION_NOT_ACTIVE` |
| POST | `/api/discovery-sessions/:id/end` \| `/abort` | `202 { session }` |
| POST | `/api/discovery-sessions/:id/validate-adapter` | `200 { report }` (runs `validateIndiaAdapter` against the live page) |
| GET | `/api/portals/:id/adapter-diagnostics` | `200 { diagnostics }` |
| GET | `/api/portals/:id/adapter-mappings` | `200 { mappings }` (canonical path → status/selector/notes) |
| POST | `/api/discovery-sessions/:id/promote` | `200 { mappingEdit }` — `{ pageSeq, candidateIndex, canonicalFieldPath }` → the exact `indiaPortalMap.ts` edit to apply (rendered, not auto-written) |

All responses value-free. `mapDiscoveryError` mirrors `mapAutomationError`.

### 5.5 Discovery UI (`src/web/`)

- **Settings → "India Visa Portal" card** (`pages/Settings/`) — appears when the
  active portal resolves to the `india` adapter. Derived **Status**:
  `Needs Discovery` (no ended session) → `Needs Mapping` (session done, mappings
  still `placeholder`) → `Needs Validation` (mappings `discovered`, none `validated`)
  → `Ready` (all required mappings `validated`). Buttons: **Test Connection**
  (existing panel), **Start Discovery**, **View Mappings**, **Validate Adapter**.
- **`/discovery/:sessionId`** (`pages/Discovery/DiscoverySessionPage.tsx`) — live
  session view: a **Capture this page** button, the ordered list of captured pages
  (state guess, url pattern, title, counts), an expandable per-page **candidate
  table** with a **Promote → canonical field** control (a `<select>` of unmapped
  `appliesTo` paths) that calls `/promote` and shows the resulting map edit to
  copy, and **End session**. No applicant data anywhere on the page.
- **Adapter diagnostics panel** — adapter version, mapping revision, last discovery,
  pages / fields discovered, mappings placeholder / discovered / validated, mappings
  needing review, unknown pages encountered, last validation timestamp + pass/fail.
- Route `discovery/:sessionId` added to `main.tsx`.

---

## 6. Value-conflict — the one generic engine change

A portal field that already holds a **different, non-empty** value (the user, or a
prior session, entered something) must not be silently overwritten (spec §12).

- `shared/automation/types.ts`: `WaitingReason` gains `'value_conflict'`.
- `shared/automation/events.ts`: `EVENT_TYPES` gains `VALUE_CONFLICT`,
  `FIELD_CONFLICT_KEPT`, `FIELD_CONFLICT_OVERWRITTEN`; `EVENT_MESSAGES` fixed English,
  no interpolation:
  - `VALUE_CONFLICT` — *"The portal already holds a different value for this field. The run paused for your decision."*
  - `FIELD_CONFLICT_KEPT` — *"You chose to keep the value already in the portal for this field."*
  - `FIELD_CONFLICT_OVERWRITTEN` — *"You chose to replace the portal value with your application value for this field."*
- `engine/automationEngine.ts` — in the field loop, **before** `applyField`: read the
  control; if it is non-empty **and** `≠ expected` **and** `applyField` would not
  report `alreadySet`, then unless `ctx.conflictDecisions.get(fieldPath)` says
  otherwise: emit `VALUE_CONFLICT`, `recordMismatch({ fieldPath, expected, actual })`
  (in-memory `/live` only — never persisted), and `return { kind: 'waiting', reason:
  'value_conflict' }`. If the decision map says `use_application` → emit
  `FIELD_CONFLICT_OVERWRITTEN`, fall through to `applyField` (overwrite + read-back).
  If `keep_portal` → emit `FIELD_CONFLICT_KEPT`, skip the field (counts as resolved
  toward `fields_verified` only if it already matched — here it did not, so it is
  **not** counted; it is recorded).
- `EngineContext` gains `conflictDecisions: ReadonlyMap<string, 'use_application' | 'keep_portal'>`.
- `automationService.ts` — `resumeRun(db, id, decision?)`. On a `value_conflict`
  wait, the `decision` is stored on the runner
  (`conflictDecisions.set(pausedFieldPath, decision)`) and threaded into every
  subsequent `EngineContext`. `decision` is **required** when the wait reason is
  `value_conflict` (`400` otherwise); optional/ignored for every other reason.
  A crash-recovery resume with no in-memory runner defaults every unresolved
  conflict to `keep_portal` (never overwrite blind) and logs a debug line.
- `routes/automation.ts` — `POST /automation-runs/:id/resume` accepts an optional
  body `{ decision?: 'use_application' | 'keep_portal' }` (Zod, tolerant of an empty
  body as today).
- `AutomationRunPage` — when `waiting_reason === 'value_conflict'`, the ACTION
  REQUIRED panel renders the `/live` `{ fieldPath, expected, actual }` (the only
  value surface, in-memory) with three buttons: **Use application value**
  (`resume { decision: 'use_application' }`), **Keep portal value**
  (`resume { decision: 'keep_portal' }`), **Edit application** (→ `abort`, then
  navigate to `/applications/:id`).

No submit path touched. `submitSelector` stays `readonly null`.

---

## 7. India adapter v2 (`adapters/india/`)

### 7.1 `indiaPortalMap.ts` enrichment

```ts
interface IndiaFieldMapping extends PortalFieldSpec {
  status: 'placeholder' | 'discovered' | 'validated';
  discoveredAt?: string;
  validatedAt?: string;
  discoverySessionRef?: string;   // session id a selector was transcribed from
  notes?: string;
}
interface IndiaPortalStateConfig {
  headingPattern: RegExp;
  urlPattern?: RegExp;            // NEW — identity is URL + heading + anchor
  anchorField: string | null;
  sectionIds: string[];
  nextSelector: string | null;
  nextSelectorStatus: 'placeholder' | 'discovered' | 'validated';
  isFinalReview: boolean;
}
interface IndiaPortalMap {
  adapterVersion: string;         // bumped when adapter logic changes
  mappingRevision: string;        // ISO date, bumped when any selector changes
  lastDiscoveryAt: string | null;
  matchesUrl: RegExp;
  states: Record<IndiaPortalState, IndiaPortalStateConfig>;
  fields: Record<string, IndiaFieldMapping>;
  uploadStates: readonly IndiaPortalState[];
  checkpointHints: CheckpointHints;
  readonly submitSelector: null;
}
```

Every `fields[*].selector` and `states[*].nextSelector` **ships `'TODO:discover'` /
`status: 'placeholder'`** until Track B (§10) transcribes real values from a
discovery session. `getFieldMap()` still returns a `PortalFieldMap` (the extra keys
are ignored by the engine).

**Guard test** (`test/automation/indiaMappingProvenance.test.ts`): for every
`fields` entry and every `nextSelector`, `selector !== 'TODO:discover'` **implies**
`status !== 'placeholder'` **and** a non-empty `discoverySessionRef`. A selector can
never be non-placeholder without a recorded discovery origin — "never guess" is
mechanically enforced.

### 7.2 `indiaAdapter.ts` — identity from URL + heading + anchor

`getPageIdentity` scores each state on: `urlPattern` match (weight 0.5), `headingPattern`
match (0.3), `anchorField` present on the page (0.2). Confidence is the sum;
`UNKNOWN` below the Phase 5 floor (0.6). This replaces the current heading-only
0.7 constant (a Phase 5 review follow-up). `clickNext` still throws on a
placeholder `nextSelector` (fails closed). `adapterVersion` exported.

### 7.3 Mapping registry (`indiaMappingRegistry.ts`)

- `getIndiaMappings()` → `{ canonicalFieldPath, label, selector, control, status,
  confidence, validatedAt, notes }[]` for the UI (value-free).
- `promoteCandidate({ session, pageSeq, candidateIndex, canonicalFieldPath })` →
  returns the **exact `indiaPortalMap.ts` edit** (the `IndiaFieldMapping` literal,
  with `status: 'discovered'`, `discoveredAt`, `discoverySessionRef`) for the
  operator to paste. Phase 6 does **not** auto-write source from the running app —
  a human reviews every selector before it lands (defence against a bad discovery
  capture, and it keeps `transform` functions hand-authored).
- `getIndiaMappingStatus()` → the placeholder / discovered / validated counts for
  the Status badge and diagnostics.

### 7.4 `validateIndiaAdapter(page)` (`validateAdapter.ts`)

For each non-placeholder field mapping: the selector resolves to **exactly one**
node; the DOM control kind matches the declared `control`; for a `native_select` /
`custom_select`, the option labels are dumped (feeds the dropdown catalogue). For
each state: `nextSelector` resolves. Returns:

```ts
interface AdapterValidationReport {
  adapterVersion: string;
  mappingRevision: string;
  ranAt: string;
  fields: { fieldPath: string; resolvable: boolean; controlMatches: boolean; optionLabels?: string[]; note?: string }[];
  states: { state: string; nextResolvable: boolean }[];
  ok: boolean;                    // every non-placeholder mapping resolvable + control-matched
}
```

The report is **sanitized** (option labels pass the §5.3 sanitizer). Persisted as
`portal_discovery_sessions.last_validation_json` when run via `/validate-adapter`;
run against the fixture in CI (a fully-populated fixture adapter, all `validated`).

---

## 8. Controlled autofill on a real portal

Once `indiaPortalMap.ts` holds real selectors (Track B), autofill is the **existing
Phase 5 `runLoop`** with the §6 conflict branch. `AutomationService.resolveAdapter`
already selects `indiaAdapter` from `matchesUrl`. So "controlled autofill" is:

1. the §6 pre-fill collision check (generic, fixture-proven);
2. the identity upgrade in §7.2 (URL + heading + anchor) so real pages are recognised;
3. `AUTOMATION_HEADLESS=false` for a real run (already supported) so the operator
   watches every page;
4. the progressive Track B runbook (§10) — never a one-shot full application.

Document handling stays Phase 5 **verify-and-pause** (`DOCUMENT_READY` /
`BLOCKED_MISSING_DOCUMENT` → pause `document_upload_required`). Phase 6 does not
drive the portal file chooser.

---

## 9. Fixture portal v2 + testing

### 9.1 Fixture v2 (`test/helpers/fixturePortal.ts`, `test/fixtures/india-portal/`)

Extend the Phase 5 fixture (11 static pages) with:

- a query flag on each field page: `?prefill=match` (the control already holds the
  exact application value → `FIELD_ALREADY_SET`), `?prefill=conflict` (holds a
  *different* value → `VALUE_CONFLICT`);
- one **ASP.NET-WebForms-style** page: a `__VIEWSTATE` hidden input, a postback
  "Save" that re-renders the same URL (exercises fingerprinting + the
  `NAVIGATION_STALLED` same-state path + `urlPattern` identity);
- two more sections (`ADDITIONAL_INFORMATION`, `PREVIOUS_VISITS` as its own page);
- an **unknown** page (no matching heading/url/anchor) reachable by a stray link;
- pre-filled PII on `?prefill=*` pages for the sanitizer test.

`fixtureIndiaAdapter` v2 — a fully-populated real adapter over the fixture
selectors, every mapping `status: 'validated'`, so `validateIndiaAdapter` and the
whole engine run green end-to-end. `startFixturePortal()` keeps `submitCount`.

### 9.2 Test matrix

| Layer | Coverage |
|---|---|
| Unit | `captureDiscoveryV2` structure; `sanitizeDiscovery` (PII in → out clean); `discoverySessionStore`; migration 6 (real v5→v6, cascade, CHECK dropped); `validateIndiaAdapter`; identity scoring (URL+heading+anchor, UNKNOWN floor); value-conflict engine branch (conflict → pause; `use_application` → overwrite+verify; `keep_portal` → skip+event; decision map suppresses re-pause); `indiaMappingRegistry.promoteCandidate`; the provenance guard |
| Integration (real engine + headless chromium + fixture v2) | prefilled-match → `FIELD_ALREADY_SET`; prefilled-conflict → `VALUE_CONFLICT` pause → `/resume {use_application}` → overwritten + verified → `review_ready`; same → `{keep_portal}` → kept + `review_ready`; WebForms page → correct state, no false `NAVIGATION_STALLED`; unknown page → `unknown_page` pause, no fills; a full fixture-v2 run with the populated fixture adapter → every section → `review_ready`, `submitCount === 0`; a discovery session start→capture×N→end persists N sanitized pages |
| Security | passport / DOB / OTP / CAPTCHA text never in logs or the DB (extend `security.test.ts`); discovery pages hold none of the seeded PII; `last_validation_json` value-free; screenshots off by default; **no-submit guard green, now also scanning `discovery/**`**; `submitCount === 0` across every scenario |
| Web (jsdom) | Settings India card status derivation + buttons; `DiscoverySessionPage` capture + promote + value-free; diagnostics panel; `AutomationRunPage` conflict panel (three actions, values only from `/live`, no submit control) |

**No live-portal dependency in CI.** Track B runs behind `INDIA_LIVE=1`, operator-only.

---

## 10. Track B — live discovery & progressive real-portal validation

Executed at the end of Phase 6, **with the user**, only if §4 returned `PERMITTED`
or `UNCLEAR` (user's call) and the user has an authenticated account + a real
in-progress application. Recorded in `docs/portals/india.md` and the Phase 6 report.

| Test | Action | Stop condition |
|---|---|---|
| A | Settings → configured India portal → **Start Discovery** → headed browser opens at the portal URL | browser open, session `active` |
| B | User logs in, handles OTP/CAPTCHA, navigates the application flow; **Capture** on each page | pages persisted, sanitized |
| C | Transcribe 3–5 personal-details selectors into `indiaPortalMap.ts` (`status: discovered`); `Validate Adapter` on the live page | those 3–5 resolve |
| D | Complete the personal-details mapping; a controlled run fills just that section, reads back, verifies | section verified, run pauses at the next unmapped page |
| E | Map PASSPORT / ADDRESS / FAMILY / OCCUPATION / VISA_DETAILS across sessions | each validates |
| F | A real run hits the portal's OTP/CAPTCHA → **pause** → user completes → **resume** | run continues past the checkpoint |
| G | A full controlled preparation run over all applicable fields + required documents → **stops at the portal's final review page** | `review_ready`; **no submit**; operator confirms nothing was submitted |

If any step is blocked (ToS, portal redesign, no test application), it is **recorded
as blocked** with the reason. Phase 6 completion does not require G to pass on the
real portal — it requires G to pass on fixture v2 and the runbook + whatever live
progress was made to be documented.

---

## 11. PII & security (maps to `automation-risks.md`)

**Stored / logged:** discovery = page structure only (headings, labels, control
kinds, selector candidates, option *labels*, fingerprint, security flags); the
event `type` / `portal_state` / canonical `field_path` / closed `message`;
`AdapterValidationReport` (selectors + control kinds + sanitized option labels);
adapter/mapping version strings; a relative screenshot path only when
`AUTOMATION_EVIDENCE=screenshots`.

**Never stored / logged:** any input value (the observer never reads `.value`), the
`{expected, actual}` conflict pair (in-memory `/live` only), OTP / CAPTCHA / MFA
text, passwords, portal credentials, document bytes, absolute paths, url path
tokens/reference numbers (masked). `REDACT_PATHS` gains nothing new — no new value
key is introduced. R7 (anti-bot) / R14 (upload) / R15 (ToS) / R17 (challenges) /
R18 (user-driven auth) / R19 (PII) all hold: challenges detected-only, uploads
verify-and-pause, ToS gated (§4), auth is the user's, no value persisted.

---

## 12. REST API summary

New (`routes/discovery.ts`): the nine endpoints in §5.4.
Changed (`routes/automation.ts`): `POST /automation-runs/:id/resume` accepts
`{ decision? }`.
Everything else unchanged.

---

## 13. Acceptance criteria (every item needs evidence in `docs/PHASE-6-REPORT.md`)

1. `typecheck` ×4, `lint`, `test`, `build` green; full Phase 0–5 regression green.
2. Migration 6 creates both discovery tables + drops the `automation_runs.waiting_reason`
   CHECK; `LATEST_SCHEMA_VERSION === 6`; a real v5→v6 upgrade preserves rows and the
   cascade still fires.
3. Phase 0–5 architecture intact: the engine imports no concrete adapter; India
   logic only under `adapters/india/`; `shared/automation/` still pure; no
   `https?://` literal in `src/server/automation/**` outside `adapters/india/`;
   guard tests green.
4. Phase 4 `ApplicationPlan` remains the sole source of visa requirements — no
   duplicate requirement model in Phase 6 (guard + review).
5. The India portal URL comes from Settings; `entryUrl` is the identity of the
   configured URL; no India host literal outside `adapters/india/indiaPortalMap.ts`.
6. Discovery launches the configured portal in a **headed** browser; a second
   active session for the same adapter is refused.
7. Discovery is read-only: the source guard (fill/click/type/press/selectOption/
   check/setInputFiles/hover/form.submit/second-goto) is green over
   `discovery/**` **and** non-vacuous.
8. Discovery persists page **structure** and **no applicant values**: the sanitizer
   test (seeded PII → clean report) passes; `url_pattern` masks tokens.
9. `captureDiscoveryV2` records headings, radio/checkbox groups, buttons (never
   clicked), nav-control candidates, required indicators, `<select>` option labels.
10. `indiaPortalMap.ts` ships every selector as `'TODO:discover'` /
    `status: 'placeholder'`; the provenance guard proves a non-placeholder selector
    is impossible without a `discoverySessionRef`.
11. `getPageIdentity` scores URL + heading + anchor; a known fixture page →
    correct state ≥ 0.6; an unknown page → `UNKNOWN` → pause, no field interaction.
12. `promoteCandidate` renders a paste-ready `indiaPortalMap.ts` edit; the app never
    auto-writes adapter source.
13. `validateIndiaAdapter` resolves every non-placeholder selector, checks control
    kind, dumps option labels; runs green against fixture v2; the report is value-free.
14. A pre-existing **matching** portal value → `FIELD_ALREADY_SET`, no overwrite.
15. A pre-existing **different** portal value → `VALUE_CONFLICT` pause;
    `/resume {use_application}` overwrites + read-back-verifies + `FIELD_CONFLICT_OVERWRITTEN`;
    `/resume {keep_portal}` skips + `FIELD_CONFLICT_KEPT`; neither value is ever
    persisted (events + DB contain neither); the re-walk after resume does not re-pause.
16. Every autofilled field is read back and verified; a required unverifiable/
    mismatched field follows the Phase 5 pause policy (`FIELD_VERIFICATION_FAILED`
    → `value_mismatch`).
17. An unknown page → safe pause + `UNKNOWN_PORTAL_STATE` + non-sensitive
    diagnostics preserved.
18. OTP + CAPTCHA fixture checkpoints pause with the matching reason; `bringToFront`
    called; resume re-checks and refuses `409` while present; **no solver/retrieval/
    evasion code** (grep green over `automation/**` incl. `discovery/**`).
19. `startRun` still refuses `!readyForAutomation.ready` with the blockers; refuses
    a second concurrent run.
20. Browser interruption mid-run leaves a resumable record (Phase 5 guarantee holds
    after the §6 change); a crash mid-conflict resumes conservatively (`keep_portal`).
21. No automatic submission: `submitSelector: null` (interface + India map + fixture
    adapter); the loop returns at `isFinalReview` before any action; the no-submit
    grep is green and non-vacuous; `fixturePortal.submitCount === 0` in every
    scenario; no `submitted` / `completed` / `payment` / `appointment` run status or
    event type exists.
22. Fixture-v2 E2E green (prefill-match, prefill-conflict ×2 decisions, WebForms
    page, unknown page, full populated run, discovery session).
23. PII-redaction + no-submit + discovery-read-only + sanitizer security tests pass.
24. Adapter diagnostics view shows versions, discovery counts, mapping status
    counts, unknown-pages-encountered, last validation — and no PII.
25. UI: Settings India card (status + 4 actions), `/discovery/:sessionId` (capture +
    promote, value-free), the run-page conflict panel (3 actions, `/live`-only
    values, no submit control).
26. Track B: `docs/portals/india.md` "ToS / robots.txt position" has a verdict;
    the progressive-test runbook is written; whatever live discovery / mapping /
    Tests A–G progress was made is recorded (or each step recorded as blocked with
    the reason).
27. `docs/PHASE-6-REPORT.md` complete: architecture, tasks + SHAs, migration 6, API
    delta, UI, discovery model, mapping model, autofill, checkpoints, no-submit
    protections, PII audit, known limitations, deferred work, the acceptance table,
    and verbatim:
    ```
    Automatic final visa submission: NOT IMPLEMENTED
    OTP/CAPTCHA/anti-bot bypass: NOT IMPLEMENTED
    ```
28. `docs/ARCHITECTURE.md` §3 gains a Phase 6 paragraph; whole-branch opus review
    (APPROVE / APPROVE-WITH-FIXES with the wave landed) complete.

---

## 14. Execution

`superpowers:subagent-driven-development`, one task at a time, task review after
each, whole-branch opus review at the end. TDD throughout. ~16 tasks:

1. ToS / robots.txt assessment → `docs/portals/india.md` verdict + the adapter-launch acknowledgement speed-bump.
2. Migration 6 (discovery tables + drop `waiting_reason` CHECK) + `discoverySessionStore` + real v5→v6 test.
3. `browserManager.launchPersistentDiscovery` (headed, persistent user-data-dir) + unit test.
4. `captureDiscoveryV2` (`observe.ts`) + `sanitizeDiscovery` + the seeded-PII sanitizer test.
5. `DiscoveryController` (start/capture/end/abort) + the read-only source guard.
6. `routes/discovery.ts` (sessions, capture, end/abort) + `mapDiscoveryError` + route tests.
7. `indiaPortalMap.ts` v2 structure + `indiaAdapter` identity (URL+heading+anchor) + the provenance guard.
8. `indiaMappingRegistry` (`getIndiaMappings` / `promoteCandidate` / status) + tests.
9. `validateIndiaAdapter` + `/validate-adapter` route + fixture-v2 adapter (populated) + tests.
10. Value-conflict: `shared/automation` (`WaitingReason`, 3 events) + engine pre-fill branch + `EngineContext.conflictDecisions` + unit tests.
11. Value-conflict wiring: `resumeRun(decision)` + `/resume` body + runner decision map + crash-conservative default + integration tests.
12. Fixture portal v2 (prefill flags, WebForms page, extra sections, unknown page, seeded PII) + `fixtureIndiaAdapter` v2.
13. Integration scenarios (prefill-match, conflict ×2, WebForms, unknown, full populated run, discovery session) + `submitCount === 0` asserts.
14. Security suite (sanitizer end-to-end, no-value logs, no-submit over `discovery/**`, screenshots off) + no-submit guard extension.
15. Web: Settings India card + status, `DiscoverySessionPage`, diagnostics panel, run-page conflict panel, route.
16. `docs/PHASE-6-REPORT.md` + `docs/ARCHITECTURE.md` §3 + Track B runbook in `docs/portals/india.md` + (with the user) the live discovery session & `indiaPortalMap` population & Tests A–G, results recorded.

Then: whole-branch opus review + fix wave + `superpowers:finishing-a-development-branch`.

---

## 15. Open follow-ups (recorded, not done in Phase 6)

- Portal file-upload automation (still verify-and-pause; `uploadStates` hook ready).
- Auto-render the `docs/portals/india.md` appendix tables from a discovery session
  (Phase 6 persists the data; the markdown is updated by hand).
- Multi-portal: a second country adapter (the interface already supports it).
- Targeted crash-recovery resume (carried from Phase 5 — replay is idempotent).
- Phase 4 value-bridge (unrelated, still open).
- Re-verify Phase 1 `regular.*` KB data against official sources before an
  operational `regular.*` run (carried from Phases 1/3/4/5).
