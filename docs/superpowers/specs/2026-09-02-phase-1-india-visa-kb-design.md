# Phase 1 — India Visa Knowledge Base — Design

**Status:** Approved for planning (2026-09-02).
**Builds on:** Phase 0 (portal settings, app skeleton, the 13 foundation requirements) and the
Phase 2 applicant profile system. This phase adds a new, self-contained `src/shared/` module and
one React page; it changes no existing runtime behaviour.
**Related documents:**
- `docs/ARCHITECTURE.md` — foundation architecture and layering rules.
- `docs/superpowers/specs/2026-09-02-phase-2-applicant-profile-design.md` — sibling `src/shared/` domain.
- `docs/visa-form-analysis.md` — field/data-source taxonomy (informs later phases, not this one).

---

## 1. Goal

Build a **local-first, versioned India Visa Knowledge Base**: a data/configuration layer that
represents the current official Indian government visa rules for **Bangladesh nationals travelling to
India**, across the two application modes the official portal supports — **Regular/Paper Visa** and
**e-Visa** — together with a pure query/validation API and a read-only React reference page.

Government rules change. The whole point of this phase is that a rule change is a **one-file edit to
versioned JSON plus a version bump** — never a code change, and never a change to a React component.

---

## 2. Scope

### In scope

- A pure module `src/shared/visa-kb/` — Zod schema, loader, and query/validation functions.
- Versioned JSON rule data for India, split by application mode, plus explicit Bangladesh eligibility
  records and a `SOURCES.md` provenance index.
- Seed data: every e-Visa sub-type and the major Regular/Paper categories relevant to Bangladesh
  applicants (see §7), each with a real official source URL and retrieval date.
- A read-only React page (`/visa-rules`) that browses the KB, importing the shared module directly.
- Tests for the six required areas (§9) plus a data-integrity guard and a web-page test.
- A `tsconfig.test.json` so `test/shared/**` (and the rest of `test/**`) is type-checked and linted
  by the gate — a prerequisite for trusting this phase's tests (see §11).
- `docs/PHASE-1-REPORT.md` with the deliverables the phase prompt requires.

### Explicitly out of scope (later phases)

- Any HTTP/Fastify API for the KB. The SPA imports the shared module directly; the server will import
  it when the form-fill flow needs it.
- Browser automation, portal inspection, CAPTCHA/OTP/MFA handling — none.
- Evaluating eligibility `conditions` against a real applicant. Conditions are stored as **data** in
  Phase 1; a later phase evaluates them.
- Nationalities other than Bangladesh (`BGD`); destinations other than India (`IND`).
- Runtime fetching of government pages. The KB is static, updated by maintainers via pull request.
- OCR, document upload, applicant matching, submission.

---

## 3. Architecture and placement

`src/shared/visa-kb/` is a pure module under the existing `shared/` layer (imported by **both**
server and web; imports neither; no dependency beyond Zod, already present).

```
src/shared/visa-kb/
  index.ts        # public API: re-exports types, loadKnowledgeBase, and every query function
  schema.ts       # Zod schemas: knowledgeBaseSchema + every sub-structure; inferred TS types
  loader.ts       # loadKnowledgeBase(): import JSON → Zod-validate → cross-check refs → freeze → cache; reload() for tests
  queries.ts      # the query/validation functions (pure; take the loaded KB or use the cached singleton)
  data/india/
    meta.json                # KB-level version + destination
    evisa-categories.json     # all e-Visa categories / sub-types
    regular-categories.json   # all Regular/Paper categories
    eligibility.bgd.json      # explicit Bangladesh eligibility records
    SOURCES.md                # every official URL used, with retrieval date and what it sourced
```

**Layering.** `visa-kb/` imports only Zod and its own JSON. `routes/`, `services/`, and other
`shared/` modules do not import it in Phase 1. The web page imports it directly; Vite bundles the JSON
into the SPA (the dataset is a few tens of KB).

