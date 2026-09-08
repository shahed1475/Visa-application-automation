# Phase 8 — Real-Portal Readiness: timing, observability, mapping ergonomics — end-of-phase report

> **Status:** implementation complete (Tasks 1–14). Combined Phase 7 + Phase 8
> whole-branch review + security review **DONE** — verdict *READY TO MERGE WITH
> FIXES*; the fix wave (5 Important + M1/M3) landed at `bcb40af`. **Track B** (the
> live discovery session against the real Indian portal) is **NOT executed** —
> zero real portal fields validated.
> **Branch:** `phase-8-real-portal-readiness` (cut from Phase 7 HEAD `ea50294`).

```
Automatic final visa submission: NOT IMPLEMENTED
OTP/CAPTCHA/anti-bot bypass: NOT IMPLEMENTED
Real Indian portal fields validated: NONE (Track B not executed)
```

---

## 1. Executive summary

Phase 8 is the **delta that makes Phases 5–7 genuinely usable** as a local
Indian-visa autofill agent. It adds:

- **Configurable realistic browser timing** — a `fast` / `normal` / `careful`
  profile driving scroll, inter-field, navigation and post-fill-verify waits plus
  the selector-stabilisation timeout, selectable via `AUTOMATION_TIMING_PROFILE`
  (default `normal`). Reliability only — no jitter, no stealth, no evasion.
- **A deterministic sub-2-minute performance guarantee** — a fixture-only
  benchmark that walks the real `runLoop` against the local fixture portal, counts
  the interactions, then *models* the wall-clock a `normal`-profile run would take
  and asserts it is under ~120 s. Never touches a network.
- **Run observability** — the run page now shows elapsed time, an ETA, the current
  section, and a value-free milestone timeline.
- **A resumable document pause** — a locally-missing required document is now a
  `document_upload_required` pause, not a terminal `failed` / `missing_document`.
- **Lower-friction discovery→mapping promotion** — promotion output carries the
  validation-stamp TODOs, a "Copy all promoted" bundle, and auto-generated
  `india.md` field-support tables; plus a numbered Track B execution checklist and
  a per-field validation-report template.

**What Phase 8 is NOT:** no new subsystem, **no DB migration**
(`LATEST_SCHEMA_VERSION` stays 6), **no new runtime dependency**, no change to the
no-submit / no-payment / no-appointment rails, and **Track B is still not
executed** — no real Indian portal field has been validated and no run has ever
touched a real portal.

## 2. Repository / branch

| | |
|---|---|
| Branch | `phase-8-real-portal-readiness` |
| Base | Phase 7 HEAD `ea50294` (`phase-7-portal-validation-autofill`, **unmerged** — Phase 7 rides along on this branch) |
| Plan | `docs/superpowers/plans/2026-09-08-phase-8-real-portal-readiness.md` (14 tasks, Global Constraints, Self-review) |
| SDD ledger | `.superpowers/sdd/2026-09-08-phase-8-real-portal-readiness/progress.md` |
| Phase 8 commit range | `c7abaeb` (plan) → `bcb40af` — **15 Phase-8 commits** |
| Combined Phase 7 + 8 review range | `74fc162..bcb40af` (31 commits) |

## 3. Baseline vs final gate

| | Phase 7 HEAD (`74fc162` / `ea50294`) | Phase 8 final (`bcb40af`) |
|---|---|---|
| `npm run typecheck` | exit 0 | exit 0 |
| `npm run lint` | exit 0 | exit 0 |
| `npm test` | 1206 / 1207 (one flaky) → 1207 after Task 1 | **1265 passed / 120 files** |
| `npm run build` | exit 0 | exit 0 |
| web bundle | 460.13 kB JS / 117.62 kB gzip | **463.88 kB JS / 118.82 kB gzip** |
| `LATEST_SCHEMA_VERSION` | 6 | 6 (unchanged) |

Typecheck / lint / build stayed exit 0 throughout. Task 1 stabilised a
pre-existing flaky test (`test/web/ApplicationDashboardPage.test.tsx`
application-scoped field input) with `fireEvent` + `waitFor` and **no new
dependency**, making the true baseline 1207 / 1207.

## 4. Tasks completed

