# Phase 2 — Applicant Profile System — end-of-phase report

**Status:** Complete. Gate green.
**Branch:** `phase-0-portal-settings` (established non-main working branch for all phases).
**Range:** `785b5ae^..HEAD` (first Phase 2 implementation commit = `785b5ae`, migration 2).
**Last verified:** 2026-09-02 — `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all green.
**Spec:** `docs/superpowers/specs/2026-09-02-phase-2-applicant-profile-design.md`
**Plan:** `docs/superpowers/plans/2026-09-02-phase-2-applicant-profile.md`

---

## 1. What was implemented

A local-first **applicant profile system**: create / edit / duplicate / delete
visa applicants, each split into normalized sections, with per-field provenance
and computed completeness / verification — no document upload, no OCR, no portal
code.

### 1.1 Schema — migration 2 (8 new tables)

`src/server/db/migrations.ts` adds `{ version: 2 }`, bringing a Phase 0/1 database
to `user_version = 2`. Idempotent; `visa_portals` / `app_settings` untouched.

| Table | Role |
|---|---|
| `applicants` | root row: `id`, `display_name`, `status` (`draft`/`archived`), timestamps |
| `applicant_identity` | 1:1 — surname, given names, full name, DOB, sex, place of birth, nationality, other nationalities |
| `applicant_passport` | 1:1 — document type, number, issuing state, issue/expiry date, place of issue, authority |
| `applicant_contact` | 1:1 — email, phone, alt phone |
| `applicant_address` | 1:1 — line1/2, city, region, postal code, country |
| `applicant_travel` | 0:N — trip type, purpose, destination, cities, arrival/departure, ports, accommodation, notes, `sort_order` |
| `applicant_reference` | 0:N — `kind` (emergency_contact/employer/in_country_host/sponsor/other), name, relationship, organization, phone, email, address, `sort_order` |
| `applicant_field_meta` | per-field provenance — `field_path`, `source`, nullable `confidence`, `raw_value`, `verified`, `verified_at`; `UNIQUE(applicant_id, field_path)` |

All child/section/meta rows are `ON DELETE CASCADE` from `applicants`
(`PRAGMA foreign_keys = ON` in `connection.ts`). Indexes on every `applicant_id`
FK.

### 1.2 Service — `src/server/services/applicantService.ts` (+ `applicantColumns.ts`, `applicantCompleteness.ts`)

Pure domain logic over the `DatabaseSync` handle (no HTTP types):

- **CRUD:** `createApplicant`, `getApplicantDetail`, `listApplicants(q?)`,
  `updateApplicant` (partial section patches, single transaction), `deleteApplicant`.
  "Partial" is literal: the section schemas leave an omitted key `undefined`
  (only `''` / explicit `null` become `NULL`), and `writeSection` /
  `updateChild` emit a `SET` clause only for the keys actually sent. A
  `PUT { identity: { surname: 'X' } }` therefore touches one column and leaves
  every sibling value — and its `applicant_field_meta` row — alone.
- **Search:** `listApplicants` filters on display name / passport number /
  nationality / contact email via parameterized `LIKE` (injection-free).
- **Children:** `addTravel` / `updateTravel` / `deleteTravel` and the reference
  equivalents, with `sort_order` maintained as `MAX(sort_order)+1`.
- **Provenance:** `upsertFieldMeta` — one row per `(applicant, field_path)`;
  `source` validated in Zod (not a SQL `CHECK`) so Phase 3 OCR sources need no
  migration; `confidence` forced `null` for non-OCR sources. `source` has no Zod
  default — an omitted `source` keeps the existing row's provenance (and its
  `confidence`, while the source is unchanged), so the Confirm button's
  `{ fieldPath, verified }` write cannot downgrade a `passport_mrz` / 0.97 row to
  `manual` / `NULL`; `'manual'` is applied in the service for genuinely new rows.
  OCR rows are never auto-`verified`: `fieldMetaInputSchema` rejects a write that
  sets an OCR `source` and `verified: true` together (400), so confirming an OCR
  reading is always a separate, human act.
- **Reconciliation:** when `updateApplicant` changes a section value, the matching
  `applicant_field_meta` row is reset to `verified = 0`, `verified_at = NULL`
  inside the same transaction.
- **Duplicate:** `duplicateApplicant` — deep copy of all sections + children in one
  `BEGIN/COMMIT`, child ids remapped inside `field_path`, `verified`/`verified_at`
  forced `0`/`NULL`, `" (copy)"` appended to the display name, fresh timestamps,
  original untouched.
- **Completeness / verification (computed, never stored):** `computeCompleteness`
  (mean of the six section ratios), `computeVerification` (verified vs. non-null
  field count → `unverified` / `partial` / `verified` label), `collectWarnings`
  (passport expiry ≤ issue; travel departure < arrival) — attached in
  `getApplicantDetail` / `listApplicants`.

### 1.3 API — `src/server/routes/applicants.ts`

Registered in `app.ts` after portals, before the not-found / error handlers.
Routes validate with the shared Zod schemas → call the service → map domain
results to status codes. No SQL, no logging in the route layer.

```
GET    /api/applicants            ?q=      list summaries (PII-safe)
POST   /api/applicants                     create (displayName required)
GET    /api/applicants/:id                 full detail + computed blocks
PUT    /api/applicants/:id                 partial patch (sections / status / name)
DELETE /api/applicants/:id                 cascade delete
POST   /api/applicants/:id/duplicate       deep copy
POST   /api/applicants/:id/travel          add travel record
PUT    /api/applicants/:id/travel/:travelId
DELETE /api/applicants/:id/travel/:travelId
POST   /api/applicants/:id/references      add reference
PUT    /api/applicants/:id/references/:refId
DELETE /api/applicants/:id/references/:refId
PUT    /api/applicants/:id/field-meta      upsert provenance / verify toggle
```

Sanitized-error guarantee preserved: 404 bodies name the resource path, never a
value; the tolerant JSON body parser turns empty/malformed payloads into a
normal `VALIDATION_ERROR`.

### 1.4 Shared contract — `src/shared/applicant/`

- `types.ts` — `Applicant`, `ApplicantDetail`, `ApplicantSummary`, `FieldMeta`,
  `Completeness`, `VerificationSummary`, `SectionKey`, `FieldSource`.
- `fieldPaths.ts` — `FIELD_SOURCES` tuple, `PROFILE_SECTIONS` spec,
  `isValidFieldPath` guard, `isOcrSource`.
- `schemas.ts` — Zod section / travel / reference / field-meta / create / put
  schemas; nullable everywhere, `YYYY-MM-DD` date regex, lenient email, `kind`
  default `other`, field-meta `superRefine` (confidence only for OCR sources).

### 1.5 Frontend — `src/web/src/`

- `api/client.ts` — 13 typed methods over the fetch wrapper.
- `lib/applicantOptions.ts` — sex / reference-kind / field-source option lists.
- `pages/Applicants/` — `ApplicantsPage` (list, search, create, duplicate, delete,
  inline completeness bar + verification badge), `ApplicantDetailPage`
  (orchestrates sections + children), `SectionCard` (view / edit one 1:1 section,
  per-field **Confirm/verified** toggle, client-side date+email validation before
  any request), `CompletenessHeader` (overall % + per-section chips + warnings),
  `TravelSection` / `ReferenceSection` + `TravelRecordForm` / `ReferenceForm`
  (add / edit / delete with a confirm gate, reload after mutation).
- The list client sends/receives only `passportNumberLast4` — full number, DOB and
  email never cross to the list view.
- `styles.css` — ~1 screen of readable, token-based CSS (Phase 0
  `--fg/--bg/--muted/--border/--accent`; amber `#b45309`/green `#15803d` literals
  for the verification states only). No design system, no UI library.

