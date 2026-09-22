# Phase 7 — Real Indian Visa Portal Validation + Controlled Autofill — Design

> **Status:** design approved 2026-09-07 (brainstorm). Implementation NOT started.
> **Branch:** `phase-7-portal-validation-autofill` cut from Phase 6 HEAD `74fc162`.
> **Baseline:** 1120 tests / 108 files, gate green at `74fc162`.

---

## 1. Mission

Turn the Phase 6 India adapter from *"has a mapping structure"* into a **production-controlled
adapter**: the automation engine may autofill a portal field **only** when that field's mapping
has been discovered, human-validated, and stamped against the **current** map revision. A mapping
that was validated against an older revision is **stale** and must not drive autofill. No portal
selector is ever guessed, fuzzy-matched, or "closest-element" matched.

```
Applicant / Application data
        ↓
India Visa Application Plan (Phase 4 — unchanged)
        ↓
Production-usable India mapping   ← NEW: status=validated AND validatedAgainstRevision=current
        ↓
Phase 5 controlled browser engine (unchanged core)
        ↓
locate → fill/select → read back → normalise → compare → verify
        ↓
safe-stop on any doubt  ·  pause at review_ready  ·  NEVER submit
```

## 2. Approach

A **delta** on Phases 5 + 6. No new subsystem. **No migration** — migration 6 already dropped the
`automation_runs.waiting_reason` CHECK, so new pause reasons are a TypeScript union change only, and
the stale-mapping stamp lives in `indiaPortalMap.ts` source (hand-authored, guard-tested), not the DB.

The chosen scope is **"delta + re-verification pass"**: build the genuine gaps (below) **and** add
a dedicated Phase-7-labelled safety suite that re-asserts every already-shipped rail
(no-submit, PII, checkpoints, unknown-page, resume idempotency, ToS gate) with fresh synthetic
markers — even where Phase 5/6 coverage already exists.

Track B (the live, authenticated, human-present real-portal session) is **runbook only** in
Phase 7 — documented, executed separately. Phase 7 completes on fixture proof, like Phase 6 Track A.

---

## 3. Reuse analysis — what Phase 7 does NOT rebuild

Verified against the repository at `74fc162`. Each row is used as-is.