**JSON import mechanism.** The loader uses static `import x from './data/india/x.json' with { type: 'json' }`.
Requires `resolveJsonModule: true` in the base tsconfig (add if absent). Task 1 of the plan verifies
this resolves under **both** `tsconfig.server.json` (NodeNext) and the Vite/`tsconfig.web.json`
(Bundler) build before any data is authored; if import attributes cause cross-toolchain friction, the
fallback is thin `.ts` re-export wrappers around the JSON — the data files stay JSON either way.

**Nationality / country codes.** ISO 3166-1 **alpha-3** (`BGD`, `IND`) — matches passport/MRZ
convention referenced elsewhere in the project.

---

## 4. Data model

### 4.1 `meta.json` — the single active version

```jsonc
{
  "schemaVersion": 1,          // shape version; bumped only when schema.ts changes
  "kbVersion": "2026-09-02",   // content version; bumped on ANY rule-data change
  "destination": "IND",
  "revisionDate": "2026-09-02",
  "notes": "Initial India KB for Bangladesh nationals."
}
```

### 4.2 Visa category entry

One shape for both modes; `applicationMode` distinguishes. e-Visa and Regular entries live in
**separate files** (`evisa-categories.json` / `regular-categories.json`).

| field | type / values | notes |
|---|---|---|
| `id` | string slug | stable identity, `"<mode>.<category>[.<subcode>]"`, e.g. `evisa.tourist.30d`, `regular.medical` |
| `applicationMode` | `"evisa"` \| `"regular"` | |
| `category` | controlled enum | `tourist`, `business`, `medical`, `medical_attendant`, `conference`, `student`, `employment`, `transit`, `entry_x`, `journalist`, `research`, `other` (extend in schema as data needs it) |
| `subCategory` | string \| null | human label for a sub-split, e.g. `"e-Tourist (30 days)"`; null when the category has none |
| `officialCode` | string \| null | the government's own code when it has one, e.g. `"e-T1V"` |
| `displayName` | string | UI label |
| `purpose` | string[] | controlled tags: `recreation`, `sightseeing`, `casual_visit`, `business`, `medical_treatment`, `medical_attendant`, `conference`, `study`, `employment`, `transit`, `family_visit`, `other` |
| `validity` | `{ amount: int, unit: "days"\|"months"\|"years", from: "issue"\|"first_arrival"\|"eta_grant", notes?: string }` | |
| `entries` | `"single"` \| `"double"` \| `"multiple"` | |
| `stayLimitations` | `{ perVisitDays?: int, perCalendarYearDays?: int, aggregateDays?: int, notes?: string }` | any/all null |
| `extendable` | boolean | |
| `convertible` | boolean | |
| `applicationTiming` | `{ minLeadDays?: int, maxLeadDays?: int, notes?: string }` | e.g. e-Visa: min 4, max 120 |
| `travelRequirements` | `{ passportValidityMonthsMin?: int, passportBlankPagesMin?: int, onwardOrReturnTicket?: boolean, portsOfEntry?: string[]\|null, notes?: string }` | `portsOfEntry` null = no restriction |
| `requiredDocuments` | `{ id: string, label: string, notes?: string }[]` | |
| `optionalDocuments` | `{ id: string, label: string, notes?: string }[]` | |
| `specialConditions` | string[] | e.g. `"Biometrics captured on arrival"`, `"FRRO registration if stay exceeds 180 days"` |
| `restrictions` | string[] | e.g. `"No employment"`, `"Cannot be extended or converted"` |
| `source` | `{ officialUrl: string (url), retrievedAt: string (ISO date), documentDate?: string (ISO date), notes?: string }` | provenance |
| `lastVerified` | string (ISO date) | when a human last checked this entry against the source |

### 4.3 Eligibility record — explicit, never inferred

One record per `(nationality, applicationMode, categoryId)`. Absence of a record is meaningful (see §5).

**`status` semantics:**
- `eligible` — the category is offered to this nationality; `conditions` are the universal
  gates (passport type, background, purpose) that a normal applicant passes.
- `conditional` — offered, but only if extra conditions beyond the universal gates hold
  (e.g. a spouse-of-Indian-national salary floor).
- `ineligible` — this nationality is explicitly barred from the category.
- `not_offered` — the category does not exist for this nationality in this application mode.

`conditions` always lists everything that must hold, whatever the status.

