# Phase 2 — Applicant Profile System

**Date:** 2026-09-02
**Status:** Approved (design + acceptance checklist)
**Project:** Visa Application Autofill (local-first)
**Builds on:** Phase 0 (portal settings, app skeleton) / Phase 1 (foundation verification).

**Related documents:**
- Foundation architecture: `docs/ARCHITECTURE.md`
- Data-source taxonomy, confidence levels, ICAO 9303 passport reference,
  per-field verification model: `docs/visa-form-analysis.md` §3, §4, §7
- Portal-agnostic risk register: `docs/automation-risks.md` (R6, R19)
- Implementation plan: `docs/superpowers/plans/2026-09-02-phase-2-applicant-profile.md`
  (written next)

---

## 1. Purpose & scope

Build the **applicant / profile management system**: the local store and UI for
the people a visa application is filled out for. This is the first phase that
holds real personal data.

### In scope

- CRUD for applicant profiles, persisted in SQLite (normalized, not one JSON blob).
- Duplicate an applicant (deep copy).
- List + substring search.
- View full applicant detail.
- Structured, **separated** sections: identity, passport, contact, address,
  travel records (1:many), references (1:many).
- **Per-field provenance & verification** in a dedicated `applicant_field_meta`
  table — separate from the canonical applicant data.
- Computed **profile completeness** and **verification status** (not stored).
- Nullable fields everywhere a value may not be known yet.
- Zod validation shared between server and web.
- Frontend screens: applicants list/search, applicant detail with editable
  sections and add/edit/delete for travel records and references, per-field
  "confirm" (verify) control.
- Automated tests: DB/migrations, service, validation, routes, web, persistence.

### Explicitly out of scope (later phases)

- Passport OCR / MRZ parsing / any document upload or extraction.
- Browser automation of any kind (Test Connection stays as Phase 0 left it).
- Visa-portal-specific fields on the core applicant model.
- Provenance **history / versioning** (Phase 2 keeps one current provenance row
  per `field_path`).
- Encryption of the SQLite file at rest.
- Linking an applicant to a visa application / submission.
- Photo / biometrics.

## 2. Engineering constraints (carried forward)

- Local-first. Server binds `127.0.0.1` only. `data/` and `.env` gitignored.
- **Personal / passport data is sensitive: never logged, never in error
  messages, never in list responses beyond what search needs.** `raw_value` and
  passport / DOB / address field paths are added to the pino redaction config.
- Sanitized client-facing errors only (existing `{ error: { code, message } }`
  envelope).
- Strict TypeScript. `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build` all pass at end of phase (or failures documented).
- TDD: every task writes failing tests first, then the implementation.
- No new runtime dependency unless justified. (Phase 2 needs **none** — Zod,
  Fastify, `node:sqlite`, React, React Router are already present.)
- All relative imports in `src/server/**` and `src/shared/**` use explicit `.js`.
- Canonical applicant data and provenance metadata remain **separate stores**.
  `applicant_field_meta` answers "where did this value come from and is it
  confirmed?" — it is never the primary storage for a value.

## 3. Architecture

### 3.1 Shape

```
Applicant  (root)
  ├── Identity        (1:1)
  ├── Passport        (1:1)
  ├── Contact         (1:1)
  ├── Address         (1:1)
  ├── Travel Records  (1:many)
  ├── References      (1:many)
  └── Field Meta      (1:many)  — provenance + verification, one row per logical field
```

### 3.2 Code layout (new files)