| Capability | Where it already lives | Phase 7 relationship |
|---|---|---|
| No-auto-submit (4 mechanisms) | `PortalAdapter.submitSelector: null` by contract; `EngineStop` has no `submitted`; `runLoop` returns at `isFinalReview` before any action; `noAutoSubmit.test.ts` (non-vacuous, walks `automation/**` incl. `discovery/**`) | re-guarded by the Phase 7 safety suite; every new flow asserts `submitCount === 0` |
| Mapping lifecycle `placeholder → discovered → validated` + provenance | `indiaPortalMap.ts` (`IndiaFieldMapping.status`/`discoveredAt`/`validatedAt`/`discoverySessionRef`); `indiaMappingProvenance.test.ts` (build fails on an un-sourced selector); `nextSelector` provenance at parity | **extended** with `stale` + `validatedAgainstRevision` (§6) |
| Adapter isolation | `architectureGuard.test.ts` (engine imports no concrete adapter; `shared/automation/` pure); `noHardcodedUrl.test.ts` (India host literal only in `indiaPortalMap.ts` + sanctioned `policyGate.ts`) | unchanged; new India code stays under `adapters/india/` |
| ToS runtime gate | `discovery/policyGate.ts` `assertPolicyAck`, called by `discoveryController.start` **and** `automationService.startRun` (Phase 6 whole-branch C1) | unchanged; re-asserted in the safety suite |
| Read-back verification per `ControlKind` | `engine/fieldActions.ts` `applyField` / `verifyControl` (`optionMatch:'value'` compares option value not label) | **extended** for `date` normalisation (§8) |
| Checkbox / radio write→read→verify | `fieldActions.ts` + `pageActions.ts` `setCheckbox`/`setRadio` (group selector) | unchanged |
| OTP / CAPTCHA / MFA / anti-bot detect-and-pause | `engine/checkpointDetector.ts` (precedence captcha>anti_bot>mfa>otp); `automationService.resumeRun` reloads the page and re-runs `detectCheckpoint` → `CHECKPOINT_STILL_PRESENT` / 409 while present; **no solver / retrieval / evasion anywhere** | unchanged; re-asserted (pause → user → **re-detect → re-validate → resume**) |
| Unknown / low-confidence page → safe stop | `engine/pageDetector.ts` `DETECT_CONFIDENCE_THRESHOLD = 0.6` → `UNKNOWN_STATE`; `runLoop` emits `UNKNOWN_PORTAL_STATE` → `{ waiting, reason: 'unknown_page' }`; `leftState` non-advance guard; `nowhere.html` fixture | unchanged; re-asserted |
| Value-conflict pause | Phase 6 `value_conflict` reason + `classifyPreFill` + `resumeRun(decision)` + `ValueConflictPanel`; the `{expected,actual}` pair lives **only** in the in-memory `GET /live` surface, never persisted | unchanged; re-asserted (conflict values never in logs/events) |
| Crash-recovery resume | `automationService.resumeRun` fresh-runner re-walk; idempotent via `FIELD_ALREADY_SET` / re-verify; `initialVerifiedCount` carries the counter across pauses | unchanged; re-asserted for idempotency |
| Session-expired pause | `SESSION_EXPIRED` event + `session_expired` waiting reason | **wired** to a fixture scenario (§10) |
| PII-safe logging | `security.test.ts` (Phase 5 + Phase 6 halves); seeded-PII scans over logs / `automation_events` / `automation_runs` / `portal_discovery_*`; `url_pattern` masking; screenshots `off` by default under gitignored `data/` | **extended** with fresh markers in the Phase 7 safety suite |
| Closed event vocabulary | `shared/automation/events.ts` — 41 `EVENT_TYPES` + `EVENT_MESSAGES` purity test (no `${}` / `%s` / `value:`) | **+3 types** wired (`DROPDOWN_OPTION_MISSING`, `SELECTOR_STALE` already declared-but-unused; `MAPPING_NOT_PRODUCTION_READY` new) |
| State machine | `shared/automation/states.ts` `RUN_STATES` (7) + `LEGAL_TRANSITIONS`; `WaitingReason` (12) | **+2 `WaitingReason`s** (`option_unavailable`, `stale_mapping`); `RunStatus` **unchanged** |
| Discovery infra (read-only, persisted, sanitized) | `discovery/{discoveryController,observe,discoverySessionStore,policyGate,portalDiscovery}.ts`; `discoveryReadOnly.test.ts` (recursive walk); migration 6 tables | unchanged; the runbook (§13) drives it |
| Adapter diagnostics | `adapters/india/diagnostics.ts` `getIndiaDiagnostics`; `indiaMappingRegistry.ts` | **extended** with `stale` / `productionUsable` counts (§14) |
| Fixture portal + fixture adapter v2 | `test/helpers/fixturePortal.ts` (`?challenge=` / `?prefill=`), `test/automation/support/fixtureIndiaAdapter.ts` (`FIXTURE_INDIA_PORTAL_MAP_V2`, all `validated`) | **extended** to v3 (§10) |

---

## 4. Gap analysis — what Phase 7 changes

