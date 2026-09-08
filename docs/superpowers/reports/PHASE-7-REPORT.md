# Phase 7 — Real Indian Visa Portal Validation + Controlled Autofill — end-of-phase report

> **Status:** implementation complete (Tasks 1–13). Whole-branch opus review +
> fix wave (Task 14) — **PENDING**. Final gate counts filled at phase end.
> **Branch:** `phase-7-portal-validation-autofill` (cut from Phase 6 HEAD `74fc162`).

```
Automatic final visa submission: NOT IMPLEMENTED
OTP/CAPTCHA/anti-bot bypass: NOT IMPLEMENTED
Real Indian portal fields validated: NONE (Track B not executed)
```

---

## 1. Executive summary

Phase 7 turns the Phase 6 India adapter from *"has a mapping structure"* into a
**production-controlled adapter**. The automation engine may autofill a portal
field only when its mapping is **`validated` against the current
`mappingRevision`**; placeholder, discovered, and stale mappings can never reach
the engine. Dropdowns, dates, and selector fallbacks all fail safe with precise
pause reasons. It is a **delta** on Phases 5/6 — no new subsystem, **no DB
migration**, no change to `RunStatus` or the no-submit rails. Track B (the live
real-portal session) is **not executed**; no real portal field is validated.

## 2. Repository / branch

| | |
|---|---|
| Branch | `phase-7-portal-validation-autofill` |
| Base | Phase 6 HEAD `74fc162` |
| Spec | `docs/superpowers/specs/2026-09-07-phase-7-portal-validation-autofill-design.md` |
| Plan | `docs/superpowers/plans/2026-09-07-phase-7-portal-validation-autofill.md` (14 tasks) |
| Planning report | `docs/superpowers/reports/PHASE-7-PLANNING-REPORT.md` |

## 3. Phase 6 baseline

Gate green at `74fc162`: typecheck exit 0 · lint exit 0 · **1120 tests / 108
files** · build exit 0. `LATEST_SCHEMA_VERSION === 6`. Phase 6 acceptance 27 PASS
/ 1 PARTIAL (Track B deferred).

## 4. Tasks completed

| # | Deliverable | Commit |
|---|---|---|
| 1 | `mappingLifecycle.ts` (`classifyMapping` / `isProductionUsable` / `isNextSelectorProductionUsable`) + `validatedAgainstRevision` / `nextSelectorValidatedAgainstRevision` type fields + provenance guard | `c63432f` |
| 2 | `indiaAdapter.getFieldMap()` production filter + optional generic `PortalAdapter.mappingReadiness?` + `PortalFieldSpec.readBackParse?` + `clickNext` production gate | `fb70b6a` |
| 3 | engine `stale_mapping` safe-stop + `MAPPING_NOT_PRODUCTION_READY` event | `7cb6571` |
| 4 | engine `option_unavailable` safe-stop + `assertNativeOptionAvailable` pre-fill check + wired `DROPDOWN_OPTION_MISSING` | `3dd540a` |
| 5 | `SELECTOR_STALE` on a configured `fallbackSelector` (`resolveSelector`, `applyField.usedFallback`) | `1af7921` |
| 6 | `adapters/india/transforms.ts` deterministic date library + `verifyControl` date read-back normalisation | `0bed90b` |
| 7 | fixture portal v3 — `?selector=` / `?field=` / `?option=` / `?session=` / `?nav=` scenarios + `dates.html` | `c0e9eeb` |
| 8 | `FIXTURE_INDIA_PORTAL_MAP_V3` (lifecycle-aware, 1 stale entry, date transforms) + `makeFixtureIndiaAdapter({ lifecycleMap })` | `2eebe89` |
| 9 | `MappingStatusCounts` += `stale` / `productionUsable`; `IndiaDiagnostics` += `staleMappings` / `productionUsableMappings` / `selectorStaleEvents` | `8f1dde7` |
| 10 | run-page `AdapterProvenance` line + `StaleMappingWarning` + "NOT submitted" `SafeStopBanner` copy + `stale_mapping` / `option_unavailable` UI copy + shared-type sync | `3d322ef` |
| 11 | `phase7Matrix.test.ts` (10 E2E scenarios); `classifyPreFill` resolve-and-never-throw fix | `202ee55` |
| 12 | `phase7Safety.test.ts` (8 cases, fresh PII markers) + `noAutoSubmit` Phase-7 coverage assertion | `8817468` |
| 13 | this report skeleton + `docs/ARCHITECTURE.md` §3 + `docs/portals/india.md` Phase 7 procedures & field tables | _this commit_ |
| 14 | whole-branch opus review + fix wave + fill this report | **PENDING** |