```
src/shared/
  applicant/
    types.ts            # Applicant, ApplicantDetail, sections, TravelRecord, Reference,
                        #   FieldMeta, Completeness, VerificationSummary, FieldSource
    fieldPaths.ts       # FIELD_SOURCES const + isFieldSource(); PROFILE_SECTIONS spec
                        #   (which fields count toward completeness); fieldPath format guard
    schemas.ts          # zod: identitySchema, passportSchema, contactSchema, addressSchema,
                        #   travelSchema, referenceSchema, fieldMetaInputSchema,
                        #   applicantCreateSchema, applicantPutSchema

src/server/
  db/migrations.ts      # + migration 2 (8 tables)
  services/
    applicantService.ts # all applicant/section/travel/reference/field-meta DB logic
    applicantCompleteness.ts  # pure: computeCompleteness(detail), computeVerification(meta)
  routes/
    applicants.ts       # REST handlers → applicantService

src/web/src/
  api/client.ts         # + applicant methods
  lib/applicantOptions.ts   # SEX_OPTIONS, REFERENCE_KIND_OPTIONS, TRIP_TYPE_OPTIONS,
                            #   FIELD_SOURCE_LABELS
  pages/Applicants/
    ApplicantsPage.tsx        # list + search + row actions
    ApplicantDetailPage.tsx   # sections + travel list + references list + summary header
    SectionCard.tsx           # one editable 1:1 section with per-field confirm control
    TravelRecordForm.tsx
    ReferenceForm.tsx
    CompletenessHeader.tsx

test/
  server/applicantMigrations.test.ts
  server/applicantService.test.ts
  server/applicantRoutes.test.ts
  server/applicantCompleteness.test.ts
  shared/applicantSchemas.test.ts
  web/ApplicantsPage.test.tsx
  web/ApplicantDetailPage.test.tsx
```

`applicantService` follows the existing `portalService` pattern: pure functions
taking the `DatabaseSync` handle as the first argument; no HTTP types; unit
tested against a temp DB.

## 4. Data model (migration 2)

`node:sqlite`. Pragmas already set (`WAL`, `foreign_keys = ON`). All timestamps
are ISO-8601 strings. All ids are `randomUUID()`. Every field below is
**nullable** unless marked `NOT NULL`.

```sql
CREATE TABLE applicants (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','archived')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE applicant_identity (
  applicant_id                 TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
  surname                      TEXT,
  given_names                  TEXT,
  full_name_as_in_passport     TEXT,
  date_of_birth                TEXT,          -- 'YYYY-MM-DD'
  sex                          TEXT CHECK (sex IN ('M','F','X') OR sex IS NULL),
  place_of_birth               TEXT,
  nationality                  TEXT,
  other_nationalities          TEXT
);

CREATE TABLE applicant_passport (
  applicant_id       TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
  document_type      TEXT,
  number             TEXT,
  issuing_state      TEXT,
  issue_date         TEXT,                    -- 'YYYY-MM-DD'
  expiry_date        TEXT,                    -- 'YYYY-MM-DD'
  place_of_issue     TEXT,
  issuing_authority  TEXT
);

CREATE TABLE applicant_contact (
  applicant_id  TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
  email         TEXT,
  phone         TEXT,
  alt_phone     TEXT
);

CREATE TABLE applicant_address (
  applicant_id  TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
  line1         TEXT,
  line2         TEXT,
  city          TEXT,
  region        TEXT,
  postal_code   TEXT,
  country       TEXT
);

CREATE TABLE applicant_travel (
  id                  TEXT PRIMARY KEY,
  applicant_id        TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  trip_type           TEXT,
  purpose             TEXT,
  destination_country TEXT,
  cities              TEXT,
  arrival_date        TEXT,                   -- 'YYYY-MM-DD'
  departure_date      TEXT,                   -- 'YYYY-MM-DD'
  port_of_entry       TEXT,
  port_of_exit        TEXT,
  accommodation       TEXT,
  previous_travel     TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_applicant_travel_applicant ON applicant_travel(applicant_id, sort_order);

CREATE TABLE applicant_reference (
  id            TEXT PRIMARY KEY,
  applicant_id  TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  kind          TEXT NOT NULL DEFAULT 'other'
                CHECK (kind IN ('emergency_contact','employer','in_country_host','sponsor','other')),
  name          TEXT,
  relationship  TEXT,
  organization  TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_applicant_reference_applicant ON applicant_reference(applicant_id, sort_order);

CREATE TABLE applicant_field_meta (
  id            TEXT PRIMARY KEY,
  applicant_id  TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  field_path    TEXT NOT NULL,
  source        TEXT NOT NULL,                -- validated in the service layer, not by CHECK
  confidence    REAL,                         -- NULL for manual/imported/system
  raw_value     TEXT,                         -- sensitive; redacted in logs
  verified      INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  verified_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (applicant_id, field_path)
);
CREATE INDEX idx_applicant_field_meta_applicant ON applicant_field_meta(applicant_id);
```