| # | Gap | Change |
|---|---|---|
| G1 | `indiaAdapter.getFieldMap()` → `toPortalFieldMap()` hands the engine **all 26** fields, incl. 22 `'TODO:discover'` placeholders. | Filter to **production-usable only** (§5). |
| G2 | No link between a mapping's `validatedAt` and the `mappingRevision` it was validated against. A stale mapping is indistinguishable from a current one. | Per-mapping `validatedAgainstRevision` + `mappingLifecycle.ts` staleness rule + guard tests (§6). |
| G3 | `OptionNotFoundError` (from `selectNative` / `selectCustom` / `typeAutocomplete`) is **not caught** by the engine's fill `catch` → propagates → hard `RUN_FAILED`. `DROPDOWN_OPTION_MISSING` is declared but **never emitted**. | Engine catches it → emits `DROPDOWN_OPTION_MISSING` → `{ waiting, reason: 'option_unavailable' }`; pre-fill option-existence check so the pause precedes any DOM write (§7). |
| G4 | A required field with no production mapping pauses `missing_field_mapping` — no distinction between "never mapped", "discovered not validated", "stale". | `mappingReadiness?()` adapter hook → engine emits `MAPPING_NOT_PRODUCTION_READY` → `{ waiting, reason: 'stale_mapping' }` for stale/unvalidated (§5, §9). |
| G5 | `SELECTOR_STALE` declared but **never emitted**; primary→fallback selector switch is silent. | `readControl` / `applyField` emit `SELECTOR_STALE` when `spec.selector` misses and `spec.fallbackSelector` resolves; surfaced in diagnostics (§9). |
| G6 | India `date` fields carry no `transform`; `setDate` fills raw ISO. No date-format library. Directive forbids inferring a portal date format. | `adapters/india/transforms.ts` — typed, deterministic, unit-tested date transforms + inverse parsers; `verifyControl` normalises both sides for `date`; fixture adapter v3 wires explicit transforms and proves fill→read-back→verify (§8). |
| G7 | Fixture portal cannot simulate changed/stale/fallback selectors, missing/placeholder/disabled/removed options, session expiry, redirect-to-login, navigation change. | Fixture portal + adapter **v3** with deterministic query-flag scenarios (§10). |
| G8 | UI shows status/progress/events but no adapter-version / mapping-revision / stale-mapping surfacing; `SafeStopBanner` copy doesn't say "NOT submitted". | `AutomationRunPage` provenance line + stale-mapping warning + tightened `SafeStopBanner` copy (§14). |
| G9 | Track B runbook is a stub; no mapping-validation / recovery / troubleshooting procedures; no supported/unsupported field tables. | `docs/portals/india.md` expansion + `PHASE-7-REPORT.md` (§17). |
| G10 | No single Phase-7-labelled safety matrix; coverage is spread across Phase 5/6 files. | `phase7Matrix.test.ts` + `phase7Safety.test.ts` (§11). |

---

## 5. Production mapping filtering (G1, G4)

**`indiaAdapter.getFieldMap()` returns production-usable specs only.** A spec is production-usable iff:

```
status === 'validated'  AND  validatedAgainstRevision === indiaPortalMap.mappingRevision
```

- `toPortalFieldMap()` filters; non-production fields **never reach the engine**.
- The **full** map stays available to `getIndiaMappings()` / `getIndiaDiagnostics()` / the discovery UI —
  filtering is only on the engine seam.
- Consequence for `mapFields` (`shared/automation/fieldMapping.ts`, unchanged): a plan field whose
  mapping was filtered out becomes a `MappedField` with `spec: null`.

**Distinguishing the pause reason (G4).** The generic engine must not know "stale" as an India concept,
so a **new optional generic hook** on `PortalAdapter`:

```ts
/** Why a plan field is absent from getFieldMap(). Optional — a generic adapter omits it. */
mappingReadiness?(fieldPath: string): 'production' | 'stale' | 'unvalidated' | 'unmapped';
```

Engine field loop, for a required `present` field with `spec === null`:

| `mappingReadiness?.(path) ?? 'unmapped'` | event | stop |
|---|---|---|
| `'stale'` / `'unvalidated'` | `MAPPING_NOT_PRODUCTION_READY` (`status:'blocked'`) | `{ waiting, reason: 'stale_mapping' }` |
| `'unmapped'` | `FIELD_UNMAPPED` (existing) | `{ waiting, reason: 'missing_field_mapping' }` (existing) |

Non-required `spec: null` fields keep the existing "left for you to enter" behaviour regardless.

`genericAdapter` does **not** implement the hook (its `getFieldMap()` is `{}`), so its behaviour is byte-unchanged.

---

## 6. Stale-mapping model (G2)

### Types (`indiaPortalMap.ts`)