```jsonc
{
  "nationality": "BGD",
  "applicationMode": "evisa",
  "categoryId": "evisa.tourist.30d",          // MUST resolve to a category entry with the same applicationMode
  "status": "eligible",                        // "eligible" | "ineligible" | "not_offered" | "conditional"
  "conditions": [
    { "type": "passport_type_not_in", "value": ["diplomatic", "official"] },
    { "type": "no_prohibited_background", "value": ["defence", "military", "police", "security"] },
    { "type": "purpose_in", "value": ["tourism", "recreation", "casual_visit"] },
    { "type": "not_endorsed_on_relative_passport" }
  ],
  "basis": "Bangladesh is on India's e-Visa eligible-nationalities list; e-Tourist is offered to eligible nationals.",
  "source": { "officialUrl": "https://indianvisaonline.gov.in/evisa/", "retrievedAt": "2026-09-02" },
  "lastVerified": "2026-09-02"
}
```

**Condition vocabulary** (Phase 1 defines what the seed data uses; `custom` is the escape hatch):

| `type` | `value` shape | meaning (evaluated in a later phase) |
|---|---|---|
| `passport_type_in` / `passport_type_not_in` | string[] (`ordinary`,`diplomatic`,`official`,`service`) | applicant's passport type |
| `no_prohibited_background` | string[] | applicant must not have any listed background |
| `purpose_in` / `purpose_not_in` | string[] (purpose tags) | trip purpose |
| `not_endorsed_on_relative_passport` | — | applicant holds their own passport |
| `min_age` / `max_age` | int (years) | |
| `passport_validity_months_min` | int | |
| `requires_supporting_institution_letter` | — | a named supporting letter must be provided |
| `salary_min_inr_per_annum` | int | for certain spouse-of-Indian-national cases |
| `custom` | `{ text: string }` | free-text condition not yet structured |

Conditions are **descriptive data** in Phase 1 — no code evaluates them against an applicant yet.

### 4.4 Loader cross-checks (fail the load, with a precise message)

1. Every category `id` is unique.
2. Every `eligibility.categoryId` resolves to a category entry.
3. `eligibility.applicationMode` equals the referenced category's `applicationMode`.
4. No two eligibility records share the same `(nationality, applicationMode, categoryId)`.
5. Every category and every eligibility record has a well-formed `source` (`officialUrl` a valid URL,
   `retrievedAt` a valid ISO date) and a valid `lastVerified` date.
6. `meta.destination` is `"IND"`; every entry is consistent with it.

The loader freezes the result (`Object.freeze`, deep) and caches it as a module singleton;
`reload()` clears the cache for tests.

---

## 5. Query / validation API (`queries.ts`, re-exported from `index.ts`)

All functions are pure. They accept an optional `kb` argument (the loaded KB) and otherwise use the
cached singleton, so tests can inject fixtures.

| function | returns |
|---|---|
| `getVersion()` | `{ schemaVersion, kbVersion, revisionDate, destination }` |
| `listCategories(opts?: { applicationMode?, category? })` | `VisaCategory[]` — **category lookup + mode filtering** |
| `getCategory(id)` | `VisaCategory \| null` |
| `getCategoriesForMode(mode)` | `VisaCategory[]` — **application-mode filtering** (only that mode, never the other) |
| `checkEligibility(nationality, mode, categoryId)` | `EligibilityResult` (below) — **never inferred** |
| `listEligibleCategories(nationality, mode)` | `{ category: VisaCategory, eligibility: EligibilityRecord }[]` — only `eligible` / `conditional` records |
| `getDocumentRequirements(categoryId)` | `{ required: Doc[], optional: Doc[] } \| null` — **document requirements** |
| `validateCombination(input)` | `ValidationResult` — **invalid category combinations** |

**`EligibilityResult`:**
```ts
| { status: "eligible" | "ineligible" | "not_offered" | "conditional";
    conditions: Condition[]; basis: string; source: Source; lastVerified: string }
| { status: "unknown"; reason: string }   // no eligibility record exists for this tuple
```

