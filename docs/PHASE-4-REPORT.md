# Phase 4 — India Visa Application Builder — end-of-phase report

**Status:** Complete. Gate green. Whole-branch review (opus) pending.
**Branch:** `phase-0-portal-settings` (established non-main working branch for all phases).
**Range:** `4a6154d … cb5e96b` (`4a6154d^..cb5e96b`) — spec `116f0ff`, plan
`599b2be`, 25 implementation / fix / test commits across the 21 tasks (several took a
fix round; Task 12 also took a pre-review critical fix). This docs commit adds the
report + the `ARCHITECTURE.md` paragraph, with no `src/` or `test/` change.
**Last verified:** 2026-09-06 — `npm run typecheck` (4 tsc projects), `npm run lint`
(0 warnings), `npm test` (**767 passed / 66 files**), `npm run build` (web bundle
**435.98 kB JS / 110.36 kB gzip**, css 11.19 kB / 2.59 kB gzip) all green. Baseline
entering the phase: 426 tests.
**Spec:** `docs/superpowers/specs/2026-09-04-phase-4-visa-application-builder-design.md`
**Plan:** `docs/superpowers/plans/2026-09-04-phase-4-visa-application-builder.md`
**SDD ledger:** `.superpowers/sdd/2026-09-04-phase-4-visa-application-builder/progress.md`

Phase 4 turns a reusable applicant profile plus a per-application visa selection
into a deterministic **application plan**: which form sections and fields apply,
which are effective-required, which documents are needed, whether the applicant is
eligible, what is still missing, how much is human-verified, and a single
`readyForAutomation` gate. Every rule the plan surfaces carries a `source` back to
an official URL. The plan engine is a pure library with no database, HTTP, React,
filesystem or environment access. **Phase 4 ends at `readyForAutomation`** — the
"Start automation (Phase 5)" control is rendered disabled and inert with no handler
behind it. No portal automation, no form fill, no submission, no OTP / CAPTCHA / MFA.

---

## 1. What was built

### 1.1 KB v2 — the form-rules layer (`src/shared/visa-kb/`)

Migration of the Phase 1 knowledge base to schema version 2 (`meta.schemaVersion: 2`,
`KNOWN_SCHEMA_VERSIONS = [1, 2]`), adding a declarative form-rules layer alongside the
existing category / eligibility / document data.

| Piece | File | Content |
|---|---|---|
| Schema | `schema.ts` | `SOURCE_CONFIDENCE` enum (`official_verbatim` / `official_derived` / `secondary_guidance` / `community_reported`); `formConditionSchema` (9 `FormCondition` variants); `FormField` / `FormSection` / `FormModel`; `fieldRuleSchema` (+`.refine` — a `conditional` rule must carry a condition); `formRules` (`applicableSections` + `fieldRules`); `conditionalDocumentSchema` |
| Form model | `data/india/form-model.json` | The India form catalog — **11 sections / 43 fields**, each with `appliesTo` (an applicant/`application.*` field path or `null`), `standardBlock` flag, `label`, and a `source` |
| Per-category rules | `data/india/{evisa,regular}-categories.json` | All **20 real category ids** carry `formRules` (`applicableSections` baseline per mode + explicit `fieldRules`) and `conditionalDocuments` |
| Loader / queries | `loader.ts`, `queries.ts` | 6 cross-check validations run pre-freeze; `getFormModel` / `getFormSection` query helpers |

Headline category rules: `regular.transit` is genuinely minimal (4 sections, no
field rules); `regular.business` carries the 3 India-company fields required +
`india_references_min` `count: 2` (Regular-only, not on `evisa.business`);
`regular.student` / `regular.medical` carry their institution / hospital fields;
spouse fields are `applicant_married`-conditional, guardian (`father_name`) fields
are `age_lt: 18`-conditional on `regular.tourist` + `evisa.tourist.30d`.

