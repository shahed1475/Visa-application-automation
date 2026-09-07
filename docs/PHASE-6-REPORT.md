# Phase 6 — Real India Visa Portal Adapter + Live Discovery + Controlled Autofill — end-of-phase report

**Status:** Complete on **Track A** (fixture-proven infrastructure + operator
runbook). Gate green. The **whole-branch opus review** (spec §13.28, second half)
is **DONE** — verdict *READY TO MERGE WITH FIXES*; the must-fix wave (1 Critical
+ 6 Important) landed at `b55202a`/`7799a65`. **Track B** (the live discovery
session against the real portal — spec §10, Tests A–G) is **NOT ATTEMPTED —
deferred**: it requires the operator present plus an authenticated ToS review
clearing the portal, and the ToS verdict is `UNCLEAR` (`ivacbd.com` treated as
`PROHIBITED` pending that review).
**Branch:** `phase-6-india-portal-adapter` (cut from `phase-5-browser-automation`
at `d61468b`; Phases 0–5 already on `origin`).
**Range:** spec `e5e89cf`, plan `359d6e5`, **21 code commits** `7c30210 … caebe91`
(15 task commits + 6 fix-round commits), the Task 16 docs commit `e67529f`, then the
**whole-branch must-fix wave** — `b55202a` (Critical 1 + Important 2/3/7) and
`7799a65` (Important 4/5/6). Six of the 15 code tasks took one fix round each
(Tasks 4, 5, 9, 13, 14, 15 — no Critical in any per-task review).
**Last verified:** 2026-09-07 — `npm run typecheck` (4 tsc projects, exit 0),
`npm run lint` (`eslint .`, 0 warnings), `npm test` (**1120 passed / 108 files**),
`npm run build` (web bundle **458.52 kB JS / 117.14 kB gzip**, css 14.77 kB /
3.25 kB gzip, html 0.40 kB) — all green. Baseline entering the phase: **971 tests
/ 91 files** at `d61468b` (+149 tests, +17 files).
**Spec:** `docs/superpowers/specs/2026-09-06-phase-6-india-portal-adapter-design.md`
**Plan:** `docs/superpowers/plans/2026-09-06-phase-6-india-portal-adapter.md`
**SDD ledger:** `.superpowers/sdd/2026-09-06-phase-6-india-portal-adapter/progress.md`

Phase 6 connects the portal-agnostic Phase 5 automation engine to the **dedicated
India adapter**, and adds the machinery the adapter needs to be populated **from
reality rather than guessed**: a persisted **read-only live-discovery** workflow, a
**canonical-field → portal-field mapping lifecycle** with per-mapping provenance
and validation state (`placeholder → discovered → validated`), **controlled
autofill** with read-back verification and a pre-existing-value collision branch,
and an **adapter-diagnostics** surface. The Phase 5 `runLoop`, `AutomationService`,
the seven `/api/automation-runs` routes and `AutomationRunPage` are reused
unchanged except **one generic engine addition** — `value_conflict`. The engine is
proven end-to-end against a **fixture portal v2**; every `indiaPortalMap.ts`
selector still ships as the literal `'TODO:discover'` / `status: 'placeholder'` —
a real run needs an operator-driven discovery pass first (the Track B runbook in
`docs/portals/india.md`). **No run has ever touched a real India portal.**

```
Automatic final visa submission: NOT IMPLEMENTED
OTP/CAPTCHA/anti-bot bypass: NOT IMPLEMENTED
```

---

## 1. Architecture

```
Applicant → Documents → Visa Selection → ApplicationPlan → readyForAutomation
                                                                │
                                              ┌─────────────────┘
                                              ▼
                              Phase 5 automation engine (portal-agnostic)
                                              │  reaches a portal ONLY through
                                              ▼
                                        PortalAdapter ──registry──► indiaAdapter
                                              │                          │
                                              ▼                   indiaPortalMap v2
                                    Indian Visa Portal            (per-mapping status +
                                              ▲                    provenance + versions)
                                              │                          ▲
                          populated (never guessed) from ────────────────┘
                                              │
   DiscoveryController ── headed browser, user-driven ──► captureDiscoveryV2 (read-only)
        │                                                        │
        ▼                                                        ▼
   portal_discovery_sessions / portal_discovery_pages  ◄── sanitized structure only
   (migration 6)                                            (zero applicant values)
```

**New server modules (all under `src/server/automation/`):**

| File | Role |
|---|---|
| `discovery/policyGate.ts` | `assertPolicyAck(db, portal, adapterId)` — a **runtime** ToS gate. Refuses (`ToSNotAcknowledgedError` → `409 TOS_NOT_ACKNOWLEDGED`) when the resolved adapter is `india`, the portal host matches a real India host, and no `app_settings` row `portal_policy_ack:<portalId>` exists. Duplicates the host regex (it must not import `adapters/india/`); the fixture host is a no-op. |
| `discovery/discoverySessionStore.ts` | 7 prepared-statement functions over migration 6 (`create` / `get` / `list` / `findActive` / `appendDiscoveryPage` (`seq = COALESCE(MAX(seq),0)+1`, bumps `page_count`) / `listDiscoveryPages` / `updateDiscoverySession` (allow-listed `SET` builder)). Mirrors `automationRunStore.ts`. |
| `discovery/observe.ts` | `captureDiscoveryV2(page)` — extends the Phase 5 `captureDiscovery` with `headings`, radio/checkbox `groups`, `buttons` (`isNavCandidate`, **never clicked**), `requiredIndicators`, `selectCatalogue` (option labels only), `stableAttributes` (selector-ladder health counts), `discoveryVersion`. `sanitizeDiscovery` / `sanitizeString` / `sanitizeUrlToPattern` scrub every string before persist. |
| `discovery/discoveryController.ts` | session lifecycle `start` / `capture` / `end` / `abort`. `start` calls `assertPolicyAck` (first production caller of the Task 1 gate), then `browserManager.launchPersistentDiscovery`, then **one** `page.goto(portal.url)` — thereafter the user drives. One `DiscoveryController` per process (`app.discovery`), disposed on app close. |
| `adapters/india/indiaMappingRegistry.ts` | `getIndiaMappings()` (value-free read model), `getIndiaMappingStatus()` (placeholder/discovered/validated counts), `promoteCandidate(...)` → renders the exact paste-ready `IndiaFieldMapping` literal (`status: 'discovered'`, `discoveredAt`, `discoverySessionRef`). **No `fs` write, no DB write** — a human reviews every selector. |
| `adapters/india/validateAdapter.ts` | `validateIndiaAdapter(page) → AdapterValidationReport` — read-only probe: each non-placeholder selector resolves (group controls: `nodeCount >= 1`, every node an `<input>` of the declared type; others: exactly one node) with a matching control kind, option labels dumped through the sanitizer, each state `nextSelector` resolves. Value-free. |
| `adapters/india/diagnostics.ts` | `getIndiaDiagnostics(db, portalId)` — map versions + discovery-store counts + `automation_events` unknown-page count + last validation `{ranAt, ok}`. May hold `count(*)` SQL; value-free. |
| `routes/discovery.ts` | the 11 discovery / diagnostics / mappings / validate / policy-ack endpoints + `mapDiscoveryError` (mirrors `mapAutomationError`). No DB SQL in the route file. |