**`validateCombination({ nationality?, applicationMode, categoryId })` → `ValidationResult`:**
```ts
| { valid: true; categoryId: string }
| { valid: false; code: "UNKNOWN_MODE" | "UNKNOWN_CATEGORY" | "MODE_MISMATCH"
                       | "NO_ELIGIBILITY_RULE" | "INELIGIBLE" | "NOT_OFFERED";
    message: string }
```
- `UNKNOWN_MODE` — `applicationMode` not `"evisa"` / `"regular"`.
- `UNKNOWN_CATEGORY` — `categoryId` matches no entry.
- `MODE_MISMATCH` — the category exists but under the other mode (e.g. an `evisa.*` id passed with `applicationMode: "regular"`).
- `NO_ELIGIBILITY_RULE` — `nationality` was given and no eligibility record exists for the tuple.
- `INELIGIBLE` / `NOT_OFFERED` — an eligibility record exists and says so.
Checks run in that order; the first failure is returned.

---

## 6. React reference page

`src/web/src/pages/VisaRules/VisaRulesPage.tsx`, route `/visa-rules` (added to `main.tsx`), nav link
in `App.tsx` beside "Applicants". Imports `src/shared/visa-kb` directly — **no API call**.

Layout (plain, matches PortalsPage/ApplicantsPage; no new UI dependency):
- A header banner: `India visa rules · KB version <kbVersion> · revised <revisionDate>`.
- A mode toggle: **e-Visa** / **Regular / Paper**.
- A list of that mode's categories (`displayName`, short summary line: validity · entries · stay).
- Selecting one opens a detail panel: purpose, validity, entries, stay limitations, application
  timing, travel requirements, required documents, optional documents, special conditions,
  restrictions, **Bangladesh eligibility** (status + conditions + basis), and the **source** (an
  external link to `officialUrl` plus `retrieved <retrievedAt>`).
- If `checkEligibility` returns `status: "unknown"` for the selected category, the panel says so
  plainly ("No Bangladesh eligibility rule recorded for this category") — it never implies eligibility.

---

## 7. Seed data plan

All values come from official Indian government sources, each recorded in `data/india/SOURCES.md`
with the URL and retrieval date. Primary sources: `indianvisaonline.gov.in` (e-Visa portal and visa
category pages), `mha.gov.in` visa annexes, `hcidhaka.gov.in` / `boi.gov.in` (High Commission of
India, Dhaka — category-wise document lists), and the India–Bangladesh bilateral travel arrangement.

### 7.1 e-Visa categories (`evisa-categories.json`)

| id | official code(s) | notes for seeding |
|---|---|---|
| `evisa.tourist.30d` | e-T1V | **three separate entries** — validity and stay limits differ: 30-day (from first arrival), … |
| `evisa.tourist.1y` | e-T1V | … 1-year (365 days from ETA grant, 180 days/calendar year), … |
| `evisa.tourist.5y` | e-T1V | … 5-year (5 years from ETA grant, 180 days/calendar year). `officialCode` = `"e-T1V"` on all three. |
| `evisa.tourist.6m` | e-T2V | 6-month variant where applicable |
| `evisa.business` | e-B1V (+ related) | 1 year, multiple entry, 180-day-per-visit / FRRO note |
| `evisa.medical` | e-M1V / e-M3V | |
| `evisa.medical_attendant` | e-M2V / e-M4V | "max two attendants per e-Medical visa" |
| `evisa.conference` | e-B5V (conference) | organiser uploads to `conference.mha.gov.in` |
| `evisa.student` | e-SV | |
| `evisa.transit` | e-TRV | |
| `evisa.entry_x` | e-X1V / e-SXV (family) | 3-month misc / family variant |

Each with an explicit `eligibility.bgd.json` record. Bangladesh is on the e-Visa eligible list, but
**each sub-type gets its own record** — where a sub-type is not offered to Bangladesh or has extra
conditions, that is stated explicitly, not inferred. e-Visa universal exclusions (diplomatic/official
passport, defence/military/police background, employment/NGO/journalism purpose, endorsed-on-relative
passport, non-passport travel documents) are encoded as `conditions` on each record.

### 7.2 Regular/Paper categories (`regular-categories.json`)