## 5. India portal mappings validated

**NONE.** Every `indiaPortalMap.ts` field ships as `'TODO:discover'` /
`status: 'placeholder'`. `getFieldMap()` returns the empty set. The lifecycle,
filtering, and stamping machinery is proven against `FIXTURE_INDIA_PORTAL_MAP_V3`
only.

## 6. Real portal pages tested

**NONE.** Track B (Tests A–G) was not executed — it requires the operator present
and an authenticated ToS review clearing the portal (`ivacbd.com` `PROHIBITED` by
default; `indianvisaonline.gov.in` `UNCLEAR`). See `docs/portals/india.md` →
"Live discovery session log".

## 7. Automated tests — what the engine actually proves (fixture only)

| Area | Coverage |
|---|---|
| Mapping lifecycle | `mappingLifecycle.test.ts` (9), `indiaMappingProvenance.test.ts` (stale-stamp guard, non-vacuous) |
| Production filtering | `indiaAdapter.test.ts` (`getFieldMap()` empty today; a temporarily-validated mapping appears then drops when staled), `phase7Matrix` sc1–2 |
| `stale_mapping` | `automationEngine.test.ts` 17–19, `phase7Matrix` sc2–3, `phase7Safety` c4 |
| `option_unavailable` | `pageActions.test.ts` + `fieldActions.test.ts` + `automationEngine.test.ts` 20, `phase7Matrix` sc4–5, `phase7Safety` c5 |
| `SELECTOR_STALE` | `pageActions.test.ts` (`resolveSelector`), `fieldActions.test.ts`, `automationEngine.test.ts` 21, `phase7Matrix` sc6–7 |
| Date transforms | `indiaDateTransforms.test.ts` (7, round-trips + strict rejects), `fieldActions.test.ts` (`verifyControl` date), `phase7Matrix` sc8 |
| Fixture portal v3 | `fixturePortalV3.test.ts` (12) |
| Diagnostics / registry | `indiaMappingRegistry.test.ts`, `indiaDiagnostics.test.ts` |
| UI | `AutomationRunProvenance.test.tsx` (6), extended `AutomationRunPage.test.tsx` / `IndiaPortalCard.test.tsx` |
| Full E2E | `phase7Matrix` sc1 — connect → detect → autofill (12 production fields) → verify → OTP pause → resume → `review_ready`, `fields_verified === fields_total`, `submitCount === 0` |

## 8. Read-back verification

Every autofilled field is read back and verified (unchanged Phase 5 mechanism).
Phase 7 adds `date` normalisation: `verifyControl` maps both the read-back value
and the expected (portal-format) value to ISO through the mapping's
`readBackParse` before comparing; an unparseable read-back → `'unreadable'` →
engine pause (never a silent pass).

## 9. OTP checkpoint

Detected and paused (`otp` / `OTP_REQUIRED`); `page.bringToFront()`; resume
re-runs `detectCheckpoint` → `409 CHECKPOINT_STILL_PRESENT` while present, resumes
when cleared. **No solver, no retrieval (IMAP/SMS), no bypass.** Re-verified:
`phase7Safety` c2.

