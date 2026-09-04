# Phase 2 — Applicant Profile System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local applicant/profile store and UI — normalized SQLite schema (identity, passport, contact, address, travel×N, references×N), per-field provenance/verification kept separate from canonical data, CRUD + duplicate + search + computed completeness, and the React screens — with no OCR and no browser automation.

**Architecture:** A migration adds 8 tables. `applicantService` is pure DB logic (takes the `DatabaseSync` handle first, no HTTP types) mirroring the existing `portalService`. Section reads/writes are driven by column-metadata maps, not per-section mapper functions, to stay DRY. Zod schemas + a field-source enum + a profile-section spec live in `src/shared/applicant/` and are imported by both server and web. Completeness/verification are pure functions computed on read. Fastify routes validate → call the service → map errors through the existing sanitizer. The frontend adds an `/applicants` route group.

**Tech Stack:** TypeScript (ESM, NodeNext server / Bundler web), Node 24, Fastify 5, `node:sqlite` `DatabaseSync`, Zod 3, Pino, React 18, React Router 6, Vite 5, Vitest 3, ESLint 9.

## Global Constraints

- **Local-first.** Server binds `127.0.0.1` only. `data/` and `.env` gitignored. No dependency added (Zod, Fastify, `node:sqlite`, React, React Router already present) — a new dependency needs written justification.
- **Personal / passport data is sensitive.** Never logged, never in error messages, never in list responses. `raw_value` and passport/DOB/address/name/email/phone field paths are added to the pino redaction config (Task 2). Applicant write-route bodies are not logged at `info`. `validationError` reports the field path + rule, never the offending value.
- **Canonical data and provenance are separate stores.** `applicant_field_meta` answers "where did this value come from and is it confirmed?" — it is never the primary storage for a value.
- **`source` is validated in shared code, not by SQL `CHECK`.** `FIELD_SOURCES` in `src/shared/applicant/fieldPaths.ts` is the allow-list; Phase 3 adds OCR sources there with no migration.
- **`confidence` is always `null` for `manual` / `imported` / `system`.** Never invented for hand-entered data.
- **OCR values are never auto-verified.** (No OCR in Phase 2; the rule is built into the field-meta write path now.)
- **Nullable everywhere.** Every section/detail field is nullable; a half-filled profile must save and reload intact.
- TS strict. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass at end of phase (or failures documented in the report).
- All relative imports in `src/server/**` and `src/shared/**` use an explicit `.js` extension. `src/web/**` omits extensions (Bundler resolution).
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit. Conventional Commit messages. Append the two trailers used in this repo's recent commits:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq
  ```
- Every task ends with a commit. No browser automation, OCR, document upload, or portal-specific field is added in any task.

---

## File structure

```
src/shared/applicant/
  types.ts                     # all TS interfaces/enums for the applicant domain (no runtime code)
  fieldPaths.ts                # FIELD_SOURCES, OCR_SOURCES, isFieldSource, isOcrSource,
                               #   isValidFieldPath, PROFILE_SECTIONS
  schemas.ts                   # zod: identity/passport/contact/address/travel/reference/
                               #   fieldMetaInput/applicantCreate/applicantPut schemas + PatchTypes

src/server/
  db/migrations.ts             # + migration 2 (8 tables) — MODIFY
  logger.ts                    # + applicant PII redaction paths — MODIFY
  services/
    applicantColumns.ts        # SECTION_TABLES column-metadata map + readSection/writeSection/deleteMeta helpers
    applicantCompleteness.ts   # computeCompleteness(detail), computeVerification(detail), collectWarnings(detail) — pure
    applicantService.ts        # all applicant/section/travel/reference/field-meta/duplicate/search DB logic
  routes/
    applicants.ts              # REST handlers → applicantService
  app.ts                       # register applicant routes — MODIFY

src/web/src/
  api/client.ts                # + applicant methods — MODIFY
  main.tsx                     # + /applicants routes — MODIFY
  App.tsx                      # + "Applicants" NavLink — MODIFY
  styles.css                   # + section-card / verify-toggle / completeness-bar styles — MODIFY
  lib/applicantOptions.ts      # SEX_OPTIONS, REFERENCE_KIND_OPTIONS, TRIP_TYPE_OPTIONS, FIELD_SOURCE_LABELS
  pages/Applicants/
    ApplicantsPage.tsx         # list + search + create + row actions
    ApplicantDetailPage.tsx    # composition: header + 4 section cards + travel list + references list
    SectionCard.tsx            # one editable 1:1 section, per-field verify toggle
    CompletenessHeader.tsx     # completeness bars + verification summary
    TravelRecordForm.tsx       # add/edit one travel record
    ReferenceForm.tsx          # add/edit one reference

test/
  server/applicantMigrations.test.ts
  server/loggerRedaction.test.ts
  server/applicantCompleteness.test.ts
  server/applicantService.test.ts
  server/applicantRoutes.test.ts
  shared/applicantSchemas.test.ts
  web/ApplicantsPage.test.tsx
  web/ApplicantDetailPage.test.tsx
```

---

### Task 1: Migration 2 — applicant schema (8 tables)

**Files:**
- Modify: `src/server/db/migrations.ts`
- Test: `test/server/applicantMigrations.test.ts`

**Interfaces:**
- Consumes: `openDatabase(dbPath)` and `runMigrations(db)`, `LATEST_SCHEMA_VERSION` (existing, `src/server/db/*`)
- Produces: `LATEST_SCHEMA_VERSION` becomes `2`. Tables: `applicants`, `applicant_identity`, `applicant_passport`, `applicant_contact`, `applicant_address`, `applicant_travel`, `applicant_reference`, `applicant_field_meta` (schema exactly as in the spec §4).

- [ ] **Step 1: Write the failing test `test/server/applicantMigrations.test.ts`**

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations, LATEST_SCHEMA_VERSION } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let db: DatabaseSync;
let dbPath: string;

function userVersion(d: DatabaseSync): number {
  return (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}
function tableNames(d: DatabaseSync): string[] {
  return d
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name);
}

beforeEach(() => {
  dbPath = makeTempDbPath();
  db = openDatabase(dbPath);
});
afterEach(() => {
  db.close();
  cleanupTempDb(dbPath);
});

it('LATEST_SCHEMA_VERSION is 2', () => {
  expect(LATEST_SCHEMA_VERSION).toBe(2);
});

it('creates all eight applicant tables and reaches version 2', () => {
  runMigrations(db);
  expect(userVersion(db)).toBe(2);
  for (const t of [
    'applicants',
    'applicant_identity',
    'applicant_passport',
    'applicant_contact',
    'applicant_address',
    'applicant_travel',
    'applicant_reference',
    'applicant_field_meta',
  ]) {
    expect(tableNames(db)).toContain(t);
  }
});

it('is idempotent', () => {
  runMigrations(db);
  expect(() => runMigrations(db)).not.toThrow();
  expect(userVersion(db)).toBe(2);
});

it('preserves existing portal data when upgrading from v1', () => {
  // simulate a Phase 0/1 database: run only migration 1 by faking user_version
  db.exec(`
    CREATE TABLE visa_portals (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
      portal_type TEXT NOT NULL, country TEXT, application_type TEXT, notes TEXT,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    PRAGMA user_version = 1;
  `);
  db.prepare(
    `INSERT INTO visa_portals (id,name,url,portal_type,enabled,created_at,updated_at)
     VALUES ('p1','Keep me','https://example.com','evisa',1,'2026-01-01','2026-01-01')`,
  ).run();

  runMigrations(db);

  expect(userVersion(db)).toBe(2);
  const row = db.prepare('SELECT name FROM visa_portals WHERE id = ?').get('p1') as
    | { name: string }
    | undefined;
  expect(row?.name).toBe('Keep me');
});

it('cascades applicant deletion to every child table', () => {
  runMigrations(db);
  const now = '2026-01-01T00:00:00Z';
  db.prepare(
    `INSERT INTO applicants (id, display_name, status, created_at, updated_at)
     VALUES ('a1','A','draft',?,?)`,
  ).run(now, now);
  db.prepare(`INSERT INTO applicant_identity (applicant_id, surname) VALUES ('a1','X')`).run();
  db.prepare(`INSERT INTO applicant_passport (applicant_id, number) VALUES ('a1','N')`).run();
  db.prepare(`INSERT INTO applicant_contact (applicant_id, email) VALUES ('a1','e')`).run();
  db.prepare(`INSERT INTO applicant_address (applicant_id, city) VALUES ('a1','C')`).run();
  db.prepare(
    `INSERT INTO applicant_travel (id, applicant_id, sort_order, created_at, updated_at)
     VALUES ('t1','a1',0,?,?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO applicant_reference (id, applicant_id, sort_order, kind, created_at, updated_at)
     VALUES ('r1','a1',0,'other',?,?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO applicant_field_meta
       (id, applicant_id, field_path, source, verified, created_at, updated_at)
     VALUES ('m1','a1','identity.surname','manual',0,?,?)`,
  ).run(now, now);

  db.prepare('DELETE FROM applicants WHERE id = ?').run('a1');

  for (const t of [
    'applicant_identity',
    'applicant_passport',
    'applicant_contact',
    'applicant_address',
    'applicant_travel',
    'applicant_reference',
    'applicant_field_meta',
  ]) {
    const count = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
    expect(count.n, `${t} should be empty after cascade`).toBe(0);
  }
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm test -- applicantMigrations`
Expected: FAIL — `LATEST_SCHEMA_VERSION` is `1`; the applicant tables do not exist.

- [ ] **Step 3: Add migration 2 to `src/server/db/migrations.ts`**

Append a second entry to the `migrations` array (after the `version: 1` object). `LATEST_SCHEMA_VERSION` and `runMigrations` need no other change — they already derive from the array and apply every migration with `version > user_version` in a `BEGIN…COMMIT`.

```ts
  {
    version: 2,
    up: `
      CREATE TABLE applicants (
        id            TEXT PRIMARY KEY,
        display_name  TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','archived')),
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE applicant_identity (
        applicant_id             TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
        surname                  TEXT,
        given_names              TEXT,
        full_name_as_in_passport TEXT,
        date_of_birth            TEXT,
        sex                      TEXT CHECK (sex IN ('M','F','X') OR sex IS NULL),
        place_of_birth           TEXT,
        nationality              TEXT,
        other_nationalities      TEXT
      );

      CREATE TABLE applicant_passport (
        applicant_id      TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
        document_type     TEXT,
        number            TEXT,
        issuing_state     TEXT,
        issue_date        TEXT,
        expiry_date       TEXT,
        place_of_issue    TEXT,
        issuing_authority TEXT
      );

      CREATE TABLE applicant_contact (
        applicant_id TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
        email        TEXT,
        phone        TEXT,
        alt_phone    TEXT
      );

      CREATE TABLE applicant_address (
        applicant_id TEXT PRIMARY KEY REFERENCES applicants(id) ON DELETE CASCADE,
        line1        TEXT,
        line2        TEXT,
        city         TEXT,
        region       TEXT,
        postal_code  TEXT,
        country      TEXT
      );

      CREATE TABLE applicant_travel (
        id                  TEXT PRIMARY KEY,
        applicant_id        TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
        sort_order          INTEGER NOT NULL DEFAULT 0,
        trip_type           TEXT,
        purpose             TEXT,
        destination_country TEXT,
        cities              TEXT,
        arrival_date        TEXT,
        departure_date      TEXT,
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
        id           TEXT PRIMARY KEY,
        applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        kind         TEXT NOT NULL DEFAULT 'other'
                     CHECK (kind IN ('emergency_contact','employer','in_country_host','sponsor','other')),
        name         TEXT,
        relationship TEXT,
        organization TEXT,
        phone        TEXT,
        email        TEXT,
        address      TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_applicant_reference_applicant ON applicant_reference(applicant_id, sort_order);

      CREATE TABLE applicant_field_meta (
        id           TEXT PRIMARY KEY,
        applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
        field_path   TEXT NOT NULL,
        source       TEXT NOT NULL,
        confidence   REAL,
        raw_value    TEXT,
        verified     INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
        verified_at  TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        UNIQUE (applicant_id, field_path)
      );
      CREATE INDEX idx_applicant_field_meta_applicant ON applicant_field_meta(applicant_id);
    `,
  },
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npm test -- applicantMigrations`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full server suite to check nothing regressed**

Run: `npm test -- migrations portalService portalRoutes`
Expected: PASS (existing tests unaffected — migration 2 only runs on a fresh/older DB).

- [ ] **Step 6: Commit**

```bash
git add src/server/db/migrations.ts test/server/applicantMigrations.test.ts
git commit -m "feat: migration 2 — normalized applicant profile schema (8 tables)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 2: Logger redaction for applicant PII

**Files:**
- Modify: `src/server/logger.ts`
- Test: `test/server/loggerRedaction.test.ts`

**Interfaces:**
- Consumes: `REDACT_PATHS` and `logger` (existing exports of `src/server/logger.ts`)
- Produces: `REDACT_PATHS` additionally contains applicant-data keys (both camelCase and snake_case) and `*.`-wildcard variants. Behaviour of `logger` unchanged except more keys are censored.

- [ ] **Step 1: Write the failing test `test/server/loggerRedaction.test.ts`**

```ts
import { expect, it } from 'vitest';
import { REDACT_PATHS } from '../../src/server/logger.js';

const MUST_INCLUDE = [
  'rawValue',
  'raw_value',
  'surname',
  'givenNames',
  'given_names',
  'dateOfBirth',
  'date_of_birth',
  'passportNumber',
  'email',
  'phone',
  'line1',
  'line2',
  'postalCode',
  'postal_code',
  '*.rawValue',
  '*.surname',
  '*.passportNumber',
];

it('redacts every applicant PII key we care about', () => {
  for (const key of MUST_INCLUDE) {
    expect(REDACT_PATHS, `REDACT_PATHS should contain ${key}`).toContain(key);
  }
});

it('does not use a bare over-broad "number" key', () => {
  // a top-level `number` would redact unrelated numeric fields (counts, ports…)
  expect(REDACT_PATHS).not.toContain('number');
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm test -- loggerRedaction`
Expected: FAIL — the new keys are missing.

- [ ] **Step 3: Extend `REDACT_PATHS` in `src/server/logger.ts`**

Replace the existing `REDACT_PATHS` array with:

```ts
export const REDACT_PATHS = [
  // Phase 0 groundwork
  'passportNumber', 'passport_number', 'dateOfBirth', 'date_of_birth', 'dob',
  'address', 'documentText', 'mrz', 'applicant', 'password', 'token',
  'req.headers.authorization', 'req.headers.cookie',
  '*.passportNumber', '*.mrz', '*.dateOfBirth',
  // Phase 2 — applicant profile data
  'rawValue', 'raw_value',
  'surname', 'givenNames', 'given_names', 'fullNameAsInPassport', 'full_name_as_in_passport',
  'placeOfBirth', 'place_of_birth',
  'email', 'phone', 'altPhone', 'alt_phone',
  'line1', 'line2', 'postalCode', 'postal_code',
  'issuingAuthority', 'issuing_authority',
  '*.rawValue', '*.raw_value',
  '*.surname', '*.givenNames', '*.given_names',
  '*.passportNumber', '*.dateOfBirth', '*.date_of_birth',
  '*.email', '*.phone', '*.line1', '*.line2', '*.postalCode',
] as const;
```

> NOTE: `pino`'s `redact.paths` accepts a `readonly string[]`. If `logger.ts`
> currently spreads `REDACT_PATHS` into the pino config as a mutable array,
> keep whatever cast it already uses; do not change the pino call otherwise.

- [ ] **Step 4: Run the test — verify it passes**

Run: `npm test -- loggerRedaction`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck (the `as const` change can surface a pino typing nit)**

Run: `npm run typecheck`
Expected: PASS. If pino rejects the `readonly` tuple, change `as const` to a plain
`: string[]` annotation on the export and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/server/logger.ts test/server/loggerRedaction.test.ts
git commit -m "feat: redact applicant PII (names, passport, contact, address, raw_value) in logs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 3: Shared applicant contract — types + field-path/source helpers

**Files:**
- Create: `src/shared/applicant/types.ts`
- Create: `src/shared/applicant/fieldPaths.ts`
- Test: `test/shared/applicantSchemas.test.ts` (this task adds the `fieldPaths` describe block; Task 4 adds the schema blocks to the same file)

**Interfaces:**
- Consumes: nothing (leaf modules)
- Produces:
  - `src/shared/applicant/types.ts` — types only (`export type` / `export interface`):
    ```ts
    type ApplicantStatus = 'draft' | 'archived';
    type Sex = 'M' | 'F' | 'X';
    type ReferenceKind = 'emergency_contact' | 'employer' | 'in_country_host' | 'sponsor' | 'other';
    type FieldSource = 'manual' | 'imported' | 'system' | 'passport_mrz' | 'passport_ocr' | 'document_ocr';
    type SectionKey = 'identity' | 'passport' | 'contact' | 'address' | 'travel' | 'references';
    interface Identity { surname: string|null; givenNames: string|null; fullNameAsInPassport: string|null;
      dateOfBirth: string|null; sex: Sex|null; placeOfBirth: string|null; nationality: string|null;
      otherNationalities: string|null; }
    interface Passport { documentType: string|null; number: string|null; issuingState: string|null;
      issueDate: string|null; expiryDate: string|null; placeOfIssue: string|null; issuingAuthority: string|null; }
    interface Contact { email: string|null; phone: string|null; altPhone: string|null; }
    interface Address { line1: string|null; line2: string|null; city: string|null; region: string|null;
      postalCode: string|null; country: string|null; }
    interface TravelRecord { id: string; applicantId: string; sortOrder: number; tripType: string|null;
      purpose: string|null; destinationCountry: string|null; cities: string|null; arrivalDate: string|null;
      departureDate: string|null; portOfEntry: string|null; portOfExit: string|null; accommodation: string|null;
      previousTravel: string|null; notes: string|null; createdAt: string; updatedAt: string; }
    interface Reference { id: string; applicantId: string; sortOrder: number; kind: ReferenceKind;
      name: string|null; relationship: string|null; organization: string|null; phone: string|null;
      email: string|null; address: string|null; createdAt: string; updatedAt: string; }
    interface FieldMeta { id: string; applicantId: string; fieldPath: string; source: FieldSource;
      confidence: number|null; rawValue: string|null; verified: boolean; verifiedAt: string|null;
      createdAt: string; updatedAt: string; }
    interface Completeness { overall: number; bySection: Record<SectionKey, number>; }
    interface VerificationSummary { verified: number; total: number; ratio: number;
      label: 'unverified'|'partial'|'verified'; bySection: Record<SectionKey, { verified: number; total: number }>; }
    interface Applicant { id: string; displayName: string; status: ApplicantStatus;
      createdAt: string; updatedAt: string; }
    interface ApplicantSummary extends Applicant { nationality: string|null; passportNumberLast4: string|null;
      completeness: { overall: number }; verification: { label: VerificationSummary['label'] }; }
    interface ApplicantDetail extends Applicant { identity: Identity; passport: Passport; contact: Contact;
      address: Address; travel: TravelRecord[]; references: Reference[]; fieldMeta: FieldMeta[];
      completeness: Completeness; verification: VerificationSummary; warnings: string[]; }
    ```
  - `src/shared/applicant/fieldPaths.ts`:
    ```ts
    FIELD_SOURCES: readonly FieldSource[]           // ['manual','imported','system','passport_mrz','passport_ocr','document_ocr']
    OCR_SOURCES: readonly string[]                  // ['passport_mrz','passport_ocr','document_ocr']
    isFieldSource(v: unknown): v is FieldSource
    isOcrSource(v: string): boolean
    isValidFieldPath(p: string): boolean
    PROFILE_SECTIONS: Record<'identity'|'passport'|'contact'|'address', readonly string[]>
    ```

- [ ] **Step 1: Write the failing test — add to `test/shared/applicantSchemas.test.ts`**

Create the file with just the `fieldPaths` block for now:

```ts
import { describe, expect, it } from 'vitest';
import {
  FIELD_SOURCES,
  OCR_SOURCES,
  isFieldSource,
  isOcrSource,
  isValidFieldPath,
  PROFILE_SECTIONS,
} from '../../src/shared/applicant/fieldPaths.js';

describe('field sources', () => {
  it('includes the Phase 2 sources and the Phase 3 OCR sources', () => {
    expect([...FIELD_SOURCES]).toEqual(
      expect.arrayContaining(['manual', 'imported', 'system', 'passport_mrz', 'passport_ocr', 'document_ocr']),
    );
  });
  it('isFieldSource accepts known, rejects unknown / non-strings', () => {
    expect(isFieldSource('manual')).toBe(true);
    expect(isFieldSource('passport_ocr')).toBe(true);
    expect(isFieldSource('nope')).toBe(false);
    expect(isFieldSource(42)).toBe(false);
    expect(isFieldSource(undefined)).toBe(false);
  });
  it('isOcrSource is true only for the OCR set', () => {
    expect(OCR_SOURCES.every(isOcrSource)).toBe(true);
    expect(isOcrSource('manual')).toBe(false);
  });
});

describe('isValidFieldPath', () => {
  it('accepts simple and list paths', () => {
    expect(isValidFieldPath('identity.surname')).toBe(true);
    expect(isValidFieldPath('passport.number')).toBe(true);
    expect(isValidFieldPath('travel.3f1c2b7a-9d4e-4a1b-8c2d-0e1f2a3b4c5d.arrival_date')).toBe(true);
  });
  it('rejects empty, spaces, uppercase, leading/trailing dots, over-long', () => {
    expect(isValidFieldPath('')).toBe(false);
    expect(isValidFieldPath('identity .surname')).toBe(false);
    expect(isValidFieldPath('Identity.Surname')).toBe(false);
    expect(isValidFieldPath('identity.')).toBe(false);
    expect(isValidFieldPath('.identity')).toBe(false);
    expect(isValidFieldPath('a.'.repeat(120))).toBe(false);
  });
});

describe('PROFILE_SECTIONS', () => {
  it('lists counting fields for each 1:1 section', () => {
    expect(PROFILE_SECTIONS.identity).toContain('surname');
    expect(PROFILE_SECTIONS.passport).toContain('number');
    expect(PROFILE_SECTIONS.contact).toContain('email');
    expect(PROFILE_SECTIONS.address).toContain('city');
    for (const k of ['identity', 'passport', 'contact', 'address'] as const) {
      expect(PROFILE_SECTIONS[k].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- applicantSchemas`
Expected: FAIL — cannot resolve `../../src/shared/applicant/fieldPaths.js`.

- [ ] **Step 3: Create `src/shared/applicant/types.ts`**

Paste the full type block from the Interfaces section above. Types only — no runtime code, no imports.

- [ ] **Step 4: Create `src/shared/applicant/fieldPaths.ts`**

```ts
import type { FieldSource } from './types.js';

export const FIELD_SOURCES = [
  'manual',
  'imported',
  'system',
  'passport_mrz',
  'passport_ocr',
  'document_ocr',
] as const satisfies readonly FieldSource[];

export const OCR_SOURCES = ['passport_mrz', 'passport_ocr', 'document_ocr'] as const;

export function isFieldSource(v: unknown): v is FieldSource {
  return typeof v === 'string' && (FIELD_SOURCES as readonly string[]).includes(v);
}

export function isOcrSource(v: string): boolean {
  return (OCR_SOURCES as readonly string[]).includes(v);
}

const SEGMENT = /^[a-z0-9_]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dot-separated; each segment is [a-z0-9_]+ or a UUID (list-item id). Max 200 chars. */
export function isValidFieldPath(p: string): boolean {
  if (p.length === 0 || p.length > 200) return false;
  const segs = p.split('.');
  return segs.every((seg) => SEGMENT.test(seg) || UUID.test(seg));
}