**Notes**

- The four 1:1 satellite rows are **created empty when the applicant is
  created**, so reads never have to reason about a missing satellite. Deleting an
  applicant cascades to all seven child tables.
- `source` is **not** a SQL `CHECK` — the allowed set lives in
  `src/shared/applicant/fieldPaths.ts` (`FIELD_SOURCES`) so Phase 3 can add
  `passport_mrz` / `passport_ocr` / `document_ocr` without a migration. The
  service validates against it on write.
- `field_path` is opaque to the persistence layer. Format (validated in shared
  code, not the DB): dot-separated segments, each `[a-z0-9_]+`, with numeric or
  child-id segments allowed for list items — e.g. `identity.surname`,
  `passport.number`, `travel.<uuid>.arrival_date`, `references.<uuid>.name`.
- `sort_order` gives travel records and references a stable, user-controllable
  order; the service assigns `max(sort_order)+1` on insert.

## 5. Provenance & verification rules

| Concern | Rule |
|---|---|
| `source` on manual entry | `'manual'`. `'imported'` reserved for a future bulk import, `'system'` for values the app derives. |
| `source` from Phase 3 | `'passport_mrz'`, `'passport_ocr'`, `'document_ocr'` — added to `FIELD_SOURCES` later, no schema change. |
| `confidence` | `REAL`, nullable. **Always `null`** for `manual` / `imported` / `system`. Never invented. Phase 3 OCR may store a number in `[0,1]`. |
| `verified` | Per field. Manual entry → `0`. The user explicitly confirming a field → `1` + `verified_at = now`. Un-confirming → `0` + `verified_at = null`. |
| OCR values | **Never** auto-`verified`. A Phase 3 OCR write is `verified = 0` until the user reviews it. |
| `raw_value` | Optional. Preserves the original extracted string for provenance/debugging. **Sensitive**: redacted in logs, never in error messages, only returned in the single-applicant detail fetch (not the list). |
| User correction of an OCR value | Updates the canonical column **and** upserts the field's meta to `source='manual'`, `confidence=null`, `verified` per the user's confirm action. The prior provenance row is overwritten (no history in Phase 2). |
| Uniqueness | One meta row per `(applicant_id, field_path)`. Writes are upserts (`ON CONFLICT ... DO UPDATE`). |

## 6. Computed values (not stored)

### 6.1 Completeness

`src/shared/applicant/fieldPaths.ts` exports `PROFILE_SECTIONS`: for each of
`identity`, `passport`, `contact`, `address` a list of field paths that count
toward "complete". `travel` and `references` are boolean sections — `travel` is
`1` when ≥1 record has a non-null `purpose` **and** `arrival_date` (else `0`);
`references` is `1` when ≥1 record has a non-null `name` (else `0`).

`computeCompleteness(detail)` →
`{ overall: number (0..1), bySection: Record<section, number> }` where:
- `bySection[identity|passport|contact|address]` = filled counting-fields /
  total counting-fields for that section (0..1).
- `bySection[travel|references]` = the `0` / `1` above.
- `overall` = the unweighted mean of all six `bySection` values.

### 6.2 Verification summary

`computeVerification(fieldMeta, detail)` → `{ verified: n, total: m, ratio,
label: 'unverified' | 'partial' | 'verified', bySection: Record<section, {verified, total}> }`
where `total` per section = the number of **non-null** canonical fields in that
section (you can only verify a field that has a value), and `verified` = those
with a `verified = 1` meta row. `label`: `verified` when `ratio === 1` and
`total > 0`; `unverified` when `verified === 0`; else `partial`.

Both are attached to `GET /api/applicants/:id`.

## 7. API