Commits: `4a6154d` (schema v2), `130b937` + `cf8a537` (form-model + confidence-honesty
revert), `a926fb7` (20 categories' form rules).

### 1.2 The pure engine (`src/shared/application/`)

`buildApplicationPlan(input) → ApplicationPlan`, assembled from single-responsibility
pure units:

| File | Role | Commit |
|---|---|---|
| `types.ts` | `FlatApplicant`, `Selection`, `DocumentCoverage`, `BuildApplicationPlanInput`, `ApplicationPlan` and every sub-shape (`SectionPlan` / `FieldPlan` / `DocumentPlan` / `MissingItem` / `Warning` / `Blocker` / `EligibilityPlan` / `VerificationRollup`) | `e4cf526` |
| `schemas.ts` | Zod request schemas (`selectionSchema`, `applicationCreateSchema`, `applicationPutSchema`, `applicationFieldValueSchema` — the last refines `fieldPath` to `application.*` + `isValidFieldPath`) | `e4cf526` |
| `conditions.ts` | `evaluateCondition(FormCondition, ctx) → boolean \| null` — 9 variants, `true` / `false` / `null` strictly distinct, exhaustiveness `never`-checked | `63eb4b3` |
| `eligibility.ts` | `evaluateEligibility(...)` — deterministic condition evaluation (never infers ineligibility from missing data), passport-validity synthesis from `travelRequirements` when the record has no explicit condition, blocker / info warnings | `2f8ec85` |
| `formRules.ts` | `resolveFieldPlans(...)` — spec §4.3 precedence (explicit `FieldRule` > applicable-section `standardBlock` default `required` > `not_applicable`); the synthetic `india_references_min` field derived from its own `FieldRule` | `d54ac91` |
| `documentRules.ts` | `resolveDocumentPlans(...)` — required / optional / conditional doc plans, `matchDocument` (classification-kind + distinctive-token overlap), return-ticket promotion from the KB `travelRequirements.onwardOrReturnTicket` flag | `0cf2e78` |
| `buildApplicationPlan.ts` | Orchestrator: `flattenApplicant` (6 profile sections → `<section>.<camelField>` paths), `resolveValue`, `BLOCK_FIELD_PRESENCE` for the 4 `appliesTo: null` block fields, `india_references_min` count check, assembles the whole plan | `f469d13` + `1fe66aa` (block-field presence fix) |
| `readiness.ts` | `computeMissing` / `computeVerification` (both dedupe by `(sectionId, id)`) / `computeReadiness` (the 5-condition §6.6 gate) | `cf2db54` + `1fe66aa` |
| `index.ts` | Barrel re-export | `cf2db54` |

### 1.3 Persistence (`src/server/`)

- **Migration 4** (`db/migrations.ts`, `LATEST_SCHEMA_VERSION === 4`): `applicant_family`,
  `applicant_occupation`, `visa_applications`, `application_field_values`; five new
  `applicant_identity` columns (`religion`, `education`, `national_id`, `visible_marks`,
  `nationality_at_birth`). Commits `10bdf35`, and `5dde24a` (mapped the 5 new identity
  columns into `SECTION_TABLES.identity.cols` — the migration alone had left the
  extension non-functional).
- **`services/applicationService.ts`** (`6525b64`): `createApplication` (pins
  `kb_version` at create, validates category + mode/category combination),
  `listApplications`, `getApplication` (assembles `FlatApplicant` +
  `DocumentCoverage` + `applicationValues`, calls the engine, appends a stale-KB info
  warning), `updateApplication` (recomputes `draft ↔ ready` from
  `plan.readyForAutomation.ready`, never touches `archived`), `setApplicationFieldValue`,
  `deleteApplication`. No engine logic is duplicated here.
- **`services/applicantService.ts`** (`5dde24a`, `df1f2d3`): family / occupation section
  read / write / completeness wiring; `src/shared/applicant/` gains `familySchema` /
  `occupationSchema` / types / `PROFILE_FIELD_PATHS`.

### 1.4 REST (`src/server/routes/`)

- **`routes/applications.ts`** (`45cd943`) — `POST /api/applicants/:id/applications`,
  `GET /api/applicants/:id/applications`, `GET /api/applications/:id`,
  `PUT /api/applications/:id`, `PUT /api/applications/:id/field-values`,
  `DELETE /api/applications/:id`. Thin: Zod safeParse → service call → sanitized
  envelope. `mapApplicationError` maps `no_applicant` → 404, `invalid_category` → 400,
  `mode_mismatch` → 409, `invalid_field` → 400, `not_found` → 404.
- **`routes/applicants.ts`** (`c58ff56`) — the existing generic
  `PUT /api/applicants/:id` already carries family / occupation section patches
  (Task 5 extended the schema); Task 15 added coverage, zero production change.

### 1.5 Web (`src/web/`)

- **API client** (`api/client.ts`, `fc3722a`) — `createApplication`, `listApplications`,
  `getApplication`, `updateApplication`, `setApplicationFieldValue`, `deleteApplication`.
- **Applications subsection** on the applicant detail page + Family / Occupation
  section cards (`fc3722a`).
- **`/applications/:id` dashboard** — a 7-section verification/prep view:
  `VisaSelectionSection`, `EligibilitySection`, `RequiredInfoSection` (`3b1be51` +
  `a56c503`); `RequiredDocumentsSection`, `MissingInfoSection`, `VerificationSection`,
  `ReadyForAutomationSection` (`8cf1587`). `chips.tsx` status chips, `provenance.tsx`
  `SourceLine` (renders confidence as a word — "official", "derived", "guidance",
  "community" — never a bare percentage). The dashboard reads `plan.*` only; it has
  no KB-category literal and no automation code.

### 1.6 Guard tests (`test/shared/application/`, `45b16c1`)

`enginePurity.test.ts` (4), `architectureGuard.test.ts` (2), `provenanceGuard.test.ts`
(41). Plus Task 20's named acceptance suites `categories.test.ts` (14),
`conditionalRequirements.test.ts` (5), `readinessScenarios.test.ts` (5) (`03eecf5`,
`cb5e96b`).

---

## 2. The three architecture rules and how each is enforced

### Rule 1 — the plan engine is pure

`src/shared/application/**` may not import a runtime (`node:*`, `fastify`, `react`,
`react-dom`, `react-router-dom`, `better-sqlite3`), may not reach into `../server`,
and may not read `process.env` / `import.meta.env`.

**`test/shared/application/enginePurity.test.ts`** — walks every `.ts` file under
`src/shared/application/`, strips comments, and asserts none matches:

- `NODE_BUILTIN_IMPORT = /from\s+['"]node:[a-z/]+['"]|require\(\s*['"]node:[a-z/]+['"]\s*\)|import\(\s*['"]node:[a-z/]+['"]/`
- a `from '<mod>'` / `require('<mod>')` / `import('<mod>')` for each forbidden module
- `SERVER_REACH = /from\s+['"](?:\.\.\/)+server\//`
- `/\bprocess\.env\b/` and `/\bimport\.meta\.env\b/`

A first test asserts the scanned file set is non-empty (non-vacuous). All pure units
stay side-effect free; applicant-data resolution is delegated to a `resolveValue`
callback so `formRules.ts` never sees the flattening detail.

### Rule 2 — India-specific visa rules live only in the KB

The engine, the service, the REST layer and the dashboard are category-agnostic — no
hard-coded KB category-id string literal anywhere in them. Everything a consumer needs
is already on the `ApplicationPlan`.

**`test/shared/application/architectureGuard.test.ts`** — scans
`src/shared/application/**.ts`, `src/server/services/applicationService.ts`,
`src/server/routes/applications.ts`, and `src/web/src/pages/Applications/**.tsx`
(comments stripped) and asserts **zero** matches of
`CATEGORY_LITERAL = /['"](evisa|regular)\.[a-z0-9_][a-z0-9_.]*['"]/`. A first test
asserts the scanned set includes the two named server files and is ≥ 10 files
(non-vacuous). KB data files + the `visa-kb` query layer are the only place a
category id appears.

### Rule 3 — every surfaced rule carries provenance

Every `SectionPlan` / `FieldPlan` / `DocumentPlan` / `MissingItem`, every eligibility
condition, and every `Blocker` (except a pure `kind: 'warning'` blocker) carries a
`source` with a non-empty `http(s)` `officialUrl`, a `YYYY-MM-DD` `retrievedAt`, and a
`confidence ∈ SOURCE_CONFIDENCE`.

**`test/shared/application/provenanceGuard.test.ts`** — iterates `listCategories()`
and, for **every** KB category × {married-adult, minor} synthetic applicant, builds a
plan and walks every source. `assertSource` checks `officialUrl` matches
`/^https?:\/\/\S+/`, `retrievedAt` matches `/^\d{4}-\d{2}-\d{2}$/`, and
`confidence` is in the enum. `source: null` is allowed only where the spec names it:
a plan-level non-blocker warning whose text is on a 2-entry allow-list
(`/was not found in the knowledge base/i`, `/knowledge base is pinned to/i`);
`eligibility.source` only when `status === 'unknown'`; a `Blocker` only when
`kind === 'warning'`. 40 category×applicant cases (+1 non-vacuity guard), all
green — no engine or KB provenance gap surfaced.

---

## 3. Data model — migration 4

`LATEST_SCHEMA_VERSION → 4`. Table / column names are code constants, so the Phase 2
string-interpolation-safe SQL pattern holds. A fresh DB and a v3→v4 upgrade both
succeed (`test/server/applicationMigrations.test.ts` — including
`'a v3 database upgrades to v4 without data loss'` :254; `applicantMigrations.test.ts`
`'LATEST_SCHEMA_VERSION is 4'`).

| Table / column | Role |
|---|---|
| `applicant_family` | `applicant_id` PK (`ON DELETE CASCADE`); father / mother / spouse name + nationality + prev-nationality + place-of-birth; `marital_status` CHECK `IN ('single','married','divorced','widowed') OR NULL`; `pakistan_ancestry` CHECK `IN ('yes','no') OR NULL` |
| `applicant_occupation` | `applicant_id` PK (`ON DELETE CASCADE`); `occupation`, `employer_name`, `employer_address`, `designation`; `military_police` CHECK `IN ('yes','no') OR NULL` |
| `applicant_identity` +5 cols | `religion`, `education`, `national_id`, `visible_marks`, `nationality_at_birth` (all `TEXT`, added via `ALTER TABLE`) |
| `visa_applications` | `id` PK, `applicant_id` (`NOT NULL`, `ON DELETE CASCADE`), `destination` (`DEFAULT 'IND'`), `application_mode` CHECK `IN ('evisa','regular')`, `category_id`, `purpose`, `entry_type` CHECK `IN ('single','double','multiple') OR NULL`, `intended_arrival_date`, `intended_stay_days`, `port_of_arrival`, `status` CHECK `IN ('draft','ready','archived')` `DEFAULT 'draft'`, `kb_version` `NOT NULL`, timestamps. Index `idx_visa_applications_applicant`. |
| `application_field_values` | `id` PK, `application_id` (`NOT NULL`, `ON DELETE CASCADE`), `field_path`, `value`, `verified` (`0/1`, `DEFAULT 0`), `verified_at`, `source` (`DEFAULT 'manual'`), timestamps, `UNIQUE(application_id, field_path)`. Index `idx_application_field_values_app`. |

One applicant → many `visa_applications`. Per-application `application.*` values live
only in `application_field_values`; **no profile data is copied into either table**.

---

## 4. The engine contract

```
buildApplicationPlan(input: BuildApplicationPlanInput) → ApplicationPlan
```

Inputs (`types.ts`):

- `applicant: FlatApplicant` — the six 1:1 profile sections + `travel[]` +
  `references[]` + `fieldMeta[]`. Not the full `ApplicantDetail` (no
  id / displayName / status / completeness). The engine reads this object, **never
  the DB**.
- `documentCoverage: DocumentCoverage` — assembled by the service from Phase 3
  document / field-meta data: per applicant path `{ applied, verified }`, and a
  `documents[]` list. Only `status: 'applied'` fields count.
- `selection: Selection` — destination / mode / categoryId / purpose / entryType /
  intendedArrivalDate / intendedStayDays / portOfArrival.
- `applicationValues: Record<string, { value, verified }>` — the `application.*`
  field values.
- `kb: KnowledgeBase`, `now: Date`.

Output `ApplicationPlan`: `selection`, `category` (`null` iff the categoryId is not
in the KB), `eligibility`, `sections[]`, `documents[]`, `missing[]`, `verification`,
`readyForAutomation: { ready, blockers[] }`, `provenance`
(`{ kbVersion, kbRevisionDate, schemaVersion, computedAt }`), `warnings[]`.

**Pure & deterministic.** `test/shared/application/enginePurity.test.ts` asserts the
imports; `test/shared/application/buildApplicationPlan.test.ts`
`'is deterministic across two calls with the same now'` (:61) asserts
`toEqual(planB)`. The only per-call variation is `provenance.computedAt`
(`input.now.toISOString()`).

---

## 5. Condition semantics

`evaluateCondition` (`conditions.ts`) and `evaluateEligibilityCondition`
(`eligibility.ts`) both return `boolean | null` where the three states are strictly
distinct:

- `true` — evaluated and satisfied.
- `false` — evaluated and **not** satisfied. For a `FieldRule` this makes
  `effectiveRequirement: 'not_applicable'`; for an eligibility condition it enters
  `unmetConditions`.
- `null` — the engine cannot determine it: missing input, or one of the genuinely
  non-auto-evaluable types (`custom`, and the "you must confirm" eligibility types).
  Neither evaluator ever infers `false` from missing data.

For a `conditional` `FieldRule` with `conditionMet: null` (spec §11.3): `requirement`
stays `'conditional'`, `conditionMet` stays `null`, `effectiveRequirement` resolves
to `'not_applicable'` **for gating purposes only** (the gating enum has no
`'conditional'` member) — so it is **never in `missing`**, **never a blocker**, and
the UI renders it as a distinct "Review required" state, never as "not required" and
never as satisfied. Covered by `conditionalRequirements.test.ts`
`'resolves conditionMet null, stays a review item, and never gates readiness'` (:104).

---

## 6. Readiness-gate semantics (§6.6)

`computeReadiness(eligibility, missing, warnings)` → `ready === true` **iff all**:

1. `eligibility.status ∈ {'eligible', 'conditional'}`.
2. `eligibility.unmetConditions` is empty (no `conditionMet === false` condition).
3. Every `FieldPlan.effectiveRequirement === 'required'` has `present === true`
   (including the `references` minimum).
4. Every `DocumentPlan.effectiveRequirement === 'required'` has `uploaded === true`.
5. No `Warning` with `severity === 'blocker'`.

Conditions 3 & 4 are derived from `computeMissing`'s output (not re-derived), so the
`(sectionId, id)` dedupe — which the `regular.business` `references` section needs,
since `resolveFieldPlans` emits two identical `india_references_min` entries — applies
once, in one place. **`null` conditions do NOT gate** (they are review items only).
**Verification is NOT part of the gate** — the smoke below shows `ready: true` while
`verification.label === 'unverified'`; also `readinessScenarios.test.ts` and the
`applicationService` `'updateApplication recomputes status from draft to ready'` test.

---

## 7. The applicant / application boundary

| Reusable, person-level (profile) | Per-application |
|---|---|
| `applicants`, `applicant_identity` (+5 cols), `applicant_passport`, `applicant_contact`, `applicant_address`, `applicant_family`, `applicant_occupation`, `applicant_travel`, `applicant_reference`, `applicant_field_meta` | `visa_applications` (the `Selection`), `application_field_values` (the `application.*` values + their verification) |

`buildApplicationPlan` reads a `FlatApplicant` value object plus a `Selection` plus
`applicationValues` — it never opens the database. `applicationService.getApplication`
is the only place the two are joined, and it copies nothing from the profile into
`visa_applications` / `application_field_values`. A profile field and an
`application.*` field are resolved by two different code paths in `resolveValue`
(`flat[...]` vs `input.applicationValues[...]`). Acceptance item 15 (no profile data
duplicated) is a review confirmation — see the §12 table.

---

## 8. Security / PII

| Boundary | How it holds | Evidence |
|---|---|---|
| **No passport / applicant data logged** | The engine is pure and logs nothing; the service passes no field values to any logger; error envelopes are code + sanitized message only (`errorBody` / `notFoundError` / `validationError`) | `test/server/applicationRoutes.test.ts` (sanitized envelopes); engine purity test |
| **`REDACT_PATHS` extended** | `logger.ts` "Phase 4 — family/occupation" block adds `fatherName` / `father_name` / `motherName` / `mother_name` / `spouseName` / `spouse_name` / `employerName` / `employer_name` / `employerAddress` / `employer_address` / `nationalId` / `national_id` / `visibleMarks` / `visible_marks` / `nationalityAtBirth` / `nationality_at_birth` and their `*.` wildcard variants | `test/server/loggerRedaction.test.ts` — `PHASE_4_MUST_INCLUDE` list, `'redacts every family/occupation PII key we care about'` (fix `df1f2d3` closed the `*.visibleMarks` / `*.nationalityAtBirth` omission) |
| **Synthetic-only fixtures** | Every fixture applicant is invented ("RANA MITHU", "RANA / MITHU", `BG1234567`) — `test/helpers/applicationFixtures.ts`, and the smoke below | no real passport number / name / address in any test or log |
| **Phase 5 control disabled + inert** | `ReadyForAutomationSection.tsx` renders `<button type="button" className="start-automation" disabled>Start automation (Phase 5)</button>` — no `onClick` handler, verbatim helper text "Available in Phase 5. This does not submit anything, and does not mean the visa is approved." | `test/web/ApplicationDashboardPage.test.tsx` `'the Start automation (Phase 5) button is present, disabled, inert, with verbatim helper text'` (:442) — asserts `btn.disabled === true` and `btn.onclick === null`, and fires a click that, by construction, can do nothing (no post-click assertion) |
| **No Phase 5 code** | No Playwright / portal / OTP / CAPTCHA / submission / appointment / payment anywhere in the Phase 4 diff | `architectureGuard.test.ts`; controller constraint audit (ledger, Task 18 recovery) |

---

## 9. End-to-end smoke — API level

**How it was run.** `npm run build`, then the real production server against a fresh
throwaway `DATA_DIR` (`NODE_ENV=production DATA_DIR=<temp> PORT=8791 node
dist/server/index.js`; migrations ran on boot; server listened on
`127.0.0.1:8791`). A Node script drove it over HTTP with `fetch` (equivalent to the
`curl` sequence in the dispatch, more robust on Windows PowerShell) and inserted the
`documents` rows directly through a second `node:sqlite` connection to the same DB
file — the OCR pipeline is out of scope here, and this is the same hybrid-insert
technique `test/server/applicationService.test.ts` uses (`original_name` =
`<docId>.pdf` so `documentRules.matchDocument` Rule B token-matches the KB doc id).
Server killed and the temp DB dir deleted afterwards. **All assertions passed
(0 failures).**

### 9.1 `regular.business` — build to ready

| Step | Request | Result |
|---|---|---|
| Create applicant | `POST /api/applicants {displayName}` | `201`, id returned |
| Fill profile | `PUT /api/applicants/:id` with `identity` + `passport` (expiry `2030-01-01`) + `contact` + `address` + `family {maritalStatus:'married', spouseName, …}` + `occupation` | `200`; `family.maritalStatus === 'married'`, `occupation.occupation` persisted |
| Create application | `POST /api/applicants/:id/applications {applicationMode:'regular', categoryId:'regular.business'}` | `201`; response pins `kbVersion: "2026-09-03"`; `status: 'draft'` |
| Get plan (baseline) | `GET /api/applications/:id` | `200` — see assertions below |

Baseline `GET /api/applications/:id` → `plan` assertions (all PASS):

- `sections`: `business_details` **`applicable: true`**, `family` `applicable: true`,
  `occupation` `applicable: true` (and `study_details` / `medical_details`
  `applicable: false`).
- `business_details` fields `india_company_name` / `india_company_address` /
  `nature_of_business` → **`effectiveRequirement: 'required'`** and each present as
  `field:<id>` in `plan.missing`.
- `references.india_references_min` → `effectiveRequirement: 'required'`,
  `value: "0"`, **`present: false`** (0 `in_country_host` references), in `missing`,
  with a `source.officialUrl` of `https://indianvisaonline.gov.in/visa/`.
- `document:invitation_letter_indian_company` in `missing`.
- `readyForAutomation.ready === false`; blockers name "Name of company/firm/
  institution in India to be visited is required", "Address of company/firm/
  institution in India is required", "Nature of business/duration of visit is
  required", "Minimum India references met is required" (plus the standard visa
  fields and the 6 required documents).
