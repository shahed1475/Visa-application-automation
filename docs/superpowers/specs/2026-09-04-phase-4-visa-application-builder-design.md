# Phase 4 — India Visa Application Builder

**Date:** 2026-09-04
**Status:** Approved (design + master implementation instruction + acceptance criteria)
**Project:** Visa Application Autofill (local-first)
**Builds on:** Phase 0 (portal settings, app skeleton) / Phase 1 (India visa knowledge base) /
Phase 2 (applicant profile system, `applicant_field_meta` provenance & verification) /
Phase 3 (passport OCR & document extraction, `document_fields` verification).

**Related documents:**
- Master implementation instruction: the user message that approved this design (43 numbered sections). Where this spec and that instruction differ, **the instruction governs** unless a deviation is explicitly recorded here.
- Foundation architecture: `docs/ARCHITECTURE.md`; per-phase reports `docs/PHASE-1..3-REPORT.md`.
- Implementation plan: `docs/superpowers/plans/2026-09-04-phase-4-visa-application-builder.md` (written next).

---

## 1. Purpose & scope

Build the **per-applicant × visa-selection application preparation system**:

```
Applicant profile + Family + Occupation + Travel + References + Documents
+ a selected India visa category + the versioned India Visa Knowledge Base
        ↓  buildApplicationPlan(input)  — deterministic, pure
   Application Preparation Dashboard:
     Visa selection → Eligibility/Warnings → Required information →
     Required documents → Missing information → Verification → Ready-for-Automation gate
```

### In scope

1. **KB schema v2** — a form-requirements layer: a canonical section catalog, per-field metadata, per-category `formRules`, a declarative condition system, conditional documents, and `source.confidence` on every source entry.
2. **migration 4** — extend the applicant profile with `applicant_family` + `applicant_occupation` + five `applicant_identity` columns (person-level, reused across applications, via the Phase 2 section machinery); add `visa_applications` + `application_field_values` (trip-level).
3. **The engine** — `src/shared/application/` — `buildApplicationPlan(input) → ApplicationPlan`. Pure, deterministic, no I/O, no React, no env. A generic KB interpreter; contains **no India-specific rules**.
4. **`applicationService.ts`** + `routes/applications.ts` — CRUD, field-value updates, plan assembly; extend `applicantService` / `PUT /api/applicants/:id` for the new sections.
5. **Web** — `/applications/:id` (the 7-section dashboard), a "New application" flow, an "Applications" subsection + `family` / `occupation` SectionCards on `/applicants/:id`.
6. **Comprehensive category-specific tests** + a machine-enforced provenance guard across **every** category.

### Out of scope — hard boundaries (Phase 5, do NOT implement)

Playwright / portal automation, portal login, OTP / CAPTCHA handling, automatic form submission, appointment booking, payment, anti-bot bypass, browser autofill, automated submission. **Phase 4 ends at `readyForAutomation`.** The "Start automation (Phase 5)" control is rendered **disabled and inert** — no automation code behind it.

### Deferred (not this phase)

Multi-applicant / family applications; fee calculation; reproducing the full ~70-field India form as inputs (Phase 4 models the differentiating/gating subset + "standard block" requirements); promoting `application_field_values` answers back to the profile; destinations other than India / nationalities other than Bangladesh (the engine is built to generalize; the data is IND × BGD).

---

## 2. Core architecture rule — the engine is pure

`src/shared/application/` — the engine. `buildApplicationPlan(input): ApplicationPlan`.

**No** database access · **no** HTTP · **no** browser APIs · **no** React · **no** filesystem · **no** env-var dependency · **no** network. It receives everything as `input`.

**Deterministic:** the same `input` + the same KB version produces the same `ApplicationPlan`, except for explicitly-documented computed fields: `provenance.computedAt` (an ISO timestamp), and any relative-date evaluation which the caller pins by passing `now` in the input (defaulting to `new Date()` only when absent — tests always pass `now`).

Layering (mirrors Phases 2/3): `src/shared/**` pure (Zod allowed, nothing else), compiled by every tsconfig; the web bundle imports only **types** + the KB query functions it already uses; `src/server/**` is Node-only.

---

## 3. India-specific rules live in the KB, never in code

The engine is a **generic KB interpreter** that Phase 5 and future portals reuse unchanged. It is a spec violation to write, anywhere in `applicationService.ts`, a React component, a REST route, the condition evaluator, or the document matcher:

```ts
if (categoryId === 'regular.business') { …India-specific… }
```

The KB carries: `formModel`, `formRules`, `conditions`, `requiredDocuments` / `optionalDocuments` / `conditionalDocuments`, `eligibility`, and a `source` on every rule-bearing node. The engine **interprets** that data. Category-specific behaviour is category-specific **data**.

