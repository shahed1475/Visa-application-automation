# Phase 1 — End-of-Phase Report

**Project:** Visa Application Autofill (local-first)
**Phase:** 1 — India Visa Knowledge Base (versioned JSON + pure query API + read-only reference page)
**Date:** 2026-09-03
**Branch:** `phase-0-portal-settings` (established non-main working branch for all phases)
**Spec:** `docs/superpowers/specs/2026-09-02-phase-1-india-visa-kb-design.md`
**Plan:** `docs/superpowers/plans/2026-09-02-phase-1-india-visa-kb.md`
**Final commit:** this docs commit — HEAD of `phase-0-portal-settings` (adds this report + the `ARCHITECTURE.md` §3 note); last implementation commit `d0e2836`
**Overall status: PASS**

Phase 1 adds one self-contained module (`src/shared/visa-kb/`) and one React page
(`/visa-rules`). It changes no existing runtime behaviour: no schema migration, no
new HTTP route, no new dependency, no browser-automation / CAPTCHA / OTP code.

---

## 1. Data model

The schema is `src/shared/visa-kb/schema.ts` (Zod, 169 lines; every object schema
is `.strict()`; TS types are `z.infer` exports). It is described in spec §4. A
knowledge base is `{ meta, categories[], eligibility[] }`:

- **`meta`** (`metaSchema`, `data/india/meta.json`) — `schemaVersion` (shape
  version; loader rejects any value not in `KNOWN_SCHEMA_VERSIONS = [1]`),
  `kbVersion` (content version, bumped on any data edit), `destination` (`"IND"`),
  `revisionDate`, optional `notes`.
- **`categories`** (`visaCategorySchema`) — one shape for both application modes;
  e-Visa entries live in `evisa-categories.json` (11), Regular/Paper in
  `regular-categories.json` (9).
- **`eligibility`** (`eligibilityRecordSchema`) — one explicit record per
  `(nationality, applicationMode, categoryId)`, in `eligibility.bgd.json` (20).
  `status ∈ {eligible, conditional, ineligible, not_offered}`; `conditions[]` is a
  12-member discriminated union (`conditionSchema`) that is **descriptive data**
  — nothing evaluates it against an applicant in Phase 1.

### The 17 required fields — where each lives

| # | Field | Schema location | Seed-data example |
|---|---|---|---|
| 1 | nationality | `eligibilityRecordSchema.nationality` (ISO 3166-1 alpha-3) | `"BGD"` on all 20 records in `eligibility.bgd.json` |
| 2 | destination | `metaSchema.destination` (loader enforces `=== "IND"`) | `meta.json` → `"IND"` |
| 3 | applicationMode | `visaCategorySchema.applicationMode` + `eligibilityRecordSchema.applicationMode` (`"evisa"` \| `"regular"`) | separate files: `evisa-categories.json` all `"evisa"`, `regular-categories.json` all `"regular"` |
| 4 | visa category | `visaCategorySchema.category` (12-value enum) + `.id` slug | `evisa.tourist.30d`, `regular.medical`, … |
| 5 | subCategory | `visaCategorySchema.subCategory` (string \| null) | `"e-Tourist (30 days)"` on `evisa.tourist.30d` |
| 6 | eligibility rules | `eligibilityRecordSchema` (`status` + `conditions[]` + `basis`) | `eligibility.bgd.json` — 17 `eligible`, 3 `conditional` |
| 7 | required documents | `visaCategorySchema.requiredDocuments` (`docSchema[]`) | `regular.tourist` — passport, photo, form, address proof, financial proof |
| 8 | optional documents | `visaCategorySchema.optionalDocuments` (`docSchema[]`) | `regular.tourist` — prior visa copy, relative invitation |
| 9 | travel requirements | `visaCategorySchema.travelRequirements` (`travelRequirementsSchema`) | `evisa.tourist.30d` — 6-month passport validity, 2 blank pages, onward ticket |
| 10 | validity | `visaCategorySchema.validity` (`validitySchema`: amount/unit/from) | `evisa.tourist.1y` — `{1, years, eta_grant}` |
| 11 | entries | `visaCategorySchema.entries` (`single`\|`double`\|`multiple`) | `evisa.tourist.30d` → `"multiple"` |
| 12 | stay limitations | `visaCategorySchema.stayLimitations` (`stayLimitationsSchema`) | `evisa.tourist.1y` — `perCalendarYearDays: 180` |
| 13 | application timing | `visaCategorySchema.applicationTiming` (`applicationTimingSchema`) | `evisa.tourist.30d` — `minLeadDays: 4`, `maxLeadDays: 120` |
| 14 | special conditions | `visaCategorySchema.specialConditions` (`string[]`) | `evisa.tourist.30d` — "Biometric details … captured … on arrival" |
| 15 | restrictions | `visaCategorySchema.restrictions` (`string[]`) | `evisa.tourist.30d` — "Non-extendable and non-convertible", "Not permitted for employment…" |
| 16 | source URL | `sourceSchema.officialUrl` (http(s) URL) on every category **and** eligibility record | `https://indianvisaonline.gov.in/evisa/tvoa.html` |
| 17 | source date / version | `sourceSchema.retrievedAt` (+ optional `documentDate`) and `lastVerified` per entry; `meta.kbVersion` + `meta.revisionDate` KB-wide | `retrievedAt: "2026-09-03"`, `documentDate: "2019-05-16"`, `lastVerified: "2026-09-03"` |