Tourist (single-entry 30–90 day **and** the India–Bangladesh bilateral multi-entry provision),
Business, Medical, Medical Attendant, Employment, Student, Conference, Transit, Entry (`X`). Documents
from the HCI Dhaka category-wise list. Each with a Bangladesh eligibility record.

### 7.3 Volatility note

Some official pages are stale-dated (the e-Visa portal page carried a 2019 "last updated" at retrieval)
and the India–Bangladesh tourist-visa channel was suspended Aug 2024 and **reopened 28 June 2026**.
Where a source is ambiguous, out of date, or contradicted by a more recent official notice, the entry
carries a `source.notes` / `specialConditions` flag and a conservative `lastVerified`. Correction is a
single JSON edit plus a `kbVersion` bump — this is the design's central benefit, not a workaround.

---

## 8. Versioning

- **One active KB version.** `meta.kbVersion` + `meta.revisionDate`. Git history is the archive; no
  superseded snapshots are kept on disk in Phase 1.
- **Rich per-entry provenance.** Every category and eligibility record carries `source` and
  `lastVerified`.
- **Schema vs content.** `meta.schemaVersion` changes only when `schema.ts` changes shape;
  `meta.kbVersion` changes on any data edit. The loader rejects a `schemaVersion` it does not
  recognise.
- **"How to update a rule"** section in `SOURCES.md`: edit the JSON, set the entry's `lastVerified`
  and `source.retrievedAt`, bump `meta.kbVersion` + `meta.revisionDate`, run the gate (the
  data-integrity test catches dangling refs and missing provenance).

---

## 9. Testing strategy

TDD. Tests in `test/shared/visaKb/` (unit) and `test/web/` (page). Fixtures: small hand-built KB
objects for behaviour; the **real seeded KB** for the integrity guard.

| # | Required area | Assertions |
|---|---|---|
| 1 | **category lookup** | `getCategory` returns the right entry; unknown id → `null`; `listCategories()` count and ids match the data; `listCategories({ category: 'tourist' })` filters correctly. |
| 2 | **application-mode filtering** | `getCategoriesForMode('evisa')` returns only `applicationMode === 'evisa'` entries and never a regular one; symmetric for `'regular'`; `listCategories({ applicationMode })` agrees. |
| 3 | **nationality eligibility** | `checkEligibility('BGD','evisa',<id>)` returns the explicit record's status/conditions/basis/source; a category with **no** eligibility record → `{ status: 'unknown' }` (proves no inference); an `ineligible` / `not_offered` record is surfaced as such, not hidden. |
| 4 | **document requirements** | `getDocumentRequirements(<id>)` returns the seeded `required` + `optional` docs; unknown id → `null`; a category with no optional docs → `{ required: [...], optional: [] }`. |
| 5 | **invalid category combinations** | `validateCombination` returns the right `code` for: unknown mode, unknown category, an `evisa.*` id under `applicationMode:'regular'` (`MODE_MISMATCH`), a `(BGD, mode, category)` with no eligibility rule (`NO_ELIGIBILITY_RULE`), an explicitly ineligible combo (`INELIGIBLE`/`NOT_OFFERED`); a valid combo → `{ valid: true, categoryId }`. |
| 6 | **versioned rules** | `getVersion()` returns `kbVersion` / `revisionDate` / `schemaVersion` / `destination`; every category and eligibility entry in the real KB has a valid `source` (URL + ISO `retrievedAt`) and `lastVerified`; the loader **throws** on a fixture entry missing `source` or with a malformed date; the loader **throws** on an unrecognised `schemaVersion`. |
| 7 | **data-integrity guard** (real KB) | `loadKnowledgeBase()` on the shipped data passes all §4.4 cross-checks: unique ids, no dangling `eligibility.categoryId`, mode consistency, no duplicate eligibility tuples, `destination === 'IND'`. This is the regression guard for every future rule edit. |
| 8 | **VisaRulesPage** (web, jsdom) | renders the e-Visa category list from the imported KB; the mode toggle switches to the Regular list; selecting a category shows its documents and an external source link; a category with `status:'unknown'` shows the "no rule recorded" message and never the word "eligible". |