**Modified modules:** `shared/automation/types.ts` (`WaitingReason += 'value_conflict'`,
new `ConflictDecision` type), `shared/automation/events.ts` (`EVENT_TYPES +=`
`VALUE_CONFLICT` / `FIELD_CONFLICT_KEPT` / `FIELD_CONFLICT_OVERWRITTEN`),
`engine/fieldActions.ts` (`classifyPreFill`), `engine/automationEngine.ts`
(pre-fill conflict branch, `EngineContext.classifyPreFill` + `conflictDecisions`,
`EngineStop.waiting.conflictFieldPath?`), `engine/browserManager.ts`
(`launchPersistentDiscovery`), `automationService.ts` (`resumeRun(db, id, decision?)`,
runner decision map, the `startRun` ToS-gate call, conservative crash default),
`adapters/india/indiaPortalMap.ts` (v2 structure), `adapters/india/indiaAdapter.ts`
(identity = URL + heading + anchor), `routes/automation.ts` (`/resume` optional
`{decision}` body), `db/migrations.ts` (migration 6), `app.ts` / `fastify.d.ts`
(`app.discovery`), the fixture portal + fixture adapter (v2), and `src/web/` (4
new surfaces).

**Layering rules — unchanged, enforced by guard tests:** the engine imports no
concrete adapter; India selectors live only under `adapters/india/`;
`shared/automation/` stays pure (`test/automation/architectureGuard.test.ts`); no
`https?://` literal in `src/server/automation/**` outside `adapters/india/`
(`noHardcodedUrl.test.ts`, carve-out widened from `adapters/india/` to also cover
`discovery/policyGate.ts` — the module duplicates the host regex and must not
import the adapter); no submit affordance anywhere (`noAutoSubmit.test.ts`, now
also descending `discovery/**`).

---

## 2. Tasks completed

| # | Deliverable | Commit range | Review outcome |
|---|---|---|---|
| 1 | ToS/robots verdict in `docs/portals/india.md` + `policyGate` runtime gate | `359d6e5..7c30210` | SPEC ✅ / QUALITY Approved — 0C / 0I / 3 minor. Verdict `UNCLEAR`. |
| 2 | Migration 6 (2 discovery tables + drop `automation_runs.waiting_reason` CHECK) + `discoverySessionStore` + real v5→v6 test | `7c30210..50f3b8c` | Approved — 0C / 0I / 5 minor. `PRAGMA foreign_keys = OFF` fallback recipe adopted (see §3). |
| 3 | `browserManager.launchPersistentDiscovery` (headed, persistent user-data-dir) | `50f3b8c..d1f9201` | Approved — 0C / 0I / 3 minor. `headless:false` explicit + locked. |
| 4 | `captureDiscoveryV2` (`observe.ts`) + `sanitizeDiscovery` + seeded-PII test | `d1f9201..81a1d74` | Approved after **1 fix round** (1 Important: `labelFor` value fallback read a prefilled `.value` → dropped to `''`). |
| 5 | `DiscoveryController` (start/capture/end/abort) + read-only source guard | `81a1d74..4b25e7a` | Approved after **1 fix round** (1 Important: no negative-path test for the ToS gate → added). |
| 6 | `routes/discovery.ts` (sessions, capture, end/abort) + `mapDiscoveryError` | `4b25e7a..30a166f` | Approved — 0C / 0I / 4 minor. `onClose → discovery.dispose()` wired. |
| 7 | `indiaPortalMap.ts` v2 (lifecycle + provenance + `urlPattern` + versions) + `indiaAdapter` identity (URL+heading+anchor) + provenance guard | `30a166f..23724b8` | Approved — 0C / 0I / 5 minor (first review lost to loadshedding, re-dispatched). All 22 selectors still `'TODO:discover'`. |
| 8 | `indiaMappingRegistry` (`getIndiaMappings` / `getIndiaMappingStatus` / `promoteCandidate`) + `GET /adapter-mappings` + `POST /promote` | `23724b8..c49bf22` | Approved — 0C / 0I / 5 minor. `promoteCandidate` side-effect-free (no `fs`, no `.run(`). |
| 9 | `validateIndiaAdapter` + `/validate-adapter` route + `FIXTURE_INDIA_PORTAL_MAP_V2` (all `validated`) | `c49bf22..635a70a` | Approved after **1 fix round** (1 Important: radio/checkbox `n===1` incompatible with the group selector — see §"Known limitations"). Brief deviation logged. |
| 10 | Value-conflict: `shared/automation` (`WaitingReason`, 3 events) + engine pre-fill branch + `classifyPreFill` + `EngineContext.conflictDecisions` | `635a70a..bc96781` | Implementer `DONE_WITH_CONCERNS`; review Approved — 0C / 0I / 4 minor. `classifyPreFill` delegates the match/conflict split to `verifyControl` — reviewer-confirmed **strictly safer** (see §7). |
| 11 | Value-conflict wiring: `resumeRun(decision)` + `/resume` body + runner decision map + conservative crash default | `bc96781..bbe347e` | Approved — 0C / 0I / 5 minor. Crash-recovery resume defaults every unresolved conflict to `keep_portal`. |
| 12 | Fixture portal v2 (prefill flags, WebForms page, `additional-information` / `previous-visits`, `nowhere` unknown page, seeded PII) + `fixtureIndiaAdapter` v2 | `bbe347e..9e05a9a` | Approved — 0C / 0I / 4 minor. `validateAdapter` fixture smoke still `ok === true`. |
| 13 | `phase6Integration.test.ts` — 8 scenarios (real engine + chromium + fixture v2), every scenario `submitCount === 0` | `9e05a9a..2062063` | Approved after **1 fix round** (1 Important: scenario-8 "no seeded PII" assertion was vacuous → pointed the capture at `/personal?prefill=conflict`). |
| 14 | Security suite (sanitizer E2E, no-value logs, `last_validation_json` value-free, screenshots off) + no-submit guard over `discovery/**` + `getIndiaDiagnostics` + route | `2062063..d6fa689` | Approved after **1 fix round** (1 Important: `url_pattern` masking assertion was vacuous → capture URL now carries a real hex token). |
| 15 | Web: `IndiaPortalCard`, `DiscoverySessionPage`, `DiagnosticsPanel`, `ValueConflictPanel` + client methods + `discovery/:sessionId` route | `d6fa689..caebe91` | Approved after **1 fix round** (1 Important: the "renders only labels/selectors/control kinds" test was vacuous → `LEAKCANARY` value on the candidate DTO). |
| 16 | this report + `docs/ARCHITECTURE.md` §3 + the Track B runbook in `docs/portals/india.md` | `caebe91..e67529f` | Steps 1–4, 6. **Step 5 (the live portal discovery session) DEFERRED — NOT ATTEMPTED.** |

