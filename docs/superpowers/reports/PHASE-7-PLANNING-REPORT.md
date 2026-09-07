# Phase 7 — Planning Report

**Date:** 2026-09-07
**Branch:** `phase-7-portal-validation-autofill` (cut from Phase 6 HEAD `74fc162`)
**Status:** planning complete — implementation NOT started, awaiting approval.

- Spec: `docs/superpowers/specs/2026-09-07-phase-7-portal-validation-autofill-design.md`
- Plan: `docs/superpowers/plans/2026-09-07-phase-7-portal-validation-autofill.md` (14 TDD tasks)
- End-of-phase report (to be filled): `docs/superpowers/reports/PHASE-7-REPORT.md`

---

## 1. Baseline

| | |
|---|---|
| Phase 6 HEAD | `74fc162` (`docs(phase-6): whole-branch review outcome + must-fix wave`) |
| Gate at baseline | typecheck exit 0 · lint exit 0 · **1120 tests / 108 files** · build exit 0 |
| Phase 6 acceptance | 27 PASS / 1 PARTIAL (Track B live session deferred) |
| Migrations | `LATEST_SCHEMA_VERSION === 6`; **Phase 7 adds none** |
| Phase 6 branches on origin | `master`, `phase-0-portal-settings`, `phase-5-browser-automation`, `phase-6-india-portal-adapter` |

---

## 2. Architecture findings (audited against `74fc162`, not memory)

The Phase 5 engine + Phase 6 India adapter are **substantially complete**. The Phase 7 directive
(§§3–24, 27–30, 32) is ~75% restatement of already-shipped, already-tested behaviour:

- **No-auto-submit** — 4 mechanisms: `submitSelector: null` by contract; `EngineStop` has no
  `submitted` member; `runLoop` returns at `isFinalReview` before any action; `noAutoSubmit.test.ts`
  (non-vacuous, walks `automation/**` incl. `discovery/**`).
- **Mapping lifecycle** `placeholder → discovered → validated` + provenance guard
  (`indiaMappingProvenance.test.ts` — a bare non-placeholder selector is a build failure); Phase 6
  whole-branch brought `nextSelector` provenance to parity.
- **Adapter isolation** — `architectureGuard.test.ts` (engine imports no concrete adapter,
  `shared/automation/` pure), `noHardcodedUrl.test.ts` (India host literal only in
  `indiaPortalMap.ts` + sanctioned `policyGate.ts`).
- **ToS runtime gate** — `assertPolicyAck` on **both** `discoveryController.start` and
  `automationService.startRun` (the Phase 6 whole-branch Critical 1 fix).
- **Read-back verification** per `ControlKind` (`fieldActions.verifyControl`); checkbox/radio
  write→read→verify; `optionMatch:'value'` compares option value not label.
- **OTP / CAPTCHA / MFA / anti-bot** — `checkpointDetector` (precedence captcha>anti_bot>mfa>otp);
  `resumeRun` reloads the page and re-runs `detectCheckpoint` → `CHECKPOINT_STILL_PRESENT` / 409
  while present; **no solver / retrieval / evasion anywhere**.
- **Unknown / low-confidence page** → `pageDetector` 0.6 confidence floor → `UNKNOWN_STATE` →
  `runLoop` pauses `unknown_page`; `leftState` non-advance guard; `nowhere.html` fixture.
- **Value-conflict** — Phase 6 `value_conflict` + `classifyPreFill` + `resumeRun(decision)` +
  `ValueConflictPanel`; the `{expected,actual}` pair lives **only** in the in-memory `GET /live`
  surface, never persisted.
- **Crash-recovery resume** — fresh-runner re-walk, idempotent via `FIELD_ALREADY_SET` / re-verify;
  `initialVerifiedCount` carries the counter across pauses.
- **PII-safe logging** — `security.test.ts` (Phase 5 + Phase 6 halves); seeded-PII scans over logs /
  `automation_events` / `automation_runs` / `portal_discovery_*`; `url_pattern` masking; screenshots
  `off` by default under gitignored `data/`.
- **Closed event vocabulary** — 41 `EVENT_TYPES` + `EVENT_MESSAGES` purity test.
- **State machine** — `RUN_STATES` (7) + `LEGAL_TRANSITIONS`; `WaitingReason` already has all 12
  §24 pause states (otp, captcha, mfa, anti_bot, unknown_page, missing_field_mapping, value_mismatch,
  value_conflict, document_upload_required, session_expired, validation_error, user_paused).
- **Discovery infra** — read-only (`discoveryReadOnly.test.ts` recursive walk), persisted, sanitized;
  migration 6 tables.

### Two dead vocabulary entries found