Base `/api/applicants`. JSON in/out. Errors use the existing envelope. Codes:
`VALIDATION_ERROR`, `NOT_FOUND`, `INTERNAL`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/applicants` | — (`?q=` optional) | `{ applicants: ApplicantSummary[] }` |
| POST | `/api/applicants` | `applicantCreateSchema` (`displayName` required; section objects optional) | `201 { applicant: ApplicantDetail }` |
| GET | `/api/applicants/:id` | — | `{ applicant: ApplicantDetail }` (sections + `travel[]` + `references[]` + `fieldMeta[]` + `completeness` + `verification` + `warnings: string[]`) |
| PUT | `/api/applicants/:id` | `applicantPutSchema` (`displayName?`, `status?`, `identity?`, `passport?`, `contact?`, `address?` — each a partial patch) | `{ applicant: ApplicantDetail }` |
| DELETE | `/api/applicants/:id` | — | `{ deleted: true }` (404 if missing) |
| POST | `/api/applicants/:id/duplicate` | — | `201 { applicant: ApplicantDetail }` |
| POST | `/api/applicants/:id/travel` | `travelSchema` (all fields optional) | `201 { travel: TravelRecord }` |
| PUT | `/api/applicants/:id/travel/:travelId` | `travelSchema` | `{ travel: TravelRecord }` |
| DELETE | `/api/applicants/:id/travel/:travelId` | — | `{ deleted: true }` |
| POST | `/api/applicants/:id/references` | `referenceSchema` (`kind` defaults `other`) | `201 { reference: Reference }` |
| PUT | `/api/applicants/:id/references/:refId` | `referenceSchema` | `{ reference: Reference }` |
| DELETE | `/api/applicants/:id/references/:refId` | — | `{ deleted: true }` |
| PUT | `/api/applicants/:id/field-meta` | `{ fieldPath: string, source?: FieldSource, confidence?: number\|null, rawValue?: string\|null, verified?: boolean }` | `{ fieldMeta: FieldMeta }` |

- `ApplicantSummary`: `{ id, displayName, status, nationality, passportNumberLast4, completeness: {overall}, verification: {label}, createdAt, updatedAt }`. **No raw passport number, no `raw_value`, no DOB** in the list.
- `PUT /field-meta` upserts one field's provenance; `verified: true` sets
  `verified_at = now`, `verified: false` clears it. `source` defaults to
  `'manual'` when the row is created and omitted. Rejects a `source` not in
  `FIELD_SOURCES`, or a non-null `confidence` paired with a non-OCR `source`.
- **Search** `?q=`: case-insensitive `LIKE '%q%'` over `applicants.display_name`,
  `identity.surname`, `identity.given_names`, `identity.nationality`,
  `passport.number`, `contact.email`. Empty/absent `q` → all applicants,
  newest-updated first.

## 8. Duplicate semantics

`POST /api/applicants/:id/duplicate`:

1. New `applicants` row: new id, `display_name = "<original> (copy)"`,
   `status = 'draft'`, fresh timestamps.
2. Copy the four 1:1 sections verbatim.
3. Copy every `applicant_travel` and `applicant_reference` row: new ids, same
   `sort_order`, fresh timestamps. Build an `oldChildId → newChildId` map.
4. Copy every `applicant_field_meta` row: new id, **`verified = 0`,
   `verified_at = null`**; `source`, `confidence`, `raw_value` preserved; any
   `field_path` segment that is an old child id is rewritten via the map.
5. Return the new `ApplicantDetail`.

All in one transaction (`BEGIN`/`COMMIT`/`ROLLBACK`).

## 9. Validation (`src/shared/applicant/schemas.ts`)

- Section schemas (`identity`, `passport`, `contact`, `address`): every field
  `.nullable().optional()`; blank strings trimmed to `null`; `sex` enum
  `['M','F','X']`; dates a `YYYY-MM-DD` regex or `null`; `email` — when non-null,
  a lenient email check; `phone` — when non-null, `≤ 40` chars.
- `travelSchema`: all fields optional/nullable; `trip_type` free text (≤ 60);
  dates as above.
- `referenceSchema`: `kind` enum with default `'other'`; `email`/`phone` as above.
- `fieldMetaInputSchema`: `fieldPath` matches the format guard;
  `source` in `FIELD_SOURCES` (default `'manual'`); `confidence`
  `number in [0,1] | null`; `verified` boolean optional; `rawValue`
  `string | null` optional. Refinement: `confidence` must be `null` unless
  `source` is one of the OCR sources.
- `applicantCreateSchema`: `displayName` trimmed, 1–120; optional nested section
  objects. `applicantPutSchema`: all top-level keys optional; `status` enum.
- **Cross-field checks are warnings, not errors** in Phase 2. If
  `passport.issue_date` and `passport.expiry_date` are both present and
  `expiry <= issue`, the write still succeeds; `GET /:id` includes a
  `warnings: string[]` array. A draft profile is allowed to be internally
  inconsistent.

## 10. Frontend

- **Route group**: `/applicants` (list) and `/applicants/:id` (detail). Nav gets
  an "Applicants" `NavLink` alongside "Visa Portals".
- **`ApplicantsPage`**: search input (debounced, updates `?q=`); table of
  summaries — name, nationality, passport `••••1234`, a completeness bar
  (`overall`), a verification badge (`label`), actions `[View] [Duplicate]
  [Delete]` (delete confirmed). `[+ New applicant]` opens a minimal create form
  (display name only; sections filled in on the detail page). Empty state.
- **`ApplicantDetailPage`**:
  - `CompletenessHeader` — overall bar + per-section chips + verification summary.
  - Four `SectionCard`s (Identity, Passport, Contact, Address): view mode shows
    each field with its value and a ✓/○ verify toggle (calls
    `PUT /field-meta`); edit mode is a controlled form saving the whole section
    via `PUT /:id`. Client validation mirrors the shared schema.
  - **Travel Records**: list of cards, each `[Edit] [Delete]`; `[+ Add Travel
    Record]` opens `TravelRecordForm`.
  - **References**: same pattern with `ReferenceForm` (kind selector).
  - Back link to the list; a `[Duplicate]` and `[Delete]` action for the whole
    applicant.
- **`api/client.ts`**: typed methods for every endpoint in §7. `raw_value` is
  never sent to the client in list responses; the detail response includes
  `fieldMeta` (with `rawValue`) for the provenance display.
- Styling reuses the existing `styles.css` conventions (tables, cards, forms,
  `.error`, `.mono`); a modest amount of new CSS for the section cards, verify
  toggles, and completeness bar.

## 11. Security & privacy

- `logger.REDACT_PATHS` gains applicant-data paths (exact list finalized in the
  implementation task): at least `rawValue` / `raw_value`, `surname`,
  `givenNames` / `given_names`, `dateOfBirth` / `date_of_birth`, address
  `line1` / `line2` / `postalCode` / `postal_code`, `email`, `phone`, and the
  passport `number` under an applicant/passport scope — each with a `*.`-prefixed
  wildcard variant — plus the existing passport / DOB / MRZ entries. Bare
  over-broad keys (e.g. a top-level `number`) are avoided. Applicant write route
  bodies are not logged at `info`.
- Error handler already sanitizes to `{ error: { code, message } }`; no
  applicant field values appear in `validationError` output (it reports the
  field path and the rule, e.g. `identity.dateOfBirth: must be YYYY-MM-DD`, not
  the bad value).
- `ApplicantSummary` deliberately omits DOB, full passport number, addresses,
  emails, `raw_value`.
- DB file is local and gitignored. Encryption at rest is **not** added in
  Phase 2 (single-user local tool; recorded as a possible later hardening).

## 12. Testing strategy

| Area | Tool | What |
|---|---|---|
| Migration 2 | Vitest | 8 tables created; `user_version` → 2; idempotent; `ON DELETE CASCADE` clears every child table; existing portal tables untouched |
| Service — applicant CRUD | Vitest + temp DB | create (empty satellites made); read detail; update section patches; delete; newest-first list |
| Service — search | Vitest | matches display name / surname / given names / nationality / passport number / email; case-insensitive; empty `q` → all |
| Service — duplicate | Vitest | deep copy of sections + travel + references + meta; `verified` reset to 0, `verified_at` null; `source`/`confidence`/`raw_value` kept; child-id field paths remapped; original unchanged |
| Service — travel & references | Vitest | add/edit/delete; `sort_order` increments; delete of one leaves others; cascade on applicant delete |
| Service — field meta | Vitest | upsert unique per `(applicant_id, field_path)`; `confidence` null for `manual`; accepts future OCR `source` values; `verified_at` set only when `verified` goes true, cleared when false; multiple rows per applicant |
| Completeness / verification | Vitest | pure functions: empty profile → 0; fully filled → 1; per-section ratios; verification `label` transitions unverified→partial→verified; `total` counts only non-null fields |
| Validation | Vitest | each section schema (valid / all-null / bad enum / bad date / blank→null); `fieldMetaInputSchema` (source allow-list incl. OCR values, confidence-null refinement, path format); `applicantCreateSchema` (name required/trimmed) |
| Routes | Vitest + `fastify.inject` | happy paths for every endpoint; 400 on bad body; 404 on unknown id / child id; duplicate endpoint; field-meta endpoint; `?q=` search; `ApplicantSummary` omits sensitive fields |
| Persistence | Vitest | applicant + all children + meta survive `buildServer` restart on the same DB file |
| Web — list | Vitest + jsdom | renders summaries from the API; empty state; typing in search calls the API with `q` |
| Web — detail | Vitest + jsdom | renders the four sections + travel list + references list + completeness header; a section form blocks an invalid save (no API call); clicking a verify toggle calls `PUT /field-meta` |

No real portal, no network, no browser automation in any Phase 2 test.

## 13. Acceptance checklist

Phase 2 is complete only when all are true:

- [ ] Migration 2 brings a Phase 0/1 database to `user_version = 2` with all 8
      new tables; idempotent; existing `visa_portals` / `app_settings` data
      preserved.
- [ ] User can create an applicant (display name only) and it appears in the list.
- [ ] User can open an applicant and fill / edit identity, passport, contact,
      address; changes persist.
- [ ] User can add, edit, and delete multiple travel records.
- [ ] User can add, edit, and delete multiple references, each with a kind.
- [ ] User can delete an applicant; all sections, travel, references, and field
      meta are removed (cascade).
- [ ] User can duplicate an applicant; the copy has the data, `verified` reset,
      a `" (copy)"` name, and does not affect the original.
- [ ] User can search applicants by name / passport number / nationality / email.
- [ ] Applicant detail shows a computed completeness figure (overall + per
      section) that updates as fields are filled.
- [ ] Each field can be marked verified / unverified by the user; `verified_at`
      is set on confirm; the verification summary reflects it.
- [ ] `applicant_field_meta` stores `source` (`manual` for hand entry),
      nullable `confidence` (null for manual), `raw_value`, `verified`,
      `verified_at`; accepts the Phase 3 OCR `source` values without a schema
      change; enforces one row per `(applicant, field_path)`.
- [ ] Canonical applicant data and provenance metadata are in separate tables;
      the meta table is not the primary store for any value.
- [ ] Nullable fields are supported throughout — a half-filled profile saves and
      reloads intact.
- [ ] No passport number, DOB, address, email, or `raw_value` appears in any log
      line or error message; the list response omits them.
- [ ] No browser automation, OCR, document upload, or portal-specific field was
      added.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass
      (or failures documented).
- [ ] Git diff reviewed; each task a focused commit.

**Do not mark the phase complete if any required checkbox fails.**

## 14. End-of-phase report

`docs/PHASE-2-REPORT.md`: what was implemented, files changed, tests executed +
results, the acceptance checklist with evidence, remaining limitations, and the
recommended next phase (Phase 3 — passport document upload + local MRZ/OCR
extraction writing into `applicant_field_meta`, user review/verify flow).