Supporting sub-shapes also modelled: `officialCode`, `displayName`, `purpose[]`
(14-tag enum), `extendable`, `convertible`.

---

## 2. Files created / changed

`git diff --stat b78ae80..HEAD` (Phase 1 range — `0e6172c` spec through this
commit). Excludes the spec/plan docs, which are process artefacts:

**Created — module**
- `src/shared/visa-kb/schema.ts` (168) — Zod schema + inferred types
- `src/shared/visa-kb/loader.ts` (84) — validate → cross-check → deep-freeze → cache; `parseKnowledgeBase` / `loadKnowledgeBase` / `reload` / `KnowledgeBaseError`
- `src/shared/visa-kb/queries.ts` (156) — the 8 pure query/validation functions
- `src/shared/visa-kb/index.ts` (3) — public barrel (`export *` of schema + loader + queries)

**Created — data (`src/shared/visa-kb/data/india/`)**
- `meta.json` (7) — schemaVersion 1, kbVersion `2026-09-03`, destination `IND`
- `evisa-categories.json` (515) — 11 e-Visa categories
- `regular-categories.json` (386) — 9 Regular/Paper categories
- `eligibility.bgd.json` (309) — 20 explicit Bangladesh eligibility records
- `SOURCES.md` (66) — the S1–S6 source tables + "how to update a rule"

**Created — web**
- `src/web/src/pages/VisaRules/VisaRulesPage.tsx` (170) — read-only `/visa-rules` page, imports the shared module directly

**Created — tests**
- `test/shared/visaKb/schema.test.ts` (121) — 16 tests
- `test/shared/visaKb/loader.test.ts` (85) — 10 tests
- `test/shared/visaKb/queries.test.ts` (173) — 22 tests
- `test/shared/visaKb/data.test.ts` (104) — 12 tests (real-KB integrity guard)
- `test/web/VisaRulesPage.test.tsx` (66) — 4 tests

**Created — config**
- `tsconfig.test.json` (7) — extends `tsconfig.web.json`, `noEmit`, `include` = `src/**` + `test/**`
  (superseded in the fix wave by `tsconfig.test.node.json` + `tsconfig.test.web.json` — see §8)

**Changed**
- `tsconfig.server.json` (+3 / -1) — `exclude: ["src/shared/visa-kb/**"]` (JSON-importing module is not part of the server emit)
- `package.json` (+1 / -1) — `typecheck` script chained with the test config(s)
- `.gitignore` (+2) — un-ignore `src/shared/visa-kb/data/` (root `data/` still ignores the DB)
- `src/web/src/main.tsx` (+2) — `/visa-rules` route
- `src/web/src/App.tsx` (+1) — nav link
- `src/web/src/styles.css` (+14) — page styles
- `test/server/applicantService.test.ts` (+13 / -3), `test/server/migrations.test.ts` (+3 / -3) — pre-existing type errors surfaced by `tsconfig.test.json`, fixed mechanically (`!` assertions, row casts); no assertion or behaviour changed
- `docs/ARCHITECTURE.md` (+10) — the Phase 1 module paragraph (§3)
- `docs/PHASE-1-REPORT.md` — this file