| # | Deliverable | Commit(s) |
|---|---|---|
| 1 | Stabilise the flaky application-scoped field-input test (`fireEvent` + `waitFor`, no new dep; TDD repro captured) | `660def2` |
| 2 | `timing.ts` pure module (`TimingProfile`, `TIMING_PROFILES`, `BENCHMARK_TIMING`, `resolveTimingProfile`) + `AUTOMATION_TIMING_PROFILE` env enum (default `normal`) | `8eb5d54` |
| 3 | `scrollIntoViewAndSettle` + `Delay` type; profile-driven scroll / interaction / verify / retry delays in `applyField`; `resolveSelector` probe arg | `9b15761`, `376f7c1` |
| 4 | Engine + service consume the profile — `EngineContext.timing` / `EngineContext.delay`, `navigationWaitMs` after `clickNext`, profile resolved from env | `b9f1fd7` |
| 5 | `src/shared/automation/progress.ts` — pure `elapsedMs` / `estimateRemainingMs` / `formatDuration` | `bb001ea` |
| 6 | Deterministic fixture benchmark (`test/automation/phase8Benchmark.test.ts`) — models a sub-2-minute `normal` run; `FIXTURE_INDIA_PORTAL_MAP_ALL_VALIDATED` helper | `ea66217` |
| 7 | Run page — `RunTiming` (elapsed / ETA) + `ProgressTimeline` (value-free milestones) + section line, wired into `AutomationRunPage` | `02c343b` |
| 8 | Accurate "Start automation" button + hint copy (`AUTOMATION_HELPER`); stale `Phase N` copy swept from `src/web` | `bcf39e4` |
| 9 | Missing required document → resumable `document_upload_required` pause (not terminal); `missing_document` retired from `src/` | `8a8d073` |
| 10 | Promotion output carries the `status` / `validatedAt` / `validatedAgainstRevision` TODO stamps; `renderPromotedBundle` + `POST /promote-bundle` + `api.promoteBundle` + "Copy all promoted" UI | `d7832e8` |
| 11 | `fieldTablesMarkdown.ts` — auto-render the three `india.md` field-support tables from persisted discovery + the live map; `GET /field-tables` + `api.getFieldTables` + "Copy field tables" UI + `india.md` note/anchor | `e957731` |
| 12 | Lock resume behaviour — `phase8Resume.test.ts` proves resume re-detects the page **and** re-checks mapping readiness every iteration (**test-only, no production change needed**) | `9600359` |
| 13 | Track B numbered 18-step execution checklist in `india.md` + `docs/portals/india-validation-report-TEMPLATE.md` (docs-only) | `54978f1` |
| 14 | Security review + whole-branch review + fix wave (5 Important + M1/M3) + this report + PHASE-7-REPORT §§17–20 + ARCHITECTURE §3 | review + `bcb40af` |

## 5. Timing profiles

`src/server/automation/engine/timing.ts` — a table of fixed constants (all values
in ms). Selectable via `AUTOMATION_TIMING_PROFILE` (`z.enum(['fast','normal','careful']).default('normal')`).

| Knob | `fast` | `normal` | `careful` | Meaning |
|---|---:|---:|---:|---|
| `navigationWaitMs` | 300 | 800 | 1 500 | pause after `clickNext`, before settle checks |
| `pageStabilizeTimeoutMs` | 8 000 | 10 000 | 15 000 | max wait for an anchor/element (threaded into `requireSelector` / `waitForPageSettled` / listbox waits after the fix wave) |
| `fieldInteractionDelayMs` | 80 | 250 | 600 | pause after focus/scroll, before writing |
| `scrollDelayMs` | 50 | 150 | 400 | pause after `scrollIntoViewIfNeeded` |
| `postFillVerifyDelayMs` | 120 | 300 | 900 | pause after write, before read-back |
| `retryDelayMs` | 200 | 500 | 1 200 | pause before the single verify retry |
| `resolveProbeMs` | 1 500 | 2 000 | 3 000 | primary-vs-fallback selector probe window |

`BENCHMARK_TIMING` (name `benchmark`) zeroes every delay knob and uses a 2 000 ms
stabilize timeout / 500 ms probe — **CI only**, unreachable from the environment
(`z.enum` rejects it), injectable only via `AutomationServiceDeps.timing`, which
no production caller sets.

**Timing is reliability-only.** No `Math.random`, no jitter, no stealth plugin, no
`navigator.webdriver` spoofing — a repo-wide grep finds only doc comments
explicitly denying them. No branch is gated on the profile name or on any timing
value, so no profile can skip a read-back, checkpoint, or safe-stop.

## 6. Performance — the deterministic benchmark

`test/automation/phase8Benchmark.test.ts` runs the **real `runLoop`** against the
local fixture portal v3 under `BENCHMARK_TIMING` (all human delays 0) so it is
fast and deterministic in CI, then:

- asserts `run.status === 'review_ready'`, `fields_verified === fields_total`,
  `portal.submitCount === 0`, and no submit-shaped event;
- counts the real `fills` / `navs` and **models** the wall-clock a `normal`-profile
  run would take: a fixed browser-open budget + `fills × (scroll + interaction +
  verify)` + `navs × (navigationWait + typical settle)` + the measured fixture
  compute.

For a representative prepared application (**35 fields / 7 navigations modeled**)
the model lands at **≈48 s under `normal`** — well under the ~120 s (2-minute)
target, leaving headroom for the operator's review + payment (which the autofill
never performs). The fix-wave run observed `fills=13 navs=10 modeledObservedMs≈39740`;
substituting the sibling test's 550 ms/field browser-work term still gives ≈65 s,
so the ≤ 2-minute claim survives either arithmetic model.

**The benchmark never touches a network.** A real-portal timing check is a
documented manual smoke behind `INDIA_LIVE=1` (`docs/portals/india.md`), never in
CI.

## 7. Run-page observability

`src/shared/automation/progress.ts` (pure, import-free) + `RunTiming` /
`ProgressTimeline` in `src/web/src/pages/Automation/runChrome.tsx`, wired into
`AutomationRunPage`:

- **Elapsed** — `formatDuration(elapsedMs(started_at))`, ticking every second
  while the run is non-terminal, frozen at `ended_at − started_at` once terminal.
- **ETA** — `estimateRemainingMs` linearly extrapolates from the observed
  per-field rate; hidden until ≥ 1 field is verified, `0` once all are.