### Whole-branch opus review + must-fix wave

Verdict **READY TO MERGE WITH FIXES** — 1 Critical, 6 Important, ~9 Minor; 6/7
rails held, the PII rail well-defended. The must-fix wave (`e67529f..7799a65`):

| Sev | Finding | Fix |
|---|---|---|
| **Critical 1** | `AutomationService.startRun` never called the ToS gate — a real India host would connect with no acknowledgement (`assertPolicyAck`'s only caller was `discoveryController`). Blast radius limited today (selectors all `TODO:discover` → run fails fast) but live the moment Track B promotes a selector. | `assertPolicyAck(db, portal.id, adapter.id, portalUrlSnapshot)` in `startRun` after `resolveAdapter`, before `createRun` / any browser launch; `ToSNotAcknowledgedError → 409 TOS_NOT_ACKNOWLEDGED` in `mapAutomationError`; service + route negative-path tests (409, no `automation_runs` row, no launch). `b55202a` |
| Important 2/3 | `classifyPreFill` read a control's **default** state as a pre-existing conflict — a `<select>` on a `<option value="">` placeholder + an unchecked checkbox → spurious `value_conflict` pause on the first real Track B page. Fails safe (pause, not overwrite) so not a rail break. The one engine deviation (`optionMatch:'value'` compares option value) had no direct unit test. | `classifyPreFill` treats an empty-`inputValue()` select and an unchecked checkbox (when the plan wants it checked) as `'empty'`; added the `optionMatch:'value'` match/conflict unit cases. `b55202a` |
| Important 4 | The `value_conflict` panel passed `mismatches[0]`; an earlier non-required `value_mismatch` can occupy `[0]` while the ruling applies to the tail conflict field. | `mismatches.at(-1)` — the engine records the conflict pair immediately before the pause. `7799a65` |
| Important 5 | `discoveryReadOnly.test.ts` hard-coded 3 paths — a new `discovery/` module during Track B would escape the fill/click/goto guard. | Recursive walk of `src/server/automation/discovery/` (+ the india `validateAdapter`), empty-walk guard. `7799a65` |
| Important 6 | The `last_validation_json` PII scan was vacuous — the real map is all-placeholder so `validateIndiaAdapter` returns empty arrays. | The security suite validates the populated `FIXTURE_INDIA_PORTAL_MAP_V2` against the live page (13 mappings + real `<option>` labels) and asserts real substance before scanning. `7799a65` |
| Important 7 | `nextSelector` provenance was weaker than field provenance — no `discoverySessionRef` for a promoted `nextSelector`. | `IndiaPortalStateConfig` gained `nextSelectorDiscoverySessionRef?` / `nextSelectorValidatedAt?`; the provenance guard now asserts them, matching the field rule. `b55202a` |

The ~9 Minors remain as follow-ups (§12/§13) — opus confirmed each is fine deferred.

---

## 3. DB changes — migration 6

`LATEST_SCHEMA_VERSION → 6` (auto-derived from the `migrations` array tail — no
manual bump). Migration 6 does three things:

1. **`portal_discovery_sessions`** — `id` PK · `portal_id → visa_portals(id) ON
   DELETE SET NULL` · `adapter_id NOT NULL` · `status CHECK IN
   ('active','ended','aborted')` · `started_at NOT NULL` · `ended_at` ·
   `page_count INTEGER NOT NULL DEFAULT 0` · `last_validation_json` (sanitized
   `AdapterValidationReport`) · `notes`.
   Partial unique index `idx_discovery_sessions_one_active ON …(adapter_id) WHERE
   status = 'active'` — at most one live session per adapter.
2. **`portal_discovery_pages`** — `id` PK · `session_id → portal_discovery_sessions(id)
   ON DELETE CASCADE` · `seq` · `created_at` · nullable `state_guess` /
   `url_pattern` / `page_title` · `headings_json` / `fingerprint_json` /
   `candidates_json` / `signals_json` all `NOT NULL` · `UNIQUE (session_id, seq)` ·
   `INDEX idx_discovery_pages_session`. **No column holds an applicant value.**
   The `captureDiscoveryV2` V2 extras (`groups` / `buttons` / `selectCatalogue` /
   `requiredIndicators` / `stableAttributes`) are stashed under
   `fingerprint_json._v2` — migration 6 has no dedicated column for them (a schema
   change would be migration 7).
3. **`automation_runs` rebuilt to drop the `waiting_reason` CHECK** (now plain
   `TEXT`). Rationale: `automation_events.type` — the closed vocabulary — is
   already un-CHECK'd and guarded only at the TS layer (`EventType` union +
   `EVENT_MESSAGES` exhaustiveness); `waiting_reason` is likewise guarded by the
   `WaitingReason` union, `assertTransition`, and the store's `UPDATABLE_COLUMNS`
   allow-list. Dropping the CHECK removes the need for a constraint-rebuild
   migration every time a phase adds a reason (§6 adds `value_conflict`). The
   `status` CHECK and `idx_automation_runs_application` are **preserved** — no
   `completed` / `submitted` status exists.

**The `PRAGMA foreign_keys = OFF` fallback recipe.** `PRAGMA legacy_alter_table`
does **not** suppress the child-FK rewrite in this `node:sqlite` build (root-caused
in `task-2-report.md`): `ALTER TABLE … RENAME` still repointed
`automation_events`'s FK at the temp table. The working rebuild:

```sql
PRAGMA foreign_keys = OFF;              -- FIRST LINE; hoisted before BEGIN by runMigrations
... create both discovery tables + indexes ...
CREATE TABLE _automation_runs_v6 (...); -- new shape, waiting_reason is plain TEXT
INSERT INTO _automation_runs_v6 SELECT * FROM automation_runs;   -- identical column order (18 cols)
DROP TABLE automation_runs;             -- FKs off => no cascade wipe of automation_events
ALTER TABLE _automation_runs_v6 RENAME TO automation_runs;  -- nothing references *_v6, FK text intact
CREATE INDEX idx_automation_runs_application ON automation_runs(application_id);
PRAGMA foreign_keys = ON;               -- no-op in txn; real restore is in runMigrations' finally
```

`runMigrations` gained a 4-line special case: a migration whose `up` **begins
with** `PRAGMA foreign_keys = OFF;` gets that pragma run *outside* the wrapping
`BEGIN` (it is a silent no-op mid-transaction), and `PRAGMA foreign_keys = ON` is
restored in a `finally` after `COMMIT` / `ROLLBACK`. Migrations 1–5 `up` strings
are byte-unchanged (regex miss → old control flow).