## 10. CAPTCHA checkpoint

Same shape (`captcha` / `CAPTCHA_REQUIRED`). No CAPTCHA service, no solver.
Re-verified: `phase7Matrix` sc10, `phase7Safety` c3.

## 11. Unknown page handling

`pageDetector` 0.6 confidence floor → `UNKNOWN_STATE`; the engine emits
`UNKNOWN_PORTAL_STATE` and pauses `unknown_page` with no field interaction.
Re-verified: `phase7Matrix` sc9, `phase7Safety` (via harness).

The `SESSION_EXPIRED` reserved state + `session_expired` pause are implemented in
the engine and fixture-tested (the fixture adapter returns `SESSION_EXPIRED_STATE`
for a "session expired" heading). Detecting a real portal session-timeout /
login-redirect page awaits Track B discovery evidence: `getIndiaPageIdentity`
scores only the twelve `INDIA_PORTAL_STATES` and has no 401 / login-form
fingerprint, so until such a signal is added a real timeout is handled as
`unknown_page` (still a safe stop — no field interaction, resumable), not
`session_expired`.

## 12. Conflict handling

Unchanged Phase 6 `value_conflict` — a pre-existing different portal value pauses
for the operator's Use-application / Keep-portal / Edit decision. The
`{expected, actual}` pair lives **only** in the in-memory `GET /live` surface.
Re-verified: `phase7Safety` c8 (neither value in any persisted row).

## 13. Resume / recovery

In-process resume: the parked runner re-enters `runLoop`, walks forward from the
paused page — a field filled before the pause is not re-visited (`phase7Matrix`
sc1: exactly one `FIELD_FILL_STARTED` per field). Crash-recovery resume: a fresh
runner re-walks from the entry URL; re-filling the same value is idempotent in
effect (the portal accepts it again); a `value_conflict` crash-recovery defaults
every unresolved conflict to `keep_portal`. Covered by `automationService.test.ts`.

## 14. Fixture E2E

`phase7Matrix.test.ts` scenario 1 — full 12-field populated run against fixture
portal v3, OTP pause + resume, → `review_ready`, `fields_verified ===
fields_total === 12`, `portal.submitCount === 0`, no `/submit|confirm|lodge|pay/i`
event.

## 15. No-submit verification

The four Phase 5 mechanisms are intact and re-guarded over the Phase 7 modules:
`PortalAdapter.submitSelector` typed `readonly null`; `runLoop` returns at
`isFinalReview` before any action; `noAutoSubmit.test.ts` source-greps
`automation/**` (now with an explicit non-vacuous assertion that
`mappingLifecycle.ts` / `transforms.ts` / `indiaAdapter.ts` / `fieldActions.ts` /
`pageActions.ts` / `automationEngine.ts` are in the scan set); `submitCount === 0`
asserted in **every** `phase7Matrix` (10) and `phase7Safety` (relevant) scenario.
No `submitted` / `payment_completed` / `appointment_booked` `RunStatus`,
`EVENT_TYPES` member, or `waiting_reason` exists.

## 16. PII audit

`phase7Safety.test.ts` seeds fresh markers (`TEST-NAME-ONLYX`, `TEST-PASSPORT-123`,
`TEST-ADDR-NOWHERE`, `TEST-JOB-XYZ`, `2035-07-19`) into the plan's free-text fields
and, after a full run + a conflict pause, scans the captured pino logs +
`automation_events` + `automation_runs` + `portal_discovery_sessions` /
`_pages` → **no marker present**; non-vacuous (the markers reached
`FIELD_VERIFIED`). Screenshots stay `off` by default (`AUTOMATION_EVIDENCE` unset
→ no `.png` written). No new value-carrying event, log line, or DB column was
added — the new events (`MAPPING_NOT_PRODUCTION_READY`, wired
`DROPDOWN_OPTION_MISSING` / `SELECTOR_STALE`) carry only a canonical `fieldPath`
and a `status`.