/**
 * Fields that count toward "complete" for each 1:1 section. camelCase — matches
 * the ApplicantDetail shape that computeCompleteness reads. Phase 3 may extend.
 */
export const PROFILE_SECTIONS = {
  identity: ['surname', 'givenNames', 'dateOfBirth', 'sex', 'placeOfBirth', 'nationality'],
  passport: ['documentType', 'number', 'issuingState', 'issueDate', 'expiryDate'],
  contact: ['email', 'phone'],
  address: ['line1', 'city', 'country'],
} as const satisfies Record<string, readonly string[]>;
```

- [ ] **Step 5: Run — verify it passes**

Run: `npm test -- applicantSchemas`
Expected: PASS (the `fieldPaths` describe blocks).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/applicant/types.ts src/shared/applicant/fieldPaths.ts test/shared/applicantSchemas.test.ts
git commit -m "feat: shared applicant types, field-source enum, field-path guard, profile-section spec

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 4: Shared Zod schemas

**Files:**
- Create: `src/shared/applicant/schemas.ts`
- Test: `test/shared/applicantSchemas.test.ts` (add the schema describe blocks)

**Interfaces:**
- Consumes: `zod`; `FIELD_SOURCES`, `isOcrSource`, `isValidFieldPath` (Task 3)
- Produces in `src/shared/applicant/schemas.ts`:
  ```ts
  identitySchema, passportSchema, contactSchema, addressSchema   // z.object; each key -> string|null
  travelSchema, referenceSchema                                   // ditto; referenceSchema.kind default 'other'
  fieldMetaInputSchema                                            // { fieldPath, source?, confidence?, rawValue?, verified? }
  applicantCreateSchema                                           // { displayName, identity?, passport?, contact?, address? }
  applicantPutSchema                                              // { displayName?, status?, identity?, passport?, contact?, address? }
  types: IdentityPatch, PassportPatch, ContactPatch, AddressPatch, TravelInput, ReferenceInput,
         FieldMetaInput, ApplicantCreate, ApplicantPut  (all z.infer)
  ```

- [ ] **Step 1: Add the failing test blocks to `test/shared/applicantSchemas.test.ts`**

```ts
import {
  identitySchema, passportSchema, contactSchema, addressSchema,
  travelSchema, referenceSchema, fieldMetaInputSchema,
  applicantCreateSchema, applicantPutSchema,
} from '../../src/shared/applicant/schemas.js';

describe('section schemas', () => {
  it('identity: accepts all-null / omitted', () => {
    expect(identitySchema.parse({}).surname).toBeNull();
    expect(identitySchema.parse({ surname: null }).surname).toBeNull();
  });
  it('identity: trims blank strings to null', () => {
    expect(identitySchema.parse({ surname: '  ' }).surname).toBeNull();
    expect(identitySchema.parse({ surname: '  Khan ' }).surname).toBe('Khan');
  });
  it('identity: rejects a bad sex and a bad date', () => {
    expect(identitySchema.safeParse({ sex: 'Q' }).success).toBe(false);
    expect(identitySchema.safeParse({ dateOfBirth: '01/02/2000' }).success).toBe(false);
    expect(identitySchema.safeParse({ dateOfBirth: '2000-02-01' }).success).toBe(true);
  });
  it('passport: valid dates ok, garbage rejected', () => {
    expect(passportSchema.safeParse({ issueDate: '2020-01-01', expiryDate: '2030-01-01' }).success).toBe(true);
    expect(passportSchema.safeParse({ expiryDate: 'soon' }).success).toBe(false);
  });
  it('contact: lenient email when present, null ok', () => {
    expect(contactSchema.safeParse({ email: null }).success).toBe(true);
    expect(contactSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(contactSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
  });
  it('address: all optional', () => {
    expect(addressSchema.parse({ city: 'Dhaka' }).city).toBe('Dhaka');
    expect(addressSchema.parse({}).line1).toBeNull();
  });
});

describe('travelSchema / referenceSchema', () => {
  it('travel: everything optional', () => {
    expect(travelSchema.parse({}).purpose).toBeNull();
    expect(travelSchema.parse({ arrivalDate: '2026-05-01' }).arrivalDate).toBe('2026-05-01');
    expect(travelSchema.safeParse({ arrivalDate: 'May' }).success).toBe(false);
  });
  it('reference: kind defaults to other, enum enforced', () => {
    expect(referenceSchema.parse({}).kind).toBe('other');
    expect(referenceSchema.parse({ kind: 'employer' }).kind).toBe('employer');
    expect(referenceSchema.safeParse({ kind: 'friend' }).success).toBe(false);
  });
});

describe('fieldMetaInputSchema', () => {
  it('defaults source to manual, accepts OCR sources', () => {
    expect(fieldMetaInputSchema.parse({ fieldPath: 'identity.surname' }).source).toBe('manual');
    expect(fieldMetaInputSchema.parse({ fieldPath: 'passport.number', source: 'passport_mrz', confidence: 0.98 }).confidence).toBe(0.98);
  });
  it('rejects unknown source, bad path, and confidence on a non-OCR source', () => {
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'identity.surname', source: 'guess' }).success).toBe(false);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'Bad Path' }).success).toBe(false);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'identity.surname', source: 'manual', confidence: 0.5 }).success).toBe(false);
  });
  it('confidence must be within [0,1] for OCR sources', () => {
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'x.y', source: 'passport_ocr', confidence: 1.5 }).success).toBe(false);
    expect(fieldMetaInputSchema.safeParse({ fieldPath: 'x.y', source: 'passport_ocr', confidence: null }).success).toBe(true);
  });
});

describe('applicantCreateSchema / applicantPutSchema', () => {
  it('create: displayName required and trimmed', () => {
    expect(applicantCreateSchema.safeParse({}).success).toBe(false);
    expect(applicantCreateSchema.safeParse({ displayName: '   ' }).success).toBe(false);
    expect(applicantCreateSchema.parse({ displayName: '  Aisha  ' }).displayName).toBe('Aisha');
  });
  it('create: optional nested sections validated', () => {
    expect(applicantCreateSchema.safeParse({ displayName: 'A', identity: { sex: 'bad' } }).success).toBe(false);
    expect(applicantCreateSchema.parse({ displayName: 'A', identity: { surname: 'A' } }).identity?.surname).toBe('A');
  });
  it('put: every key optional, status enum enforced', () => {
    expect(applicantPutSchema.parse({}).displayName).toBeUndefined();
    expect(applicantPutSchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(applicantPutSchema.safeParse({ status: 'archived' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- applicantSchemas`
Expected: FAIL — cannot resolve `../../src/shared/applicant/schemas.js`.

- [ ] **Step 3: Create `src/shared/applicant/schemas.ts`**

```ts
import { z } from 'zod';
import { FIELD_SOURCES, isOcrSource, isValidFieldPath } from './fieldPaths.js';

/** null | absent | '' -> null; otherwise trimmed string, max length enforced. */
const nstr = (max = 200) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      const s = (v ?? '').trim();
      return s.length > 0 ? s : null;
    })
    .pipe(z.string().max(max).nullable());

const isoDate = () =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      const s = (v ?? '').trim();
      return s.length > 0 ? s : null;
    })
    .pipe(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
        .refine((s) => !Number.isNaN(Date.parse(s)), 'not a real date')
        .nullable(),
    );

const emailField = () =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      const s = (v ?? '').trim();
      return s.length > 0 ? s : null;
    })
    .pipe(z.string().email('must be an email address').max(200).nullable());

const phoneField = () => nstr(40);

export const identitySchema = z.object({
  surname: nstr(120),
  givenNames: nstr(120),
  fullNameAsInPassport: nstr(240),
  dateOfBirth: isoDate(),
  sex: z
    .union([z.enum(['M', 'F', 'X']), z.null()])
    .optional()
    .transform((v) => v ?? null),
  placeOfBirth: nstr(120),
  nationality: nstr(80),
  otherNationalities: nstr(200),
});

export const passportSchema = z.object({
  documentType: nstr(40),
  number: nstr(40),
  issuingState: nstr(80),
  issueDate: isoDate(),
  expiryDate: isoDate(),
  placeOfIssue: nstr(120),
  issuingAuthority: nstr(120),
});

export const contactSchema = z.object({
  email: emailField(),
  phone: phoneField(),
  altPhone: phoneField(),
});

export const addressSchema = z.object({
  line1: nstr(160),
  line2: nstr(160),
  city: nstr(120),
  region: nstr(120),
  postalCode: nstr(40),
  country: nstr(80),
});

export const travelSchema = z.object({
  tripType: nstr(60),
  purpose: nstr(200),
  destinationCountry: nstr(80),
  cities: nstr(300),
  arrivalDate: isoDate(),
  departureDate: isoDate(),
  portOfEntry: nstr(120),
  portOfExit: nstr(120),
  accommodation: nstr(300),
  previousTravel: nstr(1000),
  notes: nstr(1000),
});

export const referenceSchema = z.object({
  kind: z
    .enum(['emergency_contact', 'employer', 'in_country_host', 'sponsor', 'other'])
    .default('other'),
  name: nstr(160),
  relationship: nstr(80),
  organization: nstr(160),
  phone: phoneField(),
  email: emailField(),
  address: nstr(300),
});

export const fieldMetaInputSchema = z
  .object({
    fieldPath: z.string().trim().refine(isValidFieldPath, 'invalid field path'),
    source: z
      .string()
      .refine((s) => (FIELD_SOURCES as readonly string[]).includes(s), 'unknown source')
      .default('manual'),
    confidence: z
      .union([z.number().min(0).max(1), z.null()])
      .optional()
      .transform((v) => v ?? null),
    rawValue: z
      .union([z.string().max(4000), z.null()])
      .optional()
      .transform((v) => v ?? null),
    verified: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.confidence !== null && !isOcrSource(v.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidence'],
        message: 'confidence is only allowed for OCR sources',
      });
    }
  });

export const applicantCreateSchema = z.object({
  displayName: z.string().trim().min(1, 'display name is required').max(120),
  identity: identitySchema.optional(),
  passport: passportSchema.optional(),
  contact: contactSchema.optional(),
  address: addressSchema.optional(),
});

export const applicantPutSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['draft', 'archived']).optional(),
  identity: identitySchema.optional(),
  passport: passportSchema.optional(),
  contact: contactSchema.optional(),
  address: addressSchema.optional(),
});

export type IdentityPatch = z.infer<typeof identitySchema>;
export type PassportPatch = z.infer<typeof passportSchema>;
export type ContactPatch = z.infer<typeof contactSchema>;
export type AddressPatch = z.infer<typeof addressSchema>;
export type TravelInput = z.infer<typeof travelSchema>;
export type ReferenceInput = z.infer<typeof referenceSchema>;
export type FieldMetaInput = z.infer<typeof fieldMetaInputSchema>;
export type ApplicantCreate = z.infer<typeof applicantCreateSchema>;
export type ApplicantPut = z.infer<typeof applicantPutSchema>;
```

> NOTE: `.transform(...).pipe(...)` is used so the empty-string→null collapse
> runs before the length/format validators. If the installed Zod version lacks
> `.pipe`, use a single `.superRefine` on a `z.string().nullish()` field that
> trims, null-collapses, then manually pushes issues for length/format.

- [ ] **Step 4: Run — verify it passes**

Run: `npm test -- applicantSchemas`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/applicant/schemas.ts test/shared/applicantSchemas.test.ts
git commit -m "feat: shared Zod schemas for applicant sections, travel, references, field meta

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 5: Completeness & verification pure functions

**Files:**
- Create: `src/server/services/applicantCompleteness.ts`
- Test: `test/server/applicantCompleteness.test.ts`

**Interfaces:**
- Consumes: `PROFILE_SECTIONS` (Task 3); `ApplicantDetail`, `Completeness`, `VerificationSummary`, `SectionKey` types (Task 3)
- Produces:
  ```ts
  computeCompleteness(d: Pick<ApplicantDetail,'identity'|'passport'|'contact'|'address'|'travel'|'references'>): Completeness
  computeVerification(d: Pick<ApplicantDetail,'identity'|'passport'|'contact'|'address'|'fieldMeta'>): VerificationSummary
  collectWarnings(d: Pick<ApplicantDetail,'passport'|'travel'>): string[]
  ```

- [ ] **Step 1: Write the failing test `test/server/applicantCompleteness.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  computeCompleteness,
  computeVerification,
  collectWarnings,
} from '../../src/server/services/applicantCompleteness.js';

const empty = {
  identity: { surname: null, givenNames: null, fullNameAsInPassport: null, dateOfBirth: null, sex: null, placeOfBirth: null, nationality: null, otherNationalities: null },
  passport: { documentType: null, number: null, issuingState: null, issueDate: null, expiryDate: null, placeOfIssue: null, issuingAuthority: null },
  contact: { email: null, phone: null, altPhone: null },
  address: { line1: null, line2: null, city: null, region: null, postalCode: null, country: null },
  travel: [] as any[],
  references: [] as any[],
  fieldMeta: [] as any[],
};