A test (§11.4) greps the engine + service + routes + components for a category-id string literal and fails on any match outside the KB data files and the KB query layer.

---

## 4. KB schema v2 (`src/shared/visa-kb/`)

`meta.schemaVersion` → **2**. `KNOWN_SCHEMA_VERSIONS = [1, 2] as const` (the loader keeps rejecting anything else; the shipped data is v2 only).

### 4.1 `sourceConfidence` — on every source

```ts
export const SOURCE_CONFIDENCE = ['official_verbatim', 'official_derived', 'secondary_guidance', 'unverified'] as const;
// sourceSchema gains:  confidence: z.enum(SOURCE_CONFIDENCE)
```
**Every existing `source` object** in `evisa-categories.json`, `regular-categories.json`, `eligibility.bgd.json` gets a `confidence` value (mostly `official_derived` / `secondary_guidance` — matching the honest provenance already documented in `SOURCES.md`; the hcidhaka-sourced Regular records are `secondary_guidance`). This closes the Phase 1 deferred `sourceConfidence` follow-up.

### 4.2 `formModel` — top-level, in `knowledgeBaseSchema`

```ts
formModel: {
  sections: FormSection[]
}

FormSection = {
  id: string            // snake_case slug — 'personal_particulars' | 'passport_details' | 'address'
                        //   | 'family' | 'occupation' | 'visa_details' | 'previous_visits' | 'references'
                        //   | 'business_details' | 'study_details' | 'medical_details'
  label: string
  fields: FormField[]
  source: Source
}

FormField = {
  id: string            // snake_case slug, unique within its section
  label: string
  appliesTo: string | null   // an applicant field_path ('identity.surname', 'family.fatherName',
                             //   'occupation.employerName'), an application field_path
                             //   ('application.indiaCompanyName'), or null (informational only)
  dataType: 'text' | 'long_text' | 'date' | 'enum' | 'boolean' | 'country'
  standardBlock: boolean      // true  → part of a section's standard block (satisfied when its
                             //         mapped profile fields are present; not individually gating)
                             // false → a differentiating / gating field
  enumValues?: string[]       // when dataType === 'enum'
  source: Source
}
```

- **`appliesTo` mapping.** A profile path resolves against the flattened applicant view (`identity.*`, `passport.*`, `contact.*`, `address.*`, `family.*`, `occupation.*`). An `application.*` path resolves against `application_field_values`. `references` requirements are expressed as a section-level rule, not a field path (see §6.3).
- `FormField.id` values are stable — an application's stored `application_field_values.field_path` (`application.<fieldId>`) must keep resolving across KB revisions.

### 4.3 `formRules` — on every `visaCategory`

```ts
formRules: {
  applicableSections: string[]     // FormSection ids that apply to this category
  fieldRules: FieldRule[]          // category-specific deltas
}

FieldRule = {
  sectionId: string
  fieldId: string
  requirement: 'required' | 'conditional' | 'optional' | 'not_applicable'
  condition?: FormCondition        // present iff requirement === 'conditional'
  count?: number                   // for a count-based requirement (e.g. sectionId 'references',
                                   //   fieldId 'india_references_min', count: 2)
  source: Source
  notes?: string
}
```

**Effective-requirement resolution (the engine):**
1. If a `FieldRule` names `(sectionId, fieldId)` → its `requirement` is the base. For `conditional`, evaluate `condition` (§5): met → `required`, not met → `not_applicable`, `null` (unknown) → `conditional` stays and `conditionMet: null` — the field is shown as "review required", is **not** added to `missing`, and does **not** block readiness on its own.
2. Else if the field's `sectionId ∈ applicableSections`:
   - `field.standardBlock === true` → base `required`
   - `field.standardBlock === false` → base `optional`
3. Else → `not_applicable`.

`applicableSections` establishes the standard-block requirements; `fieldRules` is the short delta list (make a standard field conditional/optional, require a differentiating field, pull a field in from an otherwise-not-applicable section).

### 4.4 Conditional documents

Each `visaCategory` gains `conditionalDocuments: ConditionalVisaDocument[]` where
`ConditionalVisaDocument = VisaDocument & { condition: FormCondition; source: Source }`.
`requiredDocuments` / `optionalDocuments` keep their current shape; the category's own `source` covers them, but the engine attaches it to each `DocumentPlan`. A `conditionalDocument` whose condition is `null` → `DocumentPlan` with `conditionMet: null`, shown as "review required", not in `missing`, not a blocker.

### 4.5 `FormCondition` — declarative, evaluated by the engine