---

## 10. Acceptance checklist (Phase 1 prompt)

- [ ] Data model documented (this spec §4 + `schema.ts`).
- [ ] `nationality`, `destination`, `applicationMode`, `visa category`, `subCategory`, `eligibility rules`,
      `required documents`, `optional documents`, `travel requirements`, `validity`, `entries`,
      `stay limitations`, `application timing`, `special conditions`, `restrictions`, `source URL`,
      `source date/version` — every one represented in the schema and populated in the seed data.
- [ ] e-Visa categories/sub-categories represented **separately** from Regular/Paper (separate files, `applicationMode` field).
- [ ] Bangladesh e-Visa eligibility is a set of **explicit records**, one per sub-type — not derived from a blanket "Bangladesh is eligible".
- [ ] Rules are **not** hard-coded in any React component; `VisaRulesPage` only reads the shared module.
- [ ] Configuration layer allows a rule change via JSON edit + version bump, no code change.
- [ ] Tests for: category lookup, application-mode filtering, nationality eligibility, document requirements, invalid category combinations, versioned rules — all present and passing.
- [ ] No browser automation, no CAPTCHA/OTP code added.
- [ ] `npm run typecheck` · `npm run lint` · `npm test` · `npm run build` all green (test dirs now type-checked — §11).
- [ ] `docs/PHASE-1-REPORT.md`: data model · files created/changed · official sources used · tests · typecheck · lint · build · commit hash.
- [ ] Phase stops here; Phase 2's document system is not started.

---

## 11. Supporting change: type-check the test directories

The whole-branch review of Phase 2 found `test/server/**` and `test/shared/**` are in no tsconfig
`include`, so `npm run typecheck` and typed lint never see them. Phase 1 adds a substantial
`test/shared/visaKb/**` suite; its tests must be type-checked to be trustworthy.

- Add `tsconfig.test.json` (extends the base; `include: ["test/**/*", "src/**/*"]`, `noEmit`) and add
  it to the `typecheck` script.
- Fix the errors it surfaces in existing test files (the review estimated ~13 — mostly
  `noUncheckedIndexedAccess` indexing and one `SQLOutputValue` mismatch in `migrations.test.ts`;
  mechanical).
- If the pre-existing fixes exceed roughly one task's worth of work, split them into their own task
  in the plan and keep Phase 1's new tests type-checked regardless.

---

## 12. File inventory (created / changed)

**Created**
- `src/shared/visa-kb/{index,schema,loader,queries}.ts`
- `src/shared/visa-kb/data/india/{meta,evisa-categories,regular-categories,eligibility.bgd}.json`
- `src/shared/visa-kb/data/india/SOURCES.md`
- `src/web/src/pages/VisaRules/VisaRulesPage.tsx` (+ any small sub-components)
- `test/shared/visaKb/*.test.ts`
- `test/web/VisaRulesPage.test.tsx`
- `tsconfig.test.json`
- `docs/PHASE-1-REPORT.md`

**Changed**
- `tsconfig.json` (`resolveJsonModule`), `package.json` (`typecheck` script)
- `src/web/src/main.tsx` (route), `src/web/src/App.tsx` (nav link), `src/web/src/styles.css` (page styles)
- existing `test/**` files as needed for §11
- `docs/ARCHITECTURE.md` (note the new shared module)

---

## 13. Risks

| risk | mitigation |
|---|---|
| Seeded rules drift from reality (stale gov pages, bilateral changes). | Per-entry `source` + `lastVerified`; `SOURCES.md`; data-integrity test; correction = one JSON edit. Spec is explicit that the data is a point-in-time snapshot. |
| JSON import attributes behave differently in NodeNext vs Vite. | Task 1 verifies both build paths before any data is authored; `.ts` re-export wrappers as the fallback. |
| `tsconfig.test.json` surfaces more pre-existing errors than expected. | Split into its own task; Phase 1's new tests stay type-checked regardless. |
| Over-structuring eligibility conditions before a consumer exists (YAGNI). | Conditions are descriptive data with a `custom` escape hatch; only the vocabulary the seed data needs is defined; no evaluator is built. |