- `eligibility.status === 'eligible'` (BGD `regular.business`, one auto-evaluable
  `passport_validity_months_min: 6` condition, met) — not blocking.

Then, over the real routes:

- `POST /api/applicants/:id/references` ×2 with `kind: 'in_country_host'` → `201` each.
- `PUT /api/applications/:id/field-values` for `application.indiaCompanyName`,
  `application.indiaCompanyAddress`, `application.natureOfBusiness`, plus the
  standard required visa fields `application.purpose`, `application.portOfArrival`,
  `application.intendedArrivalDate` (`2027-01-15`), `application.visitedIndiaBefore`
  → `200` each.

`GET` again → the 3 India-company fields and `india_references_min` now `present:
true` and **absent from `missing`**; `ready` still `false` — only the 6 required
documents remain.

- Direct-insert **only** the `invitation_letter_indian_company` document row → `GET`:
  that document clears from `missing`, `ready` still `false` (5 required documents
  remain) — proves per-document, token-matched clearing.
- Insert the other 5 required document rows (`passport`, `photo`, `application_form`,
  `sponsor_letter_bd_company`, `proof_of_business_activity`) → **final `GET`**:

```
plan.missing            = []
plan.readyForAutomation  = { ready: true, blockers: [] }      ← the flip
plan.verification        = { requiredVerified: 0, requiredTotal: 19,
                             ratio: 0, label: "unverified", bySection: {...} }
```