`DROPDOWN_OPTION_MISSING` and `SELECTOR_STALE` are declared in `EVENT_TYPES` + `EVENT_MESSAGES` but
**emitted nowhere** (grep-verified). Phase 7 wires both.

### One hard-fail gap found

`OptionNotFoundError` (from `selectNative` / `selectCustom` / `typeAutocomplete`) is **not caught**
by the engine's fill `catch` (which only catches `SelectorNotFoundError`) → it propagates →
`runLoop` throws → `RUN_FAILED` / `engine_error`. The directive §6 wants a clean safe-stop. Phase 7
fixes this.

---

## 3. Reuse analysis

**Reused unchanged:** `runLoop`, `AutomationService`, `AutomationRunner`, all 7 `/api/automation-runs`
routes, all discovery routes, `checkpointManager`, `checkpointDetector`, `pageDetector`,
`pageInspector`, `browserManager`, `automationRunStore`, `discoverySessionStore`, `policyGate`,
`portalDiscovery`, `observe`, `indiaMappingRegistry.promoteCandidate`, `validateAdapter`, the Phase 4
`ApplicationPlan` + `readyForAutomation` gate, `mapFields`, the Phase 6 `ValueConflictPanel` /
`ActionRequiredPanel` / `DiscoverySessionPage` / `IndiaPortalCard`, the fixture portal HTTP harness,
the `security.test.ts` / `phase6Integration.test.ts` harness patterns.

**Reused + extended:** `IndiaFieldMapping` (+`validatedAgainstRevision`), `IndiaPortalStateConfig`
(+`nextSelectorValidatedAgainstRevision`), `toPortalFieldMap` (now filters), `verifyControl`
(+date normalisation), `pageActions` (+`resolveSelector`, +`assertNativeOptionAvailable`),
`automationEngine` field loop (+2 safe-stop branches, +`SELECTOR_STALE`), `getIndiaMappingStatus`
/ `getIndiaDiagnostics` (+stale/production counts), `AutomationRunPage` / `runChrome` (+provenance
+warning +banner copy), `fixturePortal` (+5 scenario flag families), `fixtureIndiaAdapter`
(+`FIXTURE_INDIA_PORTAL_MAP_V3` +lifecycle mode), `indiaMappingProvenance.test.ts`,
`noAutoSubmit.test.ts`, `docs/portals/india.md`, `docs/ARCHITECTURE.md`.

**New (all small, focused):** `mappingLifecycle.ts` (pure), `transforms.ts` (pure),
`phase7Matrix.test.ts`, `phase7Safety.test.ts`, `fixturePortalV3.test.ts`,
`mappingLifecycle.test.ts`, `indiaDateTransforms.test.ts`, `fixtureIndiaAdapterV3.test.ts`,
`AutomationRunProvenance.test.tsx`.

**Generic (non-India) additions — minimal, optional, backward-compatible:**
`PortalAdapter.mappingReadiness?(fieldPath)` and `PortalFieldSpec.readBackParse?(portalValue)`.
`genericAdapter` and every test fake stay valid without change.

**No new dependency. No migration. No new external service.**

---

## 4. Planned tasks (14)

| # | Task | Deliverable | Deps |
|---|---|---|---|
| 1 | Mapping lifecycle model + `validatedAgainstRevision` + provenance guard | `mappingLifecycle.ts` + types + guard | — |
| 2 | Production-only `getFieldMap()` + `mappingReadiness` hook + `clickNext` gate | `indiaAdapter` filter + `baseAdapter` hook + `PortalFieldSpec.readBackParse?` | 1 |
| 3 | Engine `stale_mapping` safe-stop | `WaitingReason`+1, `MAPPING_NOT_PRODUCTION_READY`, engine branch | 2 |
| 4 | Engine `option_unavailable` safe-stop + pre-fill option check | `WaitingReason`+1, `assertNativeOptionAvailable`, `DROPDOWN_OPTION_MISSING` wired, engine catch | — |
| 5 | `SELECTOR_STALE` on configured fallback use | `resolveSelector`, `applyField.usedFallback`, engine emit | — |
| 6 | India date-transform library + `date` read-back normalisation | `transforms.ts` + `verifyControl` date branch | 2 |
| 7 | Fixture portal v3 — failure scenarios | 5 query-flag families + `dates.html` | — |
| 8 | Fixture India adapter v3 — lifecycle-aware, one stale entry | `FIXTURE_INDIA_PORTAL_MAP_V3` + `lifecycleMap` mode | 1,2,6 |
| 9 | Diagnostics + registry — stale / production counts | `MappingStatusCounts` + `IndiaDiagnostics` fields | 1 |
| 10 | UI — provenance line + stale warning + banner copy | `AdapterProvenance`, `StaleMappingWarning`, `SafeStopBanner` | 9 |
| 11 | Phase 7 test matrix (fixture v3, real engine + chromium) | `phase7Matrix.test.ts` (15 scenarios) | 1–10 |
| 12 | Phase 7 safety re-verification pass | `phase7Safety.test.ts` (10 cases, fresh markers) | 1–11 |
| 13 | Docs — `india.md` procedures + field tables + ARCHITECTURE §3 + report skeleton | docs | 1–12 |
| 14 | Whole-branch review + fix wave + `PHASE-7-REPORT.md` | review outcome + report | 1–13 |