### 1.6 Provenance model

Canonical data lives in the section / child tables. `applicant_field_meta` is a
**side table** keyed by `(applicant_id, field_path)` — it is never the primary
store for any value. Manual entry writes `source = 'manual'`, `confidence = NULL`.
A user "Confirm" sets `verified = 1`, `verified_at = <ISO now>`. Editing the
underlying value clears that mark (reconciliation). The schema already accepts the
Phase 3 OCR `source` values (`passport_mrz`, …) and numeric `confidence` with no
migration.

---

## 2. Files changed

`git diff --stat 785b5ae^..HEAD` (committed, Tasks 1–14):

```
 eslint.config.js                                   |   8 +
 src/server/app.ts                                  |   2 +
 src/server/db/migrations.ts                        | 104 ++++
 src/server/logger.ts                               |  12 +
 src/server/routes/applicants.ts                    | 121 +++++
 src/server/services/applicantColumns.ts            |  86 +++
 src/server/services/applicantCompleteness.ts       |  90 ++++
 src/server/services/applicantService.ts            | 591 +++++++++++++++++++++
 src/shared/applicant/fieldPaths.ts                 |  41 ++
 src/shared/applicant/schemas.ts                    | 160 ++++++
 src/shared/applicant/types.ts                      | 129 +++++
 src/web/src/App.tsx                                |   1 +
 src/web/src/api/client.ts                          |  63 +++
 src/web/src/lib/applicantOptions.ts                |  33 ++
 src/web/src/main.tsx                               |   4 +
 src/web/src/pages/Applicants/ApplicantDetailPage.tsx   | 125 +++++
 src/web/src/pages/Applicants/ApplicantsPage.tsx    | 136 +++++
 src/web/src/pages/Applicants/CompletenessHeader.tsx    |  38 ++
 src/web/src/pages/Applicants/ReferenceForm.tsx     |  73 +++
 src/web/src/pages/Applicants/ReferenceSection.tsx  |  63 +++
 src/web/src/pages/Applicants/SectionCard.tsx       | 128 +++++
 src/web/src/pages/Applicants/TravelRecordForm.tsx  |  86 +++
 src/web/src/pages/Applicants/TravelSection.tsx     |  60 +++
 test/server/applicantCompleteness.test.ts          | 104 ++++
 test/server/applicantMigrations.test.ts            | 120 +++++
 test/server/applicantRoutes.test.ts                | 201 +++++++
 test/server/applicantService.test.ts               | 313 +++++++++++
 test/server/loggerRedaction.test.ts                |  33 ++
 test/shared/applicantSchemas.test.ts               | 136 +++++
 test/web/ApplicantDetailPage.test.tsx              | 137 +++++
 test/web/ApplicantsPage.test.tsx                   |  63 +++
 31 files changed, 3261 insertions(+)
```