`ready: true` **while `verification.label === "unverified"`** — direct proof that
verification is displayed but is not part of the gate. A follow-up
`PUT /api/applications/:id {}` returned `application.status === 'ready'` — the
service recomputed the persisted status from `plan.readyForAutomation.ready`.

### 9.2 `regular.transit` — minimal

`POST /api/applicants/:id/applications {applicationMode:'regular',
categoryId:'regular.transit'}` → `201`; `GET /api/applications/:id` → `plan`:

- `sections`: `personal_particulars` / `passport_details` / `address` / `visa_details`
  `applicable: true`; **`business_details` `applicable: false`**, **`study_details`
  `applicable: false`** (also `family` / `occupation` / `previous_visits` /
  `references` / `medical_details` `applicable: false`).
- `business_details.india_company_name` → `effectiveRequirement: 'not_applicable'`,
  **not** in `missing`. No India-company / institution field is required.
- `documents`: `onward_ticket_third_country` → `requirement: 'required'`,
  `effectiveRequirement: 'required'`, `uploaded: false`, in `missing`
  (`document:onward_ticket_third_country`), `source.officialUrl`
  `https://indianvisaonline.gov.in/visa/visa-provision.html`. The transit `custom`
  eligibility condition ("confirmed onward/return ticket … 72 hours") resolves
  `conditionMet: null` → does not gate.