describe('computeCompleteness', () => {
  it('empty profile is 0 overall and 0 per section', () => {
    const c = computeCompleteness(empty);
    expect(c.overall).toBe(0);
    expect(c.bySection.identity).toBe(0);
    expect(c.bySection.travel).toBe(0);
    expect(c.bySection.references).toBe(0);
  });

  it('a fully filled profile is 1', () => {
    const full = {
      ...empty,
      identity: { ...empty.identity, surname: 'K', givenNames: 'A', dateOfBirth: '2000-01-01', sex: 'F', placeOfBirth: 'Dhaka', nationality: 'Bangladeshi' },
      passport: { ...empty.passport, documentType: 'P', number: 'A1', issuingState: 'BGD', issueDate: '2020-01-01', expiryDate: '2030-01-01' },
      contact: { ...empty.contact, email: 'a@b.co', phone: '123' },
      address: { ...empty.address, line1: '1 St', city: 'Dhaka', country: 'BGD' },
      travel: [{ purpose: 'Tourism', arrivalDate: '2026-05-01' }],
      references: [{ name: 'Bob' }],
    };
    const c = computeCompleteness(full as any);
    expect(c.bySection.identity).toBe(1);
    expect(c.bySection.passport).toBe(1);
    expect(c.bySection.travel).toBe(1);
    expect(c.bySection.references).toBe(1);
    expect(c.overall).toBe(1);
  });

  it('partial identity yields a fraction', () => {
    const c = computeCompleteness({ ...empty, identity: { ...empty.identity, surname: 'K', givenNames: 'A', nationality: 'X' } });
    expect(c.bySection.identity).toBeCloseTo(0.5, 5); // 3 of 6
  });

  it('travel section needs both purpose and arrivalDate', () => {
    expect(computeCompleteness({ ...empty, travel: [{ purpose: 'X' }] as any }).bySection.travel).toBe(0);
    expect(computeCompleteness({ ...empty, travel: [{ purpose: 'X', arrivalDate: '2026-01-01' }] as any }).bySection.travel).toBe(1);
  });
});

describe('computeVerification', () => {
  it('unverified when nothing has a value', () => {
    const v = computeVerification(empty);
    expect(v.label).toBe('unverified');
    expect(v.total).toBe(0);
  });

  it('total counts only non-null canonical fields; verified counts verified meta', () => {
    const d = {
      ...empty,
      identity: { ...empty.identity, surname: 'K', givenNames: 'A' },
      passport: { ...empty.passport, number: 'A1' },
      fieldMeta: [
        { fieldPath: 'identity.surname', verified: true },
        { fieldPath: 'identity.givenNames', verified: false },
      ] as any[],
    };
    const v = computeVerification(d);
    expect(v.total).toBe(3);
    expect(v.verified).toBe(1);
    expect(v.label).toBe('partial');
    expect(v.bySection.identity).toEqual({ verified: 1, total: 2 });
    expect(v.bySection.passport).toEqual({ verified: 0, total: 1 });
  });

  it('verified when every non-null field has a verified meta row', () => {
    const d = {
      ...empty,
      identity: { ...empty.identity, surname: 'K' },
      fieldMeta: [{ fieldPath: 'identity.surname', verified: true }] as any[],
    };
    expect(computeVerification(d).label).toBe('verified');
  });
});