```ts
interface IndiaFieldMapping extends PortalFieldSpec {
  status: 'placeholder' | 'discovered' | 'validated';
  discoveredAt?: string;
  validatedAt?: string;
  validatedAgainstRevision?: string;   // NEW — the mappingRevision this was validated against
  discoverySessionRef?: string;
  notes?: string;
}
interface IndiaPortalStateConfig {
  // …existing…
  nextSelectorValidatedAgainstRevision?: string;   // NEW — parity for the nextSelector
}
```

`indiaPortalMap.mappingRevision` stays a single map-wide ISO date. **A bump re-stales every validated
mapping** until each is re-stamped — the conservative "the map changed, re-verify everything" signal
the directive mandates (§5). Revision bumps are therefore deliberate (documented in the runbook).

### New pure module — `src/server/automation/adapters/india/mappingLifecycle.ts`

```ts
export type MappingLifecycle = 'placeholder' | 'discovered' | 'validated' | 'stale';

/** 'stale' when a validated mapping's stamp != the current revision. */
export function classifyMapping(m: IndiaFieldMapping, currentRevision: string): MappingLifecycle;

/** true iff status==='validated' && validatedAgainstRevision===currentRevision. */
export function isProductionUsable(m: IndiaFieldMapping, currentRevision: string): boolean;

/** Same rule for a state's nextSelector. */
export function isNextSelectorProductionUsable(cfg: IndiaPortalStateConfig, currentRevision: string): boolean;
```

Consumed by: `toPortalFieldMap()` (filter), `indiaAdapter.mappingReadiness()` (reason), `clickNext`
(refuses a non-production `nextSelector` — today it only refuses `'TODO:discover'`),
`getIndiaMappingStatus()` (counts), `getIndiaDiagnostics()` (counts).

### Guards (`indiaMappingProvenance.test.ts` extended, non-vacuous)

- a `validated` field mapping **must** carry `validatedAgainstRevision` (build fails otherwise);
- a `validated` `nextSelector` **must** carry `nextSelectorValidatedAgainstRevision`;
- `classifyMapping` returns `'stale'` for a validated mapping whose stamp ≠ current revision
  (fixture proves both directions);
- `toPortalFieldMap()` excludes a stale mapping (fixture with a deliberately stale entry);
- every mapping in the **real** `indiaPortalMap.ts` is still `'TODO:discover'` / `placeholder`
  (unchanged Phase 6 guarantee — 22 occurrences).

---

## 7. Dropdown safety (G3)

- `selectNative` / `selectCustom` / `typeAutocomplete` stay **exact-match only** — no change to their
  match logic; they never pick a "closest" option (verified: `nativeOptionExists` is label-OR-value
  exact equality; failure throws `OptionNotFoundError`).
- **New pre-fill check** in `fieldActions.applyField` (or a helper `assertOptionAvailable`): before a
  `native_select` / `custom_select` / `searchable_select` write, confirm the target option exists.
  Missing → throw `OptionNotFoundError` **before** any DOM mutation.
- **Engine catch** (`automationEngine.ts` field-loop `catch`): add an `OptionNotFoundError` branch →
  `emit DROPDOWN_OPTION_MISSING` (`fieldPath`, `status:'blocked'`) → `return { kind:'waiting',
  reason:'option_unavailable' }`. (Today it escapes to `RUN_FAILED`.)
- `WaitingReason += 'option_unavailable'`; `EVENT_MESSAGES.DROPDOWN_OPTION_MISSING` already exists.

Tests (fixture v3): exact match fills; placeholder option present → not chosen; disabled option →
not chosen, pause; duplicate-looking options → exact string decides, no ambiguity guess;
removed option → pause `option_unavailable`; changed option label → pause.

---

## 8. Date handling (G6)

### `src/server/automation/adapters/india/transforms.ts`