No assertion failed and no real defect surfaced, so the smoke is **not** BLOCKED.

---

## 10. Full gate — exact numbers

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 — 4 tsc projects (`tsconfig.server.json`, `tsconfig.web.json`, `tsconfig.test.node.json`, `tsconfig.test.web.json`) |
| `npm run lint` | exit 0 — `eslint .`, 0 warnings |
| `npm test` | **767 passed / 767** — **66 test files** (`Test Files 66 passed (66)`) |
| `npm run build` | exit 0 — `dist/web/assets/index-*.js` **435.98 kB** (gzip **110.36 kB**), `index-*.css` 11.19 kB (gzip 2.59 kB), `index.html` 0.40 kB |

Full Phases 0–3 regression is included in the 767 (baseline entering Phase 4: 426;
+341 across the phase).

---

## 11. Acceptance §12 checklist — 19 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | `typecheck` ×4, `lint`, `test`, `build` all green; full Phase 0–3 regression green | **PASS** | §10 — 4 tsc projects, lint 0-warn, 767 tests / 66 files, build OK |
| 2 | Migration 4 creates the 4 tables + 5 `applicant_identity` columns; `LATEST_SCHEMA_VERSION === 4`; fresh DB and v3→v4 both succeed | **PASS** | §3; `applicantMigrations.test.ts` (`'LATEST_SCHEMA_VERSION is 4'`, `userVersion(db) === 4` on fresh); `applicationMigrations.test.ts:254` (`'a v3 database upgrades to v4 without data loss'`) + `:33` (`LATEST_SCHEMA_VERSION === 4`) |
| 3 | An applicant can hold multiple applications; each pins `kb_version` at create | **PASS** | `applicationService.test.ts` `'two applications for the same applicant are independent'`, `'createApplication pins kb_version and defaults status to draft'`; smoke §9.1 (`kbVersion: "2026-09-03"`) + §9.2 (2nd application on the same applicant) |
| 4 | Category list, form / field / document / conditional requirements in a plan all originate from the KB — the architecture guard passes | **PASS** | §2 Rule 2 — `architectureGuard.test.ts` (zero `CATEGORY_LITERAL` matches across engine + service + routes + dashboard; scanned-set non-vacuous) |
| 5 | `buildApplicationPlan` is pure & deterministic (no DB/HTTP/React/fs/env import; a test asserts imports; same input + KB → same plan bar `computedAt`) | **PASS** | §2 Rule 1 + §4 — `enginePurity.test.ts` (4); `buildApplicationPlan.test.ts:61` `'is deterministic across two calls with the same now'` |
| 6 | Conditions: `true` / `false` / `null` distinct; unknown / `custom` → `null`, shown as review, not `false`, not blocking | **PASS** | §5 — `conditions.test.ts` (9 variants, exhaustiveness `never`-check); `conditionalRequirements.test.ts:104` |
| 7 | Eligibility deterministic; passport-validity insufficiency → unmet condition + blocker + source + not-ready, computed by the engine | **PASS** | §5–6 — `eligibility.test.ts`; `readinessScenarios.test.ts:33` (`'passport expiring inside the required validity window → unmet condition + sourced eligibility blocker + not ready'`) |
| 8 | `missing[]` generated automatically; excludes optional and unknown-conditional; every entry sourced | **PASS** | `readiness.ts` `computeMissing` (`!== 'required'` skip covers optional + `not_applicable`); `provenanceGuard.test.ts` walks `plan.missing` sources; smoke §9.1 (fields leave `missing` as filled) |
| 9 | Verification rollup works for profile + application fields; NOT part of the default readiness gate | **PASS** | §6 — `computeVerification`; smoke §9.1 (`ready: true` with `verification.label: "unverified"`); `applicationService.test.ts` `'a verify-only call does not clear the value'` |
| 10 | Provenance guard passes across every category; no `ApplicationPlan` contains an empty source | **PASS** | §2 Rule 3 — `provenanceGuard.test.ts` (40 category×applicant cases + 1 non-vacuity guard) |
| 11 | `regular.business` / `.student` / `.medical` / `.transit` / `evisa.tourist.30d` category tests pass (§11.2) | **PASS** | `categories.test.ts` (14 tests, one `describe` per category); smoke §9.1–9.2 (business + transit end-to-end) |
| 12 | Conditional tests pass: married → spouse applicable; minor → guardian applicable; unknown → `null` review | **PASS** | `conditionalRequirements.test.ts` (`:41` married→spouse required, `:55` single→not_applicable & absent from missing, `:73` minor→father_name required, `:89` adult→not forced, `:104` custom→null review) |
| 13 | Fully-populated → `ready === true, blockers === []`; remove one required field → not ready naming it; remove one required document → not ready naming it | **PASS** | `readinessScenarios.test.ts:107/:113/:130`; smoke §9.1 (full build → `{ ready: true, blockers: [] }`; and each field/document individually named in `missing`/`blockers` before it is supplied) |
| 14 | No Phase 5 code; "Start automation" control disabled and inert; a test asserts it | **PASS** | §8 — `ApplicationDashboardPage.test.tsx:442` asserts `disabled === true` and `onclick === null` (no handler; a click is fired that by construction can do nothing), verbatim helper text; `architectureGuard.test.ts`; no Playwright/portal/OTP/CAPTCHA/submission/payment in the diff |
| 15 | Applicant/Application boundary respected — no profile data duplicated into `visa_applications` / `application_field_values`; a review confirms it | **PASS** | §7 — migration 4 has no profile columns on either table; `applicationService.ts` copies nothing from the profile (create/update write only `Selection` + `application.*` values); Task 13 + Task 16 reviews (ledger) both confirmed the boundary; whole-branch review (opus) is the final confirmation |
| 16 | Structured, sanitized errors for missing applicant/application, invalid category, mode/category mismatch, invalid application field, malformed/unsourced KB, stale KB pin, DB constraint failures | **PASS** | `applicationRoutes.test.ts` (15 tests — 400 validation, 404 applicant/application, 400 `INVALID_CATEGORY`, 409 `MODE_MISMATCH`, 400 `INVALID_FIELD`, sanitized envelopes); `applicationService.test.ts` `'a stale kb_version surfaces as an info warning'`; KB loader `.strict()` union rejection + provenance cross-checks (Phase 1/Task 1). The DB-constraint sub-case has no dedicated test — it is covered by the generic sanitized-envelope path (`mapApplicationError` returns `undefined` for a non-`ApplicationServiceError`, the route `try/catch` rethrows, and `app.ts`'s `setErrorHandler` logs the real error and returns `{ error: { code: 'INTERNAL', … } }`). |
| 17 | PII: no passport numbers / full profiles / addresses / document contents / OCR text / sensitive application values in logs; redaction test extended | **PASS** | §8 — `loggerRedaction.test.ts` `PHASE_4_MUST_INCLUDE` (16 keys + `*.` variants), fix `df1f2d3`; engine logs nothing; synthetic fixtures only |
| 18 | `docs/PHASE-4-REPORT.md` exists with per-criterion evidence; `docs/ARCHITECTURE.md` gains a Phase 4 paragraph | **PASS** | this file; `ARCHITECTURE.md` §3 Phase 4 paragraph + §6 migration-4 note (this commit) |
| 19 | Whole-branch review (spec §41) passes; legitimate findings fixed; full gate re-run | **PARTIAL** | The whole-branch opus review runs **after** this task (per the plan and Task 21 brief). Everything it needs is in place: gate green (767), smoke green. Of the 25 commits, **23 had a dedicated task-review**; the 2 exceptions are Task 18 (`8cf1587` — task-review skipped by explicit user decision, diff + reconstructed report retained on disk) and Task 19 (`45b16c1` — the guard-test files, controller-executed without a separate task-review). Task 21's own review is not counted here (it is this review). Marked PARTIAL only because the whole-branch review has not yet been executed — no known blocker. |

**18 PASS, 1 PARTIAL (item 19 — the whole-branch review is the next step, not part of
this task).**

---

## 12. Deferred follow-ups (triaged)

Pulled from every `minor (deferred)` / `parked` / cross-task line in the SDD ledger.
**None is a correctness bug; none blocks merge.** The whole-branch opus review is the
gate for deciding whether any is worth a pre-merge fix.

### Behavioural / worth a look (not blocking)

- **Regular-visa KB data provenance** (carried from Phases 1 & 3). The BGD
  `regular.*` eligibility + document records carry `confidence: 'secondary_guidance'`
  and an explicit `source.notes`: *"NOT A LIVE CATEGORY FETCH … re-verify against
  hcidhaka.gov.in before operational use."* The engine surfaces this honestly (word
  "guidance" in the UI), but the underlying data should be re-verified against
  official HCI Dhaka / IVAC sources before anyone relies on a `regular.*` plan
  operationally. Data task, not a code defect.