`test/automation/discoveryMigrations.test.ts` (5) + `automationMigrations.test.ts`
prove a **genuine** v5→v6 upgrade: build real v5 → seed → `runMigrations(db)` →
`user_version === 6`, both tables + indexes, `DELETE FROM visa_applications`
cascades through runs and events, the `status` CHECK still rejects an illegal
value, and — a flipped canary — `waiting_reason = 'value_conflict'` now **stores**
(fails if the CHECK is still present). `applicant/applicationMigrations.test.ts`
carry the `LATEST_SCHEMA_VERSION === 6` canary.

---

## 4. API changes

### New — `routes/discovery.ts` (11 endpoints, all responses value-free)

| Method | Path | Result |
|---|---|---|
| POST | `/api/portals/:id/discovery-sessions` | `201 { session }` · `409 SESSION_ACTIVE` / `NO_ACTIVE_PORTAL` / `TOS_NOT_ACKNOWLEDGED` |
| GET | `/api/portals/:id/discovery-sessions` | `200 { sessions }` |
| GET | `/api/discovery-sessions/:id` | `200 { session, pages }` · `404` |
| POST | `/api/discovery-sessions/:id/capture` | `201 { page }` · `409 SESSION_NOT_ACTIVE` |
| POST | `/api/discovery-sessions/:id/end` | `202 { session }` · `409 SESSION_NOT_ACTIVE` |
| POST | `/api/discovery-sessions/:id/abort` | `202 { session }` · `409 SESSION_NOT_ACTIVE` |
| POST | `/api/discovery-sessions/:id/validate-adapter` | `200 { report }` · `404` · `409 SESSION_NOT_ACTIVE` (runs `validateIndiaAdapter` against the live page) |
| POST | `/api/discovery-sessions/:id/promote` | `200 { mappingEdit }` · `404 DISCOVERY_CANDIDATE_NOT_FOUND` (`{ pageSeq, candidateIndex, canonicalFieldPath }` → the exact `indiaPortalMap.ts` literal, rendered not written) |
| GET | `/api/portals/:id/adapter-mappings` | `200 { mappings }` (canonical path → status / selector / control / confidence / notes) |
| GET | `/api/portals/:id/adapter-diagnostics` | `200 { diagnostics }` (versions + discovery counts + unknown-page count + last validation) |
| POST | `/api/portals/:id/policy-ack` | records the operator's ToS acknowledgement (`app_settings` key `portal_policy_ack:<portalId>`) |

### Changed — `routes/automation.ts`

`POST /api/applications/:id/automation-runs` now also returns
`409 TOS_NOT_ACKNOWLEDGED` when the active portal resolves to the `india`
adapter against a real India host and no `portal_policy_ack:<portalId>` row
exists — the same runtime gate discovery enforces (whole-branch Critical 1). No
`automation_runs` row is created and no browser launches.

`POST /api/automation-runs/:id/resume` now accepts an optional body
`{ decision?: 'use_application' | 'keep_portal' }` (Zod, tolerant of an empty body
as before). The `decision` is **required** when `waiting_reason === 'value_conflict'`
(`400 DECISION_REQUIRED` otherwise); optional / ignored for every other reason.

Everything else in the seven `/api/automation-runs` routes is unchanged.

---

## 5. UI changes — four surfaces (`src/web/`)

- **Settings → "India Visa Portal" card** (`IndiaPortalCard.tsx`) — appears when the
  active portal resolves to the `india` adapter. Derived **Status** (first-match):
  `Needs Discovery` → `Needs Mapping` → `Needs Validation` → `Ready`. Buttons:
  **Test Connection**, **Start Discovery** (→ `/discovery/:sessionId`; a `409 TOS`
  renders an inline acknowledgement → `recordPolicyAck` → retry once), **View
  Mappings**, **Validate Adapter**.
- **`/discovery/:sessionId`** (`DiscoverySessionPage.tsx`) — live session view: a
  **Capture this page** button, the ordered list of captured pages (state guess,
  masked url pattern, title, counts), an expandable per-page **candidate table**
  (label / selector / control kind only — **no value column**), a **Promote →
  canonical field** `<select>` of unmapped `appliesTo` paths → the rendered
  `indiaPortalMap.ts` literal in a `<pre>` + warnings, **End session**, **Validate
  Adapter**. No applicant data anywhere on the page (allowlist-based rendering —
  named field access, never `Object.entries` / spread — so the no-leak guarantee
  holds even if the server ever added a value field).
- **Adapter diagnostics panel** (`DiagnosticsPanel`, `role="status"`, value-free
  `<dl>`) — adapter version, mapping revision, last discovery, pages / fields
  discovered, mappings placeholder / discovered / validated, mappings needing
  review, unknown pages encountered, last validation timestamp + pass/fail.
- **`ValueConflictPanel`** on `AutomationRunPage` — when `waiting_reason ===
  'value_conflict'`, a dedicated `role="alert"` panel renders the single `/live`
  `{ fieldPath, expected, actual }` pair (the only value surface, in-memory) with
  three buttons: **Use application value** (`resume { decision: 'use_application' }`),
  **Keep portal value** (`resume { decision: 'keep_portal' }`), **Edit application**
  (→ `abort`, then navigate to `/applications/:appId`). **No `<form>`, no
  `type="submit"`, no submit control.** `ActionRequiredPanel` is byte-unchanged.

Route `discovery/:sessionId` added to `main.tsx`. Bundle delta +12.49 kB raw /
+3.42 kB gzip JS, +1.70 kB CSS, no new dependency.

---

## 6. Discovery model

- **Read-only.** `discoveryController.ts` + `observe.ts` + `validateAdapter.ts`
  carry the `portalDiscovery.ts` DESIGN NOTE and are in the scanned `FILES` list of
  `test/automation/discoveryReadOnly.test.ts`, which greps them (comment-stripped)
  for `fill` / `click` / `type` / `press` / `selectOption` / `check` /
  `setInputFiles` / `hover` / `form.submit` / a second `goto` → **zero**, and is
  **non-vacuous** (bites a synthetic string). The one permitted `page.goto` in
  `start()` targets only the configured portal URL argument.
- **One headed persistent Chromium context per process.**
  `browserManager.launchPersistentDiscovery({ userDataDir: <DATA_DIR>/discovery/profile })`
  — `headless: false` hard-coded and locked, `viewport: null`, held in a separate
  `discoveryContext` field, idempotent, `closeDiscovery()` no-ops. The Phase 5
  `launch` / `newPage` / `close` path is byte-unchanged. One `DiscoveryController`
  (`app.discovery`), disposed on the app `onClose` hook.
- **`captureDiscoveryV2`** enumerates page **structure**: headings (h1–h4 in
  document order), radio/checkbox groups with option labels, buttons (`type`,
  `isNavCandidate` — **enumerated, never clicked**), required-indicator selectors,
  `<select>` option-label catalogues, `stableAttributes` coverage counts, the
  fingerprint, and `securityChallengeFlags`.
