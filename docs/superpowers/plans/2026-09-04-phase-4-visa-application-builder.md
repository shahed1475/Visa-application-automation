# Phase 4 — India Visa Application Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-applicant × visa-selection preparation system — KB schema v2 (a form-requirements layer), a pure deterministic `buildApplicationPlan` engine that interprets the KB into an `ApplicationPlan` (sections / fields / documents required·conditional·optional, eligibility with auto-evaluated conditions + passport validity, missing info, verification rollup, `readyForAutomation` gate), persistence (`visa_applications` + `application_field_values` + profile `family`/`occupation`), REST, and a 7-section dashboard UI — with **every plan node traceable to a KB `Source`** and **no browser automation** (Phase 5).

**Architecture:** `src/shared/visa-kb/` gains `formModel` + per-category `formRules` + `FormCondition` + `source.confidence` (schemaVersion 2). `src/shared/application/` is a **pure** engine (no DB / HTTP / React / fs / env) — a generic KB interpreter with **zero India-specific literals** (a guard test enforces this). migration 4 extends the Phase 2 section machinery (`applicant_family`, `applicant_occupation`, `applicant_identity` columns) and adds two trip-level tables. `applicationService` assembles the engine input from the DB and calls the engine (no engine logic in the service). The web adds `/applications/:id` and an Applications subsection on the applicant page.

**Tech Stack:** TypeScript (ESM, NodeNext server / Bundler web), Node 24, Fastify 5, `node:sqlite` `DatabaseSync`, Zod 3, Pino, React 18, React Router 6, Vite 5, Vitest 3, ESLint 9. **No new dependency.**

## Global Constraints

Copied from `docs/superpowers/specs/2026-09-04-phase-4-visa-application-builder-design.md`. Every task's requirements implicitly include this section.