- **Task 14 double-ask UX consideration** (carried to Tasks 17/18). The "Visa
  Selection" section (`PUT /api/applications/:id`) and the "Required information"
  list (`PUT …/field-values`) can both ask the user for `purpose` / `portOfArrival` /
  `intendedArrivalDate` / `intendedStayDays`, because the engine resolves every
  `application.*` field from `application_field_values` only, never from the
  selection (spec-mandated, design doc lines 118 + 264–265). Task 17 added a one-line
  hint; a proper bridge (selection submit also writes the 4 overlapping field-values,
  or the Required-info list renders them read-only) is a Phase 5 / polish item.
- **Task 8** — `max_age`'s `false` branch has no direct test (trivial mirror of the
  tested `min_age` branch); a test titled "max_age older → false" actually asserts
  `true` (fixture age 36 vs threshold 60). Coverage gap + misleading title.
- **Task 20** — `baseInput()` / `findField()` (~20 lines) are copy-pasted across
  `buildApplicationPlan.test.ts` + the 3 new suites; `readinessScenarios`
  re-implements the ready-true fixture. Candidates for
  `test/helpers/applicationFixtures.ts`.
- **Task 16** — `SectionCard.tsx` view mode renders the raw stored enum
  (`'married'`), not the option label (`'Married'`) — pre-existing since the Phase 2
  `sex` select, more visible now with 3 new selects. UI polish whenever
  `SectionCard.tsx` is next touched.