```ts
FormCondition =
  | { type: 'purpose_in';        value: PurposeTag[] }
  | { type: 'entry_type_in';     value: EntryType[] }
  | { type: 'applicant_married' }
  | { type: 'visited_india_before' }
  | { type: 'age_lt';            value: number }   // years, at intended arrival (or now)
  | { type: 'age_gte';           value: number }
  | { type: 'stay_days_gt';      value: number }
  | { type: 'sub_category_is';   value: string }
  | { type: 'custom';            text: string }    // never auto-evaluable → always conditionMet: null
```

No executable code in the KB — conditions are data. The v1 `conditionSchema` (eligibility conditions) is unchanged; `FormCondition` is a **separate** union for the application context.

---

## 5. Condition evaluator (`src/shared/application/conditions.ts`)

`evaluateCondition(cond: FormCondition, ctx: ConditionContext): boolean | null`

`ConditionContext` = `{ applicant: FlatApplicant; selection: Selection; applicationValues: Record<string, { value: string | null; verified: boolean }>; category: VisaCategory; now: Date }`.

| `type` | evaluation |
|---|---|
| `purpose_in` | `selection.purpose != null && value.includes(selection.purpose)` ; `selection.purpose == null` → **`null`** |
| `entry_type_in` | `selection.entryType != null && value.includes(selection.entryType)` ; null selection → `null` |
| `applicant_married` | `family.maritalStatus === 'married'` → `true`; `'single'|'divorced'|'widowed'` → `false`; `null` → **`null`** |
| `visited_india_before` | `applicationValues['application.visitedIndiaBefore']` ∈ `{'yes','no'}` → bool; absent → `null` |
| `age_lt` / `age_gte` | needs `identity.dateOfBirth`; compare against `selection.intendedArrivalDate ?? now`; missing DOB → `null` |
| `stay_days_gt` | `selection.intendedStayDays != null` → `> value`; null → `null` |
| `sub_category_is` | `category.subCategory === value || category.id === value` (deterministic from the KB, never `null`) |
| `custom` | always **`null`** |

**`true` = evaluated and satisfied. `false` = evaluated and not satisfied. `null` = the engine cannot determine it.** These are never conflated. `null` is not `false`.

---

## 6. The engine — `buildApplicationPlan(input): ApplicationPlan`

### 6.1 Input

```ts
BuildApplicationPlanInput = {
  applicant: FlatApplicant;         // identity, passport, contact, address, family, occupation,
                                    //   travel: TravelRecord[], references: Reference[], fieldMeta: FieldMeta[]
  documentCoverage: DocumentCoverage;   // from Phase 3: per-fieldPath { applied, verified } + uploaded docs
                                        //   [{ id, kind, originalName, fields: { fieldPath, verified }[] }]
  selection: Selection;             // { destination, applicationMode, categoryId, purpose?, entryType?,
                                    //   intendedArrivalDate?, intendedStayDays?, portOfArrival? }
  applicationValues: Record<string, { value: string | null; verified: boolean }>;  // application.* answers
  kb: KnowledgeBase;
  now: Date;
}
```

### 6.2 Output — `ApplicationPlan`

```ts
ApplicationPlan = {
  selection: Selection;
  category: { id; displayName; applicationMode; officialCode; subCategory; validity; entries;
              stayLimitations; extendable; convertible } | null;   // null iff categoryId not in KB
  eligibility: EligibilityPlan;
  sections: SectionPlan[];
  documents: DocumentPlan[];
  missing: MissingItem[];
  verification: VerificationRollup;
  readyForAutomation: { ready: boolean; blockers: Blocker[] };
  provenance: { kbVersion: string; kbRevisionDate: string; schemaVersion: number; computedAt: string };
  warnings: Warning[];              // plan-level (e.g. stale KB pin, category not in KB)
}

EligibilityPlan = {
  status: 'eligible' | 'conditional' | 'ineligible' | 'not_offered' | 'unknown';
  reason?: string;                                  // when status === 'unknown'
  conditions: EligibilityConditionView[];           // each { condition, conditionMet: true|false|null, text, source }
  unmetConditions: EligibilityConditionView[];      // subset where conditionMet === false
  warnings: Warning[];
  basis: string | null;
  source: Source | null;                            // the eligibility record's source (null only when status 'unknown')
}

SectionPlan = { id; label; applicable: boolean; source: Source; fields: FieldPlan[] }
FieldPlan   = { id; label; sectionId;
                requirement: 'required'|'conditional'|'optional'|'not_applicable';
                condition: FormCondition | null;
                conditionMet: boolean | null;
                effectiveRequirement: 'required'|'optional'|'not_applicable';
                appliesTo: string | null;
                value: string | null; present: boolean; verified: boolean;
                source: Source }
DocumentPlan = { id; label;
                requirement: 'required'|'optional'|'conditional';
                condition: FormCondition | null; conditionMet: boolean | null;
                effectiveRequirement: 'required'|'optional'|'not_applicable';
                uploaded: boolean; matchedDocumentId: string | null;
                source: Source }
MissingItem  = { kind: 'field'|'document'; id; label; sectionId?: string; appliesTo?: string | null;
                source: Source }
Warning      = { text: string; severity: 'info'|'warn'|'blocker'; source: Source | null }
Blocker      = { text: string; kind: 'eligibility'|'field'|'document'|'warning'; source: Source | null }
VerificationRollup = { requiredVerified: number; requiredTotal: number; ratio: number;
                       label: 'unverified'|'partial'|'verified'; bySection: Record<string, {verified;total}> }
```