```ts
export class DateFormatError extends Error {}   // thrown on any unparseable / ambiguous input

// forward: ISO 'YYYY-MM-DD' → portal string
export function isoToDMY(iso: string): string;         // 15/10/2026
export function isoToMDY(iso: string): string;         // 10/15/2026
export function isoToYMD(iso: string): string;         // 2026/10/15
export function isoToDdMonYyyy(iso: string): string;   // 15 Oct 2026

// inverse: portal string → ISO 'YYYY-MM-DD' (strict; DateFormatError on mismatch)
export function parseDMY(s: string): string;
export function parseMDY(s: string): string;
export function parseYMD(s: string): string;
export function parseDdMonYyyy(s: string): string;
```

- Deterministic, typed, **no fuzzy parsing, no locale guessing, no runtime format detection**.
  Each parser accepts exactly one shape; anything else throws `DateFormatError`.
- Round-trip unit tests: `parseX(isoToX(iso)) === iso` for every pair; malformed inputs throw.

### Wiring

- **Real** `indiaPortalMap.ts` date fields stay `'TODO:discover'` with **no** transform — a transform
  is assigned **only** when Track B discovers the real field's format, alongside the
  `validatedAgainstRevision` stamp.
- **Fixture** adapter v3 wires `transform: isoToDMY` (etc.) on its date fields and proves the full
  `locate → transform → fill → read back → parse → compare → verify` chain end-to-end against fixture
  date inputs.
- `verifyControl` for `control: 'date'`: if `spec.transform` is set, normalise the read-back value
  through the field's configured inverse parser before comparing; unparseable portal value →
  `'unreadable'` (→ engine `FIELD_UNVERIFIABLE` → pause for required). The inverse parser is
  referenced via a new optional `PortalFieldSpec.readBackParse?: (portalValue: string) => string`
  (generic; India sets it; undefined = compare raw, unchanged for every other field/adapter).

---

## 9. Selector fallback visibility (G5)

- `pageActions.readControl` / `fillText` / writers: today `requireSelector` waits on `spec.selector`
  only. New: a small `resolveSelector(page, spec) → { selector, usedFallback }` — tries
  `spec.selector`, then `spec.fallbackSelector` if set; returns which matched.
- When `usedFallback` is true, the engine emits `SELECTOR_STALE` (`fieldPath`, no `status` — it is
  **informational**: the run continues normally on the fallback selector, it does not pause).
- `getIndiaDiagnostics` surfaces a `selectorStaleEvents` count (`count(*)` of `type='SELECTOR_STALE'`).
- If **neither** selector resolves → existing `SelectorNotFoundError` → `FIELD_NOT_FOUND` → existing
  pause. Fallback is only ever an *explicitly configured* alternative — never a guess.

---

## 10. Fixture portal v3 (G7)

### `test/helpers/fixturePortal.ts` + `test/fixtures/india-portal/*.html`

New deterministic query-flag scenarios (same pattern as `?challenge=` / `?prefill=`):

| Flag | Effect |
|---|---|
| `?selector=changed` | a known field's `id` is renamed (primary selector misses) |
| `?selector=fallback` | primary `id` renamed but a stable `[name=…]` / `data-*` fallback still resolves |
| `?field=missing` | a mapped control is absent from the DOM |
| `?option=placeholder` | the `<select>` leads with `<option value="">— Select —</option>` |
| `?option=disabled` | the target option is present but `disabled` |
| `?option=removed` | the target option is absent |
| `?option=duplicate` | two options share a visible label, distinct values |
| `?session=expired` | the page returns 401 + a `<h1>Session expired</h1>` login redirect marker |
| `?nav=changed` | the `.next` control is relocated / renamed |
| a date page | `<input type="date">` (or a text date input for a format test) |

`nowhere.html` (unknown page) and `challenge.html` (OTP/CAPTCHA) already exist and are reused.

### `test/automation/support/fixtureIndiaAdapter.ts` → **v3**

`FIXTURE_INDIA_PORTAL_MAP_V3`: v2 + `validatedAgainstRevision` on every mapping (so it is
production-usable under the lifecycle rule), explicit date `transform` + `readBackParse` on date
fields, a `fallbackSelector` on one field, and one deliberately **stale** entry (wrong
`validatedAgainstRevision`) for the filtering test.