### Cosmetic / report-only (no action)

- Task 1 — redundant loader `appliesTo` clause (Task 5 tightened); JSON
  first-key-inline-with-brace style in 2 category files.
- Task 4 — migration 4 SQL / `applicantColumns.ts` pack multiple columns per line vs
  one-per-line elsewhere.
- Task 6 — `schemas.test.ts` "uppercase-initial segment" test name imprecise
  (rejection is real, via `startsWith('application.')`).
- Task 7 — `task-7-report.md` miscounts its own test breakdown (36 vs claimed 41);
  actual count 36 is correct.
- Task 8 — `documentType` `Set`-narrowing cast is a stylistic nit.
- Task 9 — report overstates the schema guarantee for the `india_references_min`
  missing-`count` throw (the throw is genuinely reachable, so the loud behaviour is
  right; only the characterisation is imprecise); a couple of narrower
  `resolveValue` argument assertions; the synthetic-field success test doesn't
  assert `condition` / `conditionMet` are `null` for the non-conditional case.
- Task 10 — no test for simultaneous multi-doc ticket promotion (structurally
  generic); the promotion pass mutates the plans array in place vs the `.push()`
  style elsewhere.
- Task 11 — provenance object duplicated between two branches; test 1's
  document-count assertion uses `>=` not exact length. The parked
  duplicate-`india_references_min`-FieldPlan-id item was **resolved in Task 12**
  (`readiness.ts` `uniqueFields` dedupes by `(sectionId, id)` in both
  `computeMissing` and `computeVerification`; `readiness.test.ts:231`).