- **Sanitizer.** `sanitizeString` runs on every label / placeholder / heading /
  option string before persist; a string is dropped when it matches a **value
  shape** — a run of ≥ 4 digits, an ISO or `dd/mm/yyyy` date, an email, a
  passport-like token (`[A-Z]{1,2}[0-9]{6,8}`), or ≥ 40 chars mostly non-alpha.
  Structural selector strings are **exempt** (a `#ctl00_field1234` selector
  survives). `sanitizeUrlToPattern` masks `/[0-9a-f]{8,}/`, long digit runs, and
  query values. The observer's `page.evaluate` **never reads `.value`** (a Task 4
  fix removed the last `labelFor` value fallback).
- **Persisted structure-only** in `portal_discovery_pages` (migration 6). The
  seeded-PII sanitizer test + the security suite (Task 14) + `phase6Integration`
  scenario 8 each assert: sentinel values rendered live in the DOM are **absent**
  from the GET body, `candidates_json`, and the raw row, while `state_guess` and
  `candidates` **are** populated.

---

## 7. Mapping lifecycle model

`indiaPortalMap.ts` is the **mapping source of truth**. `IndiaFieldMapping extends
PortalFieldSpec` with `status: 'placeholder' | 'discovered' | 'validated'`,
`discoveredAt?`, `validatedAt?`, `discoverySessionRef?`, `notes?`.
`IndiaPortalStateConfig` gains `urlPattern?` and `nextSelectorStatus`.
`IndiaPortalMap` gains `adapterVersion`, `mappingRevision`, `lastDiscoveryAt`.

**Lifecycle:** `placeholder → discovered → validated`.
- `discovered` requires a non-empty `discoverySessionRef`.
- `validated` requires `discoverySessionRef` **and** a `validatedAt` stamped by
  `validateIndiaAdapter`.
- Only `validated` mappings may drive a real controlled autofill run.

**Provenance guard** (`test/automation/indiaMappingProvenance.test.ts`): for every
`fields` entry, `selector !== 'TODO:discover'` **implies** `status !== 'placeholder'`
**and** a non-empty `discoverySessionRef` — a build failure otherwise. "Never
guess" is mechanically enforced. Every shipped selector today is `'TODO:discover'`
(22 occurrences); the guard is non-vacuous (the test's own fixtures prove it
fails on an un-sourced field selector). The `nextSelector` guard is now at
parity (whole-branch Important 7): `IndiaPortalStateConfig` carries
`nextSelectorDiscoverySessionRef?` / `nextSelectorValidatedAt?` and the test
asserts a non-placeholder `nextSelector` has a `discoverySessionRef` (and, when
`validated`, a `validatedAt`).

`getFieldMap()` still projects to a clean `PortalFieldMap` via `toPortalFieldMap()`
— the lifecycle keys never reach the engine. `promoteCandidate` renders the exact
literal to paste; **the app never auto-writes adapter source** — a human reviews
every selector (defence against a bad discovery capture; keeps `transform`
functions hand-authored). `indiaAdapter.getPageIdentity` scores `urlPattern`
(0.5) + `headingPattern` (0.3) + `anchorField` present (0.2), max wins, honest
confidence, `UNKNOWN` below the Phase 5 0.6 floor (replaces the Phase 5
heading-only 0.7 constant). `clickNext` still **throws** on a placeholder
`nextSelector` — a real run fails closed on the first form page until discovery
fills the map.

---

## 8. Controlled autofill

Controlled autofill is the **existing Phase 5 `runLoop`** plus:

1. **the §6 pre-fill collision check** (generic, fixture-proven);
2. **the §7 identity upgrade** (URL + heading + anchor) so real pages are recognised;
3. `AUTOMATION_HEADLESS=false` for a real run (already supported) so the operator
   watches every page;
4. **the progressive Track B runbook** (`docs/portals/india.md`) — never a
   one-shot full application.

**`classifyPreFill(page, spec, expected)`** (pure, read-only, in `fieldActions.ts`):
`readControl` → `null` or trimmed-empty ⇒ `'empty'` (defer to `applyField`);
otherwise the match/conflict split **delegates to `verifyControl`**
(`=== 'verified' ? 'match' : 'conflict'`). This is a **deviation** from the brief's
literal `norm(actual) === norm(expected)` — reviewer-confirmed **strictly safer**:
it reduces to the literal form for every control kind *except* a value-matched
`<select>`, where it compares the option **value** (not the DOM label) — which is
what "the portal holds `expected`" actually means. `'match'` is returned **only**
when `verifyControl === 'verified'`; no input yields `'match'` for a divergent
value on any control kind — there is no blind-overwrite / skipped-divergence path.

**The `value_conflict` engine branch** (`automationEngine.ts`, in the field loop
after `if (!m.present) continue;`, before `FIELD_FILL_STARTED`):
- `pre === 'conflict'` **and** no `ctx.conflictDecisions.get(fieldPath)` ⇒
  `recordMismatch({ fieldPath, expected, actual })` (in-memory `/live` only —
  **never persisted**), `emit VALUE_CONFLICT` (`status: 'blocked'`, no value),
  `return { kind: 'waiting', reason: 'value_conflict', conflictFieldPath }` —
  `applyField` never called.
- decision `keep_portal` ⇒ `emit FIELD_CONFLICT_KEPT`, skip the field (**not**
  counted toward `fields_verified` — it did not match), recorded.
- decision `use_application` ⇒ `emit FIELD_CONFLICT_OVERWRITTEN`, fall through to
  the normal fill + read-back path.

**Resume plumbing** (`automationService.ts`): `resumeRun(db, id, decision?)`. On a
`value_conflict` wait the decision lands in the runner's `conflictDecisions` map
**before** `signalResume` (synchronous, single-threaded, `run()` rebuilds the
`EngineContext` each iteration so the live map is seen). A **crash-recovery**
resume with no in-memory runner defaults every unresolved conflict to
`keep_portal` (never overwrite blind) and logs a value-free `logger.debug({runId})`
line — the passed `decision` is genuinely ignored in that branch.

Document handling stays Phase 5 **verify-and-pause** (`DOCUMENT_READY` /
`BLOCKED_MISSING_DOCUMENT` → pause `document_upload_required`). Phase 6 does not
drive the portal file chooser.

---

## 9. Human checkpoints (unchanged from Phase 5, restated)