Task 15 (this commit) additionally changes, with **no `.ts`/`.tsx` logic change**:

```
 src/web/src/styles.css      (+~175 applicant style rules, appended)
 docs/PHASE-2-REPORT.md      (new — this file)
 README.md                   ("Applicants" paragraph in "Using it")
 docs/ARCHITECTURE.md        (one line: migration 2 + applicant module + provenance)
```

---

## 3. Tests executed

Baseline before Phase 2 (Phase 0/1 foundation): **48 tests / 12 files**.
After Phase 2: **132 tests / 20 files** — **+84 tests, +8 files**.

New / changed test files this phase:

| File | Tests | Covers |
|---|---:|---|
| `test/server/applicantMigrations.test.ts` | 5 | migration 2 reaches `user_version = 2`; all 8 tables; idempotent re-run; portal data preserved; cascade delete |
| `test/shared/applicantSchemas.test.ts` | 20 | nullable coercion, date regex, lenient email, `kind` default, field-meta `superRefine`, create/put shapes |
| `test/server/applicantCompleteness.test.ts` | 10 | section ratios, overall mean, verification counts + label transitions, warnings |
| `test/server/applicantService.test.ts` | 24 | CRUD, partial patches, search fields, travel/reference CRUD + sort order, field-meta upsert, reconciliation on value change, duplicate deep-copy + id remap + verified reset, reopen persistence |
| `test/server/applicantRoutes.test.ts` | 14 | every endpoint, 201/200/400/404 mapping, body-less/invalid JSON, sanitized errors report path not value, list omits PII |
| `test/server/loggerRedaction.test.ts` | 2 | `REDACT_PATHS` covers every applicant PII key (raw_value, names, passportNumber, DOB, email, phone, address lines, postal code) + wildcards; no bare `number` key |
| `test/web/ApplicantsPage.test.tsx` | 4 | list render from API, completeness bar, verification badge, passport last4 only |
| `test/web/ApplicantDetailPage.test.tsx` | 5 | four sections + completeness header render, verify toggle path, nullable rendering |

Full suite still includes the Phase 0/1 tests (portals, migrations, health, static
serving, automation, schemas) — all green.

---

## 4. Test results (verbatim)

```
=== npm run typecheck ===

> visa-autofill@0.0.0 typecheck
> tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.web.json

exit=0

=== npm run lint ===

> visa-autofill@0.0.0 lint
> eslint .

exit=0

=== npm test ===
 Test Files  20 passed (20)
      Tests  132 passed (132)
   Duration  5.56s

=== npm run build ===

> visa-autofill@0.0.0 build
> vite build && tsc -p tsconfig.server.json

vite v5.4.21 building for production...
transforming...
✓ 49 modules transformed.
rendering chunks...
computing gzip size...
../../dist/web/index.html                   0.40 kB │ gzip:  0.27 kB
../../dist/web/assets/index-Dh3llSA1.css    5.08 kB │ gzip:  1.48 kB
../../dist/web/assets/index-IaPGnI-n.js   232.60 kB │ gzip: 73.98 kB
✓ built in 868ms
BUILD EXIT 0
```