- Task 12 — `index.ts` barrel collision-freedom was confirmed clean once Task 13
  consumed it; `ELIGIBILITY_STATUS_TEXT` takes the whole `EligibilityPlan` though 2
  of 3 branches ignore it.
- Task 13 — `updateApplication` calls `getApplication` twice per invocation (matches
  the dispatch's specified pattern); single-row vs array cast style asymmetry.
- Task 14 — file-size note; a combined test split into 3 `it` blocks (better
  hygiene).
- Task 15 — test 3 doesn't also assert unrelated sections stay untouched (covered by
  an existing cross-section test).
- Task 16 — shared structural boilerplate between `ApplicationsSubsection` and
  `DocumentsSubsection` not extracted (appropriately shallow "same shape, different
  content" similarity); the `creating` state is not reset on the success path
  (harmless — `navigate()` unmounts the component; same pattern in
  `DocumentsSubsection`).
- Task 17 — `humanize()` local helper; chip label casing vs lowercase tokens;
  `task-17-report.md:28` stale prose.
- Task 20 — a renamed test title slightly broader than its body (comment scopes it).

---

## 13. Recommended Phase 5 scope

**Browser automation — portal form-fill up to a user-controlled submit.**

1. **Portal adapters.** Per-portal (`indianvisaonline.gov.in` e-Visa,
   `indianvisa-bangladesh.nic.in` / IVAC Regular) adapters over the Phase 0
   `PortalAdapter` interface + Playwright engine — page object / selector maps kept
   out of `shared/` and out of the KB.
2. **Field-plan → form-fill mapping.** Consume `ApplicationPlan.sections[].fields[]`
   (each already carries `appliesTo`, `value`, `effectiveRequirement`) and map
   `appliesTo` → the portal field. The plan is the single source of what to type;
   the adapter owns only *where*.
3. **Security checkpoints — hard stops.** Pause and hand control to the user on OTP,
   CAPTCHA, MFA, any payment step, and the final submit. No anti-bot bypass, no
   auto-solve, no stored portal credentials.
4. **User-controlled submission.** The tool fills and reviews; a human clicks submit.
   `readyForAutomation.ready` gates whether fill can *start*, not whether anything is
   *sent*.
5. **Keep every Phase 0–4 boundary:** loopback only, PII never logged, synthetic
   fixtures, no chip/NFC, no external OCR, sanitized errors.

Still open before operational use (independent of Phase 5): re-verify the Phase 1
`regular.*` KB data against official HCI Dhaka / IVAC sources.

---

## 14. Commits

`4a6154d` schema v2 · `130b937` form-model · `cf8a537` confidence-honesty revert ·
`a926fb7` 20 categories' form rules · `10bdf35` migration 4 · `5dde24a` family/
occupation sections + identity ext · `df1f2d3` redaction wildcards · `e4cf526`
shared types + schemas · `63eb4b3` condition evaluator · `2f8ec85` eligibility ·
`d54ac91` form-rule resolver · `0cf2e78` document-rule resolver · `f469d13`
buildApplicationPlan · `cf2db54` + `1fe66aa` missing / verification / readiness (+
block-field presence fix) · `6525b64` applicationService · `45cd943` application
routes · `c58ff56` applicant family/occupation route coverage · `fc3722a` web client
+ Applications subsection · `3b1be51` + `a56c503` dashboard A · `8cf1587` dashboard B ·
`45b16c1` guard tests · `03eecf5` + `cb5e96b` category / conditional / eligibility /
readiness suites · **this commit** — `docs: Phase 4 report`.