- **`present`** — a field's value is non-null and non-blank. For a profile-mapped field, from `FlatApplicant`; for an `application.*` field, from `applicationValues`.
- **`verified`** — profile field: any `fieldMeta` row for that `field_path` with `verified === true` (Phase 2), OR Phase 3 `documentCoverage[fieldPath].verified`. Application field: `applicationValues[path].verified`.
- **Document matching** — a `DocumentPlan` is `uploaded` when an uploaded doc's `kind` or `originalName`/label heuristically matches the KB doc `id`/`label`; `matchedDocumentId` names it. The match is a documented, generic heuristic (id-token overlap) — **not** a per-category `if`.
- `references` requirement (§6.3) surfaces as a synthetic `SectionPlan` (`id: 'references'`) whose `fields` describe "≥ N India references (`kind='in_country_host'`)" as a `FieldPlan`-like row; `present` = count of matching `Reference` rows ≥ N.

### 6.3 `references` minimum

A category may carry `formRules.fieldRules` with `sectionId: 'references'`, `fieldId: 'india_references_min'`, `requirement: 'required'`, `count: N`. The engine counts `applicant.references` with `kind === 'in_country_host'`, sets the synthetic `FieldPlan.present` to `count ≥ N`, and emits a `MissingItem` / `Blocker` ("N India references required, M provided") when short — the `Source` is the `FieldRule.source`.

### 6.4 Eligibility — deterministic, auto-evaluate what is safe

`checkEligibility(nationality, mode, categoryId)` (Phase 1) gives the record. The engine then evaluates each **eligibility** `condition` (v1 `conditionSchema`) it can:

| eligibility condition | auto-check |
|---|---|
| `passport_validity_months_min` | passport `expiryDate` ≥ (`intendedArrivalDate ?? now`) + N months → `true`/`false`; missing expiry or arrival → `null` (**not** `false`) |
| `min_age` / `max_age` | from `identity.dateOfBirth` vs `intendedArrivalDate ?? now`; missing DOB → `null` |
| `purpose_in` / `purpose_not_in` | `selection.purpose`; null → `null` |
| `passport_type_in` / `passport_type_not_in` | `passport.documentType` rarely maps cleanly (MRZ gives `'P'`) → `null` unless an explicit type is set |
| `no_prohibited_background`, `not_endorsed_on_relative_passport`, `requires_supporting_institution_letter`, `salary_min_inr_per_annum`, `custom` | not auto-evaluable → `conditionMet: null`, surfaced as **"you must confirm: <text>"** with the eligibility record's source |

**Do not infer eligibility from missing data.** A `null` condition never makes the applicant ineligible and never blocks readiness by itself.

### 6.5 Passport validity (spec §13)

Where any rule (a category `travelRequirements.passportValidityMonthsMin`, or an eligibility `passport_validity_months_min`) defines a minimum, the engine computes it against `intendedArrivalDate` (falling back to `now`) and `passport.expiryDate`. If insufficient → the eligibility condition is `conditionMet: false` → it enters `unmetConditions` → a `Blocker { kind: 'eligibility' }` with the rule's `source`. Never done in the UI.

### 6.6 `readyForAutomation`

`ready === true` **iff all** of:
1. `eligibility.status ∈ {'eligible', 'conditional'}` (not `ineligible` / `not_offered` / `unknown`)
2. no `eligibility.unmetConditions` (i.e. no `conditionMet === false` eligibility condition)
3. every `FieldPlan.effectiveRequirement === 'required'` has `present === true` (including the `references` minimum)
4. every `DocumentPlan.effectiveRequirement === 'required'` has `uploaded === true`
5. no `Warning` with `severity === 'blocker'`