`detectCheckpoint` runs on every page before any field interaction. It reads
`inspection.securityChallengeFlags` + adapter `checkpointHints` + a visible-OTP-input
heuristic, precedence `captcha > anti_bot > mfa > otp`. On a hit the loop
**pauses**, `page.bringToFront()` foregrounds the browser, and the run stays
`waiting_for_user` until `POST /automation-runs/:id/resume`. Resume on an
`otp / captcha / mfa / anti_bot` wait **re-runs `detectCheckpoint` first**: still
present → `CHECKPOINT_STILL_PRESENT` event + `409 checkpoint_still_present`;
cleared → `signalResume` wakes the parked runner. **No solver, no OTP retrieval
(IMAP/SMS), no CAPTCHA service, no anti-bot / stealth / fingerprint evasion**
anywhere. Phase 6 changes nothing here except that the `noAutoSubmit` solver grep
(`2captcha|anti-captcha|capsolver|solveRecaptcha|speakeasy|otplib|otpauth|node-imap|…`)
now also descends `discovery/**` → still zero.

---

## 10. No automatic submission — the four mechanisms (spec §6, §21)

1. **Structural (interface).** `PortalAdapter.submitSelector` is typed `readonly
   null`; `genericAdapter`, `fixtureIndiaAdapter`, `FIXTURE_INDIA_PORTAL_MAP_V2`
   and `indiaPortalMap` all pin the literal `null`. `indiaPortalMap.FINAL_REVIEW`
   has `isFinalReview: true` and `nextSelector: null`.
2. **Structural (loop).** `runLoop` `return`s at `adapter.isFinalReview(state)` —
   sets `status = review_ready`, emits `REVIEW_READY`, **stops before any further
   action**. `EngineStop` has no `submitted` / `completed` member; there is no
   `clickSubmit` and no submit-selector use in the loop. Migration 6 preserved the
   `automation_runs.status` CHECK — no `completed` / `submitted` / `payment` /
   `appointment` status exists; no such `EVENT_TYPES` literal exists.
3. **Source grep (`noAutoSubmit.test.ts`).** Greps `src/server/automation/**` +
   `src/shared/automation/**` (comment-stripped), **now also descending
   `discovery/**`**, for `.click(...submit|confirm|lodge|pay...)`, a
   `locator|getByRole(...submit...)` affordance, `form => form.submit()`,
   `.evaluate(...submit())`, `requestSubmit(`, `keyboard.press('Enter')`,
   `page.on('dialog'` → **zero**. Non-vacuous (bites a synthetic
   `'discovery-submit'` string and a synthetic `#submit-application` click).
4. **Behavioural E2E.** `test/fixtures/india-portal/final-review.html` has a real
   `Submit Application` button POSTing to `/__fixture/submit`;
   `fixturePortal.submitCount === 0` after **every** one of the 8 `phase6Integration`
   scenarios (and every Phase 5 scenario), and no `automation_events.type` matches
   `/submit|confirm|lodge|pay/i`.

---

## 11. PII audit (spec §11, maps to `automation-risks.md` R7/R14/R15/R17/R18/R19)

**IS stored / logged:** discovery = **page structure only** — headings, labels,
control kinds, selector candidates, option *labels*, fingerprint,
`securityChallengeFlags`; the event `type` / `portal_state` / canonical
`field_path` / closed `message`; the sanitized `AdapterValidationReport`
(selectors + control kinds + sanitized option labels) as
`last_validation_json`; adapter / mapping version strings; a **relative**
screenshot path only when `AUTOMATION_EVIDENCE=screenshots` (**off by default** —
unset → `'off'`).

**NEVER stored / logged:** any input value (`captureDiscoveryV2` never reads
`.value`), the `{expected, actual}` conflict pair (in-memory `GET
/automation-runs/:id/live` only, while the run is loaded — never persisted, never
logged), OTP / CAPTCHA / MFA text, passwords, portal credentials (none are stored
at all), screenshot *bytes*, absolute paths, URL path tokens / reference numbers
(`url_pattern` masks them). `REDACT_PATHS` gains **nothing new** — Phase 6
introduces no new value key.

**Evidence:** `security.test.ts` Phase 6 cases run a full fixture-v2 run + a
discovery session and scan every `automation_events` and `portal_discovery_pages`
row for the seeded surname / passport / DOB / conflict value → none; every
`message ∈ EVENT_MESSAGES`; `last_validation_json` carries no value shape;
`AUTOMATION_EVIDENCE` unset → no screenshot; the discovery capture URL carries a
real hex token (`?ref=deadbeefcafe12345678`) and the persisted `url_pattern` does
**not** contain it. The `value_conflict` case has both `RANA` and `SOMEONE-ELSE`
in the engine's hands — a regression logging either fails the test.

*Deferred (brief-spec-compliant, spec-owner note):* `sanitizeUrlToPattern` only
masks hex / long-numeric path segments + query values — an email or name in a
plain path segment would survive; the aggressive `/\d{4,}/` rule scrubs any label
with a 4+ digit run; `host:port` is kept verbatim (a localhost fixture port is
not PII; a real portal has no port).

---

## 12. Known limitations (triaged)

### Headed-browser dependency

`test/automation/discoveryController.test.ts`, `phase6Integration.test.ts`
scenario 8, and the Task 3 `browserManager` test each do a **real headed Chromium
launch** (brief-mandated). They pass on a Windows / Linux desktop; a
**displayless / headless-only CI runner would fail them**. Same class as the Phase
5 headed-chromium integration tests.

### Brief deviations (both reviewer- / controller-ruled, logged for the whole-branch review)

- **`validateIndiaAdapter` radio/checkbox validation.** The brief's Step 3 said a
  selector is "resolvable" iff it resolves to **exactly one** node (`n === 1`).
  That is incompatible with how the engine consumes a group control — `setRadio`
  takes the **group** selector (`input[name="x"]`) and appends `[value=…]` at fill
  time, so a correct radio mapping resolves to ≥ 2 nodes. `validateField` now
  special-cases radio/checkbox: resolve the group selector, require `nodeCount >= 1`
  with every node an `<input>` of the declared type. Controller-ruled a **brief
  oversight** for the group-control case (spec §7.4 does not mandate `n === 1`),
  not a design change.
- **`classifyPreFill` delegates to `verifyControl`** rather than the brief's
  literal `norm(actual) === norm(expected)` — see §8. Reviewer-confirmed strictly
  safer; the only divergence is a value-matched `<select>` (compares option value,
  not label), which is the correct semantics.

### Deferred minor items (≈ 30 across the 15 task reviews + ~9 from the whole-branch review — summary, not the full list)

- **`classifyPreFill` custom-widget default state** — the whole-branch fix covers
  a native `<select>` placeholder + unchecked checkbox; a `custom_select` widget
  showing its own "— Select —" text (no `inputValue()`) could still read as a
  conflict. No fixture exposes it; the real India map uses `native_select`
  throughout.
- **`fingerprint_json._v2` stash** — the V2 report extras have no dedicated
  migration-6 column; readers must know they live under `fingerprint_json._v2`
  (Task 5).