Totals for the range: 26 files, +4913 / -13 (includes the 2 070-line plan and the
390-line spec).

---

## 3. Official sources used

Reproduced from `src/shared/visa-kb/data/india/SOURCES.md`. **Honesty note:** on
2026-09-03 the e-Visa portal pages were retrievable and are the primary e-Visa
source. `mha.gov.in` returned **HTTP 403** and `boi.gov.in` **HTTP 404**;
`hcidhaka.gov.in`'s landing page did load, but the category-wise requirements
live in a PDF that was not machine-retrievable, so **no per-category HCI Dhaka
page was ever fetched** — the Regular values rest on generally-published
guidance. Each affected record discloses this in its own `source.notes`. See §8.

### e-Visa

| # | URL | Retrieved | Sourced | Notes |
|---|---|---|---|---|
| S1 | https://indianvisaonline.gov.in/evisa/tvoa.html | 2026-09-03 | Per-sub-type validity, entries, stay limits, application-timing window, exclusions, ports of entry | Page "Last Updated" stamp **2019-05-16** — recorded as `source.documentDate` on every e-Visa entry. Authoritative detail page; used as `source.officialUrl` for all 11 e-Visa categories. |
| S2 | https://indianvisaonline.gov.in/evisa/ | 2026-09-03 | Bangladesh on the eligible list ("14.Bangladesh"); required-documents-by-type; the admissible e-Visa categories; biometrics-on-arrival | Portal landing page; used to cross-check S1 and as `source.officialUrl` for every e-Visa eligibility record. |

### Regular / Paper

| # | URL | Retrieved | Sourced |
|---|---|---|---|
| S3 | https://indianvisaonline.gov.in/visa/visa-provision.html | 2026-09-03 | Tourist / Business / Employment / Student / Transit validity, entries, extension rules; FRRO 14-day / 180-day rule |
| S4 | https://indianvisaonline.gov.in/visa/visa-category.html | 2026-09-03 | The regular visa category list |
| S5 | https://hcidhaka.gov.in/ | 2026-09-03 (**landing page only — the category-wise document PDF was not machine-retrievable, so no per-category page was actually fetched**) | Bangladesh-national rules: passport 6 months + 2 blank pages; authorised Immigration Check Posts; no visa fee for Bangladeshi passport holders; Tourist by online appointment, others walk-in at IVAC. Used as `source.officialUrl` for every Regular eligibility record. |
| S6 | https://indianvisaonline.gov.in/visa/visa-category.html — closest retrievable page for the MHA visa manual / India–Bangladesh Revised Travel Arrangement | 2026-09-03 (**underlying MHA source not machine-retrievable — `mha.gov.in` 403**) | 5-year multiple-entry tourist visa for BGD nationals 65+; Employment remuneration threshold; progressive 2026 restoration of visa services (tourist processing resumed 28 Jun 2026); Conference MEA/MHA clearance; Transit / Entry(X) terms |

### Entries flagged stale / ambiguous / re-verify

- **All 11 e-Visa entries** carry `source.documentDate: "2019-05-16"` — the source
  page is stale-dated. Values were cross-checked against the S2 landing page at
  retrieval; each entry's `source.notes` records the cross-check.
- **Regular per-category document lists** and the **Medical / Medical Attendant /
  Conference / Entry(X)** terms rest on generally-published guidance (S4/S5/S6),
  because the category-authoritative HCI-Dhaka PDFs were not machine-retrievable.
  Every such entry carries a `source.notes` "re-verify against hcidhaka.gov.in
  before operational use" flag.
- `regular.employment` / `regular.conference` are `status: conditional` (external
  prerequisite — remuneration threshold, MEA/MHA clearance), not `eligible`.

---

## 4. Tests

`npm test` → **211 passed / 211** (25 files). Phase 0/2 baseline was 147; Phase 1
adds **64** across 5 files:

| File | Tests | Covers |
|---|---|---|
| `test/shared/visaKb/schema.test.ts` | 16 | `metaSchema` (alpha-3, ISO date), `sourceSchema` (http(s) URL, strict extra-key reject), `visaCategorySchema` (mode / category enums, id slug, missing-source reject), `conditionSchema` (each type; unknown type reject), `eligibilityRecordSchema`, `knowledgeBaseSchema`, the exported tuples |
| `test/shared/visaKb/loader.test.ts` | 10 | `parseKnowledgeBase` deep-freeze; `KnowledgeBaseError` naming the field; unknown `schemaVersion`; duplicate ids; dangling `eligibility.categoryId`; mode mismatch; duplicate `(nationality, mode, categoryId)`; non-IND destination; `loadKnowledgeBase` caching + `reload()` |
| `test/shared/visaKb/queries.test.ts` | 22 | every query function against hand-built fixtures |
| `test/shared/visaKb/data.test.ts` | 12 | **the shipped KB**: schema-valid; the e-Tourist 30d/1y/5y split; real source URLs; `loadKnowledgeBase()` passes all cross-checks; every category has exactly one BGD record (`bgd.length === categories.length`); every e-Visa record encodes the universal exclusions; provenance on every entry |
| `test/web/VisaRulesPage.test.tsx` | 4 | renders the e-Visa list + KB version; mode toggle switches to Regular; detail panel shows docs + eligibility + external source link; unknown-eligibility category shows "no rule recorded" and never bare "eligible" |

### The six required areas → specific tests

| Required area (spec §9) | Test(s) |
|---|---|
| category lookup | `queries.test.ts` → `describe('category lookup')` — `getCategory returns the entry or null`, `listCategories with no filter returns every entry`, `listCategories filters by category name` |
| application-mode filtering | `queries.test.ts` → `describe('application-mode filtering')` — `getCategoriesForMode returns only that mode`, `never leaks the other mode`, `listCategories({ applicationMode }) agrees with getCategoriesForMode` |
| nationality eligibility | `queries.test.ts` → `describe('nationality eligibility')` — `returns the explicit record for a known tuple`, `returns unknown — never inferred — when no record exists`, `surfaces an explicit not_offered / ineligible rather than hiding it`, `listEligibleCategories returns only eligible/conditional…` |
| document requirements | `queries.test.ts` → `describe('document requirements')` — `returns required + optional for a known category`, `returns { required, optional: [] } for a category with no optional docs`, `returns null for an unknown category` |
| invalid category combinations | `queries.test.ts` → `describe('invalid category combinations')` — `UNKNOWN_MODE for a bad mode`, `UNKNOWN_CATEGORY for a missing id`, `MODE_MISMATCH when the id belongs to the other mode`, `NO_ELIGIBILITY_RULE when a nationality is given but no record exists`, `NOT_OFFERED / INELIGIBLE surface the explicit status`, `valid combo → { valid: true, categoryId }`, `valid without a nationality skips the eligibility checks` |
| versioned rules | `queries.test.ts` → `getVersion > returns the meta version fields`; `loader.test.ts` → `rejects an unknown schemaVersion`, `throws KnowledgeBaseError on a schema violation`; `data.test.ts` → `getVersion reports the meta version, and every entry carries provenance` |

### Data-integrity guard

`test/shared/visaKb/data.test.ts` → `describe('the shipped India KB — integrity &
versioning')` runs `loadKnowledgeBase()` against the real seed data and asserts:
loads without error (all §4.4 cross-checks pass); every category has exactly one
BGD eligibility record and `bgd.length === kb.categories.length`; every e-Visa
record contains `passport_type_not_in` + `no_prohibited_background`; every entry
has a well-formed `source.officialUrl` / `retrievedAt` / `lastVerified`; no
category silently implies eligibility. **This is the regression guard for every
future rule edit** — a dangling `categoryId`, a duplicate id, a missing source, or
a mode mismatch fails the gate.

---

## 5. Typecheck / Lint / Build

Run 2026-09-03 on branch `phase-0-portal-settings`, working tree clean.

### `npm run typecheck` — exit 0