**Unknown/`custom` conditions alone do NOT block** — they appear as review items only. **Verification is displayed but is NOT part of the default gate** (Phase 3 philosophy). Each `Blocker` carries a `source` when one applies (eligibility/field/document blockers → the KB source; a pure warning blocker → its source or `null`).

`readyForAutomation` does **not** mean the visa is approved / guaranteed / legally certain / submitted — only that the local preparation data meets the configured automation prerequisites. The UI states this verbatim.

---

## 7. Data model — migration 4

### 7.1 Extend the applicant profile (person-level)

```sql
CREATE TABLE applicant_family (
  applicant_id            TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
  father_name TEXT, father_nationality TEXT, father_prev_nationality TEXT, father_place_of_birth TEXT,
  mother_name TEXT, mother_nationality TEXT, mother_prev_nationality TEXT, mother_place_of_birth TEXT,
  marital_status TEXT CHECK (marital_status IN ('single','married','divorced','widowed') OR marital_status IS NULL),
  spouse_name TEXT, spouse_nationality TEXT, spouse_prev_nationality TEXT, spouse_place_of_birth TEXT,
  pakistan_ancestry TEXT CHECK (pakistan_ancestry IN ('yes','no') OR pakistan_ancestry IS NULL)
);
CREATE TABLE applicant_occupation (
  applicant_id     TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
  occupation TEXT, employer_name TEXT, employer_address TEXT, designation TEXT,
  military_police TEXT CHECK (military_police IN ('yes','no') OR military_police IS NULL)
);
ALTER TABLE applicant_identity ADD COLUMN religion TEXT;
ALTER TABLE applicant_identity ADD COLUMN education TEXT;
ALTER TABLE applicant_identity ADD COLUMN national_id TEXT;
ALTER TABLE applicant_identity ADD COLUMN visible_marks TEXT;
ALTER TABLE applicant_identity ADD COLUMN nationality_at_birth TEXT;
```

`SECTION_TABLES` gains `family` + `occupation` entries; `createApplicant` inserts the two new satellite rows; `assembleDetail` / `readSection` / `writeSection` / completeness / verification all extend by data, not new mechanism. `ApplicantDetail` gains `family: Family` + `occupation: Occupation`; new Zod section schemas mirror the Phase 2 pattern (`nstr`, `blankToNull`, enums). `PROFILE_SECTIONS` gains `family` / `occupation` entries for completeness. Logger `REDACT_PATHS` gains the new PII keys (`fatherName`, `motherName`, `spouseName`, `employerName`, `employerAddress`, `nationalAtBirth`, `nationalId`, `visibleMarks`, …).

### 7.2 Application (trip-level)

```sql
CREATE TABLE visa_applications (
  id                    TEXT PRIMARY KEY,
  applicant_id          TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  destination           TEXT NOT NULL DEFAULT 'IND',
  application_mode      TEXT NOT NULL CHECK (application_mode IN ('evisa','regular')),
  category_id           TEXT NOT NULL,                 -- KB category id; validated in the service, NOT an FK
  purpose               TEXT,                          -- a PurposeTag
  entry_type            TEXT CHECK (entry_type IN ('single','double','multiple') OR entry_type IS NULL),
  intended_arrival_date TEXT,
  intended_stay_days    INTEGER,
  port_of_arrival       TEXT,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','archived')),
  kb_version            TEXT NOT NULL,                  -- pinned at create time (meta.kbVersion)
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_visa_applications_applicant ON visa_applications(applicant_id);

CREATE TABLE application_field_values (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
  field_path     TEXT NOT NULL,        -- 'application.<fieldId>' — validated against isValidFieldPath
  value          TEXT,
  verified       INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  verified_at    TEXT,
  source         TEXT NOT NULL DEFAULT 'manual',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (application_id, field_path)
);
CREATE INDEX idx_application_field_values_app ON application_field_values(application_id);
```

`LATEST_SCHEMA_VERSION` → 4.

### 7.3 Applicant / Application boundary (spec §11)

| Applicant (person-level, reusable) | Application (trip-level, per-selection) |
|---|---|
| identity, passport, contact, address, **family**, **occupation** | visa category, purpose, entry type, intended dates, arrival port |
| travel records, references (incl. `in_country_host` = India ref) | application-specific field values + their verification |
| — | application status, pinned `kb_version` |

One applicant → many applications. **Never** copy profile data into an application. `status` transitions `draft → ready` are set by the service from `plan.readyForAutomation.ready` on save (informational; `archived` is user-set).

---

## 8. Provenance — a hard invariant (spec §8, §32)