- **`IndiaPortalCard` shows for any active portal** — `/adapter-mappings` and
  `/adapter-diagnostics` always return the India shape, so the `adapterId !==
  'india'` self-hide branch is dead; a real non-India adapter needs a backend
  per-portal signal (Task 15).
- **TOS-409 detected by error-message substring** — the web `request` helper drops
  the error code; `confirmAck` won't re-detect a repeated TOS error on retry
  (Task 15).
- **Crash-recovery resume re-walks earlier pages** (carried from Phase 5) — the
  replay is idempotent (`FIELD_ALREADY_SET` / re-verify), converges to the observed
  state, and cannot submit; the in-process (normal OTP / conflict) resume does not
  replay.
- **`promoteCandidate` may emit `control: 'unknown'`** when both the candidate and
  the canonical field are `unknown` (2 warnings cover it) (Task 8).
- **TOCTOU** on the partial-unique active-session index; **N+1** `pagesDiscovered`
  query in diagnostics; **`lastValidation`** returns the most-recent
  *parseable-report* session, not strictly the most recent (Tasks 5, 14).
- Several **vacuous-assertion** classes were found and fixed in the fix rounds for
  Tasks 4, 5, 13, 14, 15 (each guard now bites a synthetic violation).
- `foreign_keys = OFF` first-line regex is brittle for future migrations — prefer a
  `Migration.suspendForeignKeys` field next time (Task 2).

The per-task reviews are in
`.superpowers/sdd/2026-09-06-phase-6-india-portal-adapter/task-N-report.md` and the
ledger `progress.md`.

---

## 13. Deferred work (spec §15 + the ledger + Step 5)

- **Track B — the live portal discovery session (Tests A–G) with the operator +
  `indiaPortalMap.ts` population.** **NOT ATTEMPTED — deferred:** requires the
  operator present **and** an authenticated ToS review clearing the portal
  (`ivacbd.com` is `PROHIBITED` by default; `indianvisaonline.gov.in` is
  `UNCLEAR`). The runbook is written (`docs/portals/india.md` → "Track B runbook");
  the "Live discovery session log" records every test as NOT ATTEMPTED. Phase 6 is
  complete on Track A regardless.
- **`Migration.suspendForeignKeys` field** instead of the first-line PRAGMA regex
  (Task 2 follow-up).
- **Auto-render the `docs/portals/india.md` appendix tables** from a discovery
  session (Phase 6 persists the data; the markdown is updated by hand).
- **Portal file-upload automation** — still verify-and-pause; the
  `indiaPortalMap.uploadStates` hook is ready.
- **Multi-portal** — a second country adapter (the interface already supports it).
- **Targeted crash-recovery resume** — persist the observed state, re-detect,
  resume mid-plan without replay (carried from Phase 5).
- **Phase 4 value-bridge** — the "Visa Selection" section and the "Required
  information" list can both ask for the four overlapping `application.*` fields
  (unrelated to Phase 6, still open).
- **Re-verify the Phase 1 `regular.*` KB data** against official HCI Dhaka / IVAC
  sources before any operational `regular.*` run (carried from Phases 1/3/4/5).

---