```
> visa-autofill@0.0.0 typecheck
> tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.web.json && tsc -p tsconfig.test.node.json && tsc -p tsconfig.test.web.json
```

(No diagnostics, 4 passes. The test coverage is split in two so each half is
checked under the resolution it actually runs on: `tsconfig.test.node.json`
(extends the NodeNext base) covers `test/server`, `test/shared`, `test/helpers`,
`test/automation` + `src/server` + `src/shared`; `tsconfig.test.web.json`
(extends `tsconfig.web.json`) covers `test/web` + `src/web` + `src/shared`.)

### `npm run lint` — exit 0

```
> visa-autofill@0.0.0 lint
> eslint .
```

(No errors, no warnings.)

### `npm test` — exit 0

```
> visa-autofill@0.0.0 test
> cross-env NODE_OPTIONS=--disable-warning=ExperimentalWarning vitest run

 RUN  v3.2.7 C:/Users/Fahad/Desktop/Formal work/Visa application automation

 ✓ test/server/applicantService.test.ts (27 tests) 1087ms
 ✓ test/server/staticServing.test.ts (3 tests) 1380ms
 ✓ test/server/applicantRoutes.test.ts (18 tests) 1126ms
 ✓ test/automation/pageInspector.test.ts (1 test) 712ms
 ✓ test/server/loggerRedaction.test.ts (5 tests) 426ms
 ✓ test/server/portalService.test.ts (8 tests) 190ms
 ✓ test/server/health.test.ts (1 test) 264ms
 ✓ test/server/applicantMigrations.test.ts (5 tests) 116ms
 ✓ test/server/portalRoutes.test.ts (10 tests) 2830ms
 ✓ test/server/migrations.test.ts (3 tests) 75ms
 ✓ test/shared/visaKb/loader.test.ts (10 tests) 33ms
 ✓ test/shared/visaKb/queries.test.ts (22 tests) 20ms
 ✓ test/shared/visaKb/data.test.ts (12 tests) 37ms
 ✓ test/automation/testConnection.test.ts (5 tests) 4233ms
 ✓ test/shared/applicantSchemas.test.ts (24 tests) 23ms
 ✓ test/automation/noHardcodedUrl.test.ts (2 tests) 19ms
 ✓ test/shared/visaKb/schema.test.ts (16 tests) 14ms
 ✓ test/web/apiClient.test.ts (4 tests) 12ms
 ✓ test/server/schemas.test.ts (7 tests) 10ms
 ✓ test/server/applicantCompleteness.test.ts (10 tests) 8ms
 ✓ test/web/VisaRulesPage.test.tsx (4 tests) 224ms
 ✓ test/web/ApplicantsPage.test.tsx (4 tests) 462ms
 ✓ test/web/PortalsPage.test.tsx (2 tests) 74ms
 ✓ test/web/PortalForm.test.tsx (2 tests) 217ms
 ✓ test/web/ApplicantDetailPage.test.tsx (6 tests) 731ms

 Test Files  25 passed (25)
      Tests  211 passed (211)
   Duration  7.58s
```

(React Router v7 future-flag warnings on the web tests are pre-existing and
non-fatal.)

### `npm run build` — exit 0

```
> visa-autofill@0.0.0 build
> vite build && tsc -p tsconfig.server.json

vite v5.4.21 building for production...
✓ 68 modules transformed.
../../dist/web/index.html                   0.40 kB │ gzip:  0.27 kB
../../dist/web/assets/index-BIbs95K7.css    5.99 kB │ gzip:  1.66 kB
../../dist/web/assets/index-CSQ380IK.js   360.17 kB │ gzip: 97.82 kB
✓ built in 1.06s
```

(The KB JSON is bundled into the SPA — no runtime fetch. `tsc -p
tsconfig.server.json` emits `dist/server` with `src/shared/visa-kb/**` excluded.)

---

## 6. Commit hash

Final commit: the HEAD of `phase-0-portal-settings` after this commit —
"docs: Phase 1 report — India visa knowledge base" — adds `docs/PHASE-1-REPORT.md`
and the `docs/ARCHITECTURE.md` §3 paragraph, no `.ts` / `.tsx` / `.json` change.
(Its SHA is `git rev-parse HEAD` on the branch; the SDD `task-11-report.md`
records the value.)