- **The engine is pure & deterministic.** `src/shared/application/**` imports nothing from `node:*`, `fastify`, `react`, `../server/**`, and reads no env. `buildApplicationPlan(input)` returns the same `ApplicationPlan` for the same `input` + KB version, except `provenance.computedAt`. The caller passes `now: Date` — tests always pass it.
- **India-specific rules live in the KB, never in code.** No `if (categoryId === 'regular.business')` or any KB category-id string literal anywhere in `src/shared/application/**`, `applicationService.ts`, `routes/applications.ts`, `src/web/src/pages/Applications/**`. A guard test (Task 19) enforces this; KB data files + `src/shared/visa-kb/queries.ts` are exempt.
- **Provenance is a hard invariant.** Every `SectionPlan` / `FieldPlan` / `DocumentPlan` / non-plan-level `Warning` / `eligibility` / `EligibilityConditionView` / `MissingItem` / applicable `Blocker` carries a `Source` with non-empty `officialUrl` (http(s)), `retrievedAt` (ISO date), `confidence` ∈ `['official_verbatim','official_derived','secondary_guidance','unverified']`. Sources originate in the KB; the engine only propagates them. A machine-enforced test (Task 19) iterates **every** category.
- **Condition semantics: `true` ≠ `false` ≠ `null`.** `true` = evaluated & satisfied; `false` = evaluated & not satisfied; `null` = cannot determine. `null` is never treated as `false`. Unknown/`custom` conditions → shown as "Review required — the app cannot determine this", **not** added to `missing`, **do not** block readiness.
- **Verification is NOT part of the default `readyForAutomation` gate** (Phase 3 philosophy). It is surfaced separately.
- **`readyForAutomation` wording:** not "approved" / "guaranteed" / "legally eligible" / "submitted" — only "the local preparation data meets the configured automation prerequisites".
- **Applicant ≠ Application.** One applicant → many applications. Person-level data (identity, passport, contact, address, **family**, **occupation**, travel, references) stays on the applicant. Trip-level (category, purpose, entry type, dates, port, application-scoped field values, status, pinned `kb_version`) on the application. **Never** copy profile data into `visa_applications` / `application_field_values`.
- **`kb_version` is pinned** on `visa_applications` at create time. Plans are always computed against the **current** KB; a divergence from the pin surfaces as a plan-level `Warning { severity: 'info', source: null }`.
- **NO Phase 5 code.** No Playwright / portal / login / OTP / CAPTCHA / submission / appointment / payment / autofill. The "Start automation (Phase 5)" button is `disabled` and has **no handler**.
- **Reuse, don't duplicate.** `SECTION_TABLES` / `readSection` / `writeSection` / completeness / verification (Phase 2); document storage & upload (Phase 3); `routes/errors.ts` sanitizer; the `SectionCard` component; `loadKnowledgeBase` / `checkEligibility` / `listCategories` (Phase 1).
- **PII never logged.** Extend `REDACT_PATHS` for the new fields. Synthetic test data only — no real passport numbers / names / addresses in fixtures or logs.
- TS strict, `noUncheckedIndexedAccess`. `npm run typecheck` (×4), `npm run lint`, `npm test`, `npm run build` all green at end of every task (baseline **426** tests). Branch `phase-0-portal-settings`. Commit trailer:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KEBRLEQyErZX3ABjvh7ua2
  ```

---

## File structure

### Created

| File | Responsibility |
|---|---|
| `src/shared/visa-kb/data/india/form-model.json` | the canonical `formModel.sections[]` — section + field catalog, each with a `source` |
| `src/shared/application/types.ts` | `ApplicationPlan` and all sub-shapes (§6.2 of the spec); `FlatApplicant`, `Selection`, `BuildApplicationPlanInput` |
| `src/shared/application/schemas.ts` | Zod: `selectionSchema`, `applicationCreateSchema`, `applicationPutSchema`, `applicationFieldValueSchema` |
| `src/shared/application/conditions.ts` | `evaluateCondition(cond, ctx): boolean \| null` |
| `src/shared/application/eligibility.ts` | `evaluateEligibility(...)` — v1 eligibility conditions + passport validity → `EligibilityPlan` |
| `src/shared/application/formRules.ts` | `resolveEffectiveRequirement(...)` — the §4.3 resolution table |
| `src/shared/application/documentRules.ts` | `resolveDocumentPlans(...)` + the doc↔upload match heuristic |
| `src/shared/application/buildApplicationPlan.ts` | the orchestrator: sections + documents + eligibility + missing + verification + readiness |
| `src/shared/application/index.ts` | barrel |
| `src/server/services/applicationService.ts` | create / list / get (`{application, plan}`) / update / setFieldValue / delete; assembles engine input |
| `src/server/routes/applications.ts` | the §9.2 endpoints |
| `src/web/src/pages/Applications/ApplicationDashboardPage.tsx` | `/applications/:id` — the 7-section preparation dashboard |
| `src/web/src/pages/Applications/*.tsx` | the section components (VisaSelection, EligibilityPanel, RequiredInfo, RequiredDocuments, MissingInfo, VerificationPanel, ReadyPanel) |
| `src/web/src/pages/Applicants/ApplicationsSubsection.tsx` | list + New-application on `/applicants/:id` |
| `test/**` per task | |

### Modified

| File | Change |
|---|---|
| `src/shared/visa-kb/schema.ts` | + `formModel`/`FormSection`/`FormField`, `formRules`/`FieldRule`, `formConditionSchema`, `conditionalDocuments`, `SOURCE_CONFIDENCE` + `sourceSchema.confidence`; `KNOWN_SCHEMA_VERSIONS = [1, 2]` |
| `src/shared/visa-kb/loader.ts` | load `form-model.json`; v2 cross-checks (unique section ids, every `FieldRule` target resolves to a real section+field, every `FormField.appliesTo` valid, every `formRules.applicableSections` id exists) |
| `src/shared/visa-kb/queries.ts` | + `getFormModel()`, `getFormSection(id)` (small helpers) |
| `src/shared/visa-kb/data/india/{evisa,regular}-categories.json` | + `source.confidence` everywhere; + `formRules` + `conditionalDocuments` per category |
| `src/shared/visa-kb/data/india/eligibility.bgd.json` | + `source.confidence` on every record |
| `src/shared/visa-kb/data/india/meta.json` | `schemaVersion: 2` |
| `src/shared/visa-kb/data/india/SOURCES.md` | note the v2 additions + the `confidence` values used |
| `src/server/db/migrations.ts` | + migration 4; `LATEST_SCHEMA_VERSION` → 4 |
| `src/server/services/applicantColumns.ts` | `SECTION_TABLES` += `family`, `occupation` |
| `src/server/services/applicantService.ts` | `createApplicant` inserts the 2 new satellite rows; `assembleDetail` reads `family`/`occupation`; `updateApplicant` handles the new section patches |
| `src/server/services/applicantCompleteness.ts` | completeness/verification include `family`/`occupation` |
| `src/shared/applicant/schemas.ts` | + `familySchema`, `occupationSchema`; extend `identitySchema` (religion/education/nationalId/visibleMarks/nationalityAtBirth); extend `applicantPutSchema` |
| `src/shared/applicant/types.ts` | + `Family`, `Occupation`; `ApplicantDetail` += `family`, `occupation`; `Identity` += 5 fields; `SectionKey` += `'family'`,`'occupation'` |
| `src/shared/applicant/fieldPaths.ts` | `PROFILE_SECTIONS` += `family`, `occupation` |
| `src/server/logger.ts` | `REDACT_PATHS` += family/occupation/identity-extension PII keys |
| `src/server/routes/applicants.ts` | `PUT /api/applicants/:id` accepts `family` / `occupation` |
| `src/server/app.ts` | register `registerApplicationRoutes` |
| `src/web/src/api/client.ts` | + application methods; extend applicant PUT typing |
| `src/web/src/App.tsx` / `main.tsx` | + `/applications/:id` route (nav: keep it reachable from the applicant page, no top-nav entry needed) |
| `src/web/src/pages/Applicants/ApplicantDetailPage.tsx` | + `<ApplicationsSubsection>` + Family/Occupation `SectionCard`s |
| `src/web/src/pages/Applicants/SectionCard.tsx` | (only if the new sections need a new field `type`; likely not) |
| `src/web/src/styles.css` | application dashboard + status-chip styles |
| `docs/PHASE-4-REPORT.md` / `docs/ARCHITECTURE.md` | new / paragraph (Task 21) |

---

## Task list

1. KB v2 schema + loader cross-checks
2. KB v2 data — `source.confidence` everywhere + `form-model.json` (section/field catalog)
3. KB v2 data — per-category `formRules` + `conditionalDocuments` (all 20 categories) + SOURCES.md
4. migration 4 — tables/columns + `SECTION_TABLES` + `LATEST_SCHEMA_VERSION` 4
5. Applicant `family`/`occupation` — Zod + types + service + completeness + logger redaction
6. shared `application/` types + Zod schemas
7. condition evaluator (`conditions.ts`)
8. eligibility evaluator (`eligibility.ts` — incl. passport validity)
9. form-rule resolver (`formRules.ts`)
10. document-rule resolver (`documentRules.ts`)
11. `buildApplicationPlan` — sections + documents + eligibility assembly
12. missing / verification rollup / readiness gate (on the plan) + `index.ts` barrel
13. `applicationService` (CRUD + field values + plan assembly + errors)
14. REST — `routes/applications.ts`
15. REST — applicant `family`/`occupation` (`PUT /api/applicants/:id` + `applicants.ts` routes)
16. web — API client + Applications subsection + New-application + Family/Occupation SectionCards
17. web — `/applications/:id` dashboard A: Visa selection · Eligibility · Required information
18. web — `/applications/:id` dashboard B: Required documents · Missing information · Verification · Ready-for-automation (disabled Phase-5 button)
19. guard tests — architecture (no category literal), provenance (every category), engine purity
20. category-specific + conditional + eligibility + readiness test suites; full regression gate
21. `docs/PHASE-4-REPORT.md` + `ARCHITECTURE.md` paragraph + manual smoke walkthrough

Then: whole-branch review (opus) closes the phase.

---

### Task 1: KB v2 schema + loader cross-checks

**Files:**
- Modify: `src/shared/visa-kb/schema.ts`, `src/shared/visa-kb/loader.ts`, `src/shared/visa-kb/queries.ts`
- Test: `test/shared/visaKb/schema.test.ts` (extend), `test/shared/visaKb/loader.test.ts` (extend)

**Interfaces produced (later tasks depend on these exact names):**
```ts
// schema.ts
export const SOURCE_CONFIDENCE = ['official_verbatim','official_derived','secondary_guidance','unverified'] as const;
export type SourceConfidence = (typeof SOURCE_CONFIDENCE)[number];
// sourceSchema gains:  confidence: z.enum(SOURCE_CONFIDENCE)

export const FORM_SECTION_IDS = ['personal_particulars','passport_details','address','family','occupation',
  'visa_details','previous_visits','references','business_details','study_details','medical_details'] as const;
export const FORM_DATA_TYPES = ['text','long_text','date','enum','boolean','country'] as const;
export const FIELD_REQUIREMENTS = ['required','conditional','optional','not_applicable'] as const;

export const formConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('purpose_in'), value: z.array(z.enum(PURPOSE_TAGS)).min(1) }).strict(),
  z.object({ type: z.literal('entry_type_in'), value: z.array(z.enum(ENTRY_TYPES)).min(1) }).strict(),
  z.object({ type: z.literal('applicant_married') }).strict(),
  z.object({ type: z.literal('visited_india_before') }).strict(),
  z.object({ type: z.literal('age_lt'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('age_gte'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('stay_days_gt'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('sub_category_is'), value: z.string().min(1) }).strict(),
  z.object({ type: z.literal('custom'), text: z.string().min(1) }).strict(),
]);
export type FormCondition = z.infer<typeof formConditionSchema>;

export const formFieldSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  label: z.string().min(1),
  appliesTo: z.string().min(1).nullable(),
  dataType: z.enum(FORM_DATA_TYPES),
  standardBlock: z.boolean(),
  enumValues: z.array(z.string().min(1)).min(1).optional(),
  source: sourceSchema,
}).strict();

export const formSectionSchema = z.object({
  id: z.enum(FORM_SECTION_IDS),
  label: z.string().min(1),
  fields: z.array(formFieldSchema),
  source: sourceSchema,
}).strict();

export const formModelSchema = z.object({ sections: z.array(formSectionSchema).min(1) }).strict();

export const fieldRuleSchema = z.object({
  sectionId: z.enum(FORM_SECTION_IDS),
  fieldId: z.string().min(1),
  requirement: z.enum(FIELD_REQUIREMENTS),
  condition: formConditionSchema.optional(),
  count: z.number().int().positive().optional(),
  source: sourceSchema,
  notes: z.string().min(1).optional(),
}).strict()
  .refine((r) => r.requirement !== 'conditional' || r.condition !== undefined,
          { message: 'a conditional FieldRule must carry a condition' });

export const formRulesSchema = z.object({
  applicableSections: z.array(z.enum(FORM_SECTION_IDS)),
  fieldRules: z.array(fieldRuleSchema),
}).strict();

export const conditionalDocSchema = docSchema.extend({
  condition: formConditionSchema,
  source: sourceSchema,
}).strict();

// visaCategorySchema gains:  formRules: formRulesSchema,  conditionalDocuments: z.array(conditionalDocSchema)
// knowledgeBaseSchema gains: formModel: formModelSchema
// KNOWN_SCHEMA_VERSIONS = [1, 2] as const

export type FormSection = z.infer<typeof formSectionSchema>;
export type FormField = z.infer<typeof formFieldSchema>;
export type FieldRule = z.infer<typeof fieldRuleSchema>;
export type FormRules = z.infer<typeof formRulesSchema>;
export type ConditionalVisaDocument = z.infer<typeof conditionalDocSchema>;

// queries.ts
export function getFormModel(kb = loadKnowledgeBase()): { sections: FormSection[] };
export function getFormSection(id: string, kb = loadKnowledgeBase()): FormSection | null;
```

**Loader v2 cross-checks (in `parseKnowledgeBase`, after the existing ones):**
- `formModel.sections` ids are unique.
- Every `FormField.id` is unique within its section.
- Every `FormField.appliesTo` (when non-null) is either an `application.<slug>` path OR passes `isValidFieldPath` from `../applicant/fieldPaths.js` — **and** if it starts `identity.`/`passport.`/`contact.`/`address.`/`family.`/`occupation.`, its section+key must exist in a hard-coded allow-list of the known profile paths (import a `PROFILE_FIELD_PATHS` set — add it to `fieldPaths.ts` in Task 5 if not present; for Task 1, just check the `application.` prefix OR `isValidFieldPath`, and note the tighter check is added in Task 5).
- For every category: `formRules.applicableSections` ⊆ `formModel.sections` ids; every `formRules.fieldRules[].sectionId` ∈ `formModel.sections` ids; every `fieldRules[].fieldId` exists in that section's `fields` **OR** is one of the synthetic ids (`india_references_min`) — allow-list the synthetic ids.
- `KnowledgeBaseError` messages follow the existing style.

Note: the shipped data is not v2-complete until Tasks 2–3. **Task 1's tests use inline fixtures** (a minimal hand-built v2 KB object passed to `parseKnowledgeBase`), not the real data files. `loadKnowledgeBase()` will throw until Task 2–3 land — so Task 1 must also keep the existing real-KB tests green by **temporarily** making `formModel` optional in `knowledgeBaseSchema`? **No** — instead: Task 1 adds a minimal valid `form-model.json` (one section, one field) and a minimal `formRules`/`conditionalDocuments: []` to **every** category in the same task so `loadKnowledgeBase()` stays valid. Tasks 2–3 then flesh out the real content. **Decision: Task 1 ships schema + a skeleton `form-model.json` + `formRules: { applicableSections: [], fieldRules: [] }` + `conditionalDocuments: []` on every category + `source.confidence: 'secondary_guidance'` on every source (a safe default), so the gate stays green. Tasks 2–3 replace the skeletons with real content.**

- [ ] **Step 1: write the failing tests** — extend `schema.test.ts`: `formConditionSchema` accepts each variant + `.strict()` rejects extras; `fieldRuleSchema` rejects `requirement:'conditional'` without `condition`; `formSectionSchema` rejects an unknown section id. Extend `loader.test.ts` with inline-fixture cases for each new cross-check (dangling `fieldRule.sectionId`, `fieldRule.fieldId` not in section, `appliesTo` invalid, `applicableSections` id unknown, duplicate section id) — each throws `KnowledgeBaseError` with a message matching a regex.
- [ ] **Step 2: run — verify fail.** `npx vitest run test/shared/visaKb/`
- [ ] **Step 3: implement** `schema.ts` additions (above), `loader.ts` cross-checks + `form-model.json` import + merge into the parsed object, `queries.ts` helpers. Add the skeleton `form-model.json` (1 section `personal_particulars` with 1 field `standard_personal_block` `appliesTo: null` `standardBlock: true`) and add `formRules: { applicableSections: [], fieldRules: [] }` + `conditionalDocuments: []` + `source.confidence: 'secondary_guidance'` to **every** category and `confidence` to every eligibility source, and `meta.json` `schemaVersion: 2`. (This is a large mechanical edit across the 3 data files — do it carefully; the existing `data.test.ts` + `loader.test.ts` real-KB checks must pass.)
- [ ] **Step 4: run — verify pass.** Then full gate.
- [ ] **Step 5: commit** — `feat(visa-kb): schema v2 — form model, form rules, conditions, source confidence  <trailer>`

**Task 1 report + stop.**

---

### Task 2: KB v2 data — `source.confidence` + the real `form-model.json`

**Files:** `src/shared/visa-kb/data/india/form-model.json` (replace skeleton), the 3 data files (`confidence` values — verify Task 1's default is right per source), `SOURCES.md`
**Test:** `test/shared/visaKb/data.test.ts` (extend)

**The `form-model.json` — the section + field catalog.** Build it from the India Regular/e-Visa form structure (well-known; the "why" is in the spec). Each section + field gets a `source` — use `https://indianvisaonline.gov.in/visa/` or `.../evisa/` pages with `retrievedAt: '2026-09-04'` and an honest `confidence` (`official_derived` for fields visible on the form; `secondary_guidance` where the requirement rests on HCI guidance). Sections + representative fields (the implementer authors the full list; this is the required shape):

| section | key fields (id — appliesTo — standardBlock) |
|---|---|
| `personal_particulars` | `standard_personal_block` — null — true; `religion` — `identity.religion` — false; `education` — `identity.education` — false; `national_id` — `identity.nationalId` — false; `visible_marks` — `identity.visibleMarks` — false; `nationality_at_birth` — `identity.nationalityAtBirth` — false |
| `passport_details` | `standard_passport_block` — null — true (satisfied by `passport.number`,`passport.issueDate`,`passport.expiryDate`,`passport.placeOfIssue`) |
| `address` | `standard_address_block` — null — true (satisfied by `address.line1`,`address.city`,`address.country`); `phone` — `contact.phone` — true; `email` — `contact.email` — true |
| `family` | `father_name` — `family.fatherName` — true; `father_nationality` — `family.fatherNationality` — false; `mother_name` — `family.motherName` — true; `marital_status` — `family.maritalStatus` — true; `spouse_name` — `family.spouseName` — false; `spouse_nationality` — `family.spouseNationality` — false; `pakistan_ancestry` — `family.pakistanAncestry` — false |
| `occupation` | `occupation` — `occupation.occupation` — true; `employer_name` — `occupation.employerName` — false; `employer_address` — `occupation.employerAddress` — false; `designation` — `occupation.designation` — false; `military_police` — `occupation.militaryPolice` — false |
| `visa_details` | `purpose` — `application.purpose` — true; `port_of_arrival` — `application.portOfArrival` — true; `intended_arrival_date` — `application.intendedArrivalDate` — true; `intended_stay_days` — `application.intendedStayDays` — false |
| `previous_visits` | `visited_india_before` — `application.visitedIndiaBefore` — true; `previous_visa_number` — `application.previousVisaNumber` — false; `previous_visit_cities` — `application.previousVisitCities` — false; `countries_visited_10y` — `application.countriesVisited10y` — false |
| `references` | `home_country_reference` — null — true (satisfied by a `Reference` row with any kind); `india_references_min` — null — false (synthetic, count-driven) |
| `business_details` | `india_company_name` — `application.indiaCompanyName` — false; `india_company_address` — `application.indiaCompanyAddress` — false; `nature_of_business` — `application.natureOfBusiness` — false; `bd_company_name` — `application.bdCompanyName` — false |
| `study_details` | `institution_name` — `application.institutionName` — false; `institution_address` — `application.institutionAddress` — false; `course_of_study` — `application.courseOfStudy` — false; `course_duration` — `application.courseDuration` — false |
| `medical_details` | `hospital_name` — `application.hospitalName` — false; `hospital_address` — `application.hospitalAddress` — false; `nature_of_ailment` — `application.natureOfAilment` — false |

- [ ] Steps: extend `data.test.ts` (every source across the whole KB has a `confidence` ∈ the enum; `form-model.json` parses; every `FormField.appliesTo` non-null is `application.*` or a real profile path) → RED → author `form-model.json` + fix any `confidence` values → GREEN → gate → commit `feat(visa-kb): India visa form-model section & field catalog  <trailer>`.

**Task 2 report + stop.**

---

### Task 3: KB v2 data — per-category `formRules` + `conditionalDocuments`

**Files:** `src/shared/visa-kb/data/india/{evisa,regular}-categories.json` (replace the Task-1 skeletons), `SOURCES.md`
**Test:** `test/shared/visaKb/data.test.ts` (extend — the category-specific expectations)

For **each** of the 20 categories, replace `formRules: { applicableSections: [], fieldRules: [] }` with real content and `conditionalDocuments: []` with real conditional docs. Guidance (implementer authors all 20; these are the load-bearing ones the tests pin):

- **`regular.tourist`** — `applicableSections`: `personal_particulars, passport_details, address, family, occupation, visa_details, previous_visits, references`. `fieldRules`: `spouse_name`/`spouse_nationality` → `conditional { applicant_married }`; `references.india_references_min` is NOT required (tourist uses the home-country reference). `conditionalDocuments`: `{ id: 'invitation_relative', condition: { purpose_in: ['family_visit'] } }`.
- **`regular.business`** — + `business_details` section applicable; `fieldRules`: `india_company_name`, `india_company_address`, `nature_of_business` → `required`; `references.india_references_min` → `required, count: 2`. `conditionalDocuments`: `{ id: 'financial_proof', condition: { custom: 'if the mission requests proof of financial standing' } }`. (`invitation_letter_indian_company` etc. stay in `requiredDocuments`.)
- **`regular.student`** — + `study_details`; `institution_name`, `institution_address`, `course_of_study` → `required`.
- **`regular.medical`** / **`regular.medical_attendant`** — + `medical_details`; `hospital_name`, `hospital_address` → `required`.
- **`regular.transit`** — `applicableSections` minimal: `personal_particulars, passport_details, address, visa_details`. NO `business_details`/`study_details`/`family`/`occupation`. `conditionalDocuments`: `{ id: 'onward_ticket', condition: { custom: 'confirmed onward ticket to the third country' } }` OR put it in `requiredDocuments` if unconditional for transit — **required** per spec §29.
- **`regular.employment`** — + `occupation` emphasised; `employer_name`, `employer_address`, `designation` → `required`; a `salary`-ish field → `conditional`/`optional`.
- **`regular.conference`** / **`regular.journalist`** / **`regular.research`** / **`regular.entry_x`** — sensible `applicableSections` + a couple of differentiating `required` fields each.
- **e-Visa categories** (`evisa.tourist.30d`, `.1y`, `.5y`, `evisa.business`, `evisa.medical`, `evisa.medical_attendant`, `evisa.conference`) — lighter `applicableSections` (`personal_particulars, passport_details, address, visa_details`); `conditionalDocuments`: `{ id: 'return_ticket', condition: { custom: 'confirmed return/onward ticket + sufficient funds (per the e-Visa instructions)' } }` — **note:** spec §29 wants "if the onward/return-ticket condition is satisfied, the return-ticket document becomes required" — model this as a real evaluable condition where possible. The e-Visa categories carry `travelRequirements.onwardOrReturnTicket: true`; the engine (Task 10) should promote a `return_ticket` conditional doc to `required` when `travelRequirements.onwardOrReturnTicket === true` (that's a KB-driven rule the engine reads, not a category `if`). So: give e-Visa `conditionalDocuments: [{ id: 'return_ticket', condition: { custom: '...' }, ... }]` AND rely on the engine's `travelRequirements.onwardOrReturnTicket` handling. Document the interaction.

Every `FieldRule` and `conditionalDoc` carries a `source` with `confidence`.

- [ ] Steps: extend `data.test.ts` — per §11.2: `regular.business` `formRules` names `business_details` + the 3 fields + `india_references_min count:2`; `regular.transit.formRules.applicableSections` excludes `business_details`/`study_details`; `regular.student` names `study_details`+institution; `regular.medical` names hospital fields; `evisa.tourist.30d` has a `return_ticket` conditional doc. Also assert **every** category now has `formRules.applicableSections.length > 0`. → RED → author all 20 → GREEN → gate → commit `feat(visa-kb): per-category form rules & conditional documents (20 categories)  <trailer>`.

**Task 3 report + stop.**

---

### Task 4: migration 4 — schema + `SECTION_TABLES`

**Files:** `src/server/db/migrations.ts`, `src/server/services/applicantColumns.ts`
**Test:** `test/server/applicationMigrations.test.ts` (create), `test/server/migrations.test.ts` (LATEST_SCHEMA_VERSION → 4)

Append migration `version: 4` per spec §7.1 + §7.2 (the exact SQL). `LATEST_SCHEMA_VERSION` auto-derives. `SECTION_TABLES` += `family` (table `applicant_family`, the camelCase→snake_case col map for all 14 columns) and `occupation` (5 columns). **Do not** touch `applicantService` yet (Task 5).

- [ ] Steps: `applicationMigrations.test.ts` — v4 tables + columns + the CHECK constraints (`marital_status`, `military_police`, `pakistan_ancestry`, `visa_applications.status`/`application_mode`, `application_field_values.verified`) + FK cascade (`visa_applications` → `application_field_values`; `applicants` → both new satellite tables + `visa_applications`) + `applicant_identity` gains the 5 columns + `UNIQUE(application_id, field_path)`; v3→v4 upgrade preserves an existing applicant. → RED → implement → GREEN → full gate → commit `feat(db): migration 4 — applicant family/occupation + visa_applications  <trailer>`.

**Task 4 report + stop.**

---

### Task 5: Applicant `family` / `occupation` — schemas, types, service, completeness, redaction

**Files:** `src/shared/applicant/{schemas,types,fieldPaths}.ts`, `src/server/services/{applicantService,applicantCompleteness}.ts`, `src/server/logger.ts`
**Test:** `test/shared/applicantSchemas.test.ts`, `test/server/applicantService.test.ts`, `test/server/applicantCompleteness.test.ts`, `test/server/loggerRedaction.test.ts` (all extend)

- `familySchema` / `occupationSchema` — mirror the Phase 2 section-schema pattern (`nstr(...)`, `blankToNull`, enums for `maritalStatus`/`militaryPolice`/`pakistanAncestry`). Extend `identitySchema` with the 5 new `nstr` fields. Extend `applicantCreateSchema` + `applicantPutSchema` with `family` / `occupation`.
- `types.ts`: `Family`, `Occupation` interfaces; `ApplicantDetail` += `family`,`occupation`; `Identity` += 5; `SectionKey` += `'family'`,`'occupation'`.
- `fieldPaths.ts`: `PROFILE_SECTIONS` += `family: ['fatherName','motherName','maritalStatus']`, `occupation: ['occupation']` (the "counts toward complete" subset — keep small). Add `export const PROFILE_FIELD_PATHS: ReadonlySet<string>` built from `SECTION_TABLES`... wait, `SECTION_TABLES` is server-side. Build it from the section field lists in `schemas.ts` output shapes, OR a hand-maintained set. **Decision:** a hand-maintained `PROFILE_FIELD_PATHS` const in `fieldPaths.ts` listing every `<section>.<camelKey>` — used by the Task 1 loader's tightened `appliesTo` check (retro-fit the loader check now that the set exists) and by the engine.
- `applicantService.ts`: `createApplicant` inserts `applicant_family` + `applicant_occupation` rows; `assembleDetail` reads both via `readSection`; `updateApplicant`'s section loop includes `family`/`occupation` (the loop is already generic over `['identity','passport','contact','address']` — extend the array).
- `applicantCompleteness.ts`: the `ONE_TO_ONE` list += `family`,`occupation`; `computeVerification` handles them.
- `logger.ts`: `REDACT_PATHS` += `fatherName`, `father_name`, `motherName`, `mother_name`, `spouseName`, `spouse_name`, `employerName`, `employer_name`, `employerAddress`, `employer_address`, `nationalId`, `national_id`, `visibleMarks`, `visible_marks`, `nationalityAtBirth`, `nationality_at_birth`, + `*.` variants.

- [ ] Steps: extend the 4 test files (schema accept/reject; `createApplicant` → detail has empty `family`/`occupation`; a `PUT { family: { fatherName: 'X' } }` partial-patches; completeness counts the new sections; redaction covers the new keys) → RED → implement → GREEN → full gate → commit `feat(applicant): family & occupation profile sections + identity extensions  <trailer>`.

**Task 5 report + stop.**

---

### Task 6: shared `application/` types + Zod schemas

**Files:** Create `src/shared/application/types.ts`, `src/shared/application/schemas.ts`
**Test:** `test/shared/application/schemas.test.ts`

`types.ts` — transcribe the spec §6.1 + §6.2 shapes verbatim: `FlatApplicant`, `Selection`, `DocumentCoverage`, `BuildApplicationPlanInput`, `ApplicationPlan`, `EligibilityPlan`, `EligibilityConditionView`, `SectionPlan`, `FieldPlan`, `DocumentPlan`, `MissingItem`, `Warning`, `Blocker`, `VerificationRollup`, plus `VisaApplication` / `VisaApplicationSummary` (the DB row shapes: id, applicantId, destination, applicationMode, categoryId, purpose, entryType, intendedArrivalDate, intendedStayDays, portOfArrival, status, kbVersion, createdAt, updatedAt).

`schemas.ts` — `selectionSchema` (mode enum, categoryId string, purpose optional `PURPOSE_TAGS`, entryType optional `ENTRY_TYPES`, dates ISO, stay int); `applicationCreateSchema` (mode + categoryId required, rest optional); `applicationPutSchema` (all optional); `applicationFieldValueSchema` (`{ fieldPath: string.refine(p => p.startsWith('application.') && isValidFieldPath(p)), value: nullable string optional, verified: boolean optional }`).

Import types only from `../visa-kb/schema.js` and `../applicant/types.js`. **Pure** — no other imports.

- [ ] Steps: schemas.test.ts (accept/reject per schema; `applicationFieldValueSchema` rejects a non-`application.` path and `Bad.Path`) → RED → implement → GREEN → typecheck ×4 + lint → commit `feat(application): shared plan types + request schemas  <trailer>`.

**Task 7 report + stop.** *(numbering typo — report says "Task 6")*

---

### Task 7: condition evaluator

**Files:** Create `src/shared/application/conditions.ts`
**Test:** `test/shared/application/conditions.test.ts`

`evaluateCondition(cond: FormCondition, ctx: ConditionContext): boolean | null` per the spec §5 table. `ConditionContext = { applicant: FlatApplicant; selection: Selection; applicationValues: Record<string,{value,verified}>; category: VisaCategory; now: Date }`.

Helpers: `ageAt(dob: string | null, at: Date): number | null`.

- [ ] Steps: **exhaustive** test — for EACH of the 9 `type`s: a `true` case, a `false` case, and a `null` case (missing input). Explicit assertions that `custom` is **always** `null`; `purpose_in` with `selection.purpose` unset is `null` **not** `false`; `applicant_married` with `maritalStatus: null` is `null`; `age_lt` with `dateOfBirth: null` is `null`; `age_lt: 18` with a DOB making the applicant 17 at `intendedArrivalDate` is `true`, 18 is `false`. → RED → implement → GREEN → typecheck + lint → commit `feat(application): declarative condition evaluator (true/false/null)  <trailer>`.

**Task 7 report + stop.**

---

### Task 8: eligibility evaluator (incl. passport validity)

**Files:** Create `src/shared/application/eligibility.ts`
**Test:** `test/shared/application/eligibility.test.ts`

`evaluateEligibility(input: { nationality: string | null; selection; applicant; applicationValues; kb; now }): EligibilityPlan`.

- Calls `checkEligibility(nationality, mode, categoryId, kb)` (Phase 1). `unknown` → `EligibilityPlan { status:'unknown', reason, conditions:[], unmetConditions:[], warnings:[], basis:null, source:null }`.
- For a found record: map each v1 `EligibilityCondition` to an `EligibilityConditionView` — `evaluateEligibilityCondition(cond, ctx): boolean | null` per spec §6.4 (auto-check `passport_validity_months_min`, `min_age`, `max_age`, `purpose_in`, `purpose_not_in`; everything else → `null` with a "you must confirm: <text>" `text`). Each view carries the **record's** `source`.
- `unmetConditions` = views with `conditionMet === false`.
- **Passport validity** (spec §6.5): if the record has a `passport_validity_months_min` condition OR the category's `travelRequirements.passportValidityMonthsMin` is set, compute `monthsBetween(passport.expiryDate, intendedArrivalDate ?? now)`; insufficient → that condition view is `false` (or add a synthetic view when only `travelRequirements` had it) + a `Warning { severity:'blocker', text:'passport expires <date>; <N> months validity required after arrival', source: <the rule's source> }`.
- `warnings` — the blocker warning above; plus an `info` warning if `passport.expiryDate` is absent (can't check).

- [ ] Steps: test — a BGD × `evisa.tourist.30d` record: passport expiring in 3 months vs arrival in 30 days → `passport_validity_months_min` view `conditionMet:false`, `unmetConditions` length 1, a blocker warning with a source; passport expiring in 2 years → `true`; passport `expiryDate: null` → `null` + an info warning, **not** `false`, **not** in `unmetConditions`. A `no_prohibited_background` condition → `null` + "you must confirm". An `unknown` (no record) nationality → `status:'unknown'`, no conditions, **never** ineligible. `min_age`/`max_age` from DOB. → RED → implement → GREEN → typecheck + lint → commit `feat(application): deterministic eligibility + passport-validity evaluator  <trailer>`.

**Task 8 report + stop.**

---

### Task 9: form-rule resolver

**Files:** Create `src/shared/application/formRules.ts`
**Test:** `test/shared/application/formRules.test.ts`

```ts
resolveFieldPlans(input: { category: VisaCategory; formModel; ctx: ConditionContext }): SectionPlan[]
```
For each `formModel.section`:
- `applicable = section.id ∈ category.formRules.applicableSections`.
- For each `field` in the section: base requirement per spec §4.3 (explicit `FieldRule` > applicable-section default by `standardBlock` > `not_applicable`). For `conditional`: `evaluateCondition(rule.condition, ctx)` → `met` → `effectiveRequirement:'required'`, `!met` → `'not_applicable'`, `null` → keep `requirement:'conditional'`, `conditionMet:null`, and `effectiveRequirement` — **decision:** `'not_applicable'` for gating purposes (so it's not in `missing`) but the `FieldPlan` keeps `requirement:'conditional'` so the UI renders "review required". Document this: `effectiveRequirement` for an unknown condition is `'not_applicable'`; `conditionMet` is `null`; the UI keys the "review" chip off `requirement === 'conditional' && conditionMet === null`.
- Synthetic `india_references_min` field: build a `FieldPlan` with `id:'india_references_min'`, from the `FieldRule` (`count`), `source` = the rule's; the engine (Task 11) fills `present`/`value` from the reference count.
- `value` / `present` / `verified` are filled by the caller (Task 11) — `resolveFieldPlans` sets them to placeholders (`value:null, present:false, verified:false`) or takes a `resolveValue(appliesTo): {value, present, verified}` callback. **Use the callback** so `formRules.ts` stays pure of the applicant-flattening detail.

- [ ] Steps: test the §4.3 table with a small inline `formModel` + `category` — explicit rule wins; applicable-section `standardBlock` field → `required`; applicable-section non-standard field → `optional`; non-applicable section field → `not_applicable`; conditional `applicant_married` met → `effectiveRequirement:'required'`, unmet → `'not_applicable'`, null → `requirement:'conditional'` + `conditionMet:null` + `effectiveRequirement:'not_applicable'`. → RED → implement → GREEN → commit `feat(application): form-rule resolver — effective requirement per category  <trailer>`.

**Task 9 report + stop.**

---

### Task 10: document-rule resolver

**Files:** Create `src/shared/application/documentRules.ts`
**Test:** `test/shared/application/documentRules.test.ts`

```ts
resolveDocumentPlans(input: {
  category: VisaCategory; ctx: ConditionContext; documentCoverage: DocumentCoverage;
}): DocumentPlan[]
```
- `requiredDocuments` → `requirement:'required'`; `optionalDocuments` → `'optional'`; `conditionalDocuments` → `'conditional'` + evaluate `condition` (met → `effectiveRequirement:'required'`, unmet → `'not_applicable'`, null → `'not_applicable'` + `conditionMet:null`).
- **`travelRequirements.onwardOrReturnTicket === true`** → if there is a `conditionalDocuments` entry with `id` containing `ticket` (or an `optionalDocuments` one), promote it to `effectiveRequirement:'required'` (this is the KB-driven return-ticket rule — reads a KB field, not a category `if`). Document it.
- **Match heuristic** (the one soft spot — make it concrete): `uploaded === true` when some `documentCoverage.uploadedDocs[]` has, after lowercasing + splitting on non-alphanumerics, a token-set intersection with the KB doc `id` tokens of size ≥ 1 for a distinctive token (length ≥ 4), OR the doc's `kind` is `'passport'` and the KB doc id starts `passport`. `matchedDocumentId` = that doc's id. If nothing matches → `uploaded:false, matchedDocumentId:null`. Keep it a single documented function `matchDocument(kbDoc, uploadedDocs): string | null`.
- Every `DocumentPlan.source` = the category's `source` (for required/optional) or the `conditionalDoc.source`.

- [ ] Steps: test — required doc absent → `effectiveRequirement:'required', uploaded:false`; a conditional doc, condition met → `required`; condition null → `conditionMet:null, effectiveRequirement:'not_applicable'`; `onwardOrReturnTicket:true` promotes the ticket doc; `matchDocument` matches `{originalName:'passport-scan.jpg'}` to KB `{id:'passport'}` and does NOT match `{originalName:'random.png'}` to `{id:'invitation_letter_indian_company'}`. → RED → implement → GREEN → commit `feat(application): document-rule resolver + upload match heuristic  <trailer>`.

**Task 11 report + stop.** *(report "Task 10")*

---

### Task 11: `buildApplicationPlan` — sections + documents + eligibility

**Files:** Create `src/shared/application/buildApplicationPlan.ts`
**Test:** `test/shared/application/buildApplicationPlan.test.ts` + `test/helpers/applicationFixtures.ts`

`buildApplicationPlan(input: BuildApplicationPlanInput): ApplicationPlan`.
1. `category = getCategory(input.selection.categoryId, input.kb)` — null → return a plan with `category:null`, `eligibility.status:'unknown'`, empty sections/documents, a plan-level `Warning`, `readyForAutomation:{ready:false, blockers:[{kind:'eligibility', text:'unknown visa category', source:null}]}`.
2. `ctx = { applicant, selection, applicationValues, category, now }`.
3. `flat = flattenApplicant(applicant)` — a `Record<profilePath, {value, present, verified}>` from identity/passport/contact/address/family/occupation + `fieldMeta` + `documentCoverage`. `resolveValue(appliesTo)` reads `flat[appliesTo]` for a profile path, `applicationValues[appliesTo]` for an `application.*` path, and for the synthetic `india_references_min` counts `references` of kind `in_country_host`.
4. `sections = resolveFieldPlans({ category, formModel: getFormModel(input.kb).sections … , ctx, resolveValue })` (Task 9), then fill `value`/`present`/`verified` per field.
5. `documents = resolveDocumentPlans({ category, ctx, documentCoverage })` (Task 10).
6. `eligibility = evaluateEligibility({ nationality: applicant.identity.nationality, selection, applicant, applicationValues, kb, now })` (Task 8).
7. `provenance = { kbVersion: kb.meta.kbVersion, kbRevisionDate: kb.meta.revisionDate, schemaVersion: kb.meta.schemaVersion, computedAt: now.toISOString() }`.
8. `warnings` — plan-level: category-not-in-KB; (the pin-divergence warning is added by the **service**, which knows the pin — the engine doesn't; note this).
9. `missing` / `verification` / `readyForAutomation` — **Task 12** (return placeholders here or split the function; **decision: `buildApplicationPlan` calls the Task-12 helpers**, which land in the same `buildApplicationPlan.ts` file or a sibling `readiness.ts`).

**`test/helpers/applicationFixtures.ts`** — a `syntheticApplicant()` builder (fully-populated synthetic `FlatApplicant`: invented "RANA / MITHU" holder, valid future passport, married, an `in_country_host` reference, etc.) + `syntheticSelection(overrides)` + `emptyDocumentCoverage()` + `coverageWith(fieldPaths)`. Reused by Tasks 11, 12, 19, 20.

- [ ] Steps: test — for `regular.tourist` with the synthetic applicant: `sections` includes `family` (applicable), `business_details` NOT applicable; `documents` includes the required tourist docs; `eligibility.status` is `eligible`/`conditional`; `provenance.kbVersion` matches `meta.json`; determinism (two calls, same `now` → deep-equal except nothing, since `computedAt` = `now.toISOString()` is stable); `category:null` path. → RED → implement (+ `flattenApplicant`) → GREEN → typecheck + lint → commit `feat(application): buildApplicationPlan — sections, documents, eligibility  <trailer>`.

**Task 12 report + stop.** *(report "Task 11")*

---

### Task 12: missing / verification rollup / readiness gate + barrel

**Files:** `src/shared/application/buildApplicationPlan.ts` (or `readiness.ts`), `src/shared/application/index.ts`
**Test:** `test/shared/application/readiness.test.ts`

- `computeMissing(sections, documents): MissingItem[]` — every `FieldPlan` with `effectiveRequirement === 'required' && !present` → `{ kind:'field', id, label, sectionId, appliesTo, source }`; every `DocumentPlan` with `effectiveRequirement === 'required' && !uploaded` → `{ kind:'document', id, label, source }`. **Excludes** optional and `conditionMet:null` items.
- `computeVerification(sections): VerificationRollup` — over `FieldPlan`s with `effectiveRequirement === 'required'`: `requiredTotal`, `requiredVerified` (`present && verified`), `ratio`, `label` (`verified` if ratio 1 & total>0, `unverified` if 0, else `partial`), `bySection`.
- `computeReadiness(eligibility, sections, documents, warnings): { ready, blockers }` — the 5 conditions of spec §6.6. Blockers: eligibility status not in {eligible,conditional} → `{kind:'eligibility', source: eligibility.source}`; each `unmetConditions` → `{kind:'eligibility', text, source}`; each required-absent field → `{kind:'field', text:'<label> is required', source}`; each required-absent doc → `{kind:'document', source}`; each `Warning.severity==='blocker'` → `{kind:'warning', source}`. `ready = blockers.length === 0`.
- `index.ts` — `export * from` types, schemas, conditions, eligibility, formRules, documentRules, buildApplicationPlan.

- [ ] Steps: test — synthetic fully-populated `regular.tourist` application → `missing:[]`, `readyForAutomation.ready === true`, `blockers:[]`; blank one required field → `ready:false`, a `missing` field item + a `blocker` naming it; blank one required doc → same for a doc; verification rollup counts required-only; a `null`-condition field is NOT in `missing` and does NOT appear in `blockers`; verification at ratio 0.5 does NOT make `ready:false`. → RED → implement → GREEN → full gate → commit `feat(application): missing info, verification rollup, readiness gate  <trailer>`.

**Task 13 report + stop.** *(report "Task 12")*

---

### Task 13: `applicationService`

**Files:** Create `src/server/services/applicationService.ts`; modify `src/server/services/applicantService.ts` only if a `getFlatApplicant` helper is cleaner (optional)
**Test:** `test/server/applicationService.test.ts`

Per spec §9.1. `getApplication` assembles: `getApplicantDetail(db, applicantId)` → flatten to `FlatApplicant` (identity/passport/contact/address/family/occupation/travel/references/fieldMeta); `documentCoverage` from `listDocuments(db, applicantId)` + `getDocument` per doc (kind, originalName, fields with verified); `applicationValues` from `application_field_values`; `loadKnowledgeBase()`; `now = new Date()`. Call `buildApplicationPlan`. If `application.kb_version !== kb.meta.kbVersion` → push the pin-divergence `Warning` onto `plan.warnings`. **No engine logic in the service** — it only shapes inputs and forwards.

`createApplication` — validate `categoryId` via `getCategory` (null → `ApplicationServiceError('invalid_category')`) + `validateCombination({ applicationMode, categoryId })` for `MODE_MISMATCH` → `ApplicationServiceError('mode_mismatch')`. Pin `kb_version = loadKnowledgeBase().meta.kbVersion`. `updateApplication` recomputes and sets `status` to `'ready'` when `plan.readyForAutomation.ready` (and back to `'draft'` if not, unless `'archived'`). `setApplicationFieldValue` — upsert into `application_field_values` (mirror `upsertFieldMeta`'s shape; `verified` never auto-set to 1 except by an explicit `{verified:true}`).

- [ ] Steps: test (temp DB, synthetic applicant with `family`/`occupation` populated) — create pins `kb_version`; `getApplication` returns `{application, plan}` with a real plan; `setApplicationFieldValue('application.indiaCompanyName','ACME')` → the plan's `business_details` field becomes `present`; a 2nd application for the same applicant is independent; `createApplication` with a bogus category → `invalid_category`; mode/category mismatch → `mode_mismatch`; delete cascades `application_field_values`; a stale `kb_version` → plan has the info warning. → RED → implement → GREEN → full gate → commit `feat(server): applicationService — CRUD + plan assembly + field values  <trailer>`.

**Task 14 report + stop.** *(report "Task 13")*

---

### Task 14: REST — `routes/applications.ts`

**Files:** Create `src/server/routes/applications.ts`; modify `src/server/app.ts`
**Test:** `test/server/applicationRoutes.test.ts`

The §9.2 endpoints, following `routes/applicants.ts` patterns (Zod `safeParse` → `validationError`; `notFoundError`; service → sanitized envelope). `ApplicationServiceError` → `invalid_category`/`mode_mismatch` → 400/409; `not_found` → 404; `invalid_field` → 400. Register in `app.ts` after `registerApplicantRoutes`.

- [ ] Steps: test (build server, temp DB) — `POST /api/applicants/:id/applications` → 201 `{application}` with `kbVersion`; `GET` list; `GET /api/applications/:id` → `{application, plan}`; `PUT` selection → recomputed plan; `PUT .../field-values {fieldPath:'application.x', value:'y'}` → plan reflects it; `PUT .../field-values {fieldPath:'Bad.Path'}` → 400; `DELETE` → 404 after; unknown applicant/application → 404 envelope; bogus category on create → 400 sanitized. Assert no request body logged. → RED → implement → GREEN → full gate → commit `feat(api): visa application routes  <trailer>`.

**Task 15 report + stop.** *(report "Task 14")*

---

### Task 15: REST — applicant `family` / `occupation`

**Files:** `src/server/routes/applicants.ts`
**Test:** `test/server/applicantRoutes.test.ts` (extend)

`PUT /api/applicants/:id` already validates via `applicantPutSchema` (extended in Task 5) — confirm `family` / `occupation` section patches flow to `updateApplicant`. Add explicit route tests.

- [ ] Steps: test — `PUT /api/applicants/:id { family: { fatherName: 'X', maritalStatus: 'married' } }` → 200, `GET` shows it; a bad enum (`maritalStatus: 'nope'`) → 400 sanitized; `occupation` partial patch. → RED (if the route didn't wire the sections) → implement → GREEN → full gate → commit `feat(api): applicant family/occupation section patches  <trailer>`.

**Task 16 report + stop.** *(report "Task 15")*

---

### Task 16: web — API client + Applications subsection + Family/Occupation SectionCards

**Files:** `src/web/src/api/client.ts`, `src/web/src/pages/Applicants/ApplicationsSubsection.tsx` (create), `src/web/src/pages/Applicants/ApplicantDetailPage.tsx`, `src/web/src/main.tsx`, `src/web/src/App.tsx` (route), `src/web/src/styles.css`, `src/web/src/pages/Applications/ApplicationDashboardPage.tsx` (5-line stub for the route)
**Test:** `test/web/apiClient.test.ts` (extend), `test/web/ApplicationsSubsection.test.tsx` (create), `test/web/ApplicantDetailPage.test.tsx` (extend for the SectionCards)

- `api/client.ts`: `createApplication(applicantId, body)`, `listApplications(applicantId)`, `getApplication(id)`, `updateApplication(id, patch)`, `setApplicationFieldValue(id, {fieldPath, value?, verified?})`, `deleteApplication(id)`. Types from `../../../shared/application/types`.
- `ApplicationsSubsection` — list (`api.listApplications`): category display name, mode, status, `readyForAutomation.ready ? 'ready' : 'in progress'` (from a lightweight fetch of each? — no: the list endpoint returns summaries without the plan; show `status` only, and "readiness" is on the dashboard). Columns: category, mode, status, kbVersion, created. "New application" → a small form (mode → category from `listCategories`/`getCategoriesForMode` in the visa-kb module — import it directly, the SPA already bundles the KB) → `POST` → navigate `/applications/:id`.
- `ApplicantDetailPage` — add `<ApplicationsSubsection applicantId={id} />` + `<SectionCard title="Family" sectionKey="family" fields={FAMILY_FIELDS} … />` + `<SectionCard title="Occupation" … />` (define the field lists; `maritalStatus`/`militaryPolice`/`pakistanAncestry` as `type:'select'`).
- `main.tsx`: `{ path: 'applications/:id', element: <ApplicationDashboardPage /> }`.

- [ ] Steps: tests → RED → implement → GREEN → typecheck ×4 + lint + build (bundle size check — the KB JSON is already bundled) → commit `feat(web): applications subsection + family/occupation cards + api client  <trailer>`.

**Task 17 report + stop.** *(report "Task 16")*

---

### Task 17: web — `/applications/:id` dashboard A (Visa selection · Eligibility · Required information)

**Files:** `src/web/src/pages/Applications/ApplicationDashboardPage.tsx`, `.../VisaSelectionSection.tsx`, `.../EligibilitySection.tsx`, `.../RequiredInfoSection.tsx`, `src/web/src/styles.css`
**Test:** `test/web/ApplicationDashboardPage.test.tsx`

`ApplicationDashboardPage` loads `api.getApplication(id)` → `{application, plan}`; renders a page header + the 7 anchored `<section>`s (A here, B in Task 18), each with a **status chip** derived from the plan. Reload after any mutation.
- **VisaSelection** — form bound to `application`; `PUT /api/applications/:id`. Category options from the visa-kb module (`listCategories({ applicationMode })`).
- **Eligibility** — `plan.eligibility`: status badge; `conditions` list with ✓ / ✗ / `?` (review) per `conditionMet` (`true`/`false`/`null`); `warnings` with severity + a source `<a href={source.officialUrl}>` and the `confidence` label. Explicit "Review required — the app cannot determine this" for `conditionMet === null`.
- **RequiredInfo** — `plan.sections.filter(s => s.applicable)`; per `FieldPlan` with `effectiveRequirement !== 'not_applicable'` OR (`requirement === 'conditional' && conditionMet === null`): label, requirement chip, value (or "—"), `present`/`verified` indicators, source link. Profile-mapped (`appliesTo` not starting `application.`) → value + "Edit in profile" `<Link to={/applicants/:applicantId}>`. Application-scoped → inline `<input>`/`<select>` → `api.setApplicationFieldValue`.

- [ ] Steps: test with a mocked `getApplication` returning a crafted plan — the 7 section headings render with chips; a `conditionMet:null` condition shows the review text (not "failed"); an application-scoped field input calls `setApplicationFieldValue`; a profile field shows "Edit in profile" linking to the applicant; the confidence label renders; no bare "%". → RED → implement → GREEN → gate → commit `feat(web): application dashboard — selection, eligibility, required info  <trailer>`.

**Task 18 report + stop.** *(report "Task 17")*

---

### Task 18: web — `/applications/:id` dashboard B (Documents · Missing · Verification · Ready)

**Files:** `.../RequiredDocumentsSection.tsx`, `.../MissingInfoSection.tsx`, `.../VerificationSection.tsx`, `.../ReadyForAutomationSection.tsx`, `src/web/src/styles.css`
**Test:** `test/web/ApplicationDashboardPage.test.tsx` (extend)

- **RequiredDocuments** — `plan.documents`: requirement chip, `uploaded` state, matched doc name (link to `/documents/:id`), source. An upload control **reusing Phase 3** (`api.uploadDocument(file, applicantId)` then `api.extractDocument`, then reload the plan).
- **MissingInfo** — `plan.missing`: each item — what, `kind` (field/document), where (an anchor `<a href="#section-...">`), source.
- **Verification** — `plan.verification`: `requiredVerified` / `requiredTotal` / ratio / label + `bySection`. Per-field verify buttons reuse the Phase 2 `api.setFieldMeta` for profile fields and `api.setApplicationFieldValue({verified:true})` for application fields. Never silently verify.
- **ReadyForAutomation** — `plan.readyForAutomation`: a big status line; `blockers` list each with source; a large `<button disabled>Start automation (Phase 5)</button>` with **no `onClick`** and helper text: "Available in Phase 5. This does not submit anything, and does not mean the visa is approved."

- [ ] Steps: test — documents render with state; missing list renders with anchor links; verification rollup renders; the Phase 5 button is present, `disabled`, and has no click handler (`fireEvent.click` does nothing / assert `.disabled`); readiness `false` shows blockers with sources. → RED → implement → GREEN → full gate + build → commit `feat(web): application dashboard — documents, missing, verification, ready gate  <trailer>`.

**Task 19 report + stop.** *(report "Task 18")*

---

### Task 19: guard tests — architecture · provenance · engine purity

**Files:** Create `test/shared/application/enginePurity.test.ts`, `test/shared/application/architectureGuard.test.ts`, `test/shared/application/provenanceGuard.test.ts`
**Test:** the three above

- **enginePurity** — read every `.ts` under `src/shared/application/`; assert none import from `node:*`, `fastify`, `react`, `../server`, `../../server`, and none reference `process.env` / `import.meta.env` (comment-stripped). Mirrors `documentsNoNetwork.test.ts`.
- **architectureGuard** (spec §3/§11.7) — read every `.ts` under `src/shared/application/`, `src/server/services/applicationService.ts`, `src/server/routes/applications.ts`, and every `.tsx` under `src/web/src/pages/Applications/`; comment-strip; assert **no** match for `/['"](evisa|regular)\.[a-z0-9_][a-z0-9_.]*['"]/`. (Exempt: KB data files, `src/shared/visa-kb/**`, test files.)
- **provenanceGuard** (spec §8/§32) — `for (const cat of listCategories())`: build a plan with the `syntheticApplicant()` fixture (+ a `married` and a `minor` variant) and a `syntheticSelection({ categoryId: cat.id, applicationMode: cat.applicationMode, purpose: cat.purpose[0], intendedArrivalDate: <+60d>, entryType: 'single' })`; walk `plan.sections[].source`, `plan.sections[].fields[].source`, `plan.documents[].source`, `plan.warnings` (skip `source === null` **only** where `severity !== 'blocker'` and it's a known plan-level warning — assert the text is in an allow-list), `plan.eligibility.source` (null only if `status==='unknown'`), `plan.eligibility.conditions[].source`, `plan.missing[].source`, `plan.readyForAutomation.blockers[].source` (null allowed only for `kind==='warning'`); assert `officialUrl` is a non-empty http(s) string, `retrievedAt` matches `/^\d{4}-\d{2}-\d{2}$/`, `confidence` ∈ the 4 values. **Fails if a future category introduces an unsourced rule.**

- [ ] Steps: write all three → they should pass immediately if Tasks 1–12 are clean; if `provenanceGuard` fails, the fix is in the **KB data** (a missing source), not the engine — fix the data. → GREEN → full gate → commit `test(application): engine purity, no-category-literal, provenance-across-every-category guards  <trailer>`.

**Task 20 report + stop.** *(report "Task 19")*

---

### Task 20: category-specific + conditional + eligibility + readiness suites; full regression

**Files:** Create `test/shared/application/categories.test.ts`, `test/shared/application/conditionalRequirements.test.ts`, `test/shared/application/readinessScenarios.test.ts`
**Test:** the above + `npm test` full

Implement §11.2 / §11.3 / §11.4 / §11.6 exactly (the category matrix, married/minor/unknown conditions, passport-validity failure, the fully-populated → ready → remove-field/doc → not-ready scenarios). Use the `applicationFixtures` helpers. Each test asserts on the **plan object** (never via React).

- [ ] Steps: write all → RED (some will already pass from earlier tasks; the point is the explicit named coverage) → adjust KB data or engine ONLY if a genuine bug surfaces (report it, don't paper over) → GREEN → **full gate** `npm run typecheck && npm run lint && npm test && npm run build` → record counts → commit `test(application): category-specific, conditional, eligibility & readiness suites  <trailer>`.

**Task 21 report + stop.** *(report "Task 20")*

---

### Task 21: `docs/PHASE-4-REPORT.md` + `ARCHITECTURE.md` + manual smoke

**Files:** Create `docs/PHASE-4-REPORT.md`; modify `docs/ARCHITECTURE.md`
**Steps:**
- [ ] Full gate; record all numbers.
- [ ] **Manual smoke** (`npm run build && PORT=<free> node dist/server/index.js`): create an applicant, fill identity + passport + family (married) + occupation; create a `regular.business` application; open `/applications/:id`; observe the 7 sections + chips; see `business_details` fields required, `india_references_min` blocking; add an `in_country_host` reference + fill the India company fields; upload the invitation-letter document; watch `readyForAutomation` flip; confirm the Phase 5 button is disabled and does nothing. Then a `regular.transit` application — confirm minimal sections, no business fields. Screenshot into the report.
- [ ] Write `PHASE-4-REPORT.md` — sections: what was built (KB v2, engine, persistence, UI) · the 3 architecture rules and how each is enforced (purity test, no-category-literal test, provenance test) · data model (migration 4) · the engine contract · condition semantics (true/false/null) · readiness-gate semantics (verification not gating) · the applicant/application boundary · security/PII · acceptance §12 checklist (19 items, PASS/PARTIAL + evidence) · deferred follow-ups · recommended Phase 5 scope.
- [ ] `ARCHITECTURE.md` paragraph (source-layout section, mirroring the Phase 1–3 paragraphs).
- [ ] Commit `docs: Phase 4 report — India visa application builder  <trailer>`.

**Task 21 report + stop. Then: whole-branch review (opus) per spec §41.**

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §2 pure engine | 6–12; §19 purity guard |
| §3 India rules in KB | 1–3 (data); §19 architecture guard |
| §4 KB v2 schema | 1 |
| §4.1 sourceConfidence | 1 (schema) + 2 (data) |
| §5 condition evaluator | 7 |
| §6 engine contract | 6 (types) + 8–12 |
| §6.4 eligibility auto-eval | 8 |
| §6.5 passport validity | 8; §11.4 test in 20 |
| §6.6 readiness gate | 12 |
| §7 migration 4 | 4 + 5 |
| §8 provenance invariant | 1–3 (sources in data) + 19 (guard) |
| §9 server | 13 + 14 + 15 |
| §10 web | 16 + 17 + 18 |
| §11 test matrix | 7–12 (unit), 19 (guards), 20 (categories/conditional/eligibility/readiness) |
| §12 acceptance | 21 (report) |
| §13 execution | this plan |

No gap identified. The document-match heuristic (§6.2) is made concrete in Task 10. The KB-authoring volume (§4/§8) is split across Tasks 2 (form-model) and 3 (per-category rules).

**2. Placeholder scan** — the only soft spots are bounded and named: Task 10's match heuristic (a concrete documented function, with the fallback "no match → not uploaded"), and Task 1's decision to ship green-keeping skeletons that Tasks 2–3 replace (stated explicitly). Task-report numbering has an off-by-one in the "report + stop" lines (each says the *next* task's number) — cosmetic, the `### Task N` headers are correct.

**3. Type consistency** — `FormCondition` (Task 1) ↔ `ConditionContext` / `evaluateCondition` (Task 7) ↔ used by `formRules.ts` (9), `documentRules.ts` (10), `eligibility.ts` (8). `SectionPlan`/`FieldPlan`/`DocumentPlan`/`ApplicationPlan` defined in Task 6 `types.ts`, produced by 9/10/11, consumed by 12/13/17/18/19/20. `FlatApplicant` / `BuildApplicationPlanInput` (6) → `buildApplicationPlan` (11) → assembled by `applicationService.getApplication` (13). `VisaApplication` row shape (6) ↔ migration 4 columns (4) ↔ service (13) ↔ routes (14) ↔ client (16). `SECTION_TABLES` `family`/`occupation` (4) ↔ `familySchema`/`occupationSchema` (5) ↔ `Family`/`Occupation` types (5) ↔ SectionCards (16). `PROFILE_FIELD_PATHS` introduced in Task 5, retro-fitted into the Task 1 loader check (noted in both).

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-04-phase-4-visa-application-builder.md`.

Per the master instruction §43: **subagent-driven, one task at a time, stop for review after each.** Starting with Task 1.