## 14. Acceptance criteria — spec §13 (28 items)

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | `typecheck` ×4 / `lint` / `test` / `build` green; Phase 0–5 regression green | **PASS** | §"Last verified" — 4 tsc exit 0, `eslint .` 0 warnings, **1120 / 108**, build OK; baseline 971 / 91 → +149 (incl. the must-fix wave) |
| 2 | Migration 6 creates both discovery tables + drops the `waiting_reason` CHECK; `LATEST_SCHEMA_VERSION === 6`; real v5→v6 preserves rows + cascade fires | **PASS** | §3 — `discoveryMigrations.test.ts` (5) + `automationMigrations.test.ts` (genuine v5→v6, cascade, flipped `value_conflict` canary); `applicant/applicationMigrations.test.ts` version canary |
| 3 | Phase 0–5 architecture intact: engine imports no concrete adapter; India logic only under `adapters/india/`; `shared/automation/` pure; no `https?://` literal outside `adapters/india/`; guard tests green | **PASS** | `architectureGuard` / `noHardcodedUrl` (carve-out widened to `discovery/policyGate.ts`, narrow + commented) / `noAutoSubmit` all green |
| 4 | Phase 4 `ApplicationPlan` remains the sole source of visa requirements — no duplicate model | **PASS** | engine reads `plan.sections` / `plan.documents` only; reviewer-verified across Tasks 10/13; no requirement model added |
| 5 | India portal URL from Settings; `entryUrl` is the identity of the configured URL; no India host literal outside `indiaPortalMap.ts`; the ToS runtime gate covers **both** discovery **and** `startRun` | **PASS (sanctioned carve-out)** | `policyGate.ts` duplicates the host regex (byte-identical, anchored) but does not import the adapter and is carved out of `noHardcodedUrl`; `entryUrl` unchanged from Phase 5; `assertPolicyAck` now called by `discoveryController.start` **and** `automationService.startRun` (whole-branch Critical 1) — `automationService.test.ts` case 15 + `automationRoutes.test.ts` case 12 |
| 6 | Discovery launches the configured portal **headed**; a second active session for the same adapter is refused | **PASS** | Task 3 — `headless: false` locked + idempotency test; Task 5 — `start()` rejects a second active session; migration 6 partial unique index; `discoveryController.test.ts` |
| 7 | Discovery is read-only: the source guard (fill/click/type/press/selectOption/check/setInputFiles/hover/form.submit/second-goto) is green over `discovery/**` **and** non-vacuous | **PASS** | `discoveryReadOnly.test.ts` scans `discoveryController.ts` / `observe.ts` / `validateAdapter.ts` → zero; the single `goto` targets only the portal-URL arg |
| 8 | Discovery persists structure and **no applicant values**; the sanitizer test passes; `url_pattern` masks tokens | **PASS** | `discoverySanitizer.test.ts` (seeded PII → clean report); `phase6Integration` sc8 + `security.test.ts` (sentinels present-in-DOM-then-absent; `?ref=deadbeefcafe…` masked) — both non-vacuous after fix rounds |
| 9 | `captureDiscoveryV2` records headings, radio/checkbox groups, buttons (never clicked), nav candidates, required indicators, `<select>` option labels | **PASS** | Task 4 — `observe.ts` + `discoveryObserve.test.ts` structure assertions |
| 10 | `indiaPortalMap.ts` ships every selector `'TODO:discover'` / `status: 'placeholder'`; the provenance guard proves a non-placeholder selector is impossible without a `discoverySessionRef` | **PASS** | 22× `'TODO:discover'`; `indiaMappingProvenance.test.ts` fails the build on an un-sourced **field** selector (non-vacuous); the `nextSelector` guard is now at parity — asserts `nextSelectorDiscoverySessionRef` (whole-branch Important 7) |
| 11 | `getPageIdentity` scores URL + heading + anchor; a known fixture page → correct state ≥ 0.6; an unknown page → `UNKNOWN` → pause, no field interaction | **PASS** | `indiaAdapter.test.ts` scoring (0.5 / 0.3 / 0.2, max wins, 0 → UNKNOWN); `phase6Integration` sc6 (`nowhere.html` → `UNKNOWN_PORTAL_STATE`, `FIELD_FILL_STARTED` absent) |
| 12 | `promoteCandidate` renders a paste-ready `indiaPortalMap.ts` edit; the app never auto-writes adapter source | **PASS** | Task 8 — no `fs` import, no `.run(`, `indiaPortalMap.ts` untouched; strict key-set equality unit test |
| 13 | `validateIndiaAdapter` resolves every non-placeholder selector, checks control kind, dumps option labels; green against fixture v2; report value-free | **PASS** | Task 9 + fix round — group-selector special-case (`nodeCount >= 1`, per-node type); `FIXTURE_INDIA_PORTAL_MAP_V2` smoke `ok === true`; option labels through the sanitizer (non-vacuous scrub test). Brief deviation logged (§12) |
| 14 | A pre-existing **matching** portal value → `FIELD_ALREADY_SET`, no overwrite | **PASS** | `phase6Integration` sc1 (`?prefill=match` → `FIELD_ALREADY_SET` present, `VALUE_CONFLICT` absent) |
| 15 | A pre-existing **different** value → `VALUE_CONFLICT` pause; `/resume {use_application}` overwrites + verifies + `FIELD_CONFLICT_OVERWRITTEN`; `/resume {keep_portal}` skips + `FIELD_CONFLICT_KEPT`; neither value persisted; the re-walk does not re-pause | **PASS** | `phase6Integration` sc2 (`keep_portal`) / sc3 (`use_application`) / sc4 (no decision → `400 DECISION_REQUIRED`); events scanned for `RANA` / `SOMEONE-ELSE` → none; Task 11 threads the decision before `signalResume` |
| 16 | Every autofilled field read back + verified; a required unverifiable / mismatched field follows the Phase 5 pause policy | **PASS** | unchanged from Phase 5 — `fieldActions.test.ts` fill→verify per `ControlKind`; `phase6Integration` sc7 (`fields_verified === fields_total === 13`) |
| 17 | An unknown page → safe pause + `UNKNOWN_PORTAL_STATE` + non-sensitive diagnostics preserved | **PASS** | `phase6Integration` sc6; `getIndiaDiagnostics.unknownPagesEncountered` counts `UNKNOWN_PORTAL_STATE` events |
| 18 | OTP + CAPTCHA fixture checkpoints pause with the matching reason; `bringToFront` called; resume re-checks & refuses `409` while present; no solver / retrieval / evasion code (grep over `automation/**` incl. `discovery/**`) | **PASS** | Phase 5 `integration.test.ts` scenarios 1 & 2 still green; `checkpointDetector.test.ts`; `noAutoSubmit.test.ts` solver grep (now descending `discovery/**`) → zero |
| 19 | `startRun` still refuses `!readyForAutomation.ready` with the blockers; refuses a second concurrent run | **PASS** | Phase 5 `automationService.test.ts` cases 1 & 2 unchanged + green; `phase6Integration` uses the same gate |
| 20 | Browser interruption mid-run leaves a resumable record (Phase 5 guarantee holds after the §6 change); a crash mid-conflict resumes conservatively (`keep_portal`) | **PASS** | Task 11 — crash-recovery default `keep_portal` genuinely unconditional + value-free `logger.debug`; Phase 5 scenario 7 (dispose → rebuild → resume). Carried caveat: crash-recovery resume re-walks earlier pages idempotently |
| 21 | No automatic submission: `submitSelector: null` (interface + India map + fixture adapter); loop returns at `isFinalReview` before any action; no-submit grep green + non-vacuous; `submitCount === 0` every scenario; no `submitted` / `completed` / `payment` / `appointment` status or event type | **PASS** | §10 — all four mechanisms; `noAutoSubmit.test.ts` (non-vacuous, +`discovery/**`); `submitCount === 0` across all 8 `phase6Integration` scenarios |
| 22 | Fixture-v2 E2E green (prefill-match, prefill-conflict ×2 decisions, WebForms page, unknown page, full populated run, discovery session) | **PASS** | `phase6Integration.test.ts` — 8 scenarios, real engine + chromium + fixture v2 (green after 1 fix round) |
| 23 | PII-redaction + no-submit + discovery-read-only + sanitizer security tests pass | **PASS** | Task 14 `security.test.ts` Phase 6 cases + `discoveryReadOnly.test.ts` + `discoverySanitizer.test.ts` + `noAutoSubmit.test.ts` |
| 24 | Adapter diagnostics view shows versions, discovery counts, mapping status counts, unknown-pages-encountered, last validation — and no PII | **PASS** | Task 14 `diagnostics.ts` (only `count(*)` SQL, value-free) + Task 15 `DiagnosticsPanel` (`role="status"`, value-free `<dl>`) |
| 25 | UI: Settings India card (status + 4 actions), `/discovery/:sessionId` (capture + promote, value-free), the run-page conflict panel (3 actions, `/live`-only values, no submit control) | **PASS** | Task 15 (4 surfaces, green after 1 fix round) — allowlist rendering; `ValueConflictPanel` `role="alert"`, no `<form>` / `type="submit"`. Minor: the card shows for any active portal (dead self-hide branch, §12) |
| 26 | Track B: `docs/portals/india.md` "ToS / robots.txt position" has a verdict; the progressive-test runbook is written; Tests A–G progress recorded (or each blocked with a reason) | **PARTIAL** | Verdict present (`UNCLEAR`); the Track B runbook (Tests A–G as a numbered operator procedure) is written; the **live session is DEFERRED — every test recorded as NOT ATTEMPTED** in the "Live discovery session log" |
| 27 | `docs/PHASE-6-REPORT.md` complete (architecture, tasks + SHAs, migration 6, API delta, UI, discovery model, mapping model, autofill, checkpoints, no-submit, PII audit, known limitations, deferred work, acceptance table + the two verbatim lines) | **PASS** | this file |
| 28 | `docs/ARCHITECTURE.md` §3 gains a Phase 6 paragraph; whole-branch opus review (APPROVE / APPROVE-WITH-FIXES with the wave landed) complete | **PASS** | §3 paragraph landed at `e67529f`; whole-branch opus review done — *READY TO MERGE WITH FIXES*, must-fix wave (1 Critical + 6 Important) landed `b55202a`/`7799a65`, gate green **1120 / 108** (§2 "Whole-branch opus review + must-fix wave") |

**Summary: 27 PASS · 1 PARTIAL (item 26 — Track B runbook written, live session
deferred).**

---

## 15. Verbatim

```
Automatic final visa submission: NOT IMPLEMENTED
OTP/CAPTCHA/anti-bot bypass: NOT IMPLEMENTED
```