## 17. Security review

_(Task 14 — `security-review` skill over `74fc162..HEAD`.)_

## 18. Whole-branch review

_(Task 14 — opus whole-branch review over `74fc162..HEAD` against §12 boundaries
+ the Phase 5 rails + the Phase 7 additions; fix wave; outcome recorded here.)_

## 19. Tests

_(Task 14 — final `npm run typecheck` / `npm run lint` / `npm test` /
`npm run build` counts.)_

Interim (end of Task 13): 1206 tests / 115 files, all four green.

## 20. Build

_(Task 14 — final bundle sizes.)_ Interim: web bundle 460.13 kB JS / 117.62 kB
gzip.

## 21. Known limitations

- **No real portal mapping.** `getFieldMap()` is empty; a real run pauses
  `stale_mapping` on the first required field until Track B validates selectors.
- **One `readBackParse` per date field.** Correct when the portal echoes the
  format it accepts; a portal that reformats a date on blur → safe pause
  (`unreadable` / `value_mismatch`), and that field is "Not supported" pending a
  custom transform.
- **`custom_select` / `searchable_select` / `autocomplete` pre-fill option
  check.** Only `native_select` gets the `assertNativeOptionAvailable` pre-write
  availability check that leaves the control untouched — a custom widget's option
  set is not readable without opening it. The custom widgets DO match options by
  **exact** string equality (`===`, trim-only — `selectCustom` no longer does a
  Playwright substring `hasText` match), and a missing / near-miss option still
  pauses `option_unavailable` via `OptionNotFoundError` — but that check happens
  just after the widget is opened (a UI-state change, not a form write). So the
  Phase 7 "pauses with the control untouched" guarantee is precise for
  `native_select`; for the custom kinds the dropdown is open (nothing is
  selected) when the run pauses.
- **`classifyPreFill` double selector probe.** ~2–4 s per missing-primary field
  (`resolveSelector` runs in the triage step and again in `applyField`).
- **Headed-browser test dependency.** `phase7Matrix` / `phase7Safety` launch a
  real headless chromium; a displayless CI runner would fail them (same class as
  Phase 5/6 integration tests).
- **Stale-mapping UI warning is adapter-level**, not scoped to the active plan's
  fields — it shows on every India run until mappings are validated.

## 22. Unsupported portal features

Account registration · payment · appointment booking · final submission ·
declaration/attestation submission · CAPTCHA/OTP solving, retrieval, or bypass ·
anti-bot / stealth / fingerprint evasion · document-upload automation (detect +
pause only). See `docs/portals/india.md` → "Not supported".

## 23. Remaining manual steps

1. Run Track B (Tests A–G) with the operator present, once the ToS position is
   cleared for a portal.
2. For each discovered field: review the selector, `validate-adapter`, hand-stamp
   `validatedAgainstRevision`, commit.
3. Re-run `phase7Matrix` / a live smoke against the real portal (behind
   `INDIA_LIVE=1`, never CI) once ≥1 mapping is production-usable.

## 24. Recommendation for Phase 8

- Execute Track B and populate the **Validated** field table.
- Auto-render the `docs/portals/india.md` field tables from a discovery session
  (the data is already persisted).
- Add a `custom_select` pre-fill option probe (open → read → close, guarded).
- Consider a `nextSelectorValidatedAt` stamp for state nav selectors (parity with
  fields — partially done: `nextSelectorValidatedAgainstRevision` exists).
- Carried from earlier phases: re-verify the Phase 1 `regular.*` KB data against
  official sources; the Phase 4 value-bridge.

## 25. Verbatim

```
Automatic final visa submission: NOT IMPLEMENTED
OTP/CAPTCHA/anti-bot bypass: NOT IMPLEMENTED
Real Indian portal fields validated: NONE (Track B not executed)
```