**Known pre-existing note (not a Phase 2 regression):** the web tests print
`React Router Future Flag Warning` (`v7_startTransition`, `v7_relativeSplatPath`)
for every page test, including the older `PortalsPage` / `PortalForm`. This is the
React Router v6→v7 migration advisory already tracked in
`docs/ARCHITECTURE.md` §11; no test fails, no behavior change.

---

## 5. Manual smoke results

Per the ADAPTATION for a non-interactive agent, the smoke ran at the
**HTTP / `app.inject()` layer**, not the browser UI — a throwaway script built
`buildServer({ dbPath })` against a temp SQLite file and exercised the REST API.
Script: `scratchpad/phase2-smoke.mts` (gitignored, not committed).
Run: `NODE_ENV=test npx tsx phase2-smoke.mts` → **12 / 12 passed**.

| # | Smoke step | Result |
|---|---|---|
| 1 | `POST /api/applicants` → appears in `GET /api/applicants` at `completeness.overall = 0`, `verification.label = 'unverified'` | PASS |
| 2 | `GET /api/applicants/:id` returns detail with matching id | PASS |
| 3 | `PUT :id { identity: { surname, givenNames, dateOfBirth:'2000-01-01', sex:'F' } }` → `completeness.overall` rises above 0 | PASS |
| 4 | `PUT :id/field-meta { fieldPath:'identity.surname', verified:true }` → `GET` detail `verification.verified >= 1` | PASS |
| 5 | `PUT :id { identity: { surname:'Changed' } }` → `GET` detail: `identity.surname` meta no longer `verified` (reconciliation) | PASS |
| 6 | `POST` 2× travel (varied), `PUT` edit one, `DELETE` one | PASS |
| 7 | `POST` 2× references (`employer`, `emergency_contact`), `PUT` edit one, `DELETE` one | PASS |
| 8 | `POST :id/duplicate` → `applicant.displayName` ends with `(copy)`, carries the identity data, its `fieldMeta` all `verified:false` | PASS |
| 9 | `GET /api/applicants?q=smoke` → original + copy; `?q=(copy)` → only the copy | PASS |
| 10 | `DELETE` the copy, then the original → subsequent `GET :id` is 404 | PASS |
| 11 | Persistence: `app.close()`, `buildServer({ dbPath })` on the **same** temp file, `GET` a still-present applicant → identity + 1 travel + 1 reference intact | PASS |
| 12 | PII: create with `passport.number 'AB1234567'`, `identity.dateOfBirth '1990-05-05'`, `contact.email 'x@y.co'`; `GET /api/applicants` body contains `4567` but **not** `AB1234567`, **not** `1990-05-05`, **not** `x@y.co` | PASS |

### PII / log-leak check

- **List response:** smoke step 12 asserts the list JSON exposes only the
  passport last-4 and no full number / DOB / email. PASS.
- **Logs:** covered by `test/server/loggerRedaction.test.ts` (5 tests). Two
  vectors, two defences:
  - *Logged objects* — every applicant PII key (`raw_value`, names,
    `passportNumber`, `dateOfBirth`, `email`, `phone`, address lines,
    `postalCode`) and its wildcard variant is in `REDACT_PATHS`, and no
    over-broad bare `number` key is present. The route layer does no logging;
    the error handler logs `{ err }` only, through the redacting pino instance.
  - *Request URLs* — `redact` cannot reach a substring of `req.url`, and the
    search box sends a passport number / email as `GET /api/applicants?q=…`.
    `logger.ts` therefore installs a `serializers.req` that emits only
    `{ method, url, host, remoteAddress }` with the query string replaced by
    `?[REDACTED]` (headers are dropped entirely). Verified against the real
    captured log bytes: the server is built over a pino instance writing to an
    in-memory stream, a `?q=AB1234567` request is injected, and the output is
    asserted to contain `/api/applicants` but not the search term.

---

## 6. Spec §13 acceptance checklist — with evidence