Last implementation commit: `d0e2836` ("feat: India visa rules reference page").
Phase 1 range: `b78ae80..HEAD`, 13 commits (`0e6172c` spec, `28f86f5` plan, then
`777888a` `ed81fe9` `70ce3fe` `df6cd87` `9ce8d17` `ff378e7` `755d411` `89aa9b9`
`9675045` `d0e2836` and this one).

---

## 7. Acceptance checklist (spec §10)

- [x] **Data model documented** — spec §4 + `src/shared/visa-kb/schema.ts` + §1 of this report.
- [x] **All 17 fields represented in the schema and populated in the seed data** — see the §1 table; `test/shared/visaKb/data.test.ts` schema-validates every shipped entry.
- [x] **e-Visa categories represented separately from Regular/Paper** — `data/india/evisa-categories.json` (11) vs `regular-categories.json` (9); `visaCategorySchema.applicationMode`; `test/shared/visaKb/data.test.ts` → `all applicationMode "evisa"` / `all applicationMode "regular"`.
- [x] **Bangladesh e-Visa eligibility is a set of explicit records, one per sub-type** — `eligibility.bgd.json` has 20 records (one per category, incl. all 11 e-Visa sub-types); `data.test.ts` → `every category has exactly one Bangladesh eligibility record` asserts `bgd.length === kb.categories.length`. `checkEligibility` returns `{ status: 'unknown' }` when no record exists (`queries.ts:73-78`) — never inferred.
- [x] **Rules not hard-coded in any React component** — `VisaRulesPage.tsx` imports only `../../../../shared/visa-kb/index`; the sole string literal is `NATIONALITY = 'BGD'` (`VisaRulesPage.tsx:7`). `test/web/VisaRulesPage.test.tsx` mocks the module and asserts the page renders purely from it.
- [x] **Rule change = JSON edit + version bump, no code change** — loader reads the four JSON files (`loader.ts:1-4`, `71-79`); `SOURCES.md` → "How to update a rule"; the data-integrity test is the safety net.
- [x] **Tests for the six areas, all passing** — see §4 mapping table; 211/211.
- [x] **No browser automation, no CAPTCHA/OTP code added** — `git diff --stat b78ae80..HEAD` touches nothing under `src/server/automation/`; `test/automation/noHardcodedUrl.test.ts` still passes.
- [x] **`typecheck` · `lint` · `test` · `build` all green, test dirs now type-checked** — §5; `tsconfig.test.node.json` + `tsconfig.test.web.json` between them cover all five `test/**` directories, each under the resolution it runs on.
- [x] **`docs/PHASE-1-REPORT.md` covers: data model · files created/changed · official sources · tests · typecheck · lint · build · commit hash** — §1 / §2 / §3 / §4 / §5 / §6.
- [x] **Phase stops here; Phase 2's document system not started** — this commit is docs-only.

---

## 8. Known limitations

**Source access (2026-09-03).** The e-Visa portal pages
(`indianvisaonline.gov.in/evisa/tvoa.html`, `/evisa/`) were retrievable and are
the primary e-Visa source — but that detail page carries a **2019-05-16**
"last updated" stamp (recorded as `documentDate` on every e-Visa entry).
`mha.gov.in` returned **HTTP 403** and `boi.gov.in` **HTTP 404**. `hcidhaka.gov.in`
served its landing page, but the category-wise requirements are published only as
a "Documents Required for Visa" PDF that was **not machine-retrievable** — so no
per-category HCI Dhaka page was ever fetched, even though all 9 Regular
eligibility records carry `officialUrl: https://hcidhaka.gov.in/` and
`retrievedAt: 2026-09-03`. A number of Regular-visa values — the per-category
document lists, and the Medical / Medical Attendant / Conference / Entry(X) terms
— therefore rest on generally-published guidance cross-referenced across
HCI-Dhaka / IVAC-BD public material and the MHA visa manual. Every affected
record opens its `source.notes` with "NOT A LIVE CATEGORY FETCH…" and keeps the
"re-verify against hcidhaka.gov.in" flag, so the caveat travels with the data
rather than only with this report;
`test/shared/visaKb/data.test.ts` → "every Regular eligibility record sourced to
hcidhaka.gov.in discloses that the fetch was not live" enforces it.
**This is a known limitation, not a defect** — a correction is a one-JSON-file edit plus a `meta.kbVersion` bump, and
the data-integrity test catches structural regressions.