**Every** node in an `ApplicationPlan` that represents a rule decision carries a non-empty `Source` with `officialUrl` (http(s)), `retrievedAt` (ISO date), and `confidence` (one of the four values):
`SectionPlan.source`, `FieldPlan.source`, `DocumentPlan.source`, every `Warning.source` *(except plan-level warnings the engine itself raises about the pin/KB state, which may be `null` and are labelled as such)*, `eligibility.source` (null only for `status: 'unknown'`), each `EligibilityConditionView.source`, each `MissingItem.source`, each `Blocker.source` where one applies.

A **machine-enforced test** iterates **every category in the KB** (`listCategories()`), builds a plan for a representative applicant (a single fully-populated synthetic `FlatApplicant` + `Selection` fixture, reused across all categories, with married status + a minor variant so conditional branches are exercised), and asserts every sourced node has a valid non-empty source. It fails if a future KB category introduces an unsourced rule. Sources originate in the KB (`FormSection.source`, `FieldRule.source`, `FormField.source`, category `source`, eligibility `source`) — the engine only propagates them.

---

## 9. Server

### 9.1 `applicationService.ts` (`src/server/services/`)

```ts
createApplication(db, applicantId, input): VisaApplicationSummary        // pins kb_version; validates categoryId ∈ KB
listApplications(db, applicantId?): VisaApplicationSummary[]
getApplication(db, id): { application: VisaApplication; plan: ApplicationPlan } | null
updateApplication(db, id, patch): { application; plan } | null           // selection + trip columns; recomputes status
setApplicationFieldValue(db, id, fieldPath, { value?, verified? }): { application; plan } | null
deleteApplication(db, id): boolean
```

`getApplication` assembles the engine input from the DB (applicant detail incl. family/occupation, travel, references, `fieldMeta`, Phase 3 document coverage via `documentService.getDocument`/`listDocuments`, `application_field_values`, `loadKnowledgeBase()`, `now = new Date()`) and calls `buildApplicationPlan`. **No engine logic in the service.** `class ApplicationServiceError extends Error { code: 'not_found' | 'no_applicant' | 'invalid_category' | 'mode_mismatch' | 'invalid_field' }`.

### 9.2 REST (`routes/applications.ts`)

| Method | Route | |
|---|---|---|
| `POST` | `/api/applicants/:id/applications` | `{ applicationMode, categoryId, purpose?, entryType?, ... }` → `201 { application }` |
| `GET` | `/api/applicants/:id/applications` | `{ applications: VisaApplicationSummary[] }` |
| `GET` | `/api/applications/:id` | `{ application, plan }` |
| `PUT` | `/api/applications/:id` | selection/trip patch → `{ application, plan }` |
| `PUT` | `/api/applications/:id/field-values` | `{ fieldPath, value?, verified? }` → `{ application, plan }` |
| `DELETE` | `/api/applications/:id` | `{ deleted: true }` |

Extend `PUT /api/applicants/:id` to accept `family` / `occupation` section patches (Phase 2 pattern). All errors via `routes/errors.ts` (sanitized envelope). `invalid_category` / `mode_mismatch` → 400/409; `not_found` → 404. `kb_version` pinned on create; a later GET whose `application.kb_version !== meta.kbVersion` adds a plan-level `Warning { severity: 'info', text: 'plan computed against KB <pinned>; current KB is <current>', source: null }` — historical applications are not silently reinterpreted; the plan is always computed against the **current** KB but the divergence is surfaced.

---

## 10. Web

### 10.1 `/applications/:id` — the preparation dashboard

One scrollable page. Seven anchored sections, each with a **status chip** (`ok` / `attention` / `blocked` / `review`):

1. **Visa selection** — mode → category (`listCategories` / `listEligibleCategories` from the KB module; never a hard-coded list), purpose, entry type, intended arrival date, intended stay, port of arrival. `PUT /api/applications/:id`.
2. **Eligibility** — status badge; each condition with met (✓) / unmet (✗) / review (?) + a source link; `warnings` with severity + source.
3. **Required information** — the engine's `SectionPlan[]`. Profile-mapped fields show the current value + an "Edit in profile" link (no duplicate editing UI — routes to the applicant page section / opens the SectionCard). Application-scoped fields get an inline input → `PUT /api/applications/:id/field-values`.
4. **Required documents** — `DocumentPlan[]`: required/optional/conditional, uploaded/not, matched doc name, source. Upload control **reuses Phase 3** (`api.uploadDocument` + link to `/documents/:id`).
5. **Missing information** — the flat `missing[]`; each item: what, field-or-document, where it belongs (anchor link), source.
6. **Verification** — `verification` rollup; per-field verify reuses Phase 2 `field-meta` verify for profile fields and `PUT /field-values { verified: true }` for application fields. Never silently verify.
7. **Ready for automation** — `ready` / not; each blocker with its source; a large **`Start automation (Phase 5)` button rendered `disabled`** with helper text "Available in Phase 5. This does not submit or approve anything." No handler, no automation code.