| # | Checklist item | Evidence |
|---|---|---|
| 1 | Migration 2 → `user_version = 2`, all 8 tables, idempotent, portal data preserved | `test/server/applicantMigrations.test.ts` (5): "reaches user_version 2", "creates all eight applicant tables", "is idempotent on re-run", "preserves existing visa_portals rows"; migration body `src/server/db/migrations.ts:31-138` |
| 2 | Create an applicant (display name only) → appears in list | `applicantRoutes.test.ts` "POST creates and GET returns…"; smoke step 1 |
| 3 | Open an applicant; fill/edit identity, passport, contact, address; persists | `applicantService.test.ts` section-patch + reopen tests; `applicantRoutes.test.ts` PUT tests; smoke step 3 + 11; `ApplicantDetailPage.test.tsx` |
| 4 | Add / edit / delete multiple travel records | `applicantService.test.ts` travel CRUD + sort order; `applicantRoutes.test.ts` travel routes; smoke step 6 |
| 5 | Add / edit / delete multiple references, each with a kind | `applicantService.test.ts` reference CRUD; `applicantSchemas.test.ts` `kind` default; smoke step 7 |
| 6 | Delete an applicant → sections, travel, references, meta removed (cascade) | `applicantMigrations.test.ts` cascade test; `connection.ts:9` `foreign_keys = ON` + `migrations.ts` `ON DELETE CASCADE`; smoke step 10 |
| 7 | Duplicate → copy has data, `verified` reset, `" (copy)"` name, original unaffected | `applicantService.test.ts` duplicate test (deep copy + id remap + verified reset + original untouched); smoke step 8 |
| 8 | Search by name / passport number / nationality / email | `applicantService.test.ts` search test; `applicantRoutes.test.ts` `?q=`; smoke step 9 |
| 9 | Detail shows computed completeness (overall + per section) that updates as fields fill | `applicantCompleteness.test.ts` (10); `assembleDetail` attaches blocks; `CompletenessHeader.tsx`; smoke step 3 |
| 10 | Each field mark verified/unverified; `verified_at` set on confirm; summary reflects it | `applicantService.test.ts` field-meta upsert; `applicantCompleteness.test.ts` label transitions; `SectionCard.tsx` verify toggle; smoke step 4 |
| 11 | `applicant_field_meta` stores `source`(`manual`), nullable `confidence`(null for manual), `raw_value`, `verified`, `verified_at`; accepts Phase 3 OCR sources w/o schema change; one row per `(applicant, field_path)` | `applicantSchemas.test.ts` field-meta `superRefine` + source list; `applicantService.test.ts` upsert / uniqueness; `migrations.ts:118` `UNIQUE(applicant_id, field_path)`, no `CHECK` on `source` |
| 12 | Canonical data and provenance metadata in separate tables; meta not primary store | Schema: values in `applicant_identity/passport/contact/address/travel/reference`; `applicant_field_meta` keyed by `field_path` only — `applicantService.ts` reads canonical from section tables; `ARCHITECTURE.md` §"provenance" line |
| 13 | Nullable fields throughout — half-filled profile saves + reloads intact | `applicantSchemas.test.ts` nullable coercion; `applicantService.test.ts` reopen-persistence; smoke step 11 |
| 14 | No passport number, DOB, address, email, or `raw_value` in a logged object, a logged request URL, or an error message; list omits them | `loggerRedaction.test.ts` (5): `REDACT_PATHS` key coverage + no bare `number`, and three tests asserting on real captured log bytes that the `serializers.req` query-string strip holds (`?q=<passport>` / `?q=<email>` absent, path present). `applicantRoutes.test.ts` "list omits PII" / "error reports path not value"; smoke step 12. Scope note: this covers logged objects and request URLs — request headers and bodies are never logged. |
| 15 | No browser automation, OCR, document upload, or portal-specific field added | `git diff --stat 785b5ae^..HEAD` — no `automation/` change, no new deps, no OCR/upload code; `test/automation/noHardcodedUrl.test.ts` still green |
| 16 | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass | §4 above — all exit 0 / 132 passed |
| 17 | Git diff reviewed; each task a focused commit | `git log --oneline 785b5ae^..HEAD` — 14 focused commits (migration, redaction, types, schemas, completeness, service ×4, routes ×2, frontend ×3) + this docs commit |

All 17 items satisfied.

---

## 7. Remaining limitations

Design-level (from the spec, accepted for this phase):

- `listApplicants` does an N+1 detail read (one query per applicant to attach
  computed blocks). Fine at single-user local scale; revisit if the list grows
  large. (Task 6, brief-sanctioned.)
- Travel / reference fields are **not** individually verifiable in the UI — only
  the 16 one-to-one section fields have a Confirm toggle. Child-record provenance
  rows are supported by the schema but not surfaced.