Every task: RED → GREEN → REFACTOR → focused verification → full gate → commit. Commit trailer fixed.

---

## 5. Safety analysis

| Boundary | How Phase 7 keeps it |
|---|---|
| No automatic submission | `submitSelector` stays `readonly null`; `EngineStop` unchanged; `RunStatus` / `LEGAL_TRANSITIONS` unchanged; no `submitted`/`payment_completed`/`appointment_booked` anywhere; `noAutoSubmit.test.ts` extended to new modules + non-vacuous; `submitCount === 0` asserted in every Task 11 + Task 12 scenario |
| No CAPTCHA/OTP solving or bypass | no new checkpoint code; existing detect-and-pause reused; Task 11/12 re-assert pause → user → **re-detect → re-validate → resume**; `noAutoSubmit` solver grep (2captcha/otplib/node-imap/…) still zero, now over new modules |
| No selector guessing | `getFieldMap()` filters to `validated` + current revision; `resolveSelector` only tries the **configured** `fallbackSelector`; `selectNative`/`assertNativeOptionAvailable` exact-equality only; a stale/unvalidated required field → `stale_mapping` pause, zero fill attempts |
| Stale mappings cannot reach production | `isProductionUsable` = `status==='validated' && validatedAgainstRevision===current`; enforced at the `toPortalFieldMap` seam **and** re-asserted in Task 11 sc3 + Task 12 c7; a validated mapping with a missing stamp classifies as `stale` (never silently trusted) |
| PII never persisted | no new value-carrying field, event, or log line; new events (`MAPPING_NOT_PRODUCTION_READY`, wired `DROPDOWN_OPTION_MISSING`/`SELECTOR_STALE`) carry only `fieldPath` (canonical, value-free) + `status`; Task 12 scans every persistent surface with fresh markers; `EVENT_MESSAGES` purity test stays green |
| Discovery stays read-only | Phase 7 adds no code under `discovery/`; `discoveryReadOnly.test.ts` recursive walk unaffected |
| Human owns validation | mappings never auto-promote; `promoteCandidate` still renders paste-ready TS only; `validatedAgainstRevision` is hand-stamped; the app never writes adapter source |
| Document upload | unchanged — detect → tell the user → pause `document_upload_required`; Phase 7 does not drive the file chooser |

---

## 6. Testing strategy

- **Unit (pure, fast):** `mappingLifecycle.test.ts`, `indiaDateTransforms.test.ts` — no browser.
- **Component (jsdom):** `AutomationRunProvenance.test.tsx`, extended `AutomationRunPage.test.tsx`.
- **Integration (real engine + headless chromium + fixture v3):** `phase7Matrix.test.ts` (15
  scenarios), `phase7Safety.test.ts` (10 cases), `fixturePortalV3.test.ts` (fixture self-tests).
- **Guard tests:** extended `indiaMappingProvenance.test.ts` (stale stamp), `noAutoSubmit.test.ts`
  (new modules), the web "no submit affordance" assertion (new banner/warning).
- **CI = fixture only.** No test touches the real Indian portal. No `INDIA_LIVE` path added.
- Every integration scenario asserts `portal.submitCount === 0` and a value-free event log.
- Baseline 1120 → expected ~+70–90 tests.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| `verifyControl` date branch breaks fixture v2 date fields (no `readBackParse`) | branch only runs when `spec.readBackParse` is set; raw trim-equality is the unchanged default (Task 6 Step 5 note) |
| `applyField` return-shape change (`usedFallback`) ripples through existing `toEqual` assertions | Task 5 Step 8 explicitly greps `toEqual({` in `fieldActions.test.ts` and updates the 2–3 sites |
| `getFieldMap()` now empty for the real India adapter — a Phase 6 test may assert 26 entries | Task 2 Step 5 greps `getFieldMap` in `test/` first; the fixture adapter's own `getFieldMap` is unaffected |
| Session-expired scenario needs engine surface | Task 11 sc13 prefers `getPageIdentity` → `UNKNOWN` → `unknown_page` (no engine change); an engine branch is added only if that proves insufficient |
| Rate-limit / power interruption mid-phase (happened in Phases 5 & 6) | 14 small tasks, commit after each; subagent-driven execution with a fresh agent per task; the SDD ledger records the last verified commit |
| Whole-branch review finds a Critical (Phase 4 migration bug, Phase 6 ToS gap precedents) | Task 14 has an explicit fix-wave step before the report; `superpowers:receiving-code-review` for anything questionable |