---

## 11. Phase 7 test matrix (G10)

### `test/automation/phase7Matrix.test.ts` — the §11/§33 grid (fixture-only)

| Group | Cases |
|---|---|
| Mapping | placeholder rejected from production · discovered rejected · validated accepted · stale rejected · missing `validatedAgainstRevision` rejected (guard) |
| Page detection | known page detected · unknown page → `unknown_page` · changed page → safe stop · wrong page (non-advance) → `NAVIGATION_STALLED` |
| Field types | text · date (each format) · native_select · custom_select · checkbox · radio · textarea — fill + read-back + verify |
| Verification | successful read-back · mismatch → pause · unreadable → pause (required) · date normalisation both sides |
| Safety stops | OTP · CAPTCHA · conflict · session expired · unknown page · document checkpoint · `option_unavailable` · `stale_mapping` · `SELECTOR_STALE` (continues) |
| Recovery | dispose→resume idempotent (fills nothing new) · resume re-detects & re-validates page · partial-page resume · crash-recovery conflict default `keep_portal` |
| E2E | one full fixture-v3 run: connect → detect → autofill (production mappings) → verify → validation check → checkpoint → `review_ready`, with `fixturePortal.submitCount === 0` |

### `test/automation/phase7Safety.test.ts` — the re-verification pass

Fresh synthetic markers: `TEST-PASSPORT-123`, `TEST-NAME-ONLY`, `TEST-EMAIL@example.invalid`,
`TEST-DOB-2000-01-01`, `TEST-ADDR-NOWHERE`.

- **No-submit:** `submitCount === 0` after every Phase 7 scenario; `noAutoSubmit.test.ts` grep still
  green + non-vacuous over any new modules.
- **PII:** none of the markers appears in `captured` logs, `automation_events`, `automation_runs`,
  `portal_discovery_pages` / `_sessions`, or any screenshot path; `AUTOMATION_EVIDENCE` unset → no
  screenshot written.
- **OTP / CAPTCHA:** pause → (user clears) → resume re-runs `detectCheckpoint` → still present → 409;
  cleared → resumes.
- **Unknown page:** `nowhere.html` → `UNKNOWN_PORTAL_STATE`, `FIELD_FILL_STARTED` absent.
- **Stale / unvalidated mapping:** a run whose adapter has a stale required mapping →
  `MAPPING_NOT_PRODUCTION_READY` → `stale_mapping`, **zero** `FIELD_FILL_STARTED` for that field.
- **Resume idempotency:** dispose mid-run → resume → no field is filled a second time
  (`FIELD_ALREADY_SET` / re-verify only).
- **ToS gate:** real India host + no ack → `startRun` **and** `discoveryController.start` refuse (409),
  no run row, no browser launch.
- **Conflict:** both the application value and the portal value are in the engine's hands; neither
  appears in any persisted row.

---

## 12. Safety boundaries (NON-NEGOTIABLE — re-stated, re-guarded)

Phase 7 **never** automates: CAPTCHA solving/bypass · OTP retrieval/bypass · anti-bot/stealth/
fingerprint evasion · account registration · payment · appointment booking · **application
submission** · declaration/attestation submission · defeating any portal security control.

- Terminal success state stays **`review_ready`**. No `submitted` / `payment_completed` /
  `appointment_booked` status or event type is added. `RunStatus` and `LEGAL_TRANSITIONS` are unchanged.
- `PortalAdapter.submitSelector` stays `readonly null`.
- On OTP/CAPTCHA: **pause → wait for user → re-detect page → re-validate state → resume** (existing
  `resumeRun` behaviour; re-asserted).
- Document upload: **detect → tell the user which document → pause** (`document_upload_required`).
  Phase 7 does not drive the portal file chooser.
- Discovery stays read-only (`discoveryReadOnly.test.ts` recursive walk); Phase 7 adds no
  page-mutating call under `discovery/`.