- **No encryption at rest.** The SQLite file under `data/` holds applicant PII in
  clear text; protection is filesystem-level + loopback-only + gitignore.
- Provenance is **single-current-row** per `(applicant, field_path)` — no history
  of prior sources / values / verification events.
- Cross-field problems (passport expiry ≤ issue, travel departure < arrival) are
  **warnings**, not save blocks.

Deferred / parked items carried from `progress.md` for the final review:

- **Task 1:** no test that `UNIQUE(applicant_id, field_path)` rejects a dup, that
  `source` accepts an arbitrary/future value (proving no `CHECK`), or that the
  `verified`/`status`/`kind`/`sex` `CHECK`s bite. Plan §12 did not require them.
- **Task 3:** `PROFILE_SECTIONS` uses `satisfies Record<string, readonly string[]>`
  — a tighter literal-key union would catch a mistyped section key.
- **Task 4:** `nstr`/`isoDate`/`emailField` repeat a 3-line "collapse empty → null"
  prelude ×3; `isoDate` leans on `Date.parse` leniency rather than an explicit
  calendar check.
- **Task 5:** `computeVerification` iterates `Object.entries(section)` while
  `computeCompleteness` is driven by `PROFILE_SECTIONS`; travel/refs completeness
  uses `isSet` (excludes `''`) vs. the spec text's `!= null`. Both benign.
- **Task 6:** `as SQLInputValue[]` cast (a type guard would be cleaner);
  `readSection`/`writeSection` `table: string` param could be `SectionName`-derived;
  the N+1 above; `writeSection` treats explicit `undefined` as `null`.
- **Task 7:** `k in cols` walks the prototype chain (`Object.hasOwn` safer; Zod
  strips unknown keys upstream); `updateChild`'s `UPDATE` lacks
  `AND applicant_id = ?` (ownership pre-checked in the same synchronous call);
  insert does `MAX(sort_order)+INSERT+touch` without a wrapping transaction
  (single-process `node:sqlite`, matches existing code).
- **Task 8:** if a caller bypasses Zod with an OCR `source` and
  `confidence === undefined`, `undefined` reaches `.run()` (which `node:sqlite`
  rejects) — `?? null` would harden; an upsert with no `source` silently resets an
  OCR row's `source` → `manual` / `confidence` → `null`.
- **Task 9:** an orphaned meta row (id segment not in the id map) is copied with a
  stale child id via `idMap.get(seg) ?? seg`; the section-loop "absent row" branch
  is effectively dead (create always inserts the 4 section rows) but harmless.
- **Task 13:** FIX — export `z.input` schema variants so `api.setFieldMeta` /
  `updateApplicant` accept them without the `as unknown as` casts; `SectionCard`
  submits the whole section every save (last-write-wins); `detail.identity as
  unknown as Record` defeats the compile check that `IDENTITY_FIELDS` keys match
  the `Identity` shape.
- **Task 14:** FIX — replace the hand-copied duplicate `detail` test fixture with
  `vi.hoisted()`; the 4 `as never` casts in `TravelSection`/`ReferenceSection`
  should be `as unknown as TravelInput`/`ReferenceInput` to restore some tsc
  checking; the `+ Add` button stays visible during edit mode (discards the edit
  silently, no correctness impact).
- **Pre-existing:** React Router v6→v7 future-flag warnings in every web test
  (tracked in `ARCHITECTURE.md` §11); `eslint.config.js` gained a `test/**`
  `no-explicit-any` override in Task 6 (final review may prefer it split out).

None of these block Phase 2 acceptance.

---

## 8. Recommended next phase

**Phase 3 — passport document upload + local MRZ / OCR extraction.**

1. Add a local-only passport image/PDF upload (stored under `data/`, gitignored,
   never transmitted).
2. Run **local** MRZ parsing / OCR (no cloud service) to extract identity +
   passport fields.
3. Write the extracted values as `applicant_field_meta` rows with
   `source = 'passport_mrz'` (or the relevant OCR source), a numeric `confidence`,
   the `raw_value`, and `verified = 0` — the schema already accepts this with no
   migration.
4. Build a **review-and-verify** flow in the applicant detail UI: show the
   OCR-proposed value beside the current value with its confidence, let the user
   accept (which promotes it to canonical data and can set `verified = 1`) or
   reject each field. OCR values are never auto-verified.
5. Keep the constraints: no portal automation, no form submission, no
   CAPTCHA/OTP/MFA handling, loopback only, PII never logged.