---

## 8. Non-goals

Real-portal Track B **execution** (documented only — human-present, authenticated, run separately) ·
document-upload automation · a second country adapter · per-field independent map revisions (map-wide
`mappingRevision` chosen) · any DB migration · changes to the Phase 4 requirement model or the Phase
5 generic state-machine core · `RunStatus` additions · autonomous mapping promotion · CAPTCHA/OTP/
anti-bot handling of any kind · payment · appointment booking · application submission.

---

## 9. Track B live-validation procedure (documented, NOT executed in Phase 7)

Human-present, one field / safe group at a time — full text in the spec §13 and, after Task 13, in
`docs/portals/india.md`:

1. Operator opens the configured Indian visa portal in the discovery browser.
2. Operator handles **manually**: login, registration, OTP, CAPTCHA, any human verification.
3. `DiscoveryController.capture` observes structure (read-only, sanitized, persisted).
4. The discovery UI lists candidate controls for the current page.
5. Operator picks `canonical field → portal candidate`; `promoteCandidate` renders the paste-ready
   `discovered` literal.
6. Operator reviews the selector against the live DOM.
7. Operator runs `POST /discovery-sessions/:id/validate-adapter`.
8. Operator hand-edits `indiaPortalMap.ts`: `status: 'validated'`, `validatedAt`,
   **`validatedAgainstRevision: <current mappingRevision>`**, `discoverySessionRef`; a date field
   also gets an explicit `transform` + `readBackParse`.
9. Only `validated` + current mappings reach `getFieldMap()` → controlled autofill can use them.
10. Any step blocked → recorded BLOCKED with the reason. Phase 7 completes on fixture proof regardless.

**No payment info. No submission. Prefer a non-sensitive / test application where portal rules permit.**

---

## 10. Final acceptance criteria (spec §17, verbatim summary)

1. typecheck / lint / test / build all green; Phase 0–6 regression green; 1120 → higher.
2. `getFieldMap()` production-usable only; stale/unvalidated cannot reach the engine (non-vacuous guard).
3. `mappingLifecycle` classifies `placeholder|discovered|validated|stale`; validated without
   `validatedAgainstRevision` is a build failure.
4. Dropdown missing/disabled/removed option → `DROPDOWN_OPTION_MISSING` + `option_unavailable`, **no
   DOM write**; exact match still fills; no "closest" anywhere.
5. `SELECTOR_STALE` on primary→fallback; surfaced in diagnostics; total miss still `FIELD_NOT_FOUND`.
6. `transforms.ts` forward/inverse pairs round-trip; malformed → `DateFormatError`; real India date
   fields carry **no** transform.
7. `date` read-back normalises both sides; unparseable → pause.
8. Fixture portal v3 produces every §10 scenario deterministically; fixture adapter v3 includes one
   stale entry.
9. `phase7Matrix` + `phase7Safety` green + non-vacuous; `submitCount === 0` everywhere; synthetic PII
   absent from every persistent surface.
10. OTP + CAPTCHA pause → re-detect → re-validate → resume; unknown page safe-stops; resume
    idempotent; ToS gate on both entry points; conflict values never persisted.
11. UI shows the value-free provenance line + stale warning; `SafeStopBanner` says "NOT submitted";
    no submit-shaped affordance.
12. `india.md` has all §17 procedures + 3 field tables; `PHASE-7-REPORT.md` separates automated tests
    from real-portal validation and claims **no** real portal field as validated.
13. Whole-branch opus review over `74fc162..HEAD`; Critical/Important fixed.
14. **No** `submitted` / `payment_completed` / `appointment_booked` state, event, or code path exists.

---

## 11. Safety boundaries confirmed

- Terminal success state remains `review_ready`. ✅
- No submit / payment / appointment / registration automation. ✅
- No CAPTCHA / OTP / anti-bot solving, retrieval, or bypass. ✅
- No selector guessing / fuzzy matching / closest-option selection. ✅
- Stale mappings cannot reach the production engine. ✅
- PII cannot enter persistent logs / events / discovery rows / screenshots. ✅
- Real-portal validation (Track B) is documented, human-present, and explicitly NOT executed in
  Phase 7. ✅
- No hidden submission path — `submitSelector: null`, `EngineStop` unchanged, `noAutoSubmit` guard
  extended and non-vacuous. ✅

**Implementation NOT started. Awaiting approval of the implementation plan.**