- Mappings never auto-promote to `validated` — a human validates and hand-stamps
  `validatedAgainstRevision`. `promoteCandidate` still renders paste-ready TS; the app never writes
  adapter source.

---

## 13. Track B — real-portal field validation procedure (runbook, NOT executed in Phase 7)

Documented in `docs/portals/india.md`. Human-present, one field / safe group at a time.

1. Operator opens the configured Indian visa portal in the discovery browser.
2. Operator handles **manually**: login, registration if required, OTP, CAPTCHA, any human verification.
3. `DiscoveryController.capture` observes page structure (read-only; sanitized; persisted).
4. `getIndiaMappings` / the discovery UI lists candidate controls for the current page.
5. Operator picks `canonical field → portal candidate`; `promoteCandidate` renders the paste-ready
   `discovered` mapping literal.
6. Operator reviews the selector against the live DOM.
7. Operator runs `POST /discovery-sessions/:id/validate-adapter` → the selector resolves to one
   control of the right kind, option labels dump clean.
8. Operator hand-edits `indiaPortalMap.ts`: `status: 'validated'`, `validatedAt`,
   **`validatedAgainstRevision: <current mappingRevision>`**, `discoverySessionRef`; for a date field,
   assign the explicit `transform` + `readBackParse` matching the observed format.
9. Only `validated` + current mappings reach `getFieldMap()` → controlled autofill can use them.
10. Any step blocked → recorded as BLOCKED with the reason; Phase 7 still completes on fixture proof.

**No payment info. No submission. Prefer a non-sensitive / test application where portal rules permit.**

---

## 14. UI (G8)

`src/web/src/pages/Automation/AutomationRunPage.tsx` + `runChrome.tsx`
(+ `pages/Settings/IndiaPortalCard.tsx` / `Discovery/discoveryChrome.tsx` `DiagnosticsPanel`):

- **Provenance line** (value-free): `India adapter v6.0.0 · mapping rev 2026-09-07 · N/26 production-ready`.
- **Stale-mapping warning** banner when diagnostics report any stale or unvalidated mapping the active
  plan needs:
  > *Some required portal mappings are stale or not yet validated. Automation cannot safely continue
  > until they are re-validated.*
- **`SafeStopBanner`** (`review_ready`) copy → *"Prepared — NOT submitted. Submission is your
  responsibility in the portal."*
- No new affordance resembling Submit / Pay / Book appointment / Complete automatically. The existing
  "no `<form>` / no `type=submit` / no `/submit/i` button" web test is extended to the new banner.
- `DiagnosticsPanel` gains `stale` and `productionUsable` rows (value-free `<dl>`).

---

### Generic (non-India) type additions — small, optional, backward-compatible