- **Section** — `current_section_id ?? current_portal_state ?? '—'`.
- **Milestone timeline** — `role="list" aria-label="Progress timeline"`, a fixed
  event-type → label map (`RUN_STARTED` → "Portal opened", `PAGE_DETECTED` →
  "Page detected", `NAVIGATION_COMPLETED` → "Moved to the next page", the
  checkpoint events → "Human action required", `REVIEW_READY` → "Review page
  reached — nothing submitted", …), consecutive duplicates deduped. **Renders the
  label + a relative time only — never a portal state, field path, message, or
  value.** Locked non-vacuously by `AutomationRunPage.test.tsx` (feeds
  `portal_state: 'PASSPORT-1234567'` / `field_path: 'identity.surname'`, asserts
  the rendered text matches neither).

## 8. Document handling

`automationEngine.ts` §5.4: a page that needs a document the applicant profile has
not uploaded now returns `{ kind: 'waiting', reason: 'document_upload_required' }`
(a legal `running → waiting_for_user` transition, already in `WaitingReason` — no
vocab addition, no migration) instead of the terminal
`{ kind: 'failed', errorCode: 'missing_document' }`. The per-document
`BLOCKED_MISSING_DOCUMENT` events are preserved so the operator still sees which
document is missing; `error_code` stays `NULL`. `missing_document` is **retired
from `src/` entirely** — only historical Phase 5 docs still mention it.

The resume copy (corrected in the fix wave, I4): upload the document in the portal
yourself, advance the portal past the page, then resume — *a document added to the
applicant profile requires a fresh run*, because the in-memory resume path does
not rebuild the plan. The pause re-arms on every resume until the operator
advances the portal.

## 9. Discovery→mapping promotion ergonomics

- **`promoteCandidate`** now appends three comment lines to the rendered
  `IndiaFieldMapping` literal — `status: 'discovered'` plus TODO stamps for
  `validatedAt: <ISO>` and `validatedAgainstRevision: '<current mappingRevision>'`
  — so the operator has an exact checklist to satisfy before the mapping is
  production-usable.
- **`renderPromotedBundle`** + `POST /api/discovery-sessions/:id/promote-bundle` +
  `api.promoteBundle` + a **"Copy all promoted (N)"** button — concatenates every
  promoted candidate into one paste block, warnings de-duplicated.
- **`renderFieldTablesMarkdown`** (`fieldTablesMarkdown.ts`, pure, value-free) +
  `GET /api/discovery-sessions/:id/field-tables` + `api.getFieldTables` + a
  **"Copy field tables"** button — auto-generates the three `india.md`
  field-support tables (Validated / Discovered / Placeholder) from persisted
  discovery + the live map, using only canonical field paths, control kinds,
  portal-state names, confidence labels, lifecycle statuses and counts.
- **Track B** — a numbered **18-step execution checklist** in `docs/portals/india.md`
  and `docs/portals/india-validation-report-TEMPLATE.md` (front-matter + per-field
  table + totals + checkpoints list + operator sign-off + a `submitCount === 0`
  attestation).

## 10. Security review

**CLEAN — no HIGH or MEDIUM findings** (confidence ≥ 8), opus, focused on the
Phase 7 + Phase 8 delta. Verified clean: the `quote()` TS-string escaper is
sufficient for its single-quoted context (a raw newline is a `tsc` syntax error,
not code); the two new discovery routes are Zod-validated and parameterised; the
value-free surfaces (`renderFieldTablesMarkdown`, `ProgressTimeline`, the new
route responses) hold; the `document_upload_required` change reaches no forbidden
state; no timing knob gates a safety check. One sub-threshold note, closed in the
fix wave: `promote-bundle`'s `picks` array now has a `.max()` cap. Full write-up:
`.superpowers/sdd/2026-09-08-phase-8-real-portal-readiness/security-review.md`.

## 11. Whole-branch review

**READY TO MERGE WITH FIXES** — 0 Critical, 5 Important, 19 Minor
(`74fc162..bcb40af`, Phase 7 + Phase 8 together). All 8 binding invariants verified
holding (terminal `review_ready` / no submit-pay-appointment-registration;
production-mapping gate; no selector guessing / exact dropdowns / explicit dates;
timing reliability-only, no jitter; no PII in persistent surfaces; no migration /
no new dep; discovery read-only + app never writes adapter source; resume
re-detects page + re-checks readiness).

The 5 Important were **all fixed in `bcb40af`** (+10 tests):

| # | Finding | Shape | Fix |
|---|---|---|---|
| I1 | `custom_select` did a substring dropdown match — a wrong-but-plausible option could be left selected | Phase-7-shaped | exact `===` option-text match in `selectCustom`; miss → `OptionNotFoundError`, nothing clicked. Docs narrowed to `native_select` for the untouched-control guarantee |
| I2 | `careful` / `fast` didn't actually make the automation more patient — `pageStabilizeTimeoutMs` reached only one scroll call | Phase-8-introduced | threaded into `requireSelector` / `waitForPageSettled` / `EngineContext.settle` / listbox waits; `selectNative`'s 2 s option-set wait left as-is (sanctioned) |
| I3 | a non-production `nextSelector` crashed the run terminal (`failed` / `engine_error`) instead of a `stale_mapping` pause | Phase-7-shaped (branch edited it in Phase 8) | `nextSelectorReadiness` + `classifyNextSelector` → `MAPPING_NOT_PRODUCTION_READY` + `stale_mapping` safe-stop, parity with the field path |
| I4 | the `document_upload_required` copy promised a remedy (add the doc to the applicant) the in-memory resume can't deliver | Phase-8-introduced | honest copy — upload in the portal + advance + resume; a doc added to the applicant needs a fresh run |
| I5 | `session_expired` doc-vs-reality gap — documented as wired, but no real 401 / login fingerprint exists | Phase-7-shaped | docs corrected (ARCHITECTURE §3, PHASE-7-REPORT §§9/11/21): engine-implemented + fixture-tested; a real timeout falls to `unknown_page` until a signal is added — Track B |

Every Important is a fail-safe degradation, not a safety hole; I3 and I4 were the
two flagged as "land before any Track B session" and both landed. The 19 Minors
are logged as deferred in the SDD ledger — cosmetic or low-risk (benchmark-model
consolidation M2, an optional-field `OptionNotFoundError` guard M4, a
duplicate-path warning in `renderPromotedBundle` M5, a `|`-escape in a table cell
M7, a provenance refetch after resume M8, a `.max()` on `picks` M12, cosmetic
heading/CSS nits M14/M17, a dead `EngineStop` variant M18, one integration
scenario on `normal` M19, and the deferred `custom_select` pre-write availability
probe). None blocks merge. Full write-up:
`.superpowers/sdd/2026-09-08-phase-8-real-portal-readiness/final-review.md`;
fix-wave detail: `…/task-14-fixwave-report.md`.

## 12. Acceptance criteria — plan Self-review (directive §§1–21)

| Directive section | Task(s) | Status |
|---|---|---|
| §1 audit + baseline | pre-plan + Task 1 | **MET** — baseline recorded; Task 1 fixed the flaky test → true 1207/1207 |
| §2 human-present discovery | Phase 6 + Tasks 10/11/13 | **MET (build)** — discovery layer unchanged; promotion + field-tables + Track B checklist added |
| §3 production field mapping + diagnostics | Phase 7 + Task 10 | **MET (build)** — promotion now emits the validation stamps; **real mappings still 0 — process ready, not executed (Track B)** |
| §4 controlled autofill flow | Phases 5–7 + Task 9 | **MET** |
| §5 value safety (exact dropdown, date transform, conflict, verify) | Phase 7 + Global Constraints | **MET** — locked by the invariant audit; I1 fix makes `custom_select` exact too |
| §6 documents | Task 9 | **MET** — resumable `document_upload_required` pause |
| §7 3-minute target + timing profiles | Tasks 2/3/4/6 | **MET (modeled)** — `normal` models ≈48 s ≤ 120 s; real-portal timing is an `INDIA_LIVE=1` manual smoke |
| §8 realistic browser behaviour, no evasion | Tasks 3/4 + Global Constraints | **MET** — fixed waits, no jitter / stealth / fingerprint spoofing |
| §9 application-plan as source of truth | Phase 4/5 unchanged | **MET** |
| §10 page detection, unknown → stop | built; Task 13 doc | **MET (fixture)** — real-portal page + `session_expired` detection deferred to Track B; a real unknown/timeout page is a safe `unknown_page` stop today |
| §11 idempotent resume + revalidation | Task 12 | **MET** — proven against the real engine; no production change needed |
| §12 no appointment / payment | Global Constraints | **MET** — nothing added; rails unchanged |
| §13 security review | Task 14 | **MET** — CLEAN, no HIGH/MEDIUM |
| §14 Track B procedure | Task 13 | **MET (process)** — 18-step checklist + report template written; **live session NOT executed** |
| §15 tests A–G | A–F Phase 7; G = Task 6 | **MET** — perf test G added; A–F fixture-covered |
| §16 value-free progress timeline | Task 7 | **MET** — `ProgressTimeline` locked PII-free by a non-vacuous test |
| §17 automation UI (adapter, revision, mappings, page, section, progress, elapsed, ETA, status, checkpoint copy, "Prepared — NOT submitted", no submit button) | Tasks 7/8 | **MET** — elapsed / ETA / section / timeline + accurate copy added; provenance / stale / banner from Phase 7; no submit affordance |
| §18 failure handling — STOP + explain | built + Task 9 | **MET** — the last hard-fail (missing doc) is now a pause; the I3 fix removed the `nextSelector` crash |
| §19 TDD process | every task | **MET** — failing test first, per task, separate commits |
| §20 skills | Task 14 | **MET** — subagent-driven-development / TDD / requesting-code-review / security-review / finishing-a-development-branch |
| §21 acceptance criteria | Task 14 | **MET** — this table |

**Honest status on the Track-B-dependent items:** real portal URL from Settings —
already wired (Phase 5/6, unchanged); real mappings from discovery — the promotion
+ validation + field-table + report process is ready but **not executed**, zero
real fields; `normal` ≈ 2 min — **modeled** by the deterministic benchmark, not
measured against a real portal.

## 13. Known limitations / what's still manual

- **Track B is not executed** — 0 real Indian portal fields validated;
  `indiaPortalMap.ts` still ships every selector as `'TODO:discover'` /
  `status: 'placeholder'`, so a real run pauses `stale_mapping` on the first
  required field.
- **`session_expired` real-portal detection awaits Track B** —
  `getIndiaPageIdentity` has no 401 / login-form fingerprint; a real session
  timeout is handled as `unknown_page` (still a safe stop) until a signal is added.
- **`custom_select` availability check is post-open** — `custom_select` /
  `searchable_select` / `autocomplete` match options by exact string equality but
  the check happens *after* the dropdown is opened (a UI-state change, not a form
  write); only `native_select` gets the pre-write `assertNativeOptionAvailable`
  check that leaves the control untouched.
- **`document_upload_required` re-pauses** until the operator advances the portal
  past the page; a document added to the applicant profile needs a fresh run (the
  in-memory resume path does not rebuild the plan).
- **The deferred minors from the SDD ledger** (M2, M4, M5, M7, M8, M12, M14, M17,
  M18, M19 and the `custom_select` pre-write probe) — cosmetic or low-risk; none
  blocks merge.
- **Headed-browser test dependency** (carried from Phases 5–7) — the benchmark and
  the resume/matrix tests launch a real headless Chromium; a displayless CI runner
  would fail them.

## 14. Verbatim

```
Automatic final visa submission: NOT IMPLEMENTED
OTP/CAPTCHA/anti-bot bypass: NOT IMPLEMENTED
Real Indian portal fields validated: NONE (Track B not executed)
```