**Point-in-time snapshot.** The seed data is a 2026-09-03 snapshot. The
India–Bangladesh tourist-visa channel was suspended Aug 2024 and reopened
28 June 2026; standard tourist processing resumed then. Rules drift — the
design's whole point is that keeping up is a data edit.

**`meta.kbVersion` / entry-date skew — resolved.** `meta.kbVersion` and
`meta.revisionDate` were `2026-09-02` (set when the module was scaffolded) while
every entry's `source.retrievedAt` and `lastVerified` are `2026-09-03`. The
whole-branch review ruled that seeding all 40 entries is a material change under
`SOURCES.md` → "How to update a rule", so both `meta` fields are now `2026-09-03`.

**Only Bangladesh → India.** `nationality` is `BGD` on all 20 records;
`meta.destination` is `IND` and the loader enforces it. Other corridors are later
phases.

**Conditions are descriptive data with no evaluator.** `conditionSchema` is a
12-member union stored as data; nothing checks it against a real applicant in
Phase 1 (spec §2, §4.3). `VisaRulesPage` only formats conditions for display
(`formatCondition`).

**Test directories newly type-checked.** `tsconfig.test.json` (Task 1) added full
`test/**` + `src/**` coverage to `npm run typecheck`; 12 pre-existing errors in
`test/server/applicantService.test.ts` and `test/server/migrations.test.ts` were
fixed mechanically (`!` assertions, `SQLOutputValue` row casts) — no assertion or
behaviour changed. The whole-branch review then found that single config
overstated its coverage: it extended `tsconfig.web.json`, so server code and
server tests were checked under Bundler resolution with DOM libs and
`verbatimModuleSyntax: false` — a missing `.js` extension or a `document`
reference in server code type-checked clean and would only fail at NodeNext
runtime. It is now split into `tsconfig.test.node.json` (NodeNext base) and
`tsconfig.test.web.json` (web), each checking the half it describes. Both passes
were clean on the existing tree — no new errors were hidden — and a deliberate
`document.title` probe in `test/server/health.test.ts` now fails the Node pass
(`TS2584`), which the old config accepted.

**Deferred minor items (carried from the SDD ledger, none blocking):**

- **Task 2** — no test asserts `.strict()` extra-key rejection on a
  `conditionSchema` union member (only `sourceSchema` has that test). One-line add.
- **Task 6** — the `INELIGIBLE` `validateCombination` code path is typed and
  reachable but has no dedicated test, because no seeded category is `ineligible`
  for BGD (all 20 records are `eligible` / `conditional`).
- **Task 7** — two e-Visa `source.notes` quote `tvoa.html` detail strings
  (`evisa.business`, `evisa.medical_attendant`); the controller confirmed the
  quotes are accurate to the page.
- **Task 8** — `regular.student`'s FRRO 14-day / 180-day line is in
  `stayLimitations.notes` rather than `specialConditions` (no data lost).
- **Task 9** — `evisa.medical_attendant`'s eligibility `basis` adds an "(S2)"
  citation not on the sibling research row (kept consistent with `evisa.medical`;
  factually sound).
- **Task 10** — the read-only `specialConditions` / `restrictions` / `conditions`
  lists in `VisaRulesPage` use `key={i}` (static lists, acceptable).

---

## 9. Recommended next

**Phase 2 — document system (upload / metadata / storage)**, which was deferred.
Local passport image / PDF upload, OCR / MRZ extraction into the applicant
profile, per-field provenance already modelled in `applicant_field_meta`
(Phase 2 applicant schema). The visa-kb `requiredDocuments` / `optionalDocuments`
lists become the checklist that document system fills against.

Also worth a small dedicated task before operational use: **re-verify the
Regular-visa entries against `hcidhaka.gov.in`** once those pages are reachable,
and add an `ineligible`-path test to `validateCombination` if any real corridor
turns out to bar a category.