| Type | Addition | Default when omitted |
|---|---|---|
| `PortalAdapter` (`baseAdapter.ts`) | `mappingReadiness?(fieldPath: string): 'production' \| 'stale' \| 'unvalidated' \| 'unmapped'` | engine treats an unmapped required field as `missing_field_mapping` (today's behaviour) |
| `PortalFieldSpec` (`shared/automation/types.ts`) | `readBackParse?: (portalValue: string) => string` | `verifyControl` compares the raw read-back string (today's behaviour) |

`genericAdapter`, every test fake, and `fixtureIndiaAdapter` v2 remain valid without change
(both members optional). `toPortalFieldMap()` passes `readBackParse` through alongside `transform`.

## 15. India adapter surface (§16)

`indiaAdapter` keeps its `PortalAdapter` shape and adds only the optional `mappingReadiness?()` hook.
The module exposes (all already present except where noted):

| Member | Purpose |
|---|---|
| `getFieldMap()` | **production-usable specs only** (changed) |
| `mappingReadiness?(fieldPath)` | pause-reason classification (new, optional, generic) |
| `getPageIdentity` / `sectionIdsForState` / `documentIdsForState` / `canContinue` / `clickNext` / `isFinalReview` | unchanged, except `clickNext` refuses a non-production `nextSelector` |
| `INDIA_ADAPTER_VERSION` (export) | unchanged |
| `getIndiaMappings` / `getIndiaMappingStatus` / `getIndiaDiagnostics` | full map + `stale`/`productionUsable` counts (extended) |

`toPortalFieldMap()` stays an internal helper; it now takes the current revision and filters.

---

## 16. Documentation (§17)

- `docs/superpowers/specs/2026-09-07-phase-7-portal-validation-autofill-design.md` — this file.
- `docs/superpowers/plans/2026-09-07-phase-7-portal-validation-autofill.md` — the TDD plan.
- `docs/superpowers/reports/PHASE-7-PLANNING-REPORT.md` — the planning report.
- `docs/superpowers/reports/PHASE-7-REPORT.md` — end-of-phase (per directive §40 path); a one-line
  pointer added from `docs/` for consistency with phases 0–6.
- `docs/portals/india.md` — real-portal discovery procedure · field-validation procedure · mapping
  promotion procedure · **stale-mapping recovery** · **selector-change recovery** · **dropdown
  mismatch recovery** · OTP/CAPTCHA pause/resume procedure · troubleshooting table · three field
  tables: **Validated** / **Discovered-but-unvalidated** / **Not supported**.
- The report **must** separate *Automated tests* from *Real-portal validation* and must **not** claim
  any real portal field is validated unless Track B actually validated it (it will not have, in Phase 7).

---

## 17. Acceptance criteria

Phase 7 is complete only when **all** hold:

1. `npm run typecheck` (4 tsc projects) · `npm run lint` · `npm test` · `npm run build` — all green;
   Phase 0–6 regression green; baseline 1120 → higher.
2. `getFieldMap()` returns production-usable mappings only; a stale or unvalidated mapping cannot
   reach the engine (guard test, non-vacuous).
3. `mappingLifecycle.ts` classifies `placeholder|discovered|validated|stale` correctly; a validated
   mapping without `validatedAgainstRevision` is a build failure.
4. Dropdown: missing / disabled / removed option → `DROPDOWN_OPTION_MISSING` + `option_unavailable`
   pause, **no DOM write**; exact match still fills; no "closest" selection anywhere.
5. `SELECTOR_STALE` emitted on a primary→fallback switch; surfaced in diagnostics; a total miss still
   pauses `FIELD_NOT_FOUND`.
6. `transforms.ts` — every forward/inverse pair round-trips; malformed input throws `DateFormatError`;
   no fuzzy parsing. Real India date fields carry **no** transform (still `'TODO:discover'`).
7. `date` read-back normalises both sides through the configured parser; unparseable → pause.
8. Fixture portal v3 deterministically produces every §10 scenario; fixture adapter v3 is
   production-usable and includes one stale entry.
9. `phase7Matrix.test.ts` + `phase7Safety.test.ts` green and non-vacuous; `submitCount === 0` in
   every Phase 7 scenario; synthetic PII markers absent from every persistent surface.
10. OTP + CAPTCHA pause → re-detect → re-validate → resume; unknown page safe-stops; resume is
    idempotent; ToS gate enforced on both entry points; conflict values never persisted.
11. UI shows the value-free provenance line + stale-mapping warning; `SafeStopBanner` says
    "NOT submitted"; no submit-shaped affordance (web guard test extended).
12. `docs/portals/india.md` has all §17 procedures + the three field tables;
    `PHASE-7-REPORT.md` separates automated tests from real-portal validation and claims **no**
    real-portal field as validated.
13. Whole-branch review (opus) over `74fc162..HEAD` against §12 boundaries + the 8 Phase 5 rails +
    the Phase 6 additions + the Phase 7 additions; Critical/Important findings fixed.
14. **No** `submitted` / `payment_completed` / `appointment_booked` state, event, or code path exists.

---

## 18. Non-goals

Real-portal Track B execution · document-upload automation · a second country adapter ·
per-field independent map revisions (map-wide `mappingRevision` chosen) · any migration (none needed) ·
changes to the Phase 4 requirement model or the Phase 5 generic state machine core ·
`RunStatus` additions · autonomous mapping promotion.