### 10.2 `/applicants/:id`

- New **Applications** subsection (list: category, mode, status, readiness, `kb_version`, created date; "New application" → `POST` → navigate to `/applications/:id`). Mirrors the Documents subsection.
- New **Family** and **Occupation** `SectionCard`s (reuse the Phase 2 component + its verify flow).
- Existing Documents / Identity / Passport / Contact / Address / Travel / References unchanged.

### 10.3 `api/client.ts`

`createApplication`, `listApplications`, `getApplication`, `updateApplication`, `setApplicationFieldValue`, `deleteApplication`; extend the applicant `PUT` typing for `family` / `occupation`.

---

## 11. Testing (TDD; keeps the gate green; ~150+ new tests)

### 11.1 Unit (pure — `test/shared/application/**`, `test/shared/visaKb/**`)

- **condition evaluator** — every `FormCondition` type: `true` / `false` / `null` cases, esp. that `null` is never `false` (`purpose` unset → `null`; `custom` → always `null`; missing DOB → `age_*` → `null`).
- **eligibility evaluator** — passport-validity math vs `intendedArrivalDate`; `min_age`/`max_age`; `purpose_in`; the non-auto-evaluable conditions → `null` + "you must confirm" view; **never infer ineligible from missing data**.
- **field-rule resolution / effective requirement** — the §4.3 table: explicit rule, applicable-section standard-block default, non-standard default, not-applicable; conditional met/unmet/`null` mapping.
- **document-rule resolution** — required/optional/conditional; conditional `null` → not missing, not blocker; match heuristic.
- **missing-information** — only effective-required-absent items; excludes optional; excludes `conditionMet: null`.
- **verification rollup** — required-only counting; profile + application fields; `bySection`.
- **readiness gate** — the five conditions of §6.6; verification NOT gating; `null` conditions NOT gating.

### 11.2 Category-specific (the headline — spec §29)

- **`regular.business`** → `business_details` + `family` + `occupation` sections applicable; `application.indiaCompanyName`, `application.indiaCompanyAddress`, `application.natureOfBusiness` effective-required; `references` min (per KB `notes: 'min:2'`) → 2 `in_country_host` references required; `invitation_letter_indian_company` document effective-required.
- **`regular.student`** → institution name / address / course effective-required; admission-letter document required.
- **`regular.medical`** → hospital name / address effective-required; medical-documentation document required.
- **`regular.transit`** → minimal; onward-ticket document effective-required; `business_details` / `study_details` sections **not applicable**; no India-company / institution fields required.
- **`evisa.tourist.30d`** → light document set; when the `conditionalDocuments` onward/return-ticket condition (or the category `travelRequirements.onwardOrReturnTicket`) is satisfied → the return-ticket `DocumentPlan.effectiveRequirement === 'required'`.

### 11.3 Conditional (spec §30)

- `family.maritalStatus === 'married'` → spouse `FieldPlan`s `effectiveRequirement === 'required'`; `'single'` → `not_applicable`.
- `age_lt: 18` (DOB such that age < 18 at arrival) → guardian fields applicable; age ≥ 18 → not required.
- A `custom` / unknown condition → `conditionMet: null`, `effectiveRequirement` stays `conditional`, **not** in `missing`, **not** a blocker, rendered "Review required — the app cannot determine this."

### 11.4 Eligibility / passport validity (spec §31)

- Passport `expiryDate` within `passportValidityMonthsMin` of `intendedArrivalDate` → eligibility condition `conditionMet: false` → `unmetConditions` non-empty → a `Blocker { kind: 'eligibility' }` with source → `readyForAutomation.ready === false`. Computed by the **engine**, asserted on the plan object (not via React).

### 11.5 Provenance guard (spec §32) — across EVERY category

Iterate `listCategories()`; for each, `buildApplicationPlan` with a representative applicant; assert every `SectionPlan`/`FieldPlan`/`DocumentPlan`/`Warning`(non-plan-level)/`eligibility`/`EligibilityConditionView`/`MissingItem`/`Blocker`(where applicable) has `source.officialUrl` (non-empty http(s)), `source.retrievedAt` (ISO date), `source.confidence` ∈ the four values.

### 11.6 Ready-for-automation (spec §33)

Fully-populated verified `regular.tourist` applicant + application → `ready === true`, `blockers === []`. Remove exactly one required **field** → `ready === false` + a `missing` / `blocker` naming it. Restore; remove one required **document** → `ready === false` naming it.

### 11.7 Architecture guard (spec §3)