describe('collectWarnings', () => {
  it('flags passport expiry <= issue when both present', () => {
    expect(collectWarnings({ passport: { issueDate: '2020-01-01', expiryDate: '2019-01-01' } as any, travel: [] })).toEqual(
      expect.arrayContaining([expect.stringMatching(/expiry/i)]),
    );
  });
  it('flags a travel record where departure < arrival', () => {
    const w = collectWarnings({ passport: {} as any, travel: [{ arrivalDate: '2026-05-10', departureDate: '2026-05-01' }] as any });
    expect(w.some((s) => /departure/i.test(s))).toBe(true);
  });
  it('no warnings when data is consistent or absent', () => {
    expect(collectWarnings({ passport: {} as any, travel: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- applicantCompleteness`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/services/applicantCompleteness.ts`**

```ts
import { PROFILE_SECTIONS } from '../../shared/applicant/fieldPaths.js';
import type {
  ApplicantDetail,
  Completeness,
  SectionKey,
  VerificationSummary,
} from '../../shared/applicant/types.js';

type CompletenessInput = Pick<
  ApplicantDetail,
  'identity' | 'passport' | 'contact' | 'address' | 'travel' | 'references'
>;
type VerificationInput = Pick<
  ApplicantDetail,
  'identity' | 'passport' | 'contact' | 'address' | 'fieldMeta'
>;

const ONE_TO_ONE = ['identity', 'passport', 'contact', 'address'] as const;

function isSet(value: unknown): boolean {
  return value != null && value !== '';
}

function sectionRatio(section: Record<string, unknown>, fields: readonly string[]): number {
  if (fields.length === 0) return 0;
  const filled = fields.filter((f) => isSet(section[f])).length;
  return filled / fields.length;
}

export function computeCompleteness(d: CompletenessInput): Completeness {
  const bySection = {} as Record<SectionKey, number>;
  for (const key of ONE_TO_ONE) {
    bySection[key] = sectionRatio(
      d[key] as unknown as Record<string, unknown>,
      PROFILE_SECTIONS[key],
    );
  }
  bySection.travel = d.travel.some((t) => isSet(t.purpose) && isSet(t.arrivalDate)) ? 1 : 0;
  bySection.references = d.references.some((r) => isSet(r.name)) ? 1 : 0;

  const all = Object.values(bySection);
  const overall = all.reduce((a, b) => a + b, 0) / all.length;
  return { overall, bySection };
}

export function computeVerification(d: VerificationInput): VerificationSummary {
  const verifiedPaths = new Set(d.fieldMeta.filter((m) => m.verified).map((m) => m.fieldPath));
  const bySection = {} as Record<SectionKey, { verified: number; total: number }>;
  let verified = 0;
  let total = 0;

  for (const key of ONE_TO_ONE) {
    const section = d[key] as unknown as Record<string, unknown>;
    let sv = 0;
    let st = 0;
    for (const [field, value] of Object.entries(section)) {
      if (!isSet(value)) continue;
      st += 1;
      if (verifiedPaths.has(`${key}.${field}`)) sv += 1;
    }
    bySection[key] = { verified: sv, total: st };
    verified += sv;
    total += st;
  }
  bySection.travel = { verified: 0, total: 0 };
  bySection.references = { verified: 0, total: 0 };

  const ratio = total === 0 ? 0 : verified / total;
  const label: VerificationSummary['label'] =
    total > 0 && ratio === 1 ? 'verified' : verified === 0 ? 'unverified' : 'partial';
  return { verified, total, ratio, label, bySection };
}

export function collectWarnings(d: Pick<ApplicantDetail, 'passport' | 'travel'>): string[] {
  const w: string[] = [];
  const { issueDate, expiryDate } = d.passport;
  if (issueDate && expiryDate && Date.parse(expiryDate) <= Date.parse(issueDate)) {
    w.push('Passport expiry date is not after the issue date.');
  }
  for (const t of d.travel) {
    if (
      t.arrivalDate &&
      t.departureDate &&
      Date.parse(t.departureDate) < Date.parse(t.arrivalDate)
    ) {
      w.push('Travel record: departure date is before the arrival date.');
    }
  }
  return w;
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npm test -- applicantCompleteness`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/applicantCompleteness.ts test/server/applicantCompleteness.test.ts
git commit -m "feat: pure completeness / verification / warnings computation for applicant detail

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 6: applicantService — section column metadata + applicant CRUD

**Files:**
- Create: `src/server/services/applicantColumns.ts`
- Create: `src/server/services/applicantService.ts`
- Test: `test/server/applicantService.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `runMigrations`; `IdentityPatch`/`PassportPatch`/`ContactPatch`/`AddressPatch`/`ApplicantCreate`/`ApplicantPut` (Task 4); `Applicant`/`ApplicantDetail`/`ApplicantSummary`/`Identity`/`Passport`/`Contact`/`Address` types (Task 3); `computeCompleteness`/`computeVerification`/`collectWarnings` (Task 5); `randomUUID` from `node:crypto`
- Produces in `src/server/services/applicantColumns.ts`:
  ```ts
  SECTION_TABLES: Record<'identity'|'passport'|'contact'|'address', { table: string; cols: Record<string,string> }>
  readSection<T>(db, table, cols, applicantId): T                 // camelKey -> value, nulls for missing row
  writeSection(db, table, cols, applicantId, patch): void         // SET only provided keys
  emptySection(cols): Record<string, null>
  ```
- Produces in `src/server/services/applicantService.ts`:
  ```ts
  createApplicant(db, input: ApplicantCreate): ApplicantDetail
  listApplicants(db, q?: string): ApplicantSummary[]              // newest updated first
  getApplicantDetail(db, id): ApplicantDetail | null
  updateApplicant(db, id, patch: ApplicantPut): ApplicantDetail | null
  deleteApplicant(db, id): boolean
  ```
  (Task 7 adds travel/reference fns to this file; Task 8 adds field-meta + search refinement; Task 9 adds duplicate.)

- [ ] **Step 1: Write the failing test `test/server/applicantService.test.ts`**

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import * as svc from '../../src/server/services/applicantService.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let db: DatabaseSync;
let dbPath: string;

beforeEach(() => {
  dbPath = makeTempDbPath();
  db = openDatabase(dbPath);
  runMigrations(db);
});
afterEach(() => {
  db.close();
  cleanupTempDb(dbPath);
});

it('creates an applicant with four empty satellite sections', () => {
  const a = svc.createApplicant(db, { displayName: 'Aisha' });
  expect(a.id).toMatch(/[0-9a-f-]{36}/);
  expect(a.displayName).toBe('Aisha');
  expect(a.status).toBe('draft');
  expect(a.identity.surname).toBeNull();
  expect(a.passport.number).toBeNull();
  expect(a.contact.email).toBeNull();
  expect(a.address.city).toBeNull();
  expect(a.travel).toEqual([]);
  expect(a.references).toEqual([]);
  expect(a.fieldMeta).toEqual([]);
  expect(a.completeness.overall).toBe(0);
  expect(a.verification.label).toBe('unverified');
});

it('accepts nested sections at create time', () => {
  const a = svc.createApplicant(db, {
    displayName: 'B',
    identity: { surname: 'Khan', givenNames: 'Aisha' } as any,
    passport: { number: 'A123' } as any,
  });
  expect(a.identity.surname).toBe('Khan');
  expect(a.passport.number).toBe('A123');
});

it('reads a detail back with computed completeness / verification / warnings', () => {
  const a = svc.createApplicant(db, { displayName: 'C' });
  const got = svc.getApplicantDetail(db, a.id);
  expect(got?.displayName).toBe('C');
  expect(got?.completeness.bySection.identity).toBe(0);
  expect(Array.isArray(got?.warnings)).toBe(true);
  expect(svc.getApplicantDetail(db, 'missing')).toBeNull();
});

it('updates a section patch (only provided keys) and bumps updated_at', async () => {
  const a = svc.createApplicant(db, { displayName: 'D' });
  await new Promise((r) => setTimeout(r, 5));
  const up = svc.updateApplicant(db, a.id, {
    identity: { surname: 'Rahman' } as any,
  });
  expect(up?.identity.surname).toBe('Rahman');
  expect(up?.identity.givenNames).toBeNull();
  expect(up?.updatedAt).not.toBe(a.updatedAt);

  const up2 = svc.updateApplicant(db, a.id, { identity: { givenNames: 'Nadia' } as any });
  expect(up2?.identity.surname).toBe('Rahman'); // previous value untouched
  expect(up2?.identity.givenNames).toBe('Nadia');
});

it('updates display name and status', () => {
  const a = svc.createApplicant(db, { displayName: 'E' });
  const up = svc.updateApplicant(db, a.id, { displayName: 'E2', status: 'archived' });
  expect(up?.displayName).toBe('E2');
  expect(up?.status).toBe('archived');
});

it('returns null updating a missing applicant', () => {
  expect(svc.updateApplicant(db, 'nope', { displayName: 'x' })).toBeNull();
});

it('lists newest-updated first and deletes', async () => {
  const a = svc.createApplicant(db, { displayName: 'first' });
  await new Promise((r) => setTimeout(r, 5));
  const b = svc.createApplicant(db, { displayName: 'second' });
  expect(svc.listApplicants(db).map((x) => x.displayName)).toEqual(['second', 'first']);

  expect(svc.deleteApplicant(db, a.id)).toBe(true);
  expect(svc.deleteApplicant(db, a.id)).toBe(false);
  expect(svc.listApplicants(db).map((x) => x.displayName)).toEqual(['second']);
  void b;
});

it('summary omits sensitive fields but exposes last-4 of passport number', () => {
  const a = svc.createApplicant(db, {
    displayName: 'F',
    identity: { nationality: 'Bangladeshi' } as any,
    passport: { number: 'AB1234567' } as any,
  });
  const [row] = svc.listApplicants(db);
  expect(row.id).toBe(a.id);
  expect(row.nationality).toBe('Bangladeshi');
  expect(row.passportNumberLast4).toBe('4567');
  expect(row as Record<string, unknown>).not.toHaveProperty('dateOfBirth');
  expect(JSON.stringify(row)).not.toContain('AB1234567');
});

it('persists across a reopen of the same db file', () => {
  const a = svc.createApplicant(db, { displayName: 'G', identity: { surname: 'Z' } as any });
  db.close();
  const db2 = openDatabase(dbPath);
  runMigrations(db2);
  expect(svc.getApplicantDetail(db2, a.id)?.identity.surname).toBe('Z');
  db2.close();
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- applicantService`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/services/applicantColumns.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';

/** camelCase key -> snake_case column, per 1:1 section table. */
export const SECTION_TABLES = {
  identity: {
    table: 'applicant_identity',
    cols: {
      surname: 'surname',
      givenNames: 'given_names',
      fullNameAsInPassport: 'full_name_as_in_passport',
      dateOfBirth: 'date_of_birth',
      sex: 'sex',
      placeOfBirth: 'place_of_birth',
      nationality: 'nationality',
      otherNationalities: 'other_nationalities',
    },
  },
  passport: {
    table: 'applicant_passport',
    cols: {
      documentType: 'document_type',
      number: 'number',
      issuingState: 'issuing_state',
      issueDate: 'issue_date',
      expiryDate: 'expiry_date',
      placeOfIssue: 'place_of_issue',
      issuingAuthority: 'issuing_authority',
    },
  },
  contact: {
    table: 'applicant_contact',
    cols: { email: 'email', phone: 'phone', altPhone: 'alt_phone' },
  },
  address: {
    table: 'applicant_address',
    cols: {
      line1: 'line1',
      line2: 'line2',
      city: 'city',
      region: 'region',
      postalCode: 'postal_code',
      country: 'country',
    },
  },
} as const;

export type SectionName = keyof typeof SECTION_TABLES;

export function emptySection(cols: Record<string, string>): Record<string, null> {
  return Object.fromEntries(Object.keys(cols).map((k) => [k, null]));
}

export function readSection<T>(
  db: DatabaseSync,
  table: string,
  cols: Record<string, string>,
  applicantId: string,
): T {
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE applicant_id = ?`)
    .get(applicantId) as Record<string, unknown> | undefined;
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(cols)) {
    out[key] = row ? (row[col] ?? null) : null;
  }
  return out as T;
}

/** UPDATE only the keys present in `patch`. Table names/columns come from the
 *  in-code SECTION_TABLES map (never user input) so interpolation is safe. */
export function writeSection(
  db: DatabaseSync,
  table: string,
  cols: Record<string, string>,
  applicantId: string,
  patch: Record<string, unknown>,
): void {
  const entries = Object.entries(patch).filter(([key]) => key in cols);
  if (entries.length === 0) return;
  const setSql = entries.map(([key]) => `${cols[key]} = ?`).join(', ');
  const values = entries.map(([, v]) => (v === undefined ? null : v));
  db.prepare(`UPDATE ${table} SET ${setSql} WHERE applicant_id = ?`).run(
    ...values,
    applicantId,
  );
}
```

- [ ] **Step 4: Create `src/server/services/applicantService.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Address,
  Applicant,
  ApplicantDetail,
  ApplicantStatus,
  ApplicantSummary,
  Contact,
  FieldMeta,
  Identity,
  Passport,
  Reference,
  TravelRecord,
} from '../../shared/applicant/types.js';
import type { ApplicantCreate, ApplicantPut } from '../../shared/applicant/schemas.js';
import {
  SECTION_TABLES,
  emptySection,
  readSection,
  writeSection,
} from './applicantColumns.js';
import {
  collectWarnings,
  computeCompleteness,
  computeVerification,
} from './applicantCompleteness.js';

interface ApplicantRow {
  id: string;
  display_name: string;
  status: ApplicantStatus;
  created_at: string;
  updated_at: string;
}

function rowToApplicant(r: ApplicantRow): Applicant {
  return {
    id: r.id,
    displayName: r.display_name,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function touch(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE applicants SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}

function getApplicantRow(db: DatabaseSync, id: string): ApplicantRow | undefined {
  return db.prepare('SELECT * FROM applicants WHERE id = ?').get(id) as
    | ApplicantRow
    | undefined;
}

function listTravel(db: DatabaseSync, applicantId: string): TravelRecord[] {
  return (
    db
      .prepare(
        'SELECT * FROM applicant_travel WHERE applicant_id = ? ORDER BY sort_order, created_at',
      )
      .all(applicantId) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    applicantId: r.applicant_id as string,
    sortOrder: r.sort_order as number,
    tripType: (r.trip_type as string) ?? null,
    purpose: (r.purpose as string) ?? null,
    destinationCountry: (r.destination_country as string) ?? null,
    cities: (r.cities as string) ?? null,
    arrivalDate: (r.arrival_date as string) ?? null,
    departureDate: (r.departure_date as string) ?? null,
    portOfEntry: (r.port_of_entry as string) ?? null,
    portOfExit: (r.port_of_exit as string) ?? null,
    accommodation: (r.accommodation as string) ?? null,
    previousTravel: (r.previous_travel as string) ?? null,
    notes: (r.notes as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

function listReferences(db: DatabaseSync, applicantId: string): Reference[] {
  return (
    db
      .prepare(
        'SELECT * FROM applicant_reference WHERE applicant_id = ? ORDER BY sort_order, created_at',
      )
      .all(applicantId) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    applicantId: r.applicant_id as string,
    sortOrder: r.sort_order as number,
    kind: r.kind as Reference['kind'],
    name: (r.name as string) ?? null,
    relationship: (r.relationship as string) ?? null,
    organization: (r.organization as string) ?? null,
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    address: (r.address as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

function listFieldMeta(db: DatabaseSync, applicantId: string): FieldMeta[] {
  return (
    db
      .prepare(
        'SELECT * FROM applicant_field_meta WHERE applicant_id = ? ORDER BY field_path',
      )
      .all(applicantId) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    applicantId: r.applicant_id as string,
    fieldPath: r.field_path as string,
    source: r.source as FieldMeta['source'],
    confidence: (r.confidence as number) ?? null,
    rawValue: (r.raw_value as string) ?? null,
    verified: r.verified === 1,
    verifiedAt: (r.verified_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

function assembleDetail(db: DatabaseSync, row: ApplicantRow): ApplicantDetail {
  const identity = readSection<Identity>(
    db,
    SECTION_TABLES.identity.table,
    SECTION_TABLES.identity.cols,
    row.id,
  );
  const passport = readSection<Passport>(
    db,
    SECTION_TABLES.passport.table,
    SECTION_TABLES.passport.cols,
    row.id,
  );
  const contact = readSection<Contact>(
    db,
    SECTION_TABLES.contact.table,
    SECTION_TABLES.contact.cols,
    row.id,
  );
  const address = readSection<Address>(
    db,
    SECTION_TABLES.address.table,
    SECTION_TABLES.address.cols,
    row.id,
  );
  const travel = listTravel(db, row.id);
  const references = listReferences(db, row.id);
  const fieldMeta = listFieldMeta(db, row.id);

  const completeness = computeCompleteness({ identity, passport, contact, address, travel, references });
  const verification = computeVerification({ identity, passport, contact, address, fieldMeta });
  const warnings = collectWarnings({ passport, travel });

  return {
    ...rowToApplicant(row),
    identity,
    passport,
    contact,
    address,
    travel,
    references,
    fieldMeta,
    completeness,
    verification,
    warnings,
  };
}

export function createApplicant(db: DatabaseSync, input: ApplicantCreate): ApplicantDetail {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO applicants (id, display_name, status, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?)`,
    ).run(id, input.displayName, now, now);
    db.prepare('INSERT INTO applicant_identity (applicant_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO applicant_passport (applicant_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO applicant_contact (applicant_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO applicant_address (applicant_id) VALUES (?)').run(id);
    for (const key of ['identity', 'passport', 'contact', 'address'] as const) {
      const patch = input[key];
      if (patch) {
        writeSection(
          db,
          SECTION_TABLES[key].table,
          SECTION_TABLES[key].cols,
          id,
          patch as Record<string, unknown>,
        );
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getApplicantDetail(db, id)!;
}

export function getApplicantDetail(db: DatabaseSync, id: string): ApplicantDetail | null {
  const row = getApplicantRow(db, id);
  return row ? assembleDetail(db, row) : null;
}

export function updateApplicant(
  db: DatabaseSync,
  id: string,
  patch: ApplicantPut,
): ApplicantDetail | null {
  if (!getApplicantRow(db, id)) return null;
  db.exec('BEGIN');
  try {
    if (patch.displayName !== undefined || patch.status !== undefined) {
      const current = getApplicantRow(db, id)!;
      db.prepare('UPDATE applicants SET display_name = ?, status = ? WHERE id = ?').run(
        patch.displayName ?? current.display_name,
        patch.status ?? current.status,
        id,
      );
    }
    for (const key of ['identity', 'passport', 'contact', 'address'] as const) {
      const sectionPatch = patch[key];
      if (sectionPatch) {
        writeSection(
          db,
          SECTION_TABLES[key].table,
          SECTION_TABLES[key].cols,
          id,
          sectionPatch as Record<string, unknown>,
        );
      }
    }
    touch(db, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getApplicantDetail(db, id);
}

export function deleteApplicant(db: DatabaseSync, id: string): boolean {
  const { changes } = db.prepare('DELETE FROM applicants WHERE id = ?').run(id);
  return Number(changes) > 0;
}

export function listApplicants(db: DatabaseSync, q?: string): ApplicantSummary[] {
  const term = (q ?? '').trim();
  const like = `%${term}%`;
  const sql = `
    SELECT a.id, a.display_name, a.status, a.created_at, a.updated_at,
           i.nationality AS nationality,
           p.number AS passport_number
    FROM applicants a
    LEFT JOIN applicant_identity i ON i.applicant_id = a.id
    LEFT JOIN applicant_passport p ON p.applicant_id = a.id
    ${term.length > 0
      ? `WHERE a.display_name LIKE ? COLLATE NOCASE
           OR i.surname LIKE ? COLLATE NOCASE
           OR i.given_names LIKE ? COLLATE NOCASE
           OR i.nationality LIKE ? COLLATE NOCASE
           OR p.number LIKE ? COLLATE NOCASE
           OR EXISTS (SELECT 1 FROM applicant_contact c
                      WHERE c.applicant_id = a.id AND c.email LIKE ? COLLATE NOCASE)`
      : ''}
    ORDER BY a.updated_at DESC, a.id DESC`;
  const args = term.length > 0 ? [like, like, like, like, like, like] : [];
  const rows = db.prepare(sql).all(...args) as Record<string, unknown>[];

  return rows.map((r) => {
    const id = r.id as string;
    const detail = getApplicantDetail(db, id)!;
    const num = (r.passport_number as string) ?? null;
    return {
      id,
      displayName: r.display_name as string,
      status: r.status as ApplicantStatus,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      nationality: (r.nationality as string) ?? null,
      passportNumberLast4: num && num.length >= 4 ? num.slice(-4) : null,
      completeness: { overall: detail.completeness.overall },
      verification: { label: detail.verification.label },
    };
  });
}
```

> NOTE: `listApplicants` calls `getApplicantDetail` per row to reuse the
> completeness/verification computation. Fine for a local single-user tool with a
> handful of applicants. If it ever matters, add a lighter aggregate query — not
> in Phase 2.

- [ ] **Step 5: Run — verify it passes**

Run: `npm test -- applicantService`
Expected: PASS (all `it` blocks in this task).

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/applicantColumns.ts src/server/services/applicantService.ts test/server/applicantService.test.ts
git commit -m "feat: applicant service — CRUD, section patches, summary list, search

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 7: applicantService — travel & reference records

**Files:**
- Modify: `src/server/services/applicantService.ts`
- Test: `test/server/applicantService.test.ts` (add a `describe('travel & references')` block)

**Interfaces:**
- Consumes: `TravelInput`, `ReferenceInput` (Task 4); the private `getApplicantRow` / `touch` / `listTravel` / `listReferences` helpers already in `applicantService.ts` (Task 6)
- Produces in `src/server/services/applicantService.ts`:
  ```ts
  addTravel(db, applicantId, input: TravelInput): TravelRecord | null      // null if applicant missing
  updateTravel(db, applicantId, travelId, input: TravelInput): TravelRecord | null
  deleteTravel(db, applicantId, travelId): boolean
  addReference(db, applicantId, input: ReferenceInput): Reference | null
  updateReference(db, applicantId, refId, input: ReferenceInput): Reference | null
  deleteReference(db, applicantId, refId): boolean
  ```

- [ ] **Step 1: Add the failing test block to `test/server/applicantService.test.ts`**

```ts
describe('travel & references', () => {
  it('adds, orders, edits and deletes travel records', () => {
    const a = svc.createApplicant(db, { displayName: 'T' });
    const t1 = svc.addTravel(db, a.id, { purpose: 'Tourism', arrivalDate: '2026-05-01' } as any)!;
    const t2 = svc.addTravel(db, a.id, { purpose: 'Business' } as any)!;
    expect(t1.sortOrder).toBe(0);
    expect(t2.sortOrder).toBe(1);

    const list = svc.getApplicantDetail(db, a.id)!.travel;
    expect(list.map((t) => t.purpose)).toEqual(['Tourism', 'Business']);

    const edited = svc.updateTravel(db, a.id, t1.id, { purpose: 'Family visit', arrivalDate: '2026-05-01' } as any)!;
    expect(edited.purpose).toBe('Family visit');

    expect(svc.deleteTravel(db, a.id, t1.id)).toBe(true);
    expect(svc.deleteTravel(db, a.id, t1.id)).toBe(false);
    expect(svc.getApplicantDetail(db, a.id)!.travel.map((t) => t.purpose)).toEqual(['Business']);
  });

  it('travel ops on a missing applicant / wrong applicant return null / false', () => {
    const a = svc.createApplicant(db, { displayName: 'T2' });
    const b = svc.createApplicant(db, { displayName: 'T3' });
    const t = svc.addTravel(db, a.id, { purpose: 'X' } as any)!;
    expect(svc.addTravel(db, 'missing', {} as any)).toBeNull();
    expect(svc.updateTravel(db, b.id, t.id, {} as any)).toBeNull(); // t belongs to a, not b
    expect(svc.deleteTravel(db, b.id, t.id)).toBe(false);
  });

  it('adds, edits and deletes references with a kind', () => {
    const a = svc.createApplicant(db, { displayName: 'R' });
    const r = svc.addReference(db, a.id, { kind: 'employer', name: 'ACME', organization: 'ACME Ltd' } as any)!;
    expect(r.kind).toBe('employer');
    const list = svc.getApplicantDetail(db, a.id)!.references;
    expect(list).toHaveLength(1);
    const edited = svc.updateReference(db, a.id, r.id, { kind: 'sponsor', name: 'ACME' } as any)!;
    expect(edited.kind).toBe('sponsor');
    expect(svc.deleteReference(db, a.id, r.id)).toBe(true);
    expect(svc.getApplicantDetail(db, a.id)!.references).toEqual([]);
  });

  it('deleting the applicant removes its travel and references (cascade)', () => {
    const a = svc.createApplicant(db, { displayName: 'C' });
    svc.addTravel(db, a.id, { purpose: 'X' } as any);
    svc.addReference(db, a.id, { name: 'Y' } as any);
    svc.deleteApplicant(db, a.id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM applicant_travel').get() as { n: number };
    const m = db.prepare('SELECT COUNT(*) AS n FROM applicant_reference').get() as { n: number };
    expect(n.n).toBe(0);
    expect(m.n).toBe(0);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- applicantService`
Expected: FAIL — `svc.addTravel` is not a function.

- [ ] **Step 3: Add the travel/reference functions to `src/server/services/applicantService.ts`**

Add these column maps near the top (after the imports):

```ts
const TRAVEL_COLS: Record<string, string> = {
  tripType: 'trip_type',
  purpose: 'purpose',
  destinationCountry: 'destination_country',
  cities: 'cities',
  arrivalDate: 'arrival_date',
  departureDate: 'departure_date',
  portOfEntry: 'port_of_entry',
  portOfExit: 'port_of_exit',
  accommodation: 'accommodation',
  previousTravel: 'previous_travel',
  notes: 'notes',
};

const REFERENCE_COLS: Record<string, string> = {
  kind: 'kind',
  name: 'name',
  relationship: 'relationship',
  organization: 'organization',
  phone: 'phone',
  email: 'email',
  address: 'address',
};
```

Add a generic child-row helper and the six exported functions:

```ts
function nextSortOrder(db: DatabaseSync, table: string, applicantId: string): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM ${table} WHERE applicant_id = ?`)
    .get(applicantId) as { m: number };
  return row.m + 1;
}

function insertChild(
  db: DatabaseSync,
  table: string,
  cols: Record<string, string>,
  applicantId: string,
  input: Record<string, unknown>,
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const sortOrder = nextSortOrder(db, table, applicantId);
  const provided = Object.entries(input).filter(([k]) => k in cols);
  const columns = ['id', 'applicant_id', 'sort_order', 'created_at', 'updated_at', ...provided.map(([k]) => cols[k])];
  const placeholders = columns.map(() => '?').join(', ');
  const values = [id, applicantId, sortOrder, now, now, ...provided.map(([, v]) => v ?? null)];
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
  return id;
}

function updateChild(
  db: DatabaseSync,
  table: string,
  cols: Record<string, string>,
  applicantId: string,
  childId: string,
  input: Record<string, unknown>,
): boolean {
  const owned = db
    .prepare(`SELECT 1 FROM ${table} WHERE id = ? AND applicant_id = ?`)
    .get(childId, applicantId);
  if (!owned) return false;
  const provided = Object.entries(input).filter(([k]) => k in cols);
  const now = new Date().toISOString();
  const setSql = [...provided.map(([k]) => `${cols[k]} = ?`), 'updated_at = ?'].join(', ');
  const values = [...provided.map(([, v]) => v ?? null), now, childId];
  db.prepare(`UPDATE ${table} SET ${setSql} WHERE id = ?`).run(...values);
  return true;
}

function deleteChild(
  db: DatabaseSync,
  table: string,
  applicantId: string,
  childId: string,
): boolean {
  const { changes } = db
    .prepare(`DELETE FROM ${table} WHERE id = ? AND applicant_id = ?`)
    .run(childId, applicantId);
  return Number(changes) > 0;
}

export function addTravel(db: DatabaseSync, applicantId: string, input: TravelInput): TravelRecord | null {
  if (!getApplicantRow(db, applicantId)) return null;
  const id = insertChild(db, 'applicant_travel', TRAVEL_COLS, applicantId, input as Record<string, unknown>);
  touch(db, applicantId);
  return listTravel(db, applicantId).find((t) => t.id === id) ?? null;
}

export function updateTravel(
  db: DatabaseSync,
  applicantId: string,
  travelId: string,
  input: TravelInput,
): TravelRecord | null {
  if (!updateChild(db, 'applicant_travel', TRAVEL_COLS, applicantId, travelId, input as Record<string, unknown>)) {
    return null;
  }
  touch(db, applicantId);
  return listTravel(db, applicantId).find((t) => t.id === travelId) ?? null;
}

export function deleteTravel(db: DatabaseSync, applicantId: string, travelId: string): boolean {
  const ok = deleteChild(db, 'applicant_travel', applicantId, travelId);
  if (ok) touch(db, applicantId);
  return ok;
}

export function addReference(db: DatabaseSync, applicantId: string, input: ReferenceInput): Reference | null {
  if (!getApplicantRow(db, applicantId)) return null;
  const id = insertChild(db, 'applicant_reference', REFERENCE_COLS, applicantId, input as Record<string, unknown>);
  touch(db, applicantId);
  return listReferences(db, applicantId).find((r) => r.id === id) ?? null;
}

export function updateReference(
  db: DatabaseSync,
  applicantId: string,
  refId: string,
  input: ReferenceInput,
): Reference | null {
  if (!updateChild(db, 'applicant_reference', REFERENCE_COLS, applicantId, refId, input as Record<string, unknown>)) {
    return null;
  }
  touch(db, applicantId);
  return listReferences(db, applicantId).find((r) => r.id === refId) ?? null;
}

export function deleteReference(db: DatabaseSync, applicantId: string, refId: string): boolean {
  const ok = deleteChild(db, 'applicant_reference', applicantId, refId);
  if (ok) touch(db, applicantId);
  return ok;
}
```

Add `TravelInput`, `ReferenceInput` to the `import type { ... } from '../../shared/applicant/schemas.js'` line.

- [ ] **Step 4: Run — verify it passes**

Run: `npm test -- applicantService`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/applicantService.ts test/server/applicantService.test.ts
git commit -m "feat: applicant service — travel & reference record CRUD with sort order

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 8: applicantService — field-meta upsert + meta reconciliation on section change

**Files:**
- Modify: `src/server/services/applicantService.ts`
- Test: `test/server/applicantService.test.ts` (add `describe('field meta')`)

**Interfaces:**
- Consumes: `FieldMetaInput` (Task 4); `isOcrSource` (Task 3); `writeSection` already imported
- Produces in `src/server/services/applicantService.ts`:
  ```ts
  upsertFieldMeta(db, applicantId, input: FieldMetaInput): FieldMeta | null
  ```
  and modifies the existing `updateApplicant` so that when a section patch changes a
  field's value, its meta row is reconciled: a changed non-null value downgrades an
  existing meta row to `source='manual'`, `confidence=null`, `verified=0`,
  `verified_at=null`; clearing a value to null deletes its meta row.

- [ ] **Step 1: Add the failing test block to `test/server/applicantService.test.ts`**

```ts
describe('field meta', () => {
  it('upserts one row per (applicant, field_path); default source manual, confidence null', () => {
    const a = svc.createApplicant(db, { displayName: 'M', identity: { surname: 'K' } as any });
    const m1 = svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true } as any)!;
    expect(m1.source).toBe('manual');
    expect(m1.confidence).toBeNull();
    expect(m1.verified).toBe(true);
    expect(m1.verifiedAt).not.toBeNull();

    const m2 = svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: false } as any)!;
    expect(m2.id).toBe(m1.id); // same row
    expect(m2.verified).toBe(false);
    expect(m2.verifiedAt).toBeNull();

    const all = svc.getApplicantDetail(db, a.id)!.fieldMeta.filter((m) => m.fieldPath === 'identity.surname');
    expect(all).toHaveLength(1);
  });

  it('accepts Phase 3 OCR source values with a numeric confidence and raw value', () => {
    const a = svc.createApplicant(db, { displayName: 'O', passport: { number: 'A1' } as any });
    const m = svc.upsertFieldMeta(db, a.id, {
      fieldPath: 'passport.number',
      source: 'passport_mrz',
      confidence: 0.97,
      rawValue: 'A1<<<<',
    } as any)!;
    expect(m.source).toBe('passport_mrz');
    expect(m.confidence).toBeCloseTo(0.97, 5);
    expect(m.rawValue).toBe('A1<<<<');
    expect(m.verified).toBe(false); // OCR is never auto-verified
  });

  it('returns null for a missing applicant', () => {
    expect(svc.upsertFieldMeta(db, 'missing', { fieldPath: 'identity.surname' } as any)).toBeNull();
  });

  it('multiple field paths coexist for one applicant', () => {
    const a = svc.createApplicant(db, { displayName: 'M2' });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname' } as any);
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'passport.number' } as any);
    expect(svc.getApplicantDetail(db, a.id)!.fieldMeta.map((m) => m.fieldPath).sort()).toEqual([
      'identity.surname',
      'passport.number',
    ]);
  });

  it('editing a verified value via updateApplicant un-verifies it and marks source manual', () => {
    const a = svc.createApplicant(db, { displayName: 'RC', passport: { number: 'OLD' } as any });
    svc.upsertFieldMeta(db, a.id, {
      fieldPath: 'passport.number',
      source: 'passport_mrz',
      confidence: 0.9,
    } as any);
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'passport.number', verified: true } as any);

    svc.updateApplicant(db, a.id, { passport: { number: 'NEW' } as any });

    const meta = svc.getApplicantDetail(db, a.id)!.fieldMeta.find((m) => m.fieldPath === 'passport.number')!;
    expect(meta.source).toBe('manual');
    expect(meta.confidence).toBeNull();
    expect(meta.verified).toBe(false);
    expect(meta.verifiedAt).toBeNull();
  });

  it('clearing a value to null via updateApplicant deletes its meta row', () => {
    const a = svc.createApplicant(db, { displayName: 'RC2', identity: { surname: 'Z' } as any });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true } as any);
    svc.updateApplicant(db, a.id, { identity: { surname: null } as any });
    expect(svc.getApplicantDetail(db, a.id)!.fieldMeta.find((m) => m.fieldPath === 'identity.surname')).toBeUndefined();
  });

  it('field meta is removed when the applicant is deleted (cascade)', () => {
    const a = svc.createApplicant(db, { displayName: 'D' });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname' } as any);
    svc.deleteApplicant(db, a.id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM applicant_field_meta').get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('field meta persists across a reopen', () => {
    const a = svc.createApplicant(db, { displayName: 'P' });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true } as any);
    db.close();
    const db2 = openDatabase(dbPath);
    runMigrations(db2);
    const m = svc.getApplicantDetail(db2, a.id)!.fieldMeta[0];
    expect(m.fieldPath).toBe('identity.surname');
    expect(m.verified).toBe(true);
    db2.close();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- applicantService`
Expected: FAIL — `svc.upsertFieldMeta` is not a function; the reconciliation tests fail.

- [ ] **Step 3: Add `upsertFieldMeta` and the reconciliation to `src/server/services/applicantService.ts`**

Add the export:

```ts
export function upsertFieldMeta(
  db: DatabaseSync,
  applicantId: string,
  input: FieldMetaInput,
): FieldMeta | null {
  if (!getApplicantRow(db, applicantId)) return null;
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT * FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
    .get(applicantId, input.fieldPath) as Record<string, unknown> | undefined;

  const source = input.source ?? 'manual';
  const confidence = isOcrSource(source) ? input.confidence : null;
  const verified = input.verified ?? (existing ? existing.verified === 1 : false);
  const verifiedAt = verified ? (existing?.verified_at as string | null) ?? now : null;
  const rawValue = input.rawValue ?? (existing?.raw_value as string | null) ?? null;

  if (existing) {
    db.prepare(
      `UPDATE applicant_field_meta
         SET source = ?, confidence = ?, raw_value = ?, verified = ?, verified_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(source, confidence, rawValue, verified ? 1 : 0, verifiedAt, now, existing.id as string);
  } else {
    db.prepare(
      `INSERT INTO applicant_field_meta
         (id, applicant_id, field_path, source, confidence, raw_value, verified, verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      applicantId,
      input.fieldPath,
      source,
      confidence,
      rawValue,
      verified ? 1 : 0,
      verifiedAt,
      now,
      now,
    );
  }
  touch(db, applicantId);
  return listFieldMeta(db, applicantId).find((m) => m.fieldPath === input.fieldPath) ?? null;
}
```

Add `FieldMetaInput` to the schemas import and `isOcrSource` to the fieldPaths import.

In `updateApplicant`, **before** each `writeSection` call, capture the old section
values and reconcile meta after writing. Replace the `for (const key of ['identity',...])` loop body with:

```ts
    for (const key of ['identity', 'passport', 'contact', 'address'] as const) {
      const sectionPatch = patch[key];
      if (!sectionPatch) continue;
      const before = readSection<Record<string, unknown>>(
        db,
        SECTION_TABLES[key].table,
        SECTION_TABLES[key].cols,
        id,
      );
      writeSection(db, SECTION_TABLES[key].table, SECTION_TABLES[key].cols, id, sectionPatch as Record<string, unknown>);
      const after = readSection<Record<string, unknown>>(
        db,
        SECTION_TABLES[key].table,
        SECTION_TABLES[key].cols,
        id,
      );
      for (const field of Object.keys(SECTION_TABLES[key].cols)) {
        if (before[field] === after[field]) continue;
        const fieldPath = `${key}.${field}`;
        if (after[field] == null) {
          db.prepare(
            'DELETE FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?',
          ).run(id, fieldPath);
        } else {
          const meta = db
            .prepare('SELECT id FROM applicant_field_meta WHERE applicant_id = ? AND field_path = ?')
            .get(id, fieldPath) as { id: string } | undefined;
          if (meta) {
            db.prepare(
              `UPDATE applicant_field_meta
                 SET source = 'manual', confidence = NULL, verified = 0, verified_at = NULL, updated_at = ?
               WHERE id = ?`,
            ).run(new Date().toISOString(), meta.id);
          }
        }
      }
    }
```

- [ ] **Step 4: Run — verify it passes**

Run: `npm test -- applicantService`
Expected: PASS (all field-meta tests plus the earlier ones).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/applicantService.ts test/server/applicantService.test.ts
git commit -m "feat: applicant field-meta upsert + provenance reconciliation on value change

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 9: applicantService — duplicate (deep copy + id remap + verified reset)

**Files:**
- Modify: `src/server/services/applicantService.ts`
- Test: `test/server/applicantService.test.ts` (add `describe('duplicate')`)

**Interfaces:**
- Consumes: everything already in `applicantService.ts`
- Produces:
  ```ts
  duplicateApplicant(db, id): ApplicantDetail | null
  ```

- [ ] **Step 1: Add the failing test block to `test/server/applicantService.test.ts`**

```ts
describe('duplicate', () => {
  it('deep-copies sections, travel, references and meta; resets verification; renames', () => {
    const a = svc.createApplicant(db, {
      displayName: 'Original',
      identity: { surname: 'Khan', givenNames: 'Aisha' } as any,
      passport: { number: 'A999' } as any,
    });
    const t = svc.addTravel(db, a.id, { purpose: 'Tourism', arrivalDate: '2026-05-01' } as any)!;
    const r = svc.addReference(db, a.id, { kind: 'employer', name: 'ACME' } as any)!;
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true } as any);
    svc.upsertFieldMeta(db, a.id, { fieldPath: `travel.${t.id}.arrival_date`, source: 'passport_ocr', confidence: 0.8 } as any);

    const copy = svc.duplicateApplicant(db, a.id)!;

    expect(copy.id).not.toBe(a.id);
    expect(copy.displayName).toBe('Original (copy)');
    expect(copy.status).toBe('draft');
    expect(copy.identity.surname).toBe('Khan');
    expect(copy.passport.number).toBe('A999');
    expect(copy.travel).toHaveLength(1);
    expect(copy.travel[0].id).not.toBe(t.id);
    expect(copy.travel[0].purpose).toBe('Tourism');
    expect(copy.references[0].kind).toBe('employer');

    // meta: verified reset, source/confidence kept, travel id remapped
    const surnameMeta = copy.fieldMeta.find((m) => m.fieldPath === 'identity.surname')!;
    expect(surnameMeta.verified).toBe(false);
    expect(surnameMeta.verifiedAt).toBeNull();

    const travelMeta = copy.fieldMeta.find((m) => m.fieldPath.startsWith('travel.'))!;
    expect(travelMeta.fieldPath).toBe(`travel.${copy.travel[0].id}.arrival_date`);
    expect(travelMeta.source).toBe('passport_ocr');
    expect(travelMeta.confidence).toBeCloseTo(0.8, 5);
    expect(travelMeta.verified).toBe(false);
  });

  it('does not modify the original', () => {
    const a = svc.createApplicant(db, { displayName: 'Keep', identity: { surname: 'X' } as any });
    svc.upsertFieldMeta(db, a.id, { fieldPath: 'identity.surname', verified: true } as any);
    svc.duplicateApplicant(db, a.id);
    const again = svc.getApplicantDetail(db, a.id)!;
    expect(again.displayName).toBe('Keep');
    expect(again.fieldMeta.find((m) => m.fieldPath === 'identity.surname')!.verified).toBe(true);
    expect(svc.listApplicants(db)).toHaveLength(2);
  });

  it('returns null for a missing applicant', () => {
    expect(svc.duplicateApplicant(db, 'missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- applicantService`
Expected: FAIL — `svc.duplicateApplicant` is not a function.

- [ ] **Step 3: Add `duplicateApplicant` to `src/server/services/applicantService.ts`**

```ts
export function duplicateApplicant(db: DatabaseSync, id: string): ApplicantDetail | null {
  const src = getApplicantRow(db, id);
  if (!src) return null;

  const newId = randomUUID();
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO applicants (id, display_name, status, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?)`,
    ).run(newId, `${src.display_name} (copy)`, now, now);

    for (const { table } of Object.values(SECTION_TABLES)) {
      const row = db.prepare(`SELECT * FROM ${table} WHERE applicant_id = ?`).get(id) as
        | Record<string, unknown>
        | undefined;
      const cols = row ? Object.keys(row) : ['applicant_id'];
      const values = cols.map((c) => (c === 'applicant_id' ? newId : row ? row[c] : null));
      db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ).run(...values);
    }

    const idMap = new Map<string, string>();
    for (const table of ['applicant_travel', 'applicant_reference'] as const) {
      const rows = db.prepare(`SELECT * FROM ${table} WHERE applicant_id = ?`).all(id) as Record<string, unknown>[];
      for (const row of rows) {
        const childNewId = randomUUID();
        idMap.set(row.id as string, childNewId);
        const cols = Object.keys(row);
        const values = cols.map((c) => {
          if (c === 'id') return childNewId;
          if (c === 'applicant_id') return newId;
          if (c === 'created_at' || c === 'updated_at') return now;
          return row[c];
        });
        db.prepare(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        ).run(...values);
      }
    }

    const metaRows = db
      .prepare('SELECT * FROM applicant_field_meta WHERE applicant_id = ?')
      .all(id) as Record<string, unknown>[];
    for (const row of metaRows) {
      const remappedPath = (row.field_path as string)
        .split('.')
        .map((seg) => idMap.get(seg) ?? seg)
        .join('.');
      db.prepare(
        `INSERT INTO applicant_field_meta
           (id, applicant_id, field_path, source, confidence, raw_value, verified, verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
      ).run(
        randomUUID(),
        newId,
        remappedPath,
        row.source,
        row.confidence,
        row.raw_value,
        now,
        now,
      );
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getApplicantDetail(db, newId);
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npm test -- applicantService`
Expected: PASS (all `applicantService` tests — CRUD + travel/refs + field meta + duplicate).

- [ ] **Step 5: Full server gate**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/applicantService.ts test/server/applicantService.test.ts
git commit -m "feat: duplicate an applicant — deep copy, child-id remap, verification reset

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 10: REST routes — applicant CRUD, search, duplicate

**Files:**
- Create: `src/server/routes/applicants.ts`
- Modify: `src/server/app.ts` (register the routes)
- Test: `test/server/applicantRoutes.test.ts`

**Interfaces:**
- Consumes: `applicantCreateSchema`, `applicantPutSchema` (Task 4); `createApplicant` / `listApplicants` / `getApplicantDetail` / `updateApplicant` / `deleteApplicant` / `duplicateApplicant` (Tasks 6, 9); `validationError`, `notFoundError` (existing `src/server/routes/errors.js`)
- Produces: `registerApplicantRoutes(app: FastifyInstance): Promise<void>` registering:
  `GET /api/applicants`, `POST /api/applicants`, `GET /api/applicants/:id`,
  `PUT /api/applicants/:id`, `DELETE /api/applicants/:id`,
  `POST /api/applicants/:id/duplicate`. (Task 11 appends the child + field-meta routes to this same file.)

- [ ] **Step 1: Write the failing test `test/server/applicantRoutes.test.ts`**

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let app: FastifyInstance;
let dbPath: string;

beforeEach(async () => {
  dbPath = makeTempDbPath();
  app = await buildServer({ dbPath });
});
afterEach(async () => {
  await app.close();
  cleanupTempDb(dbPath);
});

async function create(body: Record<string, unknown> = { displayName: 'Aisha' }) {
  const res = await app.inject({ method: 'POST', url: '/api/applicants', payload: body });
  return res;
}

it('POST creates and GET returns the applicant with computed blocks', async () => {
  const res = await create();
  expect(res.statusCode).toBe(201);
  const { applicant } = res.json();
  expect(applicant.displayName).toBe('Aisha');
  expect(applicant.completeness.overall).toBe(0);
  expect(applicant.verification.label).toBe('unverified');
  expect(Array.isArray(applicant.warnings)).toBe(true);

  const get = await app.inject({ method: 'GET', url: `/api/applicants/${applicant.id}` });
  expect(get.statusCode).toBe(200);
  expect(get.json().applicant.id).toBe(applicant.id);
});

it('POST with a blank displayName is 400 VALIDATION_ERROR', async () => {
  const res = await create({ displayName: '   ' });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe('VALIDATION_ERROR');
});

it('POST with a bad nested section value is 400 and reports the path (not the value)', async () => {
  const res = await create({ displayName: 'X', identity: { dateOfBirth: '13/2000' } });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.message).toMatch(/dateOfBirth/);
  expect(res.json().error.message).not.toMatch(/13\/2000/);
});

it('GET list omits sensitive fields; search narrows results', async () => {
  await create({ displayName: 'Aisha Khan', identity: { nationality: 'Bangladeshi' }, passport: { number: 'AB1234567' } });
  await create({ displayName: 'Bob Smith' });

  const all = await app.inject({ method: 'GET', url: '/api/applicants' });
  expect(all.json().applicants).toHaveLength(2);
  const row = all.json().applicants.find((r: { displayName: string }) => r.displayName === 'Aisha Khan');
  expect(row.passportNumberLast4).toBe('4567');
  expect(JSON.stringify(row)).not.toContain('AB1234567');
  expect(row).not.toHaveProperty('identity');

  const q = await app.inject({ method: 'GET', url: '/api/applicants?q=khan' });
  expect(q.json().applicants.map((r: { displayName: string }) => r.displayName)).toEqual(['Aisha Khan']);

  const q2 = await app.inject({ method: 'GET', url: '/api/applicants?q=AB12345' });
  expect(q2.json().applicants).toHaveLength(1);
});

it('PUT patches a section; GET reflects it', async () => {
  const { applicant } = (await create()).json();
  const put = await app.inject({
    method: 'PUT',
    url: `/api/applicants/${applicant.id}`,
    payload: { identity: { surname: 'Rahman' } },
  });
  expect(put.statusCode).toBe(200);
  expect(put.json().applicant.identity.surname).toBe('Rahman');
});

it('GET / PUT / DELETE unknown id is 404 NOT_FOUND', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/applicants/nope' })).statusCode).toBe(404);
  expect((await app.inject({ method: 'PUT', url: '/api/applicants/nope', payload: {} })).statusCode).toBe(404);
  const del = await app.inject({ method: 'DELETE', url: '/api/applicants/nope' });
  expect(del.statusCode).toBe(404);
  expect(del.json().error.code).toBe('NOT_FOUND');
});

it('DELETE removes the applicant', async () => {
  const { applicant } = (await create()).json();
  expect((await app.inject({ method: 'DELETE', url: `/api/applicants/${applicant.id}` })).statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url: '/api/applicants' })).json().applicants).toHaveLength(0);
});

it('POST /:id/duplicate returns a renamed copy', async () => {
  const { applicant } = (await create({ displayName: 'Orig', identity: { surname: 'K' } })).json();
  const dup = await app.inject({ method: 'POST', url: `/api/applicants/${applicant.id}/duplicate` });
  expect(dup.statusCode).toBe(201);
  expect(dup.json().applicant.displayName).toBe('Orig (copy)');
  expect(dup.json().applicant.identity.surname).toBe('K');
  expect((await app.inject({ method: 'GET', url: '/api/applicants' })).json().applicants).toHaveLength(2);
});

it('applicant data survives a server restart on the same db file', async () => {
  const { applicant } = (await create({ displayName: 'Persist', identity: { surname: 'Z' } })).json();
  await app.close();
  app = await buildServer({ dbPath });
  const get = await app.inject({ method: 'GET', url: `/api/applicants/${applicant.id}` });
  expect(get.json().applicant.identity.surname).toBe('Z');
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- applicantRoutes`
Expected: FAIL — routes not registered (404s everywhere).

- [ ] **Step 3: Create `src/server/routes/applicants.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import {
  applicantCreateSchema,
  applicantPutSchema,
} from '../../shared/applicant/schemas.js';
import * as svc from '../services/applicantService.js';
import { notFoundError, validationError } from './errors.js';

export async function registerApplicantRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>('/api/applicants', async (req) => ({
    applicants: svc.listApplicants(app.db, req.query.q),
  }));

  app.post('/api/applicants', async (req, reply) => {
    const parsed = applicantCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    return reply.code(201).send({ applicant: svc.createApplicant(app.db, parsed.data) });
  });

  app.get<{ Params: { id: string } }>('/api/applicants/:id', async (req, reply) => {
    const applicant = svc.getApplicantDetail(app.db, req.params.id);
    if (!applicant) return reply.code(404).send(notFoundError('applicant'));
    return { applicant };
  });

  app.put<{ Params: { id: string } }>('/api/applicants/:id', async (req, reply) => {
    const parsed = applicantPutSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const applicant = svc.updateApplicant(app.db, req.params.id, parsed.data);
    if (!applicant) return reply.code(404).send(notFoundError('applicant'));
    return { applicant };
  });

  app.delete<{ Params: { id: string } }>('/api/applicants/:id', async (req, reply) => {
    if (!svc.deleteApplicant(app.db, req.params.id)) {
      return reply.code(404).send(notFoundError('applicant'));
    }
    return { deleted: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/applicants/:id/duplicate',
    async (req, reply) => {
      const applicant = svc.duplicateApplicant(app.db, req.params.id);
      if (!applicant) return reply.code(404).send(notFoundError('applicant'));
      return reply.code(201).send({ applicant });
    },
  );
}
```

- [ ] **Step 4: Register in `src/server/app.ts`**

Add the import beside the other route imports:
```ts
import { registerApplicantRoutes } from './routes/applicants.js';
```
Add the call right after `await registerPortalRoutes(app);`:
```ts
  await registerApplicantRoutes(app);
```

- [ ] **Step 5: Run — verify it passes**

Run: `npm test -- applicantRoutes`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint + full server suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/applicants.ts src/server/app.ts test/server/applicantRoutes.test.ts
git commit -m "feat: applicant REST routes — CRUD, search, duplicate with sanitized errors

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 11: REST routes — travel, references, field-meta

**Files:**
- Modify: `src/server/routes/applicants.ts`
- Test: `test/server/applicantRoutes.test.ts` (add `describe('child records & field meta')`)

**Interfaces:**
- Consumes: `travelSchema`, `referenceSchema`, `fieldMetaInputSchema` (Task 4); `addTravel` / `updateTravel` / `deleteTravel` / `addReference` / `updateReference` / `deleteReference` / `upsertFieldMeta` / `getApplicantDetail` (Tasks 7, 8)
- Produces: additional routes on the same `registerApplicantRoutes`:
  `POST|PUT|DELETE /api/applicants/:id/travel[/:travelId]`,
  `POST|PUT|DELETE /api/applicants/:id/references[/:refId]`,
  `PUT /api/applicants/:id/field-meta`.

- [ ] **Step 1: Add the failing test block to `test/server/applicantRoutes.test.ts`**

```ts
describe('child records & field meta', () => {
  async function newApplicant() {
    return (await create({ displayName: 'Child Owner' })).json().applicant.id as string;
  }

  it('travel: POST / PUT / DELETE', async () => {
    const id = await newApplicant();
    const add = await app.inject({
      method: 'POST',
      url: `/api/applicants/${id}/travel`,
      payload: { purpose: 'Tourism', arrivalDate: '2026-05-01' },
    });
    expect(add.statusCode).toBe(201);
    const travelId = add.json().travel.id;

    const edit = await app.inject({
      method: 'PUT',
      url: `/api/applicants/${id}/travel/${travelId}`,
      payload: { purpose: 'Business' },
    });
    expect(edit.json().travel.purpose).toBe('Business');

    const del = await app.inject({ method: 'DELETE', url: `/api/applicants/${id}/travel/${travelId}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/applicants/${id}` })).json().applicant.travel).toEqual([]);
  });

  it('travel: bad body 400, unknown applicant/record 404', async () => {
    const id = await newApplicant();
    expect(
      (await app.inject({ method: 'POST', url: `/api/applicants/${id}/travel`, payload: { arrivalDate: 'nope' } })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: `/api/applicants/missing/travel`, payload: {} })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'PUT', url: `/api/applicants/${id}/travel/missing`, payload: {} })).statusCode,
    ).toBe(404);
  });

  it('references: POST / PUT / DELETE with kind', async () => {
    const id = await newApplicant();
    const add = await app.inject({
      method: 'POST',
      url: `/api/applicants/${id}/references`,
      payload: { kind: 'employer', name: 'ACME' },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().reference.kind).toBe('employer');
    const refId = add.json().reference.id;
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/applicants/${id}/references/${refId}`,
      payload: { kind: 'sponsor', name: 'ACME' },
    });
    expect(edit.json().reference.kind).toBe('sponsor');
    expect((await app.inject({ method: 'DELETE', url: `/api/applicants/${id}/references/${refId}` })).statusCode).toBe(200);
  });

  it('field-meta: PUT upserts and toggles verification', async () => {
    const id = await newApplicant();
    await app.inject({ method: 'PUT', url: `/api/applicants/${id}`, payload: { identity: { surname: 'K' } } });

    const v = await app.inject({
      method: 'PUT',
      url: `/api/applicants/${id}/field-meta`,
      payload: { fieldPath: 'identity.surname', verified: true },
    });
    expect(v.statusCode).toBe(200);
    expect(v.json().fieldMeta.verified).toBe(true);
    expect(v.json().fieldMeta.verifiedAt).not.toBeNull();

    const detail = (await app.inject({ method: 'GET', url: `/api/applicants/${id}` })).json().applicant;
    expect(detail.verification.bySection.identity).toEqual({ verified: 1, total: 1 });

    const bad = await app.inject({
      method: 'PUT',
      url: `/api/applicants/${id}/field-meta`,
      payload: { fieldPath: 'identity.surname', source: 'manual', confidence: 0.9 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('field-meta: 404 for a missing applicant', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/applicants/missing/field-meta`,
      payload: { fieldPath: 'identity.surname' },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- applicantRoutes`
Expected: FAIL — child routes 404 / not registered.

- [ ] **Step 3: Append routes to `src/server/routes/applicants.ts`**

Add to the imports:
```ts
import {
  fieldMetaInputSchema,
  referenceSchema,
  travelSchema,
} from '../../shared/applicant/schemas.js';
```
Inside `registerApplicantRoutes`, after the duplicate route:

```ts
  // --- travel ---
  app.post<{ Params: { id: string } }>('/api/applicants/:id/travel', async (req, reply) => {
    const parsed = travelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const travel = svc.addTravel(app.db, req.params.id, parsed.data);
    if (!travel) return reply.code(404).send(notFoundError('applicant'));
    return reply.code(201).send({ travel });
  });

  app.put<{ Params: { id: string; travelId: string } }>(
    '/api/applicants/:id/travel/:travelId',
    async (req, reply) => {
      const parsed = travelSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      const travel = svc.updateTravel(app.db, req.params.id, req.params.travelId, parsed.data);
      if (!travel) return reply.code(404).send(notFoundError('travel record'));
      return { travel };
    },
  );

  app.delete<{ Params: { id: string; travelId: string } }>(
    '/api/applicants/:id/travel/:travelId',
    async (req, reply) => {
      if (!svc.deleteTravel(app.db, req.params.id, req.params.travelId)) {
        return reply.code(404).send(notFoundError('travel record'));
      }
      return { deleted: true };
    },
  );

  // --- references ---
  app.post<{ Params: { id: string } }>('/api/applicants/:id/references', async (req, reply) => {
    const parsed = referenceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const reference = svc.addReference(app.db, req.params.id, parsed.data);
    if (!reference) return reply.code(404).send(notFoundError('applicant'));
    return reply.code(201).send({ reference });
  });

  app.put<{ Params: { id: string; refId: string } }>(
    '/api/applicants/:id/references/:refId',
    async (req, reply) => {
      const parsed = referenceSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
      const reference = svc.updateReference(app.db, req.params.id, req.params.refId, parsed.data);
      if (!reference) return reply.code(404).send(notFoundError('reference'));
      return { reference };
    },
  );

  app.delete<{ Params: { id: string; refId: string } }>(
    '/api/applicants/:id/references/:refId',
    async (req, reply) => {
      if (!svc.deleteReference(app.db, req.params.id, req.params.refId)) {
        return reply.code(404).send(notFoundError('reference'));
      }
      return { deleted: true };
    },
  );

  // --- field meta ---
  app.put<{ Params: { id: string } }>('/api/applicants/:id/field-meta', async (req, reply) => {
    const parsed = fieldMetaInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const fieldMeta = svc.upsertFieldMeta(app.db, req.params.id, parsed.data);
    if (!fieldMeta) return reply.code(404).send(notFoundError('applicant'));
    return { fieldMeta };
  });
```

- [ ] **Step 4: Run — verify it passes**

Run: `npm test -- applicantRoutes`
Expected: PASS.

- [ ] **Step 5: Full server gate**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/applicants.ts test/server/applicantRoutes.test.ts
git commit -m "feat: applicant travel / reference / field-meta REST routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 12: Frontend — API client methods, option constants, ApplicantsPage

**Files:**
- Modify: `src/web/src/api/client.ts`
- Create: `src/web/src/lib/applicantOptions.ts`
- Create: `src/web/src/pages/Applicants/ApplicantsPage.tsx`
- Modify: `src/web/src/main.tsx` (routes), `src/web/src/App.tsx` (nav link)
- Test: `test/web/ApplicantsPage.test.tsx`

**Interfaces:**
- Consumes: shared types from `src/shared/applicant/types` (import without `.js` — web uses Bundler resolution); `ApplicantCreate`/`ApplicantPut`/`TravelInput`/`ReferenceInput`/`FieldMetaInput` from `src/shared/applicant/schemas`
- Produces:
  - `api.listApplicants(q?) / createApplicant(input) / getApplicant(id) / updateApplicant(id, patch) / deleteApplicant(id) / duplicateApplicant(id) / addTravel(id, input) / updateTravel(id, travelId, input) / deleteTravel(id, travelId) / addReference(id, input) / updateReference(id, refId, input) / deleteReference(id, refId) / setFieldMeta(id, input)`
  - `src/web/src/lib/applicantOptions.ts`: `SEX_OPTIONS`, `REFERENCE_KIND_OPTIONS`, `TRIP_TYPE_OPTIONS`, `FIELD_SOURCE_LABELS`
  - `ApplicantsPage` component (named export, no default)

- [ ] **Step 1: Write the failing test `test/web/ApplicantsPage.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApplicantsPage } from '../../src/web/src/pages/Applicants/ApplicantsPage';

const rowAisha = {
  id: 'a1', displayName: 'Aisha Khan', status: 'draft', nationality: 'Bangladeshi',
  passportNumberLast4: '4567', completeness: { overall: 0.5 }, verification: { label: 'partial' },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
};

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    listApplicants: vi.fn().mockResolvedValue({ applicants: [rowAisha] }),
    createApplicant: vi.fn().mockResolvedValue({ applicant: { id: 'new', displayName: 'New' } }),
    deleteApplicant: vi.fn().mockResolvedValue({ deleted: true }),
    duplicateApplicant: vi.fn().mockResolvedValue({ applicant: { id: 'copy' } }),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('renders applicant summaries from the API', async () => {
  render(<MemoryRouter><ApplicantsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Aisha Khan')).toBeTruthy());
  expect(screen.getByText('Bangladeshi')).toBeTruthy();
  expect(screen.getByText(/4567/)).toBeTruthy();
  // no full passport number anywhere
  expect(document.body.textContent).not.toMatch(/AB1234567/);
});

it('shows an empty state', async () => {
  const { api } = await import('../../src/web/src/api/client');
  (api.listApplicants as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ applicants: [] });
  render(<MemoryRouter><ApplicantsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/no applicants yet/i)).toBeTruthy());
});

it('typing in search re-queries with q', async () => {
  render(<MemoryRouter><ApplicantsPage /></MemoryRouter>);
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() => expect(api.listApplicants).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'khan' } });
  await waitFor(() =>
    expect((api.listApplicants as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe('khan'),
  );
});

it('creating an applicant calls the API', async () => {
  render(<MemoryRouter><ApplicantsPage /></MemoryRouter>);
  const { api } = await import('../../src/web/src/api/client');
  fireEvent.click(screen.getByRole('button', { name: /new applicant/i }));
  fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Bob' } });
  fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
  await waitFor(() => expect(api.createApplicant).toHaveBeenCalledWith({ displayName: 'Bob' }));
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- ApplicantsPage`
Expected: FAIL — module not found.

- [ ] **Step 3: Extend `src/web/src/api/client.ts`**

Add imports at the top:
```ts
import type {
  ApplicantDetail,
  ApplicantSummary,
  Reference,
  TravelRecord,
  FieldMeta,
} from '../../../shared/applicant/types';
import type {
  ApplicantCreate,
  ApplicantPut,
  TravelInput,
  ReferenceInput,
  FieldMetaInput,
} from '../../../shared/applicant/schemas';
```

Add these methods inside the `api` object (before the closing `}`):
```ts
  listApplicants: (q?: string) =>
    request<{ applicants: ApplicantSummary[] }>(
      `/applicants${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),
  createApplicant: (input: ApplicantCreate) =>
    request<{ applicant: ApplicantDetail }>('/applicants', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getApplicant: (id: string) =>
    request<{ applicant: ApplicantDetail }>(`/applicants/${id}`),
  updateApplicant: (id: string, patch: ApplicantPut) =>
    request<{ applicant: ApplicantDetail }>(`/applicants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteApplicant: (id: string) =>
    request<{ deleted: true }>(`/applicants/${id}`, { method: 'DELETE' }),
  duplicateApplicant: (id: string) =>
    request<{ applicant: ApplicantDetail }>(`/applicants/${id}/duplicate`, { method: 'POST' }),
  addTravel: (id: string, input: TravelInput) =>
    request<{ travel: TravelRecord }>(`/applicants/${id}/travel`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTravel: (id: string, travelId: string, input: TravelInput) =>
    request<{ travel: TravelRecord }>(`/applicants/${id}/travel/${travelId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteTravel: (id: string, travelId: string) =>
    request<{ deleted: true }>(`/applicants/${id}/travel/${travelId}`, { method: 'DELETE' }),
  addReference: (id: string, input: ReferenceInput) =>
    request<{ reference: Reference }>(`/applicants/${id}/references`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateReference: (id: string, refId: string, input: ReferenceInput) =>
    request<{ reference: Reference }>(`/applicants/${id}/references/${refId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteReference: (id: string, refId: string) =>
    request<{ deleted: true }>(`/applicants/${id}/references/${refId}`, { method: 'DELETE' }),
  setFieldMeta: (id: string, input: FieldMetaInput) =>
    request<{ fieldMeta: FieldMeta }>(`/applicants/${id}/field-meta`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
```

- [ ] **Step 4: Create `src/web/src/lib/applicantOptions.ts`**

```ts
import type { ReferenceKind, Sex, FieldSource } from '../../../shared/applicant/types';

export const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'X', label: 'Unspecified / X' },
];

export const REFERENCE_KIND_OPTIONS: { value: ReferenceKind; label: string }[] = [
  { value: 'emergency_contact', label: 'Emergency contact' },
  { value: 'employer', label: 'Employer' },
  { value: 'in_country_host', label: 'In-country host' },
  { value: 'sponsor', label: 'Sponsor' },
  { value: 'other', label: 'Other' },
];

export const TRIP_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'tourism', label: 'Tourism' },
  { value: 'business', label: 'Business' },
  { value: 'family_visit', label: 'Family visit' },
  { value: 'study', label: 'Study' },
  { value: 'transit', label: 'Transit' },
  { value: 'other', label: 'Other' },
];

export const FIELD_SOURCE_LABELS: Record<FieldSource, string> = {
  manual: 'Entered manually',
  imported: 'Imported',
  system: 'Derived by the app',
  passport_mrz: 'Passport MRZ',
  passport_ocr: 'Passport OCR',
  document_ocr: 'Document OCR',
};
```

- [ ] **Step 5: Create `src/web/src/pages/Applicants/ApplicantsPage.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApplicantSummary } from '../../../../shared/applicant/types';
import { api } from '../../api/client';

export function ApplicantsPage() {
  const [rows, setRows] = useState<ApplicantSummary[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const res = await api.listApplicants(term.trim() || undefined);
      setRows(res.applicants);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applicants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  function onSearch(value: string) {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(value), 200);
  }

  async function create() {
    if (newName.trim().length === 0) return;
    try {
      await api.createApplicant({ displayName: newName.trim() });
      setNewName('');
      setCreating(false);
      await load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create applicant');
    }
  }

  async function remove(row: ApplicantSummary) {
    if (!window.confirm(`Delete applicant "${row.displayName}"? This cannot be undone.`)) return;
    try {
      await api.deleteApplicant(row.id);
      await load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete applicant');
    }
  }

  async function duplicate(row: ApplicantSummary) {
    try {
      await api.duplicateApplicant(row.id);
      await load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to duplicate applicant');
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2>Applicants</h2>
        <button onClick={() => setCreating((v) => !v)}>New applicant</button>
      </div>

      {creating && (
        <div className="inline-form">
          <label htmlFor="new-applicant-name">Display name</label>
          <input
            id="new-applicant-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button onClick={create}>Create</button>
          <button className="link" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      )}

      <label htmlFor="applicant-search">Search applicants</label>
      <input
        id="applicant-search"
        placeholder="name, passport number, nationality, email…"
        value={q}
        onChange={(e) => onSearch(e.target.value)}
      />

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && rows.length === 0 && <p>No applicants yet. Create one to get started.</p>}

      {rows.length > 0 && (
        <table className="applicants">
          <thead>
            <tr>
              <th>Name</th><th>Nationality</th><th>Passport</th>
              <th>Complete</th><th>Verified</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/applicants/${r.id}`}>{r.displayName}</Link></td>
                <td>{r.nationality ?? '—'}</td>
                <td className="mono">{r.passportNumberLast4 ? `••••${r.passportNumberLast4}` : '—'}</td>
                <td>
                  <span className="bar" aria-label={`${Math.round(r.completeness.overall * 100)}% complete`}>
                    <span className="bar__fill" style={{ width: `${r.completeness.overall * 100}%` }} />
                  </span>
                </td>
                <td><span className={`badge badge--${r.verification.label}`}>{r.verification.label}</span></td>
                <td className="row-actions">
                  <Link className="button-link" to={`/applicants/${r.id}`}>View</Link>
                  <button onClick={() => duplicate(r)}>Duplicate</button>
                  <button onClick={() => remove(r)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Wire the routes + nav**

`src/web/src/main.tsx` — add imports and two child routes:
```tsx
import { ApplicantsPage } from './pages/Applicants/ApplicantsPage';
import { ApplicantDetailPage } from './pages/Applicants/ApplicantDetailPage';
```
```tsx
      { path: 'applicants', element: <ApplicantsPage /> },
      { path: 'applicants/:id', element: <ApplicantDetailPage /> },
```

> NOTE: `ApplicantDetailPage` is created in Task 13. To keep this task's build
> green, create a one-line placeholder now:
> `src/web/src/pages/Applicants/ApplicantDetailPage.tsx` →
> `export function ApplicantDetailPage() { return <p>Applicant detail loads here.</p>; }`
> Task 13 replaces it.

`src/web/src/App.tsx` — add an "Applicants" `NavLink` beside "Visa Portals":
```tsx
          <NavLink to="/applicants">Applicants</NavLink>
```

- [ ] **Step 7: Run — verify the test passes**

Run: `npm test -- ApplicantsPage`
Expected: PASS (4 tests).

- [ ] **Step 8: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/web/src/api/client.ts src/web/src/lib/applicantOptions.ts src/web/src/pages/Applicants src/web/src/main.tsx src/web/src/App.tsx test/web/ApplicantsPage.test.tsx
git commit -m "feat: applicants list page — search, create, duplicate, delete; typed API client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 13: Frontend — ApplicantDetailPage + SectionCard + CompletenessHeader

**Files:**
- Create: `src/web/src/pages/Applicants/SectionCard.tsx`
- Create: `src/web/src/pages/Applicants/CompletenessHeader.tsx`
- Replace: `src/web/src/pages/Applicants/ApplicantDetailPage.tsx`
- Test: `test/web/ApplicantDetailPage.test.tsx`

**Interfaces:**
- Consumes: `api` (Task 12); `SEX_OPTIONS` (Task 12); `ApplicantDetail`, section types (Task 3)
- Produces:
  - `CompletenessHeader({ detail }: { detail: ApplicantDetail })`
  - `SectionCard(props: { title: string; sectionKey: 'identity'|'passport'|'contact'|'address';
      fields: { key: string; label: string; type?: 'text'|'date'|'select'; options?: {value:string;label:string}[] }[];
      values: Record<string, string | null>; fieldMeta: FieldMeta[];
      onSave: (patch: Record<string,string|null>) => Promise<void>;
      onVerify: (fieldPath: string, verified: boolean) => Promise<void>; })`
  - `ApplicantDetailPage()` — reads `:id` param, loads detail, renders header + 4 SectionCards + a Travel section and References section (list + add/edit/delete wired to `TravelRecordForm`/`ReferenceForm` from Task 14 — until then, a stub list).

- [ ] **Step 1: Write the failing test `test/web/ApplicantDetailPage.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ApplicantDetailPage } from '../../src/web/src/pages/Applicants/ApplicantDetailPage';

const detail = {
  id: 'a1', displayName: 'Aisha Khan', status: 'draft',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  identity: { surname: 'Khan', givenNames: 'Aisha', fullNameAsInPassport: null, dateOfBirth: '2000-01-01', sex: 'F', placeOfBirth: 'Dhaka', nationality: 'Bangladeshi', otherNationalities: null },
  passport: { documentType: 'P', number: 'AB1234567', issuingState: 'BGD', issueDate: '2020-01-01', expiryDate: '2030-01-01', placeOfIssue: 'Dhaka', issuingAuthority: null },
  contact: { email: 'a@b.co', phone: null, altPhone: null },
  address: { line1: null, line2: null, city: null, region: null, postalCode: null, country: null },
  travel: [], references: [],
  fieldMeta: [{ id: 'm1', applicantId: 'a1', fieldPath: 'identity.surname', source: 'manual', confidence: null, rawValue: null, verified: true, verifiedAt: '2026-01-02T00:00:00Z', createdAt: '', updatedAt: '' }],
  completeness: { overall: 0.55, bySection: { identity: 1, passport: 1, contact: 0.5, address: 0, travel: 0, references: 0 } },
  verification: { verified: 1, total: 10, ratio: 0.1, label: 'partial', bySection: { identity: { verified: 1, total: 6 }, passport: { verified: 0, total: 6 }, contact: { verified: 0, total: 1 }, address: { verified: 0, total: 0 }, travel: { verified: 0, total: 0 }, references: { verified: 0, total: 0 } } },
  warnings: [],
};

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    getApplicant: vi.fn().mockResolvedValue({ applicant: detail }),
    updateApplicant: vi.fn().mockResolvedValue({ applicant: detail }),
    setFieldMeta: vi.fn().mockResolvedValue({ fieldMeta: {} }),
    deleteApplicant: vi.fn(),
    duplicateApplicant: vi.fn().mockResolvedValue({ applicant: { id: 'copy' } }),
    addTravel: vi.fn(), updateTravel: vi.fn(), deleteTravel: vi.fn(),
    addReference: vi.fn(), updateReference: vi.fn(), deleteReference: vi.fn(),
  },
}));

function renderAt(id = 'a1') {
  return render(
    <MemoryRouter initialEntries={[`/applicants/${id}`]}>
      <Routes>
        <Route path="/applicants/:id" element={<ApplicantDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('loads and renders the four sections and the completeness header', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('Aisha Khan')).toBeTruthy());
  expect(screen.getByText('Identity')).toBeTruthy();
  expect(screen.getByText('Passport')).toBeTruthy();
  expect(screen.getByText('Contact')).toBeTruthy();
  expect(screen.getByText('Address')).toBeTruthy();
  expect(screen.getByText(/55%|complete/i)).toBeTruthy();
  expect(screen.getByText('Khan')).toBeTruthy();
});

it('editing identity and saving calls updateApplicant with a section patch', async () => {
  renderAt();
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() => expect(screen.getByText('Khan')).toBeTruthy());
  fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0]); // Identity card
  fireEvent.change(screen.getByLabelText(/surname/i), { target: { value: 'Rahman' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() =>
    expect(api.updateApplicant).toHaveBeenCalledWith('a1', expect.objectContaining({ identity: expect.objectContaining({ surname: 'Rahman' }) })),
  );
});

it('an invalid date blocks the save (no API call)', async () => {
  renderAt();
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() => expect(screen.getByText('Khan')).toBeTruthy());
  fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0]);
  fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '2000/01/01' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(screen.getByText(/YYYY-MM-DD/i)).toBeTruthy());
  expect(api.updateApplicant).not.toHaveBeenCalled();
});

it('toggling a field verify control calls setFieldMeta', async () => {
  renderAt();
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() => expect(screen.getByText('Khan')).toBeTruthy());
  // givenNames is filled ('Aisha') and unverified -> a "Confirm" control exists
  const confirmButtons = screen.getAllByRole('button', { name: /confirm|verified/i });
  fireEvent.click(confirmButtons[0]);
  await waitFor(() => expect(api.setFieldMeta).toHaveBeenCalled());
  expect((api.setFieldMeta as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(
    expect.objectContaining({ fieldPath: expect.stringMatching(/^identity\./), verified: expect.any(Boolean) }),
  );
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- ApplicantDetailPage`
Expected: FAIL — the placeholder renders "Applicant detail loads here."

- [ ] **Step 3: Create `src/web/src/pages/Applicants/CompletenessHeader.tsx`**

```tsx
import type { ApplicantDetail, SectionKey } from '../../../../shared/applicant/types';

const SECTION_LABELS: Record<SectionKey, string> = {
  identity: 'Identity',
  passport: 'Passport',
  contact: 'Contact',
  address: 'Address',
  travel: 'Travel',
  references: 'References',
};

export function CompletenessHeader({ detail }: { detail: ApplicantDetail }) {
  const pct = Math.round(detail.completeness.overall * 100);
  return (
    <div className="completeness-header">
      <div className="completeness-header__overall">
        <strong>{pct}% complete</strong>
        <span className={`badge badge--${detail.verification.label}`}>
          {detail.verification.verified}/{detail.verification.total} fields verified
        </span>
      </div>
      <ul className="completeness-header__chips">
        {(Object.keys(SECTION_LABELS) as SectionKey[]).map((key) => (
          <li key={key} className="chip">
            {SECTION_LABELS[key]}: {Math.round(detail.completeness.bySection[key] * 100)}%
          </li>
        ))}
      </ul>
      {detail.warnings.length > 0 && (
        <ul className="completeness-header__warnings">
          {detail.warnings.map((w, i) => (
            <li key={i} className="warning">{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/web/src/pages/Applicants/SectionCard.tsx`**

```tsx
import { useState } from 'react';
import type { FieldMeta } from '../../../../shared/applicant/types';

export interface SectionField {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'select' | 'email';
  options?: { value: string; label: string }[];
}

interface Props {
  title: string;
  sectionKey: 'identity' | 'passport' | 'contact' | 'address';
  fields: SectionField[];
  values: Record<string, string | null>;
  fieldMeta: FieldMeta[];
  onSave: (patch: Record<string, string | null>) => Promise<void>;
  onVerify: (fieldPath: string, verified: boolean) => Promise<void>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function SectionCard({ title, sectionKey, fields, values, fieldMeta, onSave, onVerify }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? ''])));
    setError(null);
    setEditing(true);
  }

  async function save() {
    for (const f of fields) {
      const v = (draft[f.key] ?? '').trim();
      if (f.type === 'date' && v.length > 0 && !DATE_RE.test(v)) {
        setError(`${f.label} must be YYYY-MM-DD`);
        return;
      }
      if (f.type === 'email' && v.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
        setError(`${f.label} must be a valid email address`);
        return;
      }
    }
    const patch: Record<string, string | null> = {};
    for (const f of fields) {
      const v = (draft[f.key] ?? '').trim();
      patch[f.key] = v.length > 0 ? v : null;
    }
    setSaving(true);
    try {
      await onSave(patch);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const verifiedPaths = new Set(fieldMeta.filter((m) => m.verified).map((m) => m.fieldPath));

  return (
    <div className="section-card">
      <div className="section-card__head">
        <h3>{title}</h3>
        {!editing && <button onClick={startEdit}>Edit</button>}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {editing ? (
        <div className="section-card__form">
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.type === 'select' ? (
                <select value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={draft[f.key] ?? ''}
                  placeholder={f.type === 'date' ? 'YYYY-MM-DD' : ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              )}
            </label>
          ))}
          <div className="form-actions">
            <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="link" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <dl className="section-card__view">
          {fields.map((f) => {
            const value = values[f.key];
            const path = `${sectionKey}.${f.key}`;
            const isVerified = verifiedPaths.has(path);
            return (
              <div key={f.key} className="section-card__row">
                <dt>{f.label}</dt>
                <dd>{value ?? '—'}</dd>
                <dd className="section-card__verify">
                  {value == null ? null : (
                    <button
                      className={isVerified ? 'verify verify--on' : 'verify'}
                      aria-pressed={isVerified}
                      onClick={() => onVerify(path, !isVerified)}
                    >
                      {isVerified ? '✓ Verified' : 'Confirm'}
                    </button>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Replace `src/web/src/pages/Applicants/ApplicantDetailPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ApplicantDetail } from '../../../../shared/applicant/types';
import { api } from '../../api/client';
import { SEX_OPTIONS } from '../../lib/applicantOptions';
import { CompletenessHeader } from './CompletenessHeader';
import { SectionCard, type SectionField } from './SectionCard';
import { TravelSection } from './TravelSection';
import { ReferenceSection } from './ReferenceSection';

const IDENTITY_FIELDS: SectionField[] = [
  { key: 'surname', label: 'Surname' },
  { key: 'givenNames', label: 'Given names' },
  { key: 'fullNameAsInPassport', label: 'Full name as in passport' },
  { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  { key: 'sex', label: 'Sex', type: 'select', options: SEX_OPTIONS },
  { key: 'placeOfBirth', label: 'Place of birth' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'otherNationalities', label: 'Other nationalities' },
];
const PASSPORT_FIELDS: SectionField[] = [
  { key: 'documentType', label: 'Document type' },
  { key: 'number', label: 'Passport number' },
  { key: 'issuingState', label: 'Issuing state' },
  { key: 'issueDate', label: 'Issue date', type: 'date' },
  { key: 'expiryDate', label: 'Expiry date', type: 'date' },
  { key: 'placeOfIssue', label: 'Place of issue' },
  { key: 'issuingAuthority', label: 'Issuing authority' },
];
const CONTACT_FIELDS: SectionField[] = [
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone' },
  { key: 'altPhone', label: 'Alternate phone' },
];
const ADDRESS_FIELDS: SectionField[] = [
  { key: 'line1', label: 'Address line 1' },
  { key: 'line2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'region', label: 'Region / state' },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'country', label: 'Country' },
];

export function ApplicantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ApplicantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.getApplicant(id);
      setDetail(res.applicant);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applicant');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!detail || !id) return <p>Applicant not found.</p>;

  const saveSection = (key: 'identity' | 'passport' | 'contact' | 'address') =>
    async (patch: Record<string, string | null>) => {
      await api.updateApplicant(id, { [key]: patch });
      await reload();
    };

  const verifyField = async (fieldPath: string, verified: boolean) => {
    await api.setFieldMeta(id, { fieldPath, verified });
    await reload();
  };

  async function duplicate() {
    const res = await api.duplicateApplicant(id!);
    navigate(`/applicants/${res.applicant.id}`);
  }
  async function remove() {
    if (!window.confirm(`Delete applicant "${detail!.displayName}"?`)) return;
    await api.deleteApplicant(id!);
    navigate('/applicants');
  }

  return (
    <section>
      <p><Link to="/applicants">← All applicants</Link></p>
      <div className="section-head">
        <h2>{detail.displayName}</h2>
        <div className="row-actions">
          <button onClick={duplicate}>Duplicate</button>
          <button onClick={remove}>Delete</button>
        </div>
      </div>

      <CompletenessHeader detail={detail} />

      <SectionCard title="Identity" sectionKey="identity" fields={IDENTITY_FIELDS}
        values={detail.identity as unknown as Record<string, string | null>}
        fieldMeta={detail.fieldMeta} onSave={saveSection('identity')} onVerify={verifyField} />
      <SectionCard title="Passport" sectionKey="passport" fields={PASSPORT_FIELDS}
        values={detail.passport as unknown as Record<string, string | null>}
        fieldMeta={detail.fieldMeta} onSave={saveSection('passport')} onVerify={verifyField} />
      <SectionCard title="Contact" sectionKey="contact" fields={CONTACT_FIELDS}
        values={detail.contact as unknown as Record<string, string | null>}
        fieldMeta={detail.fieldMeta} onSave={saveSection('contact')} onVerify={verifyField} />
      <SectionCard title="Address" sectionKey="address" fields={ADDRESS_FIELDS}
        values={detail.address as unknown as Record<string, string | null>}
        fieldMeta={detail.fieldMeta} onSave={saveSection('address')} onVerify={verifyField} />

      <TravelSection applicantId={id} records={detail.travel} onChange={reload} />
      <ReferenceSection applicantId={id} records={detail.references} onChange={reload} />
    </section>
  );
}
```

> NOTE: `TravelSection` / `ReferenceSection` are created in Task 14. To keep this
> task green, create stubs now:
> `src/web/src/pages/Applicants/TravelSection.tsx` →
> `export function TravelSection() { return <section><h3>Travel Records</h3></section>; }`
> `src/web/src/pages/Applicants/ReferenceSection.tsx` →
> `export function ReferenceSection() { return <section><h3>References</h3></section>; }`

- [ ] **Step 6: Run — verify it passes**

Run: `npm test -- ApplicantDetailPage`
Expected: PASS (4 tests).

- [ ] **Step 7: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/web/src/pages/Applicants test/web/ApplicantDetailPage.test.tsx
git commit -m "feat: applicant detail page — editable sections, per-field verify, completeness header

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 14: Frontend — TravelSection / ReferenceSection with add-edit-delete forms

**Files:**
- Create: `src/web/src/pages/Applicants/TravelRecordForm.tsx`
- Create: `src/web/src/pages/Applicants/ReferenceForm.tsx`
- Replace: `src/web/src/pages/Applicants/TravelSection.tsx`, `src/web/src/pages/Applicants/ReferenceSection.tsx`
- Test: `test/web/ApplicantDetailPage.test.tsx` (add `describe('travel & references')`)

**Interfaces:**
- Consumes: `api` (Task 12); `TRIP_TYPE_OPTIONS`, `REFERENCE_KIND_OPTIONS` (Task 12); `TravelRecord`, `Reference` types (Task 3)
- Produces:
  - `TravelRecordForm({ initial?, onCancel, onSubmit })` — controlled form; `onSubmit(values: Record<string,string|null>)`
  - `ReferenceForm({ initial?, onCancel, onSubmit })`
  - `TravelSection({ applicantId, records, onChange })` — list of cards + `[+ Add Travel Record]`, each card `[Edit] [Delete]`
  - `ReferenceSection({ applicantId, records, onChange })` — same pattern

- [ ] **Step 1: Add the failing test block to `test/web/ApplicantDetailPage.test.tsx`**

```tsx
describe('travel & references', () => {
  const withChildren = {
    ...detail,
    travel: [{ id: 't1', applicantId: 'a1', sortOrder: 0, tripType: 'tourism', purpose: 'Holiday', destinationCountry: 'FR', cities: null, arrivalDate: '2026-05-01', departureDate: null, portOfEntry: null, portOfExit: null, accommodation: null, previousTravel: null, notes: null, createdAt: '', updatedAt: '' }],
    references: [{ id: 'r1', applicantId: 'a1', sortOrder: 0, kind: 'employer', name: 'ACME', relationship: null, organization: 'ACME Ltd', phone: null, email: null, address: null, createdAt: '', updatedAt: '' }],
  };

  it('renders travel + reference cards and calls the API on add/delete', async () => {
    const { api } = await import('../../src/web/src/api/client');
    (api.getApplicant as ReturnType<typeof vi.fn>).mockResolvedValue({ applicant: withChildren });
    (api.addTravel as ReturnType<typeof vi.fn>).mockResolvedValue({ travel: {} });
    (api.deleteReference as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted: true });
    renderAt();
    await waitFor(() => expect(screen.getByText('Holiday')).toBeTruthy());
    expect(screen.getByText('ACME')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /add travel record/i }));
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: 'Conference' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(api.addTravel).toHaveBeenCalledWith('a1', expect.objectContaining({ purpose: 'Conference' })),
    );

    window.confirm = () => true;
    fireEvent.click(screen.getAllByRole('button', { name: /delete/i }).find((b) => b.closest('.reference-card'))!);
    await waitFor(() => expect(api.deleteReference).toHaveBeenCalledWith('a1', 'r1'));
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- ApplicantDetailPage`
Expected: FAIL — stubs render only headings; `Holiday` / `ACME` not present.

- [ ] **Step 3: Create `src/web/src/pages/Applicants/TravelRecordForm.tsx`**

```tsx
import { useState } from 'react';
import type { TravelRecord } from '../../../../shared/applicant/types';
import { TRIP_TYPE_OPTIONS } from '../../lib/applicantOptions';

const FIELDS: { key: keyof TravelRecord & string; label: string; type?: 'date' | 'select' | 'textarea' }[] = [
  { key: 'tripType', label: 'Trip type', type: 'select' },
  { key: 'purpose', label: 'Purpose' },
  { key: 'destinationCountry', label: 'Destination country' },
  { key: 'cities', label: 'Cities / locations' },
  { key: 'arrivalDate', label: 'Planned arrival date', type: 'date' },
  { key: 'departureDate', label: 'Planned departure date', type: 'date' },
  { key: 'portOfEntry', label: 'Port of entry' },
  { key: 'portOfExit', label: 'Port of exit' },
  { key: 'accommodation', label: 'Accommodation' },
  { key: 'previousTravel', label: 'Previous travel (summary)', type: 'textarea' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  initial?: TravelRecord;
  onCancel: () => void;
  onSubmit: (values: Record<string, string | null>) => Promise<void>;
}

export function TravelRecordForm({ initial, onCancel, onSubmit }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, (initial?.[f.key] as string | null) ?? ''])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    for (const f of FIELDS) {
      const v = (draft[f.key] ?? '').trim();
      if (f.type === 'date' && v.length > 0 && !DATE_RE.test(v)) {
        setError(`${f.label} must be YYYY-MM-DD`);
        return;
      }
    }
    const values: Record<string, string | null> = {};
    for (const f of FIELDS) {
      const v = (draft[f.key] ?? '').trim();
      values[f.key] = v.length > 0 ? v : null;
    }
    setSaving(true);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="child-form">
      {error && <p className="error" role="alert">{error}</p>}
      {FIELDS.map((f) => (
        <label key={f.key}>
          {f.label}
          {f.type === 'select' ? (
            <select value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
              <option value="">—</option>
              {TRIP_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea rows={2} value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
          ) : (
            <input
              value={draft[f.key] ?? ''}
              placeholder={f.type === 'date' ? 'YYYY-MM-DD' : ''}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            />
          )}
        </label>
      ))}
      <div className="form-actions">
        <button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/web/src/pages/Applicants/ReferenceForm.tsx`**

```tsx
import { useState } from 'react';
import type { Reference } from '../../../../shared/applicant/types';
import { REFERENCE_KIND_OPTIONS } from '../../lib/applicantOptions';

const FIELDS: { key: keyof Reference & string; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'relationship', label: 'Relationship' },
  { key: 'organization', label: 'Organization' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface Props {
  initial?: Reference;
  onCancel: () => void;
  onSubmit: (values: Record<string, string | null>) => Promise<void>;
}

export function ReferenceForm({ initial, onCancel, onSubmit }: Props) {
  const [kind, setKind] = useState<string>(initial?.kind ?? 'other');
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, (initial?.[f.key] as string | null) ?? ''])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const emailVal = (draft.email ?? '').trim();
    if (emailVal.length > 0 && !EMAIL_RE.test(emailVal)) {
      setError('Email must be a valid email address');
      return;
    }
    const values: Record<string, string | null> = { kind };
    for (const f of FIELDS) {
      const v = (draft[f.key] ?? '').trim();
      values[f.key] = v.length > 0 ? v : null;
    }
    setSaving(true);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="child-form">
      {error && <p className="error" role="alert">{error}</p>}
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {REFERENCE_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {FIELDS.map((f) => (
        <label key={f.key}>
          {f.label}
          <input value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
        </label>
      ))}
      <div className="form-actions">
        <button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace `src/web/src/pages/Applicants/TravelSection.tsx`**

```tsx
import { useState } from 'react';
import type { TravelRecord } from '../../../../shared/applicant/types';
import { api } from '../../api/client';
import { TravelRecordForm } from './TravelRecordForm';

interface Props {
  applicantId: string;
  records: TravelRecord[];
  onChange: () => Promise<void>;
}

export function TravelSection({ applicantId, records, onChange }: Props) {
  const [mode, setMode] = useState<{ kind: 'add' } | { kind: 'edit'; id: string } | null>(null);

  async function add(values: Record<string, string | null>) {
    await api.addTravel(applicantId, values as never);
    setMode(null);
    await onChange();
  }
  async function edit(id: string, values: Record<string, string | null>) {
    await api.updateTravel(applicantId, id, values as never);
    setMode(null);
    await onChange();
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this travel record?')) return;
    await api.deleteTravel(applicantId, id);
    await onChange();
  }

  return (
    <section className="child-section">
      <div className="section-head">
        <h3>Travel Records</h3>
        {mode?.kind !== 'add' && <button onClick={() => setMode({ kind: 'add' })}>+ Add Travel Record</button>}
      </div>

      {mode?.kind === 'add' && <TravelRecordForm onCancel={() => setMode(null)} onSubmit={add} />}

      {records.length === 0 && mode?.kind !== 'add' && <p>No travel records.</p>}

      {records.map((r) =>
        mode?.kind === 'edit' && mode.id === r.id ? (
          <TravelRecordForm key={r.id} initial={r} onCancel={() => setMode(null)} onSubmit={(v) => edit(r.id, v)} />
        ) : (
          <div key={r.id} className="travel-card">
            <div className="travel-card__body">
              <strong>{r.purpose ?? '(no purpose)'}</strong>
              <span>{r.tripType ?? '—'} · {r.destinationCountry ?? '—'} · {r.arrivalDate ?? '—'}</span>
            </div>
            <div className="row-actions">
              <button onClick={() => setMode({ kind: 'edit', id: r.id })}>Edit</button>
              <button onClick={() => remove(r.id)}>Delete</button>
            </div>
          </div>
        ),
      )}
    </section>
  );
}
```

- [ ] **Step 6: Replace `src/web/src/pages/Applicants/ReferenceSection.tsx`**

```tsx
import { useState } from 'react';
import type { Reference } from '../../../../shared/applicant/types';
import { api } from '../../api/client';
import { REFERENCE_KIND_OPTIONS } from '../../lib/applicantOptions';
import { ReferenceForm } from './ReferenceForm';

interface Props {
  applicantId: string;
  records: Reference[];
  onChange: () => Promise<void>;
}

const kindLabel = (k: string) => REFERENCE_KIND_OPTIONS.find((o) => o.value === k)?.label ?? k;

export function ReferenceSection({ applicantId, records, onChange }: Props) {
  const [mode, setMode] = useState<{ kind: 'add' } | { kind: 'edit'; id: string } | null>(null);

  async function add(values: Record<string, string | null>) {
    await api.addReference(applicantId, values as never);
    setMode(null);
    await onChange();
  }
  async function edit(id: string, values: Record<string, string | null>) {
    await api.updateReference(applicantId, id, values as never);
    setMode(null);
    await onChange();
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this reference?')) return;
    await api.deleteReference(applicantId, id);
    await onChange();
  }

  return (
    <section className="child-section">
      <div className="section-head">
        <h3>References</h3>
        {mode?.kind !== 'add' && <button onClick={() => setMode({ kind: 'add' })}>+ Add Reference</button>}
      </div>

      {mode?.kind === 'add' && <ReferenceForm onCancel={() => setMode(null)} onSubmit={add} />}

      {records.length === 0 && mode?.kind !== 'add' && <p>No references.</p>}

      {records.map((r) =>
        mode?.kind === 'edit' && mode.id === r.id ? (
          <ReferenceForm key={r.id} initial={r} onCancel={() => setMode(null)} onSubmit={(v) => edit(r.id, v)} />
        ) : (
          <div key={r.id} className="reference-card">
            <div className="reference-card__body">
              <strong>{r.name ?? '(no name)'}</strong>
              <span>{kindLabel(r.kind)} · {r.organization ?? '—'}</span>
            </div>
            <div className="row-actions">
              <button onClick={() => setMode({ kind: 'edit', id: r.id })}>Edit</button>
              <button onClick={() => remove(r.id)}>Delete</button>
            </div>
          </div>
        ),
      )}
    </section>
  );
}
```

- [ ] **Step 7: Run — verify it passes**

Run: `npm test -- ApplicantDetailPage ApplicantsPage`
Expected: PASS (all web tests for both pages).

- [ ] **Step 8: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/web/src/pages/Applicants test/web/ApplicantDetailPage.test.tsx
git commit -m "feat: applicant travel & reference sections with add/edit/delete forms

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

---

### Task 15: Styling, full verification gate, and PHASE-2-REPORT

**Files:**
- Modify: `src/web/src/styles.css`
- Create: `docs/PHASE-2-REPORT.md`
- Modify: `README.md` (add an "Applicants" line under Phase 2 usage), `docs/ARCHITECTURE.md` (note migration 2 + the applicant module in the source-layout section)

**Interfaces:** none (styling + docs + verification only).

- [ ] **Step 1: Add applicant styles to `src/web/src/styles.css`**

Append readable, minimal styles (reuse existing tokens `--fg`, `--bg`, `--muted`, `--border`, `--accent`). Add rules for:
- `table.applicants` (same look as `table.portals`)
- `.bar` / `.bar__fill` — a 90px inline completeness bar (`.bar` grey track, `.bar__fill` `--accent`, height ~8px, rounded)
- `.badge` + `.badge--unverified` (muted) / `.badge--partial` (amber `#b45309` on `#fef3c7`) / `.badge--verified` (green `#15803d` on `#dcfce7`) — small rounded pill
- `.completeness-header`, `.completeness-header__overall` (flex, gap), `.completeness-header__chips` (flex wrap, `.chip` = small bordered pill), `.completeness-header__warnings` `.warning` (reuse `.error` colours, lighter)
- `.section-card` (bordered, padding, margin-bottom), `.section-card__head` (flex space-between), `.section-card__view dl` grid `max-content 1fr max-content`, `.section-card__row` contents, `.section-card__form label` block
- `.verify` (small button, muted border) / `.verify--on` (green text + border)
- `.child-section`, `.travel-card` / `.reference-card` (flex space-between, bordered, padding), `.child-form` (bordered, padding, label block), `.inline-form` (flex gap, wrap)
- `.button-link` — an `<a>` styled like a small button

Keep total additions under ~120 lines. No design system.

- [ ] **Step 2: Full verification gate — capture output for the report**

Run each and record exact results:
```bash
npm run typecheck
npm run lint
npm test
npm run build
```
Expected: all pass. Any failure is fixed before continuing (do not proceed with a red gate) or, if genuinely environmental, documented verbatim in the report.

- [ ] **Step 3: Manual runtime smoke (dev)**

Run `npm run dev`. In the browser:
1. Go to **Applicants** → "New applicant" → create "Test Person". It appears in the list with 0% complete / `unverified`.
2. Open it. Edit **Identity** — set surname, given names, DOB (`2000-01-01`), sex. Save. Completeness rises; header per-section chip updates.
3. Click **Confirm** on the surname field. Badge/summary shows 1 verified. Reload the page — still verified.
4. Edit the surname to a new value. Confirm it is no longer marked verified (provenance reconciliation).
5. Add two **Travel Records** and two **References** (different kinds). Edit one, delete one of each.
6. **Duplicate** the applicant. The copy is `Test Person (copy)`, has the data, and its verified marks are cleared.
7. **Search** "test" → both rows; "person (copy)" → one row.
8. Delete the copy, then the original. List returns to empty (or prior state).
9. Restart `npm run dev`. Confirm the remaining applicant + sections + travel + references persisted.

Record pass/fail per numbered item. No portal, no browser automation, no network beyond `127.0.0.1`.

- [ ] **Step 4: Confirm no PII leaks**

With the dev server running and an applicant that has a passport number / DOB / email:
```bash
# in another shell, hit the list endpoint and grep for sensitive values
curl -s http://127.0.0.1:5174/api/applicants | grep -Ei "1990|passportnumber|dateofbirth|@" || echo "list response clean"
```
Then check the server log output (the terminal running `dev:server`) for any passport number / DOB / email string. Expected: the list response contains only `passportNumberLast4` and no DOB/email; the log shows `[REDACTED]` (or nothing) for those keys. Record the result.

- [ ] **Step 5: Write `docs/PHASE-2-REPORT.md`**

Sections:
1. **What was implemented** — the 8-table schema, the service, the API, the frontend, provenance model.
2. **Files changed** — from `git diff --stat <phase-2-first-commit>^..HEAD`.
3. **Tests executed** — list every new/changed test file + its count; total suite count before/after.
4. **Test results** — paste the Step 2 gate output.
5. **Manual smoke results** — the Step 3 checklist with pass/fail; the Step 4 PII check.
6. **Spec §13 acceptance checklist** — every box with evidence (test name / smoke step / file).
7. **Remaining limitations** — `listApplicants` does an N+1 detail read (fine at this scale); travel/reference fields are not individually verifiable in the UI (only 1:1 section fields); no encryption at rest; provenance is single-current-row (no history); cross-field issues are warnings not blocks.
8. **Recommended next phase** — Phase 3: passport document upload + local MRZ/OCR extraction writing `applicant_field_meta` rows (`source='passport_mrz'`, numeric `confidence`, `raw_value`), `verified=0`, then a review-and-verify flow in the applicant detail UI.

- [ ] **Step 6: Update `README.md` and `docs/ARCHITECTURE.md`**

- `README.md` "Using it" section: add a short "**Applicants**" paragraph — create an applicant, fill the identity/passport/contact/address sections, add travel records and references, confirm fields to mark them verified, duplicate or delete.
- `docs/ARCHITECTURE.md`: in the source-layout / data-model areas, add one line noting migration 2 adds the applicant tables and `src/server/services/applicantService.ts` + `src/shared/applicant/` hold the domain, with per-field provenance in `applicant_field_meta` kept separate from canonical data.

- [ ] **Step 7: Review the diff**

Run: `git log --oneline` and `git diff --stat <phase-2-first-commit>^..HEAD`.
Confirm: no `console.log`, no committed `.env` / `data/` / `dist/`, no OCR / browser-automation / portal-specific code, no dependency added (`git diff <base> -- package.json` shows no new deps).

- [ ] **Step 8: Commit**

```bash
git add src/web/src/styles.css docs/PHASE-2-REPORT.md README.md docs/ARCHITECTURE.md
git commit -m "docs: Phase 2 styling, end-of-phase report, README + architecture notes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkxGjRY61KfAPEdw5KHJWq"
```

- [ ] **Step 9: Present the report and STOP**

Present the spec §13 acceptance checklist with evidence, the gate results, the manual smoke results, files changed, and the recommended next phase. Do not start Phase 3.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §1 in-scope: CRUD | T6, T10 |
| §1: duplicate | T9, T10 |
| §1: list + search | T6 (search in listApplicants), T10 |
| §1: view detail | T6 (getApplicantDetail), T10, T13 |
| §1: separated sections (identity/passport/contact/address/travel/references) | T1 (schema), T6, T7 |
| §1: per-field provenance & verification (separate table) | T1, T3, T8 |
| §1: computed completeness + verification | T5, T6 (attached in assembleDetail) |
| §1: nullable everywhere | T1 (schema), T4 (schemas), T6 (empty satellites) |
| §1: shared Zod validation | T3, T4 |
| §1: frontend screens | T12, T13, T14 |
| §1: tests (DB, service, validation, routes, web, persistence) | T1, T3–T14 (each task's test) |
| §2: PII never logged | T2 (redaction), T10/T11 (sanitized errors), T6 (summary omits) |
| §2: no new dependency | Global Constraints + T15 Step 7 check |
| §3.1 shape | T1, T6 |
| §3.2 code layout | file structure + every task's Files block |
| §4 data model (8 tables, cascade, indexes, UNIQUE) | T1 |
| §5 provenance rules (source enum, confidence null-for-manual, OCR never verified, raw_value sensitive, correction reconciliation, uniqueness) | T3, T4, T8 |
| §6 computed values (completeness = mean of 6; verification total = non-null fields; label transitions; warnings) | T5 |
| §7 API (every endpoint, ApplicantSummary shape, search fields, field-meta upsert refusing bad source/confidence) | T10, T11 |
| §8 duplicate semantics (rename, status draft, deep copy, verified reset, id remap, one transaction) | T9 |
| §9 validation (section schemas nullable, date regex, email lenient, kind default, fieldMeta refinement, cross-field = warnings) | T4, T5 (warnings) |
| §10 frontend (route group, nav, ApplicantsPage, ApplicantDetailPage, SectionCard verify toggle, travel/reference add-edit-delete, client omits raw_value in list) | T12, T13, T14 |
| §11 security (redaction paths, sanitized errors report path not value, summary omits, no encryption) | T2, T10 (test asserts path-not-value), T6, T15 Step 4 |
| §12 testing strategy (every row) | T1, T3–T14 tests; T15 manual smoke |
| §13 acceptance checklist | T15 Step 5 |
| §14 end-of-phase report | T15 Step 5 |

No gaps found.

**2. Placeholder scan**

- Styling (T15 Step 1) describes specific selectors + colours to add rather than
  a full stylesheet — acceptable (cosmetic; no test asserts exact CSS), and it is
  concrete about every class and value.
- `ApplicantDetailPage` (T13) and `main.tsx` (T12) reference `TravelSection` /
  `ReferenceSection` / `ApplicantDetailPage` before Task 14/13 — each is handled
  with an explicit one-line stub in the same step that introduces the reference,
  and replaced in the named later task. Not a "similar to Task N" placeholder —
  the stub code is given verbatim.
- No "TBD"/"TODO"/"add error handling"/"write tests for the above" — every test
  and implementation block contains real code.

**3. Type consistency**

- `FieldSource` union (T3 types) === `FIELD_SOURCES` tuple (T3 fieldPaths) ===
  `FIELD_SOURCE_LABELS` keys (T12) — all six values, same spelling.
- `SectionKey` = `'identity'|'passport'|'contact'|'address'|'travel'|'references'`
  used identically in T3, T5 (`computeCompleteness`/`computeVerification` return
  `Record<SectionKey, …>`), T13 (`CompletenessHeader` `SECTION_LABELS`).
- `ApplicantDetail` shape (T3) — `assembleDetail` (T6) returns exactly these keys
  (`identity, passport, contact, address, travel, references, fieldMeta,
  completeness, verification, warnings` + the `Applicant` root fields); the route
  (T10) returns `{ applicant }`; the web client (T12) types it as
  `ApplicantDetail`; the detail test (T13) mocks the same shape.
- `readSection` / `writeSection` (T6 `applicantColumns.ts`) signatures — used with
  matching args in `applicantService.ts` (T6, T8) and nowhere else.
- `upsertFieldMeta(db, applicantId, input: FieldMetaInput)` (T8) — the route (T11)
  calls it with exactly `(app.db, req.params.id, parsed.data)`; the service test
  (T8) and web client `setFieldMeta` (T12) agree on the `{ fieldPath, source?,
  confidence?, rawValue?, verified? }` input.
- `addTravel/updateTravel/deleteTravel` + reference equivalents (T7) — route (T11)
  and web client (T12) and `TravelSection`/`ReferenceSection` (T14) all use the
  same names and `(applicantId, [childId,] input)` argument order.
- `duplicateApplicant(db, id): ApplicantDetail | null` (T9) — route (T10) maps
  `null → 404`, value → `201 { applicant }`; web `duplicateApplicant(id)` (T12)
  returns `{ applicant: ApplicantDetail }`.
- `computeCompleteness` return `{ overall, bySection }` and `computeVerification`
  return `{ verified, total, ratio, label, bySection }` (T5) match the
  `Completeness` / `VerificationSummary` interfaces (T3) and the `ApplicantSummary`
  narrowing in `listApplicants` (T6: `completeness: { overall }`,
  `verification: { label }`).

Fixes applied during review: none required.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-02-phase-2-applicant-profile.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