Grep `src/shared/application/**`, `src/server/services/applicationService.ts`, `src/server/routes/applications.ts`, `src/web/src/pages/Applications/**` (comment-stripped) for a KB category-id literal (`/['"](evisa|regular)\.[a-z0-9_.]+['"]/`) → **zero matches** (KB data files + the visa-kb query layer are exempt).

### 11.8 Integration / API / UI

Per spec §37: `applicationService` persistence, `kb_version` pinning, field-value upsert, applicant↔application relationship, document matching; application CRUD routes, field-values route, family/occupation routes, validation-error envelopes; UI — application create, selection, section rendering, missing list, document state, verification, readiness, the **disabled** Phase 5 control (a test asserts the button has no click handler / is `disabled`).

### 11.9 Regression

Full Phases 0–3 suite stays green (426 baseline).

**Synthetic data only.** No real passport numbers / names / addresses in fixtures or test logs; PII redaction extended for the new fields (`test/server/loggerRedaction.test.ts`).

---

## 12. Acceptance criteria (spec §42 — every item needs evidence)

1. `npm run typecheck` (×4), `npm run lint`, `npm test`, `npm run build` all green; full Phase 0–3 regression green.
2. migration 4 creates `applicant_family`, `applicant_occupation`, `visa_applications`, `application_field_values`; adds the five `applicant_identity` columns; `LATEST_SCHEMA_VERSION === 4`; fresh DB and a v3→v4 upgrade both succeed.
3. An applicant can hold **multiple** applications; each pins `kb_version` at create.
4. Category list, form sections, field requirements, document requirements, and conditional requirements in a plan **all originate from the KB** — the §11.7 architecture guard passes.
5. `buildApplicationPlan` is pure & deterministic (no DB/HTTP/React/fs/env import; a test asserts the imports; same input + KB → same plan bar `computedAt`).
6. Conditions: `true` / `false` / `null` are distinct; unknown/`custom` → `null`, shown as review, not treated as `false`, not blocking.
7. Eligibility is deterministic; passport-validity insufficiency → unmet condition + blocker + source + not-ready, computed by the engine.
8. `missing[]` is generated automatically; excludes optional and unknown-conditional items; every entry sourced.
9. Verification rollup works for profile + application fields; **not** part of the default readiness gate.
10. **Provenance guard passes across every category** (§11.5); no `ApplicationPlan` contains an empty source.
11. `regular.business` / `regular.student` / `regular.medical` / `regular.transit` / `evisa.tourist.30d` category tests pass (§11.2).
12. Conditional tests pass (§11.3): married → spouse applicable; minor → guardian applicable; unknown → `null` review.
13. A fully-populated application → `ready === true, blockers === []`; removing one required field → not ready naming it; removing one required document → not ready naming it (§11.6).
14. **No Phase 5 code** — no Playwright/portal/OTP/CAPTCHA/submission/appointment/payment; the "Start automation" control is disabled and inert; a test asserts it.
15. Applicant/Application boundary respected — no profile data duplicated into `visa_applications` / `application_field_values`; a review confirms it.
16. Structured, sanitized errors for: missing applicant/application, invalid category, mode/category mismatch, invalid application field, malformed/unsourced KB, stale KB pin, DB constraint failures (spec §35).
17. PII: no passport numbers / full profiles / addresses / document contents / OCR text / sensitive application values in logs; redaction test extended.
18. `docs/PHASE-4-REPORT.md` exists with per-criterion evidence; `docs/ARCHITECTURE.md` gains a Phase 4 paragraph.
19. Whole-branch review (spec §41) passes; legitimate findings fixed; full gate re-run.

---

## 13. Execution method

`superpowers:subagent-driven-development` — the workflow used for Phases 1–3. **One task at a time.** For every task: read this spec, implement only the assigned scope, TDD where appropriate, run the task tests + the full regression gate, inspect the diff, commit, report (implementation / files / tests / results / typecheck / lint / build / security / commit hash / limitations), **stop for review**. Do not start the next task automatically. ~20–24 tasks; the plan (written next) sets the boundaries and dependency order (roughly: KB v2 schema → source-confidence data → migration 4 → shared types → Zod → condition evaluator → eligibility evaluator → form-rule resolver → document-rule resolver → plan builder → missing calc → verification rollup → readiness gate → applicationService → field values → REST → family/occupation routes → web client → applications list/create UI → application dashboard UI → document/verification integration → styling/error/a11y → integration/provenance/full gate → smoke + whole-branch review). A whole-branch review (opus) closes the phase. Work continues on branch `phase-0-portal-settings`. Commit trailer:

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KEBRLEQyErZX3ABjvh7ua2
```

**Stop after this phase. Browser automation is Phase 5.**
