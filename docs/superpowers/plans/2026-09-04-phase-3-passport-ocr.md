# Phase 3 — Passport OCR & Document Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an uploaded passport image / single-image PDF into structured applicant-profile fields — each with a source, a heuristic confidence score, a link back to its document, and `verified = false` until a human confirms it — via a strictly staged local pipeline (MRZ parsing authoritative, tesseract.js as text-from-pixels fallback).

**Architecture:** A migration adds `documents`, `extraction_runs`, `document_fields` and `applicant_field_meta.document_id`. Pure, dependency-free MRZ (`src/shared/mrz/`) and document (`src/shared/documents/`) modules do check digits, TD3 parsing, MRZ detection, normalization, classification, confidence scoring, OCR-fallback field extraction, and applicant-field mapping. `src/server/documents/` adds file sniffing, filesystem storage, a `pdfjs-dist` single-image extractor, an `OcrEngine` interface with a vendored-model `tesseract.js` implementation, a thin pipeline orchestrator, the profile-application rules, and the DB service. Fastify routes (multipart upload) validate → service → sanitized envelope. React adds a `/documents` route group and a per-field review/verify UI; the applicant detail page gains a Documents subsection and provenance hints.

**Tech Stack:** TypeScript (ESM, NodeNext server / Bundler web), Node 24, Fastify 5 + `@fastify/multipart` 9, `node:sqlite` `DatabaseSync`, Zod 3, Pino, `tesseract.js`, `pdfjs-dist` (legacy build), React 18, React Router 6, Vite 5, Vitest 3, ESLint 9.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-09-04-phase-3-passport-ocr-design.md`). Every task's requirements implicitly include this section.

- **Local-first.** Server binds `127.0.0.1` only. `data/` and `.env` gitignored. Stored originals live under `<DATA_DIR>/documents/`, served only from the loopback server, never transmitted.
- **No network anywhere in the extraction path.** tesseract.js uses vendored local file paths only; pdfjs runs with `isEvalSupported: false`, no `standardFontDataUrl`, worker disabled. No external / cloud OCR API, ever. A test asserts no `node:http`/`node:https`/`fetch`/`undici` import under `src/server/documents/**`, `src/shared/mrz/**`, `src/shared/documents/**`.
- **`tesseract.js` is never responsible for MRZ semantics.** It returns text + per-line confidence only. `src/shared/mrz/td3.ts` is the sole authority for a valid TD3 MRZ's field values.
- **`applied != verified`.** No extraction code path writes `verified = 1` / `verified: true`. A source-grep guard test enforces this over the documents/mrz modules. The only path to `verified = 1` is the existing `PUT /api/applicants/:id/field-meta { fieldPath, verified: true }` (Phase 2), which omits `source` and preserves provenance.
- **`confidence` is a documented application-level heuristic in [0,1]**, not a calibrated probability. Always `NULL` for `manual`/`imported`/`system` sources — never invented for hand-entered data.
- **No document-security bypass.** Encrypted / password PDF → rejected, no password attempt. No e-passport NFC/chip reading. No decoding of any machine-readable security feature other than the MRZ.
- **Synthetic / SPECIMEN test documents only.** No real passport, no real person, in fixtures or tests.
- **No native addon** (WDAC Enforced — Phase 0 Amendment 01). New deps must be pure JS / WASM.
- **Personal / passport data is sensitive.** Never logged, never in error messages, never in list responses. Errors carry stable codes, not content.
- **Canonical data and provenance are separate stores.** `applicant_field_meta` / `document_fields` are never the primary storage for a value.
- TS strict, `noUncheckedIndexedAccess`. `npm run typecheck` (×4), `npm run lint`, `npm test`, `npm run build` all pass at the end of every task (or the failure is documented in the task report).
- Branch: `phase-0-portal-settings` (established multi-phase branch). Commit trailer:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KEBRLEQyErZX3ABjvh7ua2
  ```

---

## File structure

### Created

| File | Responsibility |
|---|---|
| `src/shared/mrz/types.ts` | MRZ result types (`Td3Result`, `Td3Field`, `DetectedMrz`, `OcrLine`) |
| `src/shared/mrz/checkDigit.ts` | ICAO 9303 char values + `computeCheckDigit` + `verifyCheckDigit` |
| `src/shared/mrz/td3.ts` | authoritative TD3 (2×44) parser: fields + per-field & composite check digits + `overallValid` |
| `src/shared/mrz/detect.ts` | find the 2 candidate TD3 lines in OCR output (shape heuristics only) |
| `src/shared/mrz/normalize.ts` | raw MRZ → canonical (ISO date w/ century window, sex, country, doc number, name split) |
| `src/shared/mrz/index.ts` | barrel |
| `src/shared/documents/types.ts` | `DocumentKind`, `DocumentStatus`, `ExtractionMethod`, `ExtractedField`, `ExtractionOutcome`, `DocumentSummary`, `DocumentDetail`, DTOs |
| `src/shared/documents/fieldMap.ts` | extracted key → applicant `field_path` + section; `mapExtractedKey` |
| `src/shared/documents/confidence.ts` | pure heuristic scoring (spec §8) + module doc-comment defining the semantics |
| `src/shared/documents/classify.ts` | `classifyDocument` → `{ kind, confidence }` |
| `src/shared/documents/ocrFieldExtract.ts` | label/pattern extraction of passport fields from OCR text (fallback only) |
| `src/shared/documents/schemas.ts` | Zod: upload metadata, `fieldPathBody` |
| `src/shared/documents/index.ts` | barrel |
| `src/server/documents/fileType.ts` | magic-byte sniff (JPEG/PNG/PDF) + size cap |
| `src/server/documents/storage.ts` | write/read/delete originals under `env.DOCUMENTS_DIR`, path-containment guard |
| `src/server/documents/ocrEngine.ts` | `OcrEngine` interface + `OcrResult` type |
| `src/server/documents/tesseractEngine.ts` | real `tesseract.js` impl, vendored model, lazy worker, `dispose()` |
| `src/server/documents/pdfImage.ts` | `pdfjs-dist` single-image (DCTDecode) extractor; encryption → reject |
| `src/server/documents/extractionPipeline.ts` | thin orchestrator: prep → OCR → detect → parse → (fallback) → normalize → score → map → `ExtractionOutcome` |
| `src/server/documents/documentApply.ts` | the spec §10 case table: auto-apply / hold / provenance |
| `src/server/documents/documentService.ts` | DB: create, extract (runs), get, list, applyHeldField, dismissField, deleteDocument |
| `src/server/routes/documents.ts` | REST endpoints (multipart upload) |
| `src/web/src/pages/Documents/DocumentsPage.tsx` | `/documents` — list + upload |
| `src/web/src/pages/Documents/DocumentDetailPage.tsx` | `/documents/:id` — review & verify UI |
| `src/web/src/pages/Documents/ExtractedFieldsTable.tsx` | the per-field table (value/source/confidence/status/actions) |
| `vendor/tessdata/eng.traineddata` | vendored OCR model (~2 MB, `tessdata_fast`) |
| `vendor/tessdata/README.md` | model source URL + SHA-256 + licence |
| `test/helpers/fakeOcrEngine.ts` | `OcrEngine` test double |
| `test/helpers/mrzFixtures.ts` | ICAO specimen + synthetic-BGD TD3 line builders for tests |
| `test/fixtures/documents/*` | synthetic images + PDFs (see Task 14/15) |
| test files per task (see tasks) | |

### Modified

| File | Change |
|---|---|
| `src/server/db/migrations.ts` | + migration 3; `LATEST_SCHEMA_VERSION` → 3 |
| `src/server/env.ts` | + `DOCUMENTS_DIR` |
| `src/server/logger.ts` | + document/OCR PII keys in `REDACT_PATHS` |
| `src/server/app.ts` | register `@fastify/multipart` + `registerDocumentRoutes`; construct/inject `OcrEngine`; dispose on close |
| `src/server/index.ts` | pass the real `tesseractEngine` to `buildServer` |
| `src/server/fastify.d.ts` | + `ocr: OcrEngine` on `FastifyInstance` |
| `src/server/services/applicantService.ts` | `duplicateApplicant` clones field-meta with `document_id = NULL` |
| `src/web/src/api/client.ts` | `FormData` bodies skip JSON content-type; + document methods |
| `src/web/src/App.tsx` | + "Documents" nav link |
| `src/web/src/main.tsx` | + `/documents` and `/documents/:id` routes |
| `src/web/src/pages/Applicants/ApplicantDetailPage.tsx` | + Documents subsection |
| `src/web/src/pages/Applicants/SectionCard.tsx` | + provenance hint line for non-manual fields |
| `src/web/src/styles.css` | document pages + review table styles |
| `.gitignore` | `!vendor/`, `!vendor/tessdata/`, `!vendor/tessdata/*` |
| `package.json` | + `tesseract.js`, `pdfjs-dist`, `@fastify/multipart`; + dev `form-data` |
| `docs/PHASE-3-REPORT.md` | new (Task 19) |
| `docs/ARCHITECTURE.md` | one paragraph on the document subsystem (Task 19) |

---

## Task list

1. Migration 3 — `documents` / `extraction_runs` / `document_fields` / `applicant_field_meta.document_id` + `DOCUMENTS_DIR`
2. Logger redaction for document / OCR PII
3. MRZ check digits (`checkDigit.ts`, `types.ts`)
4. MRZ TD3 parser + detection (`td3.ts`, `detect.ts`)
5. MRZ normalization + barrel (`normalize.ts`, `index.ts`)
6. Shared document types + applicant-field map (`types.ts`, `fieldMap.ts`)
7. Confidence scoring + classification (`confidence.ts`, `classify.ts`)
8. OCR-fallback field extraction + schemas + barrel (`ocrFieldExtract.ts`, `schemas.ts`, `index.ts`)
9. File-type sniff + storage (`fileType.ts`, `storage.ts`)
10. OCR engine interface + FakeOcrEngine + PDF single-image extractor + deps (`ocrEngine.ts`, `pdfImage.ts`, `test/helpers/fakeOcrEngine.ts`)
11. Tesseract engine + vendored model (`tesseractEngine.ts`, `vendor/tessdata/`)
12. Extraction pipeline orchestrator (`extractionPipeline.ts`)
13. Profile-application rules (`documentApply.ts`)
14. Document service (`documentService.ts`) + `duplicateApplicant` patch
15. REST routes + multipart wiring + no-network / no-verify guard tests (`routes/documents.ts`, `app.ts`)
16. Web — API client + `DocumentsPage`
17. Web — `DocumentDetailPage` + `ExtractedFieldsTable` (the review UI)
18. Web — `ApplicantDetailPage` Documents subsection + `SectionCard` provenance hint
19. `docs/PHASE-3-REPORT.md` + `ARCHITECTURE.md` paragraph + acceptance walkthrough

---

### Task 1: Migration 3 — document tables + `DOCUMENTS_DIR`

**Files:**
- Modify: `src/server/db/migrations.ts` (append migration `version: 3`; `LATEST_SCHEMA_VERSION` auto-derives)
- Modify: `src/server/env.ts:25-30` (add `DOCUMENTS_DIR`)
- Test: `test/server/documentMigrations.test.ts` (create)
- Test: `test/server/migrations.test.ts` (modify — `LATEST_SCHEMA_VERSION` assertion → 3)

**Interfaces:**
- Consumes: `runMigrations(db)`, `openDatabase(path)` (`src/server/db/connection.ts`), `makeTempDbPath` / `cleanupTempDb` (`test/helpers/tempDb.ts`), the existing `migrations` array + `PRAGMA user_version` mechanism.
- Produces: SQLite schema v3. Later tasks rely on these exact table/column names:
  - `documents(id, applicant_id, kind, classification_confidence, original_name, mime_type, byte_size, sha256, storage_path, status, latest_extraction_method, latest_ocr_mean_confidence, page_count, error_code, created_at, updated_at)`
  - `extraction_runs(id, document_id, attempt, method, status, mrz_detected, mrz_valid, ocr_mean_confidence, field_count, error_code, engine_detail, created_at)`
  - `document_fields(id, document_id, extraction_run_id, field_path, value, raw_value, source, confidence, check_digit_ok, status, normalization_note, created_at, updated_at)`
  - `applicant_field_meta.document_id` (nullable, `REFERENCES documents(id) ON DELETE SET NULL`)
  - `env.DOCUMENTS_DIR` = `path.join(dataDir, 'documents')`

- [ ] **Step 1: Write the failing test `test/server/documentMigrations.test.ts`**

Follow the shape of `test/server/applicantMigrations.test.ts` (open a temp DB, `runMigrations`, introspect). Cover:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations, LATEST_SCHEMA_VERSION } from '../../src/server/db/migrations.js';
import { makeTempDbPath, cleanupTempDb } from '../helpers/tempDb.js';

describe('migration 3 — document tables', () => {
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

  const cols = (t: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((r) => r.name);

  it('bumps the schema version to 3', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(3);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
  });

  it('creates documents with the expected columns', () => {
    expect(cols('documents').sort()).toEqual(
      [
        'applicant_id', 'byte_size', 'classification_confidence', 'created_at', 'error_code',
        'id', 'kind', 'latest_extraction_method', 'latest_ocr_mean_confidence', 'mime_type',
        'original_name', 'page_count', 'sha256', 'status', 'storage_path', 'updated_at',
      ].sort(),
    );
  });

  it('creates extraction_runs and document_fields', () => {
    expect(cols('extraction_runs')).toContain('attempt');
    expect(cols('extraction_runs')).toContain('mrz_valid');
    expect(cols('extraction_runs')).toContain('engine_detail');
    expect(cols('document_fields')).toContain('extraction_run_id');
    expect(cols('document_fields')).toContain('check_digit_ok');
    expect(cols('document_fields')).toContain('normalization_note');
  });

  it('adds applicant_field_meta.document_id', () => {
    expect(cols('applicant_field_meta')).toContain('document_id');
  });

  it('enforces documents.kind and documents.mime_type CHECK constraints', () => {
    const ins = () =>
      db.prepare(
        `INSERT INTO documents (id, kind, mime_type, byte_size, sha256, storage_path, status, created_at, updated_at)
         VALUES ('d1', 'passport-photo', 'image/gif', 1, 'x', 'p', 'uploaded', 't', 't')`,
      ).run();
    expect(ins).toThrow();
  });

  it('cascades documents → extraction_runs → document_fields on delete', () => {
    db.exec("PRAGMA foreign_keys = ON");
    const now = 't';
    db.prepare(
      `INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO documents (id, applicant_id, kind, mime_type, byte_size, sha256, storage_path, status, created_at, updated_at)
       VALUES ('d1','a1','passport','image/jpeg',10,'h','d1/original.jpg','uploaded',?,?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO extraction_runs (id, document_id, attempt, method, status, created_at) VALUES ('r1','d1',1,'mrz','completed',?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO document_fields (id, document_id, extraction_run_id, field_path, source, confidence, status, created_at, updated_at)
       VALUES ('f1','d1','r1','passport.number','passport_mrz',0.99,'proposed',?,?)`,
    ).run(now, now);
    db.prepare(`DELETE FROM documents WHERE id = 'd1'`).run();
    expect(db.prepare(`SELECT count(*) c FROM extraction_runs`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM document_fields`).get()).toEqual({ c: 0 });
  });

  it('nulls applicant_field_meta.document_id when the document is deleted (ON DELETE SET NULL)', () => {
    db.exec('PRAGMA foreign_keys = ON');
    const now = 't';
    db.prepare(`INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`).run(now, now);
    db.prepare(
      `INSERT INTO documents (id, applicant_id, kind, mime_type, byte_size, sha256, storage_path, status, created_at, updated_at)
       VALUES ('d1','a1','passport','image/jpeg',10,'h','d1/o.jpg','uploaded',?,?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO applicant_field_meta (id, applicant_id, field_path, source, verified, document_id, created_at, updated_at)
       VALUES ('m1','a1','passport.number','passport_mrz',0,'d1',?,?)`,
    ).run(now, now);
    db.prepare(`DELETE FROM documents WHERE id = 'd1'`).run();
    const meta = db.prepare(`SELECT document_id FROM applicant_field_meta WHERE id = 'm1'`).get();
    expect(meta).toEqual({ document_id: null });
  });

  it('a v2 database upgrades to v3 without data loss', () => {
    // fresh temp db, run only migrations 1..2 by faking user_version, then full runMigrations
    const p2 = makeTempDbPath();
    const d2 = openDatabase(p2);
    d2.exec('PRAGMA user_version = 0');
    runMigrations(d2); // goes straight to 3 — proxy check: a pre-existing applicant survives
    d2.prepare(`INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft','t','t')`).run();
    d2.close();
    const d3 = openDatabase(p2);
    runMigrations(d3);
    expect(d3.prepare(`SELECT display_name FROM applicants WHERE id='a1'`).get()).toEqual({ display_name: 'A' });
    d3.close();
    cleanupTempDb(p2);
  });
});
```

Also update `test/server/migrations.test.ts`: any assertion that `LATEST_SCHEMA_VERSION` is `2` (or that the migrations array length is 2) becomes `3`. Grep the file first; change only the version-count assertions, nothing else.

- [ ] **Step 2: Run the tests — verify they fail**

```
npx vitest run test/server/documentMigrations.test.ts test/server/migrations.test.ts
```
Expected: `documentMigrations` fails (`no such table: documents`), `migrations` fails on the version assertion.

- [ ] **Step 3: Add migration 3 to `src/server/db/migrations.ts`**

Append to the `migrations` array (after `version: 2`):

```ts
  {
    version: 3,
    up: `
      CREATE TABLE documents (
        id                         TEXT PRIMARY KEY,
        applicant_id               TEXT REFERENCES applicants(id) ON DELETE CASCADE,
        kind                       TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('passport','unknown')),
        classification_confidence  REAL,
        original_name              TEXT,
        mime_type                  TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
        byte_size                  INTEGER NOT NULL,
        sha256                     TEXT NOT NULL,
        storage_path               TEXT NOT NULL,
        status                     TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','extracted','failed')),
        latest_extraction_method   TEXT CHECK (latest_extraction_method IN ('mrz','ocr','mrz_ocr') OR latest_extraction_method IS NULL),
        latest_ocr_mean_confidence REAL,
        page_count                 INTEGER,
        error_code                 TEXT,
        created_at                 TEXT NOT NULL,
        updated_at                 TEXT NOT NULL
      );
      CREATE INDEX idx_documents_applicant ON documents(applicant_id);

      CREATE TABLE extraction_runs (
        id                  TEXT PRIMARY KEY,
        document_id         TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        attempt             INTEGER NOT NULL,
        method              TEXT CHECK (method IN ('mrz','ocr','mrz_ocr') OR method IS NULL),
        status              TEXT NOT NULL CHECK (status IN ('completed','failed')),
        mrz_detected        INTEGER NOT NULL DEFAULT 0 CHECK (mrz_detected IN (0,1)),
        mrz_valid           INTEGER NOT NULL DEFAULT 0 CHECK (mrz_valid IN (0,1)),
        ocr_mean_confidence REAL,
        field_count         INTEGER NOT NULL DEFAULT 0,
        error_code          TEXT,
        engine_detail       TEXT,
        created_at          TEXT NOT NULL,
        UNIQUE (document_id, attempt)
      );
      CREATE INDEX idx_extraction_runs_document ON extraction_runs(document_id);

      CREATE TABLE document_fields (
        id                 TEXT PRIMARY KEY,
        document_id        TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        extraction_run_id  TEXT NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
        field_path         TEXT NOT NULL,
        value              TEXT,
        raw_value          TEXT,
        source             TEXT NOT NULL CHECK (source IN ('passport_mrz','passport_ocr','document_ocr')),
        confidence         REAL NOT NULL,
        check_digit_ok     INTEGER CHECK (check_digit_ok IN (0,1) OR check_digit_ok IS NULL),
        status             TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','applied','held','dismissed')),
        normalization_note TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        UNIQUE (document_id, field_path)
      );
      CREATE INDEX idx_document_fields_document ON document_fields(document_id);

      ALTER TABLE applicant_field_meta ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
    `,
  },
```

`LATEST_SCHEMA_VERSION` is `migrations[migrations.length - 1]!.version` — no manual edit needed.

- [ ] **Step 4: Add `DOCUMENTS_DIR` to `src/server/env.ts`**

In the exported `env` object literal, alongside `DB_PATH` / `SCREENSHOT_DIR`:

```ts
  DOCUMENTS_DIR: path.join(dataDir, 'documents'),
```

- [ ] **Step 5: Run the tests — verify they pass**

```
npx vitest run test/server/documentMigrations.test.ts test/server/migrations.test.ts
```
Expected: PASS.

- [ ] **Step 6: Full regression gate**

```
npm run typecheck && npm run lint && npm test && npm run build
```
Expected: all green; test count = prior + new `documentMigrations` cases.

- [ ] **Step 7: Inspect the diff, then commit**

```
git add src/server/db/migrations.ts src/server/env.ts test/server/documentMigrations.test.ts test/server/migrations.test.ts
git commit -m "$(cat <<'EOF'
feat(db): migration 3 — documents, extraction_runs, document_fields

Adds the Phase 3 document tables and applicant_field_meta.document_id
(ON DELETE SET NULL). extraction_runs.attempt is per-document; document_fields
is one current proposal per (document_id, field_path), each tied to the run
that produced it. + env.DOCUMENTS_DIR.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KEBRLEQyErZX3ABjvh7ua2
EOF
)"
```

**Task 1 report:** implementation summary / files changed / tests added / test results / typecheck / lint / build / security checks (schema only — confirm no PII columns are un-redactable, no new logging) / commit hash / remaining limitations. **Stop for review.**

---

### Task 2: Logger redaction for document / OCR PII

**Files:**
- Modify: `src/server/logger.ts:4-21` (`REDACT_PATHS`)
- Test: `test/server/loggerRedaction.test.ts` (modify — add a Phase 3 block)

**Interfaces:**
- Consumes: `REDACT_PATHS`, `loggerOptions`, the existing capture-stream test pattern.
- Produces: redaction of `ocrText`, `text`, `lines`, `mrzLine`, `mrzLines`, `extractedFields`, `fields`, `documentText` (and `*.` variants where the existing file uses them).

- [ ] **Step 1: Add the failing test block** to `test/server/loggerRedaction.test.ts` — build a logger over a capture stream (copy the existing helper in that file), log an object containing `{ ocrText: 'ERIKSSON<<ANNA', mrzLines: ['P<UTO...'], fields: [{ raw_value: 'L898902C3' }] }`, assert none of those literal strings appear in the captured output and `[REDACTED]` does.

- [ ] **Step 2: Run — verify it fails.** `npx vitest run test/server/loggerRedaction.test.ts`

- [ ] **Step 3: Extend `REDACT_PATHS`** — add a `// Phase 3 — document extraction` group:

```ts
  'ocrText', 'documentText', 'text', 'lines', 'mrzLine', 'mrzLines', 'extractedFields', 'fields',
  '*.ocrText', '*.mrzLine', '*.mrzLines', '*.rawValue', '*.raw_value',
```

(`rawValue`/`raw_value` and `*` variants already present from Phase 2 — do not duplicate; add only what's missing. `text`/`lines`/`fields` are broad but the server logs no benign field with those exact keys — confirm with a grep of `src/server/**` for `log.*\{.*\b(text|lines|fields)\b` before adding; if a benign use exists, scope the path instead.)

- [ ] **Step 4: Run — verify it passes.**

- [ ] **Step 5: Typecheck** (`as const` array change can nudge pino typings): `npm run typecheck`

- [ ] **Step 6: Full gate + commit**

```
git add src/server/logger.ts test/server/loggerRedaction.test.ts
git commit -m "feat(logger): redact OCR/MRZ/extracted-field PII paths  <trailer>"
```

**Task 2 report + stop.**

---

### Task 3: MRZ check digits

**Files:**
- Create: `src/shared/mrz/types.ts`, `src/shared/mrz/checkDigit.ts`
- Test: `test/shared/mrz/checkDigit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface OcrLine { text: string; confidence: number }
  export interface Td3CheckDigit { input: string; expected: number; actual: string; ok: boolean }
  export interface Td3Field { raw: string; checkDigit: Td3CheckDigit | null }
  export interface Td3Result {
    documentCode: string; issuingState: string; surname: string; givenNames: string;
    documentNumber: Td3Field; nationality: string;
    dateOfBirth: Td3Field; sex: string; expiryDate: Td3Field;
    optionalData: Td3Field; composite: Td3CheckDigit; overallValid: boolean;
    line1: string; line2: string;
  }
  export interface DetectedMrz { line1: string; line2: string; lineConfidence: number }
  // checkDigit.ts
  export function charValue(c: string): number            // 0-9→n, A-Z→10-35, '<'→0, else throws RangeError
  export function computeCheckDigit(field: string): number // weights cycle 7,3,1
  export function verifyCheckDigit(field: string, digit: string): boolean // non-numeric digit → false
  ```

- [ ] **Step 1: Write `test/shared/mrz/checkDigit.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { charValue, computeCheckDigit, verifyCheckDigit } from '../../../src/shared/mrz/checkDigit.js';

describe('charValue', () => {
  it('maps digits, letters and filler', () => {
    expect(charValue('0')).toBe(0);
    expect(charValue('9')).toBe(9);
    expect(charValue('A')).toBe(10);
    expect(charValue('Z')).toBe(35);
    expect(charValue('<')).toBe(0);
  });
  it('throws on anything else', () => {
    expect(() => charValue('a')).toThrow();
    expect(() => charValue(' ')).toThrow();
  });
});

describe('computeCheckDigit — ICAO 9303 vectors', () => {
  it('D23145890 → 7', () => expect(computeCheckDigit('D23145890')).toBe(7));
  it('740812 → 2', () => expect(computeCheckDigit('740812')).toBe(2));
  it('120415 → 9', () => expect(computeCheckDigit('120415')).toBe(9));
  it('L898902C3 → 6', () => expect(computeCheckDigit('L898902C3')).toBe(6));
  it('ZE184226B<<<<< → 1', () => expect(computeCheckDigit('ZE184226B<<<<<')).toBe(1));
  it('all-filler → 0', () => expect(computeCheckDigit('<<<<<<<<<<<<<<')).toBe(0));
});

describe('verifyCheckDigit', () => {
  it('accepts the correct digit', () => expect(verifyCheckDigit('740812', '2')).toBe(true));
  it('rejects a wrong digit', () => expect(verifyCheckDigit('740812', '3')).toBe(false));
  it('rejects a non-numeric supplied digit rather than throwing', () => {
    expect(verifyCheckDigit('740812', '<')).toBe(false);
    expect(verifyCheckDigit('740812', 'A')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify it fails.** `npx vitest run test/shared/mrz/checkDigit.test.ts`

- [ ] **Step 3: Implement `src/shared/mrz/types.ts`** (the interfaces above, verbatim) **and `src/shared/mrz/checkDigit.ts`:**

```ts
const WEIGHTS = [7, 3, 1];

export function charValue(c: string): number {
  if (c.length !== 1) throw new RangeError(`expected one char, got ${JSON.stringify(c)}`);
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55; // 'A' → 10
  if (c === '<') return 0;
  throw new RangeError(`invalid MRZ character ${JSON.stringify(c)}`);
}

export function computeCheckDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i += 1) {
    sum += charValue(field[i]!) * WEIGHTS[i % 3]!;
  }
  return sum % 10;
}

export function verifyCheckDigit(field: string, digit: string): boolean {
  if (!/^[0-9]$/.test(digit)) return false;
  return computeCheckDigit(field) === Number(digit);
}
```

- [ ] **Step 4: Run — verify it passes.**

- [ ] **Step 5: Typecheck + lint.** `npm run typecheck && npm run lint`

- [ ] **Step 6: Commit** — `git add src/shared/mrz/types.ts src/shared/mrz/checkDigit.ts test/shared/mrz/checkDigit.test.ts` → `feat(mrz): ICAO 9303 check-digit primitives  <trailer>`

**Task 3 report + stop.**

---

### Task 4: MRZ TD3 parser + detection

**Files:**
- Create: `src/shared/mrz/td3.ts`, `src/shared/mrz/detect.ts`, `test/helpers/mrzFixtures.ts`
- Test: `test/shared/mrz/td3.test.ts`, `test/shared/mrz/detect.test.ts`

**Interfaces:**
- Consumes: `charValue`, `computeCheckDigit`, `verifyCheckDigit`, all `types.ts`.
- Produces:
  ```ts
  export function parseTd3(line1: string, line2: string): Td3Result
  export function detectMrzLines(lines: OcrLine[]): DetectedMrz | null
  // test/helpers/mrzFixtures.ts
  export const ICAO_SPECIMEN: { line1: string; line2: string }  // the public UTO/ERIKSSON specimen
  export function buildTd3(opts): { line1: string; line2: string }  // recomputes all check digits
  ```

**Reference — TD3 layout (0-indexed):** line 1: `[0-1]` doc code, `[2-4]` issuing state, `[5-43]` name (`SURNAME<<GIVEN<NAMES`, `<`-padded). Line 2: `[0-8]` doc number, `[9]` its check, `[10-12]` nationality, `[13-18]` DOB `YYMMDD`, `[19]` its check, `[20]` sex, `[21-26]` expiry `YYMMDD`, `[27]` its check, `[28-41]` optional data, `[42]` its check, `[43]` composite check. Composite input = `line2.slice(0,10) + line2.slice(13,20) + line2.slice(21,43)`. `overallValid` = composite OK **and** doc-number, DOB, expiry checks all OK (optional-data check counts only if the field is non-filler).

- [ ] **Step 1: Write `test/helpers/mrzFixtures.ts`**

```ts
// ICAO Doc 9303 Part 3 public specimen — invented holder "ANNA MARIA ERIKSSON", state "UTO".
export const ICAO_SPECIMEN = {
  line1: 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  line2: 'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
} as const;

import { computeCheckDigit } from '../../src/shared/mrz/checkDigit.js';

interface BuildOpts {
  documentCode?: string;        // default 'P<'
  issuingState?: string;        // default 'BGD'
  surname: string;
  givenNames: string;
  documentNumber: string;       // <=9 chars, will be '<'-padded
  nationality?: string;         // default 'BGD'
  dateOfBirth: string;          // YYMMDD
  sex: 'M' | 'F' | '<';
  expiryDate: string;           // YYMMDD
  optionalData?: string;        // default '' → all filler
}

const pad = (s: string, n: number) => (s + '<'.repeat(n)).slice(0, n);

export function buildTd3(o: BuildOpts): { line1: string; line2: string } {
  const documentCode = pad(o.documentCode ?? 'P<', 2);
  const issuingState = pad(o.issuingState ?? 'BGD', 3);
  const name = pad(`${o.surname.toUpperCase()}<<${o.givenNames.toUpperCase().replace(/ /g, '<')}`, 39);
  const line1 = documentCode + issuingState + name;

  const num = pad(o.documentNumber.toUpperCase(), 9);
  const numCd = String(computeCheckDigit(num));
  const nat = pad(o.nationality ?? 'BGD', 3);
  const dobCd = String(computeCheckDigit(o.dateOfBirth));
  const expCd = String(computeCheckDigit(o.expiryDate));
  const opt = pad(o.optionalData ?? '', 14);
  const optCd = String(computeCheckDigit(opt));
  const beforeComposite = num + numCd + nat + o.dateOfBirth + dobCd + o.sex + o.expiryDate + expCd + opt + optCd;
  const compositeInput = beforeComposite.slice(0, 10) + beforeComposite.slice(13, 20) + beforeComposite.slice(21, 43);
  const compCd = String(computeCheckDigit(compositeInput));
  return { line1, line2: beforeComposite + compCd };
}
```

- [ ] **Step 2: Write `test/shared/mrz/td3.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseTd3 } from '../../../src/shared/mrz/td3.js';
import { ICAO_SPECIMEN, buildTd3 } from '../../helpers/mrzFixtures.js';

describe('parseTd3 — ICAO specimen', () => {
  const r = parseTd3(ICAO_SPECIMEN.line1, ICAO_SPECIMEN.line2);
  it('splits the header', () => {
    expect(r.documentCode).toBe('P');
    expect(r.issuingState).toBe('UTO');
    expect(r.surname).toBe('ERIKSSON');
    expect(r.givenNames).toBe('ANNA MARIA');
  });
  it('reads line 2 fields with their raw values', () => {
    expect(r.documentNumber.raw).toBe('L898902C3');
    expect(r.nationality).toBe('UTO');
    expect(r.dateOfBirth.raw).toBe('740812');
    expect(r.sex).toBe('F');
    expect(r.expiryDate.raw).toBe('120415');
  });
  it('validates every check digit and the composite', () => {
    expect(r.documentNumber.checkDigit?.ok).toBe(true);
    expect(r.dateOfBirth.checkDigit?.ok).toBe(true);
    expect(r.expiryDate.checkDigit?.ok).toBe(true);
    expect(r.composite.ok).toBe(true);
    expect(r.overallValid).toBe(true);
  });
});

describe('parseTd3 — synthetic BGD specimen', () => {
  const built = buildTd3({
    surname: 'RAHMAN', givenNames: 'ABDUL KARIM',
    documentNumber: 'A01234567', dateOfBirth: '900115', sex: 'M', expiryDate: '300114',
  });
  const r = parseTd3(built.line1, built.line2);
  it('round-trips a valid MRZ', () => {
    expect(r.issuingState).toBe('BGD');
    expect(r.nationality).toBe('BGD');
    expect(r.surname).toBe('RAHMAN');
    expect(r.givenNames).toBe('ABDUL KARIM');
    expect(r.documentNumber.raw).toBe('A01234567');
    expect(r.overallValid).toBe(true);
  });
});

describe('parseTd3 — corrupted', () => {
  it('flags a bad document-number check digit but still returns the field', () => {
    const bad = ICAO_SPECIMEN.line2.slice(0, 9) + '9' + ICAO_SPECIMEN.line2.slice(10);
    const r = parseTd3(ICAO_SPECIMEN.line1, bad);
    expect(r.documentNumber.raw).toBe('L898902C3');
    expect(r.documentNumber.checkDigit?.ok).toBe(false);
    expect(r.overallValid).toBe(false);
  });
  it('handles a truncated / short line 2 without throwing', () => {
    const r = parseTd3(ICAO_SPECIMEN.line1, 'L898902C36UTO7408122F');
    expect(r.documentNumber.raw).toBe('L898902C3');
    expect(r.overallValid).toBe(false);
  });
});
```

- [ ] **Step 3: Write `test/shared/mrz/detect.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { detectMrzLines } from '../../../src/shared/mrz/detect.js';
import { ICAO_SPECIMEN } from '../../helpers/mrzFixtures.js';

const line = (text: string, confidence = 90) => ({ text, confidence });

describe('detectMrzLines', () => {
  it('finds the MRZ among page noise', () => {
    const got = detectMrzLines([
      line('REPUBLIC OF ELBONIA'), line('Passport No  A01234567'),
      line(ICAO_SPECIMEN.line1), line(ICAO_SPECIMEN.line2), line('  '),
    ]);
    expect(got?.line1).toBe(ICAO_SPECIMEN.line1);
    expect(got?.line2).toBe(ICAO_SPECIMEN.line2);
  });
  it('tolerates spaces and lowercase from OCR', () => {
    const got = detectMrzLines([
      line(ICAO_SPECIMEN.line1.toLowerCase().replace(/(.{10})/g, '$1 ')),
      line(ICAO_SPECIMEN.line2.toLowerCase()),
    ]);
    expect(got?.line1).toBe(ICAO_SPECIMEN.line1);
  });
  it('returns null when there is no MRZ', () => {
    expect(detectMrzLines([line('Name: John Smith'), line('DOB: 1990-01-01')])).toBeNull();
  });
});
```

- [ ] **Step 4: Run all three — verify they fail.**

- [ ] **Step 5: Implement `src/shared/mrz/td3.ts`**

Parsing rules:
- Normalize each input line: uppercase, remove spaces, right-pad with `<` to 44 (or leave short — slice defensively with `?? ''` and guard `length`).
- `documentCode` = `line1.slice(0,2).replace(/<+$/,'') || line1[0]` → take `line1.slice(0,1)` if the 2nd char is `<`; expose the first letter (`'P'`).
- `issuingState` = `line1.slice(2,5).replace(/<+$/,'')`.
- name field = `line1.slice(5,44)`; split on `/<<+/` → `[sur, given]`; `surname = sur.replace(/</g,' ').trim()`; `givenNames = (given ?? '').split(/<+/).filter(Boolean).join(' ')`.
- line 2 slices per the reference table. Each `Td3Field` = `{ raw: <field, trailing '<' trimmed for documentNumber/optionalData; kept as-is for dates>, checkDigit: {...} | null }`.
  - For `documentNumber`: `raw` is the 9-char slice with trailing `<` **trimmed**; the check digit is computed over the **untrimmed 9-char** slice (ICAO computes over the fixed-width field). Store both: `raw` (trimmed, for display/normalize) and compute check over `line2.slice(0,9)`.
  - `dateOfBirth.raw` / `expiryDate.raw` = the 6-char slice as-is.
  - `optionalData.raw` = slice(28,42) trailing-`<`-trimmed; `checkDigit` computed over slice(28,42); if the field is all `<`, still compute (`computeCheckDigit` of all-filler = 0) and set `ok` against `line2[42]` (often `<` or `0`) — treat a supplied `<` as `0` for the compare (i.e. `verifyCheckDigit` returns false for `<`, so special-case: if field is all-filler and digit is `<`, `ok = true`).
- `composite.input` = `line2.slice(0,10) + line2.slice(13,20) + line2.slice(21,43)`; `expected = computeCheckDigit(input)`; `actual = line2[43] ?? ''`; `ok = /^[0-9]$/.test(actual) && Number(actual) === expected`.
- `overallValid` = `composite.ok && documentNumber.checkDigit?.ok && dateOfBirth.checkDigit?.ok && expiryDate.checkDigit?.ok` (all truthy).
- Never throw on a short/garbled line — every slice guarded, `checkDigit.ok = false` on any parse problem.

- [ ] **Step 6: Implement `src/shared/mrz/detect.ts`**

```ts
import type { DetectedMrz, OcrLine } from './types.js';

const clean = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '');
const looksLikeMrz = (s: string) => {
  const c = clean(s);
  return c.length >= 40 && c.length <= 46 && /^[A-Z0-9<]+$/.test(c) && (c.match(/</g)?.length ?? 0) >= 3;
};

export function detectMrzLines(lines: OcrLine[]): DetectedMrz | null {
  for (let i = 0; i < lines.length - 1; i += 1) {
    const a = lines[i]!, b = lines[i + 1]!;
    if (looksLikeMrz(a.text) && looksLikeMrz(b.text)) {
      const pad = (s: string) => (clean(s) + '<'.repeat(44)).slice(0, 44);
      return {
        line1: pad(a.text),
        line2: pad(b.text),
        lineConfidence: (a.confidence + b.confidence) / 2,
      };
    }
  }
  return null;
}
```

- [ ] **Step 7: Run all three — verify they pass. Typecheck + lint.**

- [ ] **Step 8: Commit** — `feat(mrz): authoritative TD3 parser + MRZ line detection  <trailer>`

**Task 4 report + stop.**

---

### Task 5: MRZ normalization + barrel

**Files:**
- Create: `src/shared/mrz/normalize.ts`, `src/shared/mrz/index.ts`
- Test: `test/shared/mrz/normalize.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function normalizeMrzDate(yymmdd: string, kind: 'birth' | 'expiry', ref?: Date): string | null
  export function normalizeSex(raw: string): 'M' | 'F' | 'X'
  export function normalizeCountry(alpha3: string): string          // known → name; else the raw code
  export function normalizeDocNumber(raw: string): string
  export function splitName(surname: string, givenNames: string): { surname: string | null; givenNames: string | null }
  export const COUNTRY_NAMES: Readonly<Record<string, string>>       // BGD, IND, + common issuers
  // index.ts re-exports checkDigit, td3, detect, normalize, types
  ```

- [ ] **Step 1: Write `test/shared/mrz/normalize.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeMrzDate, normalizeSex, normalizeCountry, normalizeDocNumber } from '../../../src/shared/mrz/normalize.js';

const REF = new Date('2026-09-04T00:00:00Z');

describe('normalizeMrzDate', () => {
  it('birth date in the plausible past', () => {
    expect(normalizeMrzDate('900115', 'birth', REF)).toBe('1990-01-15');
    expect(normalizeMrzDate('010101', 'birth', REF)).toBe('2001-01-01');
  });
  it('a 2-digit birth year that would be in the future rolls back a century', () => {
    expect(normalizeMrzDate('271231', 'birth', REF)).toBe('1927-12-31');
  });
  it('expiry date within the forward window', () => {
    expect(normalizeMrzDate('300114', 'expiry', REF)).toBe('2030-01-14');
  });
  it('rejects an impossible calendar date', () => {
    expect(normalizeMrzDate('900230', 'birth', REF)).toBeNull();
    expect(normalizeMrzDate('901301', 'birth', REF)).toBeNull();
    expect(normalizeMrzDate('<<<<<<', 'birth', REF)).toBeNull();
  });
});

describe('normalizeSex', () => {
  it('maps the MRZ codes', () => {
    expect(normalizeSex('M')).toBe('M');
    expect(normalizeSex('F')).toBe('F');
    expect(normalizeSex('<')).toBe('X');
    expect(normalizeSex('')).toBe('X');
  });
});

describe('normalizeCountry', () => {
  it('names the ones we know', () => {
    expect(normalizeCountry('BGD')).toBe('Bangladesh');
    expect(normalizeCountry('IND')).toBe('India');
  });
  it('passes an unknown code straight through — never guesses', () => {
    expect(normalizeCountry('UTO')).toBe('UTO');
    expect(normalizeCountry('D')).toBe('D');
  });
});

describe('normalizeDocNumber', () => {
  it('trims filler and uppercases', () => {
    expect(normalizeDocNumber('a012345<<')).toBe('A012345');
  });
});
```

- [ ] **Step 2: Run — fail. Step 3: Implement.**

`normalizeMrzDate`: reject if not `/^\d{6}$/`. `yy=+slice(0,2)`, `mm`, `dd`. `birth`: `year = 2000 + yy; if (year > ref.getUTCFullYear()) year -= 100`. `expiry`: `year = 2000 + yy; if (year < ref.getUTCFullYear() - 10) year += 100`. Build `new Date(Date.UTC(year, mm-1, dd))`; verify round-trip (`getUTCMonth()===mm-1 && getUTCDate()===dd`) — else `null`. Return `YYYY-MM-DD`.

`COUNTRY_NAMES`: at minimum `BGD:'Bangladesh', IND:'India', NPL:'Nepal', LKA:'Sri Lanka', PAK:'Pakistan', USA:'United States', GBR:'United Kingdom', CAN:'Canada', AUS:'Australia', ARE:'United Arab Emirates', SAU:'Saudi Arabia', MYS:'Malaysia', SGP:'Singapore', CHN:'China', THA:'Thailand'`. Comment: this is a convenience label only; unknown codes pass through verbatim so nothing is fabricated.

`index.ts`: `export * from './checkDigit.js'` etc. (verify no name collision — `types.ts` has only interfaces).

- [ ] **Step 4: pass. Step 5: typecheck + lint. Step 6: commit** — `feat(mrz): value normalization (date century window, sex, country, number)  <trailer>`

**Task 5 report + stop.**

---

### Task 6: Shared document types + applicant-field map

**Files:**
- Create: `src/shared/documents/types.ts`, `src/shared/documents/fieldMap.ts`
- Test: `test/shared/documents/fieldMap.test.ts`

**Interfaces:**
- Consumes: `isValidFieldPath` (`src/shared/applicant/fieldPaths.ts`), `Td3Result` (mrz types), `FieldSource` (`src/shared/applicant/types.ts`).
- Produces:
  ```ts
  // types.ts
  export type DocumentKind = 'passport' | 'unknown';
  export type DocumentStatus = 'uploaded' | 'extracted' | 'failed';
  export type ExtractionMethod = 'mrz' | 'ocr' | 'mrz_ocr';
  export type DocumentFieldStatus = 'proposed' | 'applied' | 'held' | 'dismissed';
  export type ExtractionSource = 'passport_mrz' | 'passport_ocr' | 'document_ocr';
  export interface ExtractedField {
    fieldPath: string; value: string | null; raw: string | null;
    source: ExtractionSource; confidence: number;
    checkDigitOk: boolean | null; normalizationNote: string | null;
  }
  export interface ExtractionOutcome {
    kind: DocumentKind; classificationConfidence: number;
    method: ExtractionMethod; mrzDetected: boolean; mrzValid: boolean;
    ocrMeanConfidence: number | null; fields: ExtractedField[]; warnings: string[];
  }
  export interface DocumentExtractedFieldView extends ExtractedField {
    id: string; status: DocumentFieldStatus; extractionRunId: string;
    inProfile: boolean; verified: boolean;
  }
  export interface ExtractionRunView {
    id: string; attempt: number; method: ExtractionMethod | null;
    status: 'completed' | 'failed'; mrzDetected: boolean; mrzValid: boolean;
    ocrMeanConfidence: number | null; fieldCount: number; errorCode: string | null;
    engineDetail: string | null; createdAt: string;
  }
  export interface DocumentSummary {
    id: string; applicantId: string | null; kind: DocumentKind;
    originalName: string | null; mimeType: string; status: DocumentStatus;
    runCount: number; fieldCount: number; createdAt: string; updatedAt: string;
  }
  export interface DocumentDetail extends DocumentSummary {
    classificationConfidence: number | null;
    latestExtractionMethod: ExtractionMethod | null;
    latestOcrMeanConfidence: number | null; pageCount: number | null;
    errorCode: string | null; byteSize: number;
    runs: ExtractionRunView[]; fields: DocumentExtractedFieldView[];
  }
  // fieldMap.ts
  export type MrzFieldKey =
    | 'documentType' | 'documentNumber' | 'issuingState' | 'expiryDate'
    | 'surname' | 'givenNames' | 'nationality' | 'dateOfBirth' | 'sex';
  export type OcrFieldKey = 'placeOfIssue' | 'issueDate' | 'fullName';
  export interface FieldTarget { fieldPath: string; section: 'identity' | 'passport' }
  export const MRZ_FIELD_MAP: Readonly<Record<MrzFieldKey, FieldTarget>>;
  export const OCR_FIELD_MAP: Readonly<Record<OcrFieldKey, FieldTarget>>;
  export function mapMrzResult(r: Td3Result, ref?: Date): ExtractedField[]  // MRZ → normalized + scored ExtractedField[]
  ```
  (`mapMrzResult` normalizes + scores here so the pipeline stays thin. It imports `normalize*` from mrz and `scoreMrzField` from `confidence.ts` — **so Task 6 depends on Task 7's `confidence.ts` being present**; reorder if executing strictly: do Task 7 before Task 6, or split `mapMrzResult` into Task 7. **Decision: move `mapMrzResult` to Task 7; Task 6 ships only the maps + types.**)

- [ ] **Step 1: Write `test/shared/documents/fieldMap.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { MRZ_FIELD_MAP, OCR_FIELD_MAP } from '../../../src/shared/documents/fieldMap.js';
import { isValidFieldPath } from '../../../src/shared/applicant/fieldPaths.js';

describe('field maps', () => {
  it('every MRZ target is a valid applicant field path', () => {
    for (const t of Object.values(MRZ_FIELD_MAP)) expect(isValidFieldPath(t.fieldPath)).toBe(true);
  });
  it('maps the expected MRZ keys', () => {
    expect(MRZ_FIELD_MAP.documentNumber.fieldPath).toBe('passport.number');
    expect(MRZ_FIELD_MAP.dateOfBirth.fieldPath).toBe('identity.dateOfBirth');
    expect(MRZ_FIELD_MAP.sex.section).toBe('identity');
  });
  it('OCR-only keys map into passport/identity', () => {
    expect(OCR_FIELD_MAP.issueDate.fieldPath).toBe('passport.issueDate');
    expect(OCR_FIELD_MAP.fullName.fieldPath).toBe('identity.fullNameAsInPassport');
  });
});
```

- [ ] **Step 2: fail → Step 3: implement `types.ts` + `fieldMap.ts`** (maps per spec §9; `mapMrzResult` deferred to Task 7).

- [ ] **Step 4: pass → typecheck + lint → Step 5: commit** — `feat(documents): shared extraction types + applicant-field map  <trailer>`

**Task 6 report + stop.**

---

### Task 7: Confidence scoring + classification + `mapMrzResult`

**Files:**
- Create: `src/shared/documents/confidence.ts`, `src/shared/documents/classify.ts`
- Modify: `src/shared/documents/fieldMap.ts` (add `mapMrzResult`)
- Test: `test/shared/documents/confidence.test.ts`, `test/shared/documents/classify.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // confidence.ts — module doc-comment states the Amendment-2 semantics verbatim
  export interface MrzScoreInput { hasOwnCheckDigit: boolean; ownCheckOk: boolean | null; siblingChecksOk: boolean }
  export function scoreMrzField(i: MrzScoreInput): number
  export function scoreOcrField(i: { anchored: boolean; lineConfidence: number }): number
  export function penalizeUnnormalized(score: number): number   // score * 0.5
  // classify.ts
  export interface ClassifyInput { mrzDetected: boolean; mrzDocType: string | null; mrzOverallValid: boolean; ocrText: string }
  export function classifyDocument(i: ClassifyInput): { kind: DocumentKind; confidence: number }
  // fieldMap.ts (added)
  export function mapMrzResult(r: Td3Result, ref?: Date): ExtractedField[]
  ```

- [ ] **Step 1: `test/shared/documents/confidence.test.ts`** — one assertion per spec §8 row:

```ts
import { describe, expect, it } from 'vitest';
import { scoreMrzField, scoreOcrField, penalizeUnnormalized } from '../../../src/shared/documents/confidence.js';

describe('scoreMrzField', () => {
  it('own check digit OK → 0.99', () =>
    expect(scoreMrzField({ hasOwnCheckDigit: true, ownCheckOk: true, siblingChecksOk: true })).toBe(0.99));
  it('own check digit FAILED → 0.55', () =>
    expect(scoreMrzField({ hasOwnCheckDigit: true, ownCheckOk: false, siblingChecksOk: true })).toBe(0.55));
  it('no own check digit, siblings OK → 0.95', () =>
    expect(scoreMrzField({ hasOwnCheckDigit: false, ownCheckOk: null, siblingChecksOk: true })).toBe(0.95));
  it('no own check digit, siblings failed → 0.60', () =>
    expect(scoreMrzField({ hasOwnCheckDigit: false, ownCheckOk: null, siblingChecksOk: false })).toBe(0.6));
});

describe('scoreOcrField', () => {
  it('anchored, mid confidence', () =>
    expect(scoreOcrField({ anchored: true, lineConfidence: 80 })).toBeCloseTo(0.35 + 0.5 * 0.8));
  it('anchored clamps at 0.75', () =>
    expect(scoreOcrField({ anchored: true, lineConfidence: 100 })).toBe(0.75));
  it('unanchored clamps at 0.15 floor', () =>
    expect(scoreOcrField({ anchored: false, lineConfidence: 0 })).toBe(0.15));
});

describe('penalizeUnnormalized', () => {
  it('halves the score', () => expect(penalizeUnnormalized(0.99)).toBeCloseTo(0.495));
});
```

- [ ] **Step 2: `test/shared/documents/classify.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { classifyDocument } from '../../../src/shared/documents/classify.js';

it('valid passport MRZ → passport, high', () => {
  const r = classifyDocument({ mrzDetected: true, mrzDocType: 'P', mrzOverallValid: true, ocrText: '' });
  expect(r.kind).toBe('passport');
  expect(r.confidence).toBeGreaterThanOrEqual(0.95);
});
it('MRZ present but invalid → passport, lower', () => {
  const r = classifyDocument({ mrzDetected: true, mrzDocType: 'P', mrzOverallValid: false, ocrText: '' });
  expect(r.kind).toBe('passport');
  expect(r.confidence).toBeLessThan(0.95);
});
it('no MRZ, passport keywords → passport, weak', () => {
  const r = classifyDocument({ mrzDetected: false, mrzDocType: null, mrzOverallValid: false, ocrText: 'REPUBLIC OF X\nPASSPORT\nP<' });
  expect(r.kind).toBe('passport');
  expect(r.confidence).toBeLessThan(0.7);
});
it('nothing passport-like → unknown', () => {
  const r = classifyDocument({ mrzDetected: false, mrzDocType: null, mrzOverallValid: false, ocrText: 'BANK STATEMENT\nAccount balance' });
  expect(r.kind).toBe('unknown');
});
```

- [ ] **Step 3: fail → Step 4: implement.**

`scoreMrzField`: `hasOwnCheckDigit ? (ownCheckOk ? 0.99 : 0.55) : (siblingChecksOk ? 0.95 : 0.60)`.
`scoreOcrField`: `anchored ? clamp(0.35 + 0.5*(lc/100), 0.30, 0.75) : clamp(0.20 + 0.4*(lc/100), 0.15, 0.55)`.
`classifyDocument`: MRZ + docType `P`/`P<` → `passport`, conf `mrzOverallValid ? 0.97 : 0.80`. Else count keyword hits (`PASSPORT`, `P<`, `REPUBLIC OF`, `MRZ`, `TYPE\s*P`) in uppercased `ocrText`; `hits >= 1` → `passport` conf `min(0.4 + 0.1*hits, 0.65)`; else `unknown` conf `0.9`.
`mapMrzResult(r, ref)`: for each `MrzFieldKey`, pull the raw from `r`, normalize (date/sex/country/number/name per key), score via `scoreMrzField` (`hasOwnCheckDigit` = key ∈ {documentNumber, dateOfBirth, expiryDate}; `siblingChecksOk` = `r.composite.ok`), map `checkDigitOk` from the field's `checkDigit?.ok ?? null`, apply `penalizeUnnormalized` + set `normalizationNote` when normalize returns `null`. Return `ExtractedField[]` with `source: 'passport_mrz'`.

- [ ] **Step 5: pass → typecheck + lint → Step 6: commit** — `feat(documents): heuristic confidence scoring + classification  <trailer>`

**Task 7 report + stop.**

---

### Task 8: OCR-fallback field extraction + schemas + barrel

**Files:**
- Create: `src/shared/documents/ocrFieldExtract.ts`, `src/shared/documents/schemas.ts`, `src/shared/documents/index.ts`
- Test: `test/shared/documents/ocrFieldExtract.test.ts`, add a block to `test/shared/documents/` for schemas

**Interfaces:**
- Produces:
  ```ts
  // ocrFieldExtract.ts
  export function extractFieldsFromOcr(text: string, lines: OcrLine[], kind: DocumentKind): ExtractedField[]
  // schemas.ts
  export const uploadMetaSchema: z.ZodType<{ applicantId?: string }>
  export const fieldPathBodySchema: z.ZodType<{ fieldPath: string }>   // refine isValidFieldPath
  ```

- [ ] **Step 1: tests** — `extractFieldsFromOcr` finds `Passport No: A01234567` → `passport.number` anchored; a bare ISO date on a line labelled `Date of Issue` → `passport.issueDate`; `Date of Birth 15/01/1990` → `identity.dateOfBirth` normalized to `1990-01-15`; no anchor → lower `confidence` and `anchored:false` path; `kind: 'unknown'` still yields `document_ocr` source not `passport_ocr`. Schema: `fieldPathBodySchema` rejects `Identity.Surname` and `../x`, accepts `passport.number`.

- [ ] **Step 2: fail → Step 3: implement.**

Pattern set (uppercased text, line-oriented): label regexes for `PASSPORT\s*(NO|NUMBER|#)`, `DATE OF BIRTH|BIRTH DATE|DOB`, `DATE OF ISSUE|ISSUE DATE`, `DATE OF EXPIRY|EXPIRY|EXPIRATION`, `PLACE OF ISSUE|AUTHORITY`, `SURNAME`, `GIVEN NAMES?`. Value extraction: passport number `[A-Z0-9]{6,9}` after the label or on the same line; dates via `\b(\d{1,2})[ /.\-](\d{1,2}|[A-Z]{3})[ /.\-](\d{2,4})\b` → normalize to ISO (2-digit year window: birth in past, issue/expiry as appropriate). `anchored` = matched next to its label; `lineConfidence` from the source `OcrLine`. `source` = `kind === 'passport' ? 'passport_ocr' : 'document_ocr'`. Score with `scoreOcrField`. Emit `value: null` + note if a date won't normalize.

- [ ] **Step 4: pass → Step 5: `index.ts` barrel (`export * from` each) → typecheck + lint → Step 6: commit** — `feat(documents): OCR-fallback field extraction + request schemas  <trailer>`

**Task 8 report + stop.**

---

### Task 9: File-type sniff + storage

**Files:**
- Create: `src/server/documents/fileType.ts`, `src/server/documents/storage.ts`
- Test: `test/server/documentFileType.test.ts`, `test/server/documentStorage.test.ts`

**Interfaces:**
- Consumes: `env.DOCUMENTS_DIR`, `node:fs`, `node:crypto`.
- Produces:
  ```ts
  // fileType.ts
  export type SniffedMime = 'image/jpeg' | 'image/png' | 'application/pdf';
  export function sniffMime(bytes: Uint8Array): SniffedMime | null
  export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
  export function validateUpload(bytes: Uint8Array): { mime: SniffedMime } // throws UploadError('too_large'|'empty'|'unsupported_type')
  export class UploadError extends Error { code: 'too_large' | 'empty' | 'unsupported_type' }
  // storage.ts
  export function storeOriginal(documentId: string, ext: string, bytes: Uint8Array): string  // returns storage_path (relative)
  export function readOriginal(storagePath: string): Buffer
  export function deleteOriginal(storagePath: string): void
  export function sha256Hex(bytes: Uint8Array): string
  ```

- [ ] **Step 1: tests** — magic bytes: `FF D8 FF` → jpeg, `89 50 4E 47 0D 0A 1A 0A` → png, `25 50 44 46 2D` (`%PDF-`) → pdf, GIF header → `null`, empty → `null`. `validateUpload`: empty → `empty`, 16 MiB of `FF D8 FF ...` → `too_large`, GIF → `unsupported_type`. `storage`: `storeOriginal('id','jpg',bytes)` writes `<DOCUMENTS_DIR>/id/original.jpg`, returns `id/original.jpg`; `readOriginal` round-trips; `deleteOriginal` removes the file **and** the now-empty `id/` dir; a `storagePath` containing `..` throws.

- [ ] **Step 2: fail → Step 3: implement.** `storeOriginal` resolves the target, asserts `resolved.startsWith(resolve(DOCUMENTS_DIR) + sep)`, `mkdirSync(dir,{recursive:true})`, `writeFileSync`. `sha256Hex` = `createHash('sha256').update(bytes).digest('hex')`.

- [ ] **Step 4: pass → gate → Step 5: commit** — `feat(documents): magic-byte type sniff + local original storage  <trailer>`

**Task 9 report + stop.**

---

### Task 10: OCR engine interface + FakeOcrEngine + PDF single-image extractor

**Files:**
- Create: `src/server/documents/ocrEngine.ts`, `src/server/documents/pdfImage.ts`, `test/helpers/fakeOcrEngine.ts`
- Test: `test/server/pdfImage.test.ts`
- Modify: `package.json` (+ `pdfjs-dist`)
- Modify: `.gitignore` will be touched in Task 11; PDF fixtures are created here

**Interfaces:**
- Produces:
  ```ts
  // ocrEngine.ts
  export interface OcrResult { text: string; lines: { text: string; confidence: number }[]; meanConfidence: number }
  export interface OcrEngine { recognize(image: Uint8Array): Promise<OcrResult>; dispose(): Promise<void> }
  // pdfImage.ts
  export class ExtractionError extends Error { code: 'pdf_encrypted' | 'pdf_unsupported' | 'unreadable' | 'not_an_image' | 'internal' }
  export interface PreparedImage { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png'; pageCount: number | null }
  export async function extractSingleImage(pdfBytes: Uint8Array): Promise<PreparedImage>
  // test/helpers/fakeOcrEngine.ts
  export class FakeOcrEngine implements OcrEngine {
    constructor(result: OcrResult | ((img: Uint8Array) => OcrResult));
    calls: Uint8Array[];
  }
  export function ocrResultFromLines(lines: string[], confidence = 88): OcrResult
  ```

- [ ] **Step 1: create 3 tiny PDF fixtures** (controller/implementer, committed, synthetic): `test/fixtures/documents/single-image.pdf` (one page wrapping one small JPEG — build with a throwaway `pdf-lib` invocation in a scratch script, or hand-assemble; the JPEG content is a 2×2 grey square, no text), `encrypted.pdf` (same, `userPassword` set), `multi-image.pdf` (one page, two images). Document how each was produced in a comment in the test file.

- [ ] **Step 2: `test/server/pdfImage.test.ts`** — `single-image.pdf` → `PreparedImage` mime `image/jpeg`, `pageCount 1`; `encrypted.pdf` → `ExtractionError` code `pdf_encrypted` (assert the error message contains **no** bytes/paths); `multi-image.pdf` → `pdf_unsupported`; a JPEG passed to `extractSingleImage` is not this function's job (it only takes PDFs) — no test.

- [ ] **Step 3: implement `pdfImage.ts`** with `pdfjs-dist/legacy/build/pdf.mjs`: `getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true })`; catch `PasswordException` → `ExtractionError('pdf_encrypted')`; `doc.numPages`; `page = doc.getPage(1)`; `ops = page.getOperatorList()`; collect `OPS.paintImageXObject` / `paintJpegXObject` names; for each, `page.objs.get(name)` (resolve via the callback form); accept only when exactly one image and its `kind`/filter is JPEG-decodable to raw bytes — if pdfjs only yields decoded RGBA, return it as `image/png` via a **minimal inline PNG encoder** (uncompressed IDAT with stored zlib blocks — ~40 lines, deterministic) **or**, simpler and preferred: read the raw stream via `page.objs` is not reliable → instead reject with `pdf_unsupported` unless the embedded image is a straight JPEG stream obtainable from the operator args. Keep the happy path narrow: one page, one JPEG XObject → its encoded bytes. Everything else → `pdf_unsupported`. (If the narrow path proves unreachable with the pdfjs API in practice, the implementer notes it and the task falls back to "PDF always `pdf_unsupported` this phase" with a deferred follow-up — images still fully work.)

- [ ] **Step 4: `test/helpers/fakeOcrEngine.ts`** — trivial.

- [ ] **Step 5: `package.json`** — add `"pdfjs-dist": "^4"` to dependencies. `npm i`. Confirm no native build step ran.

- [ ] **Step 6: run tests → gate → commit** — `feat(documents): OcrEngine interface + single-image PDF extractor  <trailer>`

**Task 10 report + stop.** (Report must state clearly which PDF path actually works.)

---

### Task 11: Tesseract engine + vendored model

**Files:**
- Create: `src/server/documents/tesseractEngine.ts`, `vendor/tessdata/eng.traineddata`, `vendor/tessdata/README.md`
- Modify: `.gitignore` (+ `!vendor/`, `!vendor/tessdata/`, `!vendor/tessdata/*`), `package.json` (+ `tesseract.js`)
- Test: `test/server/tesseractEngine.slow.test.ts`, `test/fixtures/documents/mrz-clean.png`

**Interfaces:**
- Consumes: `OcrEngine`, `OcrResult`.
- Produces: `export function createTesseractEngine(opts?: { langPath?: string }): OcrEngine` + `export const ENGINE_DETAIL: string`.

- [ ] **Step 1: vendor the model** — download `eng.traineddata` from `tessdata_fast` (`https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata`), place at `vendor/tessdata/eng.traineddata`, record its SHA-256 + source URL + "Apache-2.0" in `vendor/tessdata/README.md`. Update `.gitignore`.

- [ ] **Step 2: create `test/fixtures/documents/mrz-clean.png`** — render the two `buildTd3({ surname:'RAHMAN', givenNames:'ABDUL KARIM', documentNumber:'A01234567', dateOfBirth:'900115', sex:'M', expiryDate:'300114' })` lines as black OCR-B-ish monospace text on white, ~1000×160 px. Produced by the controller during planning (browser canvas → PNG, or an offline render) and committed. Synthetic data only.

- [ ] **Step 3: `package.json`** — add `"tesseract.js": "^5"` (or `^6` if `^5` pulls anything native — verify). `npm i`.

- [ ] **Step 4: implement `tesseractEngine.ts`** — lazy `createWorker('eng', 1, { langPath: <abs vendor/tessdata>, gzip: false, cachePath: <os tmp>, workerBlobURL: false })`; on first `recognize`, create the worker; `worker.setParameters({ tessedit_pageseg_mode: '6' })`; `const { data } = await worker.recognize(Buffer.from(image))`; map `data.text`, `data.lines.map(l => ({ text: l.text.trim(), confidence: l.confidence }))`, `meanConfidence: data.confidence`. `dispose()` terminates the worker. **All paths local — no `langPath` URL, no `corePath` URL.** `ENGINE_DETAIL = \`tesseract.js@${pkgVersion} / eng (tessdata_fast)\``.

- [ ] **Step 5: `test/server/tesseractEngine.slow.test.ts`** — `const eng = createTesseractEngine(); const r = await eng.recognize(readFileSync('test/fixtures/documents/mrz-clean.png')); const mrz = detectMrzLines(r.lines); expect(mrz).not.toBeNull(); const parsed = parseTd3(mrz!.line1, mrz!.line2); expect(parsed.documentNumber.raw).toBe('A01234567'); await eng.dispose();` — `testTimeout: 60_000`. If it flakes or exceeds ~30 s in execution, wrap `describe.skip` with a `// DEFERRED:` note and record it in the task report + phase report.

- [ ] **Step 6: gate** (the slow test may be excluded from the fast loop via a filename convention if needed — check `vitest.config.ts` `include`; `*.slow.test.ts` still matches `test/**/*.test.ts`, so it runs — keep it unless it's a problem). **Commit** — `feat(documents): local tesseract.js OCR engine + vendored eng model  <trailer>` (note: the ~2 MB binary is in this commit).

**Task 11 report + stop.** (Report the model SHA-256 and whether the slow test is active or skipped.)

---

### Task 12: Extraction pipeline orchestrator

**Files:**
- Create: `src/server/documents/extractionPipeline.ts`
- Test: `test/server/extractionPipeline.test.ts`

**Interfaces:**
- Consumes: `sniffMime`, `extractSingleImage`, `OcrEngine`, `detectMrzLines`, `parseTd3`, `classifyDocument`, `mapMrzResult`, `extractFieldsFromOcr`, all document/mrz types.
- Produces:
  ```ts
  export interface PipelineDeps { ocr: OcrEngine; now?: () => Date }
  export async function runExtraction(bytes: Uint8Array, mime: SniffedMime, deps: PipelineDeps): Promise<ExtractionOutcome>
  ```

- [ ] **Step 1: `test/server/extractionPipeline.test.ts`** with `FakeOcrEngine` / `ocrResultFromLines`:
  - **MRZ primary:** fake returns `[...noise, ICAO_SPECIMEN.line1, ICAO_SPECIMEN.line2]` → `outcome.method === 'mrz'`, `mrzValid true`, a `passport.number` field with `source 'passport_mrz'`, `confidence 0.99`, `checkDigitOk true`, `kind 'passport'`.
  - **OCR fallback:** fake returns a corrupted line 2 (bad check digits) + labelled VIZ text → `method 'ocr'`, fields `source 'passport_ocr'`, `confidence < 0.8`.
  - **mixed:** valid MRZ but the fake also carries `Place of Issue: DHAKA` → `passport.placeOfIssue` from OCR, `method 'mrz_ocr'`.
  - **unknown doc:** fake returns `['GROCERY RECEIPT','TOTAL 12.40']` → `kind 'unknown'`, `fields` may be empty, no throw.
  - **normalization failure:** MRZ with an impossible DOB (`buildTd3` with `dateOfBirth:'999999'` — check digit still computes) → `dateOfBirth` field `value: null`, `normalizationNote` set, `confidence` halved.
  - **pdf path:** `mime 'application/pdf'` with the `single-image.pdf` bytes → calls `extractSingleImage`, then OCR (assert via `FakeOcrEngine.calls.length === 1`).
  - **errors carry no content:** force `ocr.recognize` to reject → `ExtractionError('unreadable')`, `err.message` contains none of the input.

- [ ] **Step 2: fail → Step 3: implement** the 9-step sequence from spec §4. Thin: no DB, no logging. `method`: `mrz` if all emitted fields are `passport_mrz`; `ocr` if none are; else `mrz_ocr`.

- [ ] **Step 4: pass → gate → Step 5: commit** — `feat(documents): staged extraction pipeline orchestrator  <trailer>`

**Task 12 report + stop.**

---

### Task 13: Profile-application rules

**Files:**
- Create: `src/server/documents/documentApply.ts`
- Test: `test/server/documentApply.test.ts`

**Interfaces:**
- Consumes: `DatabaseSync`, `SECTION_TABLES` / `readSection` / `writeSection` (`applicantColumns.ts`), `ExtractedField`, existing `applicant_field_meta` shape.
- Produces:
  ```ts
  export interface ApplyResult { fieldPath: string; status: 'applied' | 'held'; reason: 'empty' | 'same_value' | 'different' | 'verified' | 'unnormalizable' }
  export function applyExtractedField(
    db: DatabaseSync, applicantId: string, documentId: string, field: ExtractedField, now: string,
  ): ApplyResult
  ```
  Caller (Task 14) wraps this per field inside the run transaction and writes the `document_fields` row from the `ApplyResult`.

- [ ] **Step 1: `test/server/documentApply.test.ts`** — set up an applicant with an empty profile, then exhaustively per spec §10:
  - EMPTY → `applied/empty`; section column now holds `value`; `applicant_field_meta` row `source`, `confidence`, `document_id`, `verified 0`.
  - SAME + no meta → `applied/same_value`; meta created, `verified 0`.
  - SAME + meta `manual` unverified → `applied/same_value`; meta `source` upgraded to `passport_mrz`, `verified 0`.
  - SAME + meta verified → `applied/same_value`; meta **unchanged** (still `verified 1`, original source).
  - DIFFERENT unverified → `held/different`; section + meta untouched.
  - DIFFERENT verified → `held/verified`; untouched.
  - `value: null` → `held/unnormalizable`; nothing written.
  - never writes `verified = 1`.

- [ ] **Step 2: fail → Step 3: implement** the case table exactly. Reuse `readSection`/`writeSection` for the canonical column; hand-write the `applicant_field_meta` upsert (mirror `upsertFieldMeta` in `applicantService.ts` but always with `document_id` and never `verified: 1`).

- [ ] **Step 4: pass → gate → Step 5: commit** — `feat(documents): profile-application rules (auto-apply / hold / provenance)  <trailer>`

**Task 13 report + stop.**

---

### Task 14: Document service

**Files:**
- Create: `src/server/documents/documentService.ts`
- Modify: `src/server/services/applicantService.ts` (`duplicateApplicant` — field-meta clone adds `document_id` NULL column explicitly)
- Test: `test/server/documentService.test.ts`, add a case to `test/server/applicantService.test.ts` (duplicate leaves `document_id` NULL)

**Interfaces:**
- Consumes: everything above, `randomUUID`, `FakeOcrEngine` (tests).
- Produces:
  ```ts
  export function createDocument(db, input: { applicantId: string | null; originalName: string | null; bytes: Uint8Array }): DocumentSummary  // sniffs, stores, inserts
  export async function runExtraction(db, documentId: string, deps: { ocr: OcrEngine; engineDetail: string; now?: () => Date }): Promise<DocumentDetail>
  export function getDocument(db, id: string): DocumentDetail | null
  export function listDocuments(db, applicantId?: string): DocumentSummary[]
  export function applyHeldField(db, documentId: string, fieldPath: string): DocumentDetail | null
  export function dismissField(db, documentId: string, fieldPath: string): DocumentDetail | null
  export function deleteDocument(db, id: string): boolean
  export class DocumentServiceError extends Error { code: 'no_applicant' | 'not_found' | 'field_not_held' | 'field_has_no_value' }
  ```

- [ ] **Step 1: `test/server/documentService.test.ts`** (in-memory or temp DB, `FakeOcrEngine`):
  - `createDocument` with a JPEG → row `status 'uploaded'`, file on disk, `sha256` set, `kind 'unknown'`.
  - `runExtraction` (fake returns ICAO specimen) → `extraction_runs` attempt 1, `method 'mrz'`, `mrz_valid 1`, `field_count > 0`; `document_fields` rows; empty profile fields auto-applied with `verified 0`; `documents.status 'extracted'`, `latest_extraction_method 'mrz'`.
  - second `runExtraction` → attempt 2; a `dismissed` field stays dismissed; re-evaluates status.
  - `runExtraction` on a document with `applicant_id NULL` → `DocumentServiceError('no_applicant')`.
  - pipeline throws (`ExtractionError`) → run row `status 'failed'` + `error_code`, `documents.status 'failed'`, no partial `document_fields`.
  - `applyHeldField` on a held field → value written, meta `verified 0`, field `status 'applied'`.
  - `dismissField` → `status 'dismissed'`.
  - `deleteDocument` → file gone, rows gone, `applicant_field_meta.document_id` for any applied field is now `NULL` (value retained).
  - `duplicateApplicant` (Phase 2) after an extraction → the copy's field-meta rows have `document_id NULL`.

- [ ] **Step 2: fail → Step 3: implement.** `runExtraction` is one `BEGIN`/`COMMIT`: compute `attempt`, insert the run row (status pending), call `runExtraction` pipeline, then per field call `applyExtractedField` + upsert the `document_fields` row (respecting sticky `dismissed` and the re-extraction rules), update the run row (`method`, counts, `mrz_*`), update `documents`. On a pipeline `ExtractionError`: mark run `failed` + `error_code`, `documents.status 'failed'`, COMMIT (the failed run is a real audit record), rethrow a sanitized `DocumentServiceError` or return the detail with the failure — pick return-detail for the route's benefit.

- [ ] **Step 4: patch `duplicateApplicant`** — its field-meta re-insert `INSERT ... (id, applicant_id, field_path, source, confidence, raw_value, verified, verified_at, created_at, updated_at)` becomes `(..., document_id, ...)` with `NULL`. Update the existing duplicate test expectation.

- [ ] **Step 5: pass → gate → Step 6: commit** — `feat(documents): document service — upload, runs, apply/dismiss, delete  <trailer>`

**Task 14 report + stop.**

---

### Task 15: REST routes + multipart wiring + guard tests

**Files:**
- Create: `src/server/routes/documents.ts`, `test/server/documentRoutes.test.ts`, `test/server/documentsNoNetwork.test.ts`
- Modify: `src/server/app.ts`, `src/server/index.ts`, `src/server/fastify.d.ts`, `package.json` (+ `@fastify/multipart`, dev `form-data`), `test/helpers/` as needed

**Interfaces:**
- Consumes: `documentService`, `createTesseractEngine`, `ENGINE_DETAIL`, `@fastify/multipart`.
- Produces: the spec §13 endpoints; `app.ocr: OcrEngine` decoration; `buildServer({ ..., ocr?: OcrEngine })` option (defaults to a real tesseract engine; tests pass a `FakeOcrEngine`).

- [ ] **Step 1: tests**
  - `documentRoutes.test.ts` — build the server with a `FakeOcrEngine`; `POST /api/documents` multipart (via `form-data`) with a JPEG + `applicantId` → 201 `{ document }`; `POST /api/documents/:id/extract` → 200 with `runs`/`fields`; `GET /api/documents?applicantId=` and `GET /api/documents/:id`; `GET /api/documents/:id/file` → the exact bytes + `content-type: image/jpeg`; `POST /api/documents/:id/fields/apply` / `.../dismiss`; `DELETE`. Error cases: oversize (assert 400 `VALIDATION_ERROR`, sanitized), wrong type, zero-byte, unknown id → 404 envelope, `fieldPath` failing `isValidFieldPath` → 400. Assert **no** request body or file content is logged (capture-stream logger).
  - `documentsNoNetwork.test.ts` — read every file under `src/server/documents/`, `src/shared/mrz/`, `src/shared/documents/` and assert the source contains no `from 'node:http'`, `node:https`, `undici`, no bare `fetch(` call, and no `verified: 1` / `verified:1` / `verified: true` literal. (Mirror `test/automation/noHardcodedUrl.test.ts` style.)

- [ ] **Step 2: fail → Step 3: implement routes** following `src/server/routes/applicants.ts` patterns; use `app.file()` / `req.file()` from `@fastify/multipart` (`attachFieldsToBody: false`; `limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 4 }`); buffer the stream (respect `file.truncated` → 400 `too_large`); read `applicantId` from `parts`. `GET /:id/file` → `readOriginal` + `reply.type(mime).header('content-disposition','inline').send(buffer)`.

- [ ] **Step 4: wire `app.ts`** — `await app.register(multipart, {...})`; `const ocr = opts.ocr ?? createTesseractEngine(); app.decorate('ocr', ocr); app.addHook('onClose', () => ocr.dispose());` `await registerDocumentRoutes(app)`. `index.ts` unchanged if the default kicks in; `fastify.d.ts` += `ocr: OcrEngine`.

- [ ] **Step 5: pass → gate → Step 6: commit** — `feat(api): document upload/extract/review routes + multipart  <trailer>`

**Task 15 report + stop.**

---

### Task 16: Web — API client + DocumentsPage

**Files:**
- Modify: `src/web/src/api/client.ts`, `src/web/src/App.tsx`, `src/web/src/main.tsx`, `src/web/src/styles.css`
- Create: `src/web/src/pages/Documents/DocumentsPage.tsx`
- Test: `test/web/apiClient.test.ts` (add a FormData case), `test/web/DocumentsPage.test.tsx`

**Interfaces:**
- Produces client methods: `uploadDocument(file: File, applicantId?: string)`, `extractDocument(id)`, `listDocuments(applicantId?)`, `getDocument(id)`, `documentFileUrl(id): string`, `applyDocumentField(id, fieldPath)`, `dismissDocumentField(id, fieldPath)`, `deleteDocument(id)`.

- [ ] **Step 1: tests** — `apiClient`: a `FormData` body does **not** get `content-type: application/json` set (extend the existing header test). `DocumentsPage`: renders a list from a mocked `listDocuments`; selecting a file + submit calls `uploadDocument` then navigates; shows kind badge + status.

- [ ] **Step 2: fail → Step 3: implement.** In `request()`: `if (init.body instanceof FormData) { /* leave content-type unset */ } else if (init.body != null && !headers.has('content-type')) headers.set('content-type','application/json')`. `uploadDocument` builds `FormData`. `documentFileUrl` = `\`/api/documents/${id}/file\``. Add the `/documents` + `/documents/:id` routes to `main.tsx`, the nav link to `App.tsx`.

- [ ] **Step 4: pass → gate (typecheck web + test + build) → Step 5: commit** — `feat(web): documents list + upload page + API client  <trailer>`

**Task 16 report + stop.**

---

### Task 17: Web — DocumentDetailPage (review UI)

**Files:**
- Create: `src/web/src/pages/Documents/DocumentDetailPage.tsx`, `src/web/src/pages/Documents/ExtractedFieldsTable.tsx`
- Modify: `src/web/src/styles.css`
- Test: `test/web/DocumentDetailPage.test.tsx`

- [ ] **Step 1: test** — mock `getDocument` to return a `DocumentDetail` with one `applied` MRZ field (`confidence 0.99`, `checkDigitOk true`, `verified false`), one `held` field, one `dismissed`. Assert: header shows kind + method + classification confidence; `<img>` with `src` = `documentFileUrl(id)`; the runs list; the table columns (Field / Extracted value / Source / Confidence / In profile? / Verified? / Actions); **Confirm** on the applied+matching field calls `api.setFieldMeta(applicantId, { fieldPath, verified: true })`; **Apply** on the held field calls `applyDocumentField`; **Dismiss** calls `dismissDocumentField`; Confirm is disabled when the field is not applied. Confidence is rendered as a labelled heuristic (e.g. `0.99 · MRZ check digit`), not as "99% correct".

- [ ] **Step 2: fail → Step 3: implement.** `DocumentDetailPage` loads `getDocument`, renders header + original + runs + `<ExtractedFieldsTable>`; a "Re-extract" button calls `extractDocument`; an "Assign to applicant" control when `applicantId` is null (calls a small `PATCH`? — no: keep it simple, require assignment at upload; if null, show "upload was not linked to an applicant" and disable extraction). `ExtractedFieldsTable` takes `detail` + callbacks; row actions per the test.

- [ ] **Step 4: pass → gate → Step 5: commit** — `feat(web): document review & per-field verify UI  <trailer>`

**Task 17 report + stop.**

---

### Task 18: Web — ApplicantDetailPage Documents subsection + SectionCard hint

**Files:**
- Modify: `src/web/src/pages/Applicants/ApplicantDetailPage.tsx`, `src/web/src/pages/Applicants/SectionCard.tsx`, `src/web/src/styles.css`
- Test: `test/web/ApplicantDetailPage.test.tsx` (extend), `test/web/SectionCard` behaviour via the detail test

- [ ] **Step 1: tests** — `ApplicantDetailPage` shows a "Documents" subsection listing the applicant's documents (mock `listDocuments`) with an inline upload; a `SectionCard` row whose `fieldMeta.source === 'passport_mrz'` renders a hint line `passport MRZ · 0.99` and (when a matching document is in props) a link to it; a `manual` field renders no hint.

- [ ] **Step 2: fail → Step 3: implement.** `SectionCard` already receives `fieldMeta`; for each row, find the meta by `${sectionKey}.${f.key}`; if `meta && meta.source !== 'manual'`, render `<p class="provenance-hint">{sourceLabel(meta.source)} · {meta.confidence?.toFixed(2)} {meta.documentId && <Link>…}</p>`. `ApplicantDetailPage` adds `<DocumentsSubsection applicantId={id} />` (small inline component: list + upload → navigate to `/documents/:id`).

- [ ] **Step 4: pass → gate → Step 5: commit** — `feat(web): applicant page documents subsection + provenance hints  <trailer>`

**Task 18 report + stop.**

---

### Task 19: Phase 3 report + acceptance walkthrough

**Files:**
- Create: `docs/PHASE-3-REPORT.md`
- Modify: `docs/ARCHITECTURE.md` (one paragraph in the source-layout section)

- [ ] **Step 1: full gate** — `npm run typecheck && npm run lint && npm test && npm run build`; record counts.
- [ ] **Step 2: manual acceptance** — `npm start`, upload `test/fixtures/documents/mrz-clean.png` against a fresh applicant, run extraction, confirm the review table shows MRZ fields with 0.99 / check-digit chips, Confirm one field, verify it flips `verified` on the applicant page and the provenance hint shows. Screenshot into the report. Then upload a non-passport image → `kind unknown`, no fields. Then an encrypted PDF → rejected with `pdf_encrypted`.
- [ ] **Step 3: write `docs/PHASE-3-REPORT.md`** — sections: what was built / files / the 12 pipeline stages & where each lives / dependency justification / data model / the §10 case table as implemented / confidence semantics (Amendment 2 wording) / extraction-run model (Amendment 3) / security checklist (no network proof, no chip, encrypted-PDF rejection, synthetic fixtures, redaction) / acceptance checklist §18 pass/fail with evidence / deferred follow-ups / recommended next phase.
- [ ] **Step 4: `ARCHITECTURE.md`** paragraph. **Step 5: commit** — `docs: Phase 3 report — passport OCR & document extraction  <trailer>`

**Task 19 report + stop. Then: whole-branch review (opus) closes the phase.**

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §2 stage separation (Amendment 1) | 3–14 (one unit per stage); §2 table mapped file-for-file in the plan File structure |
| §3 migration 3 | 1 |
| §4 pipeline | 12 (orchestrator); stages in 3–11 |
| §5 MRZ subsystem | 3 (check digits), 4 (td3 + detect), 5 (normalize) |
| §6 OCR engine, vendored model, Fake, no external service | 10 (interface + Fake), 11 (tesseract + vendor) |
| §7 PDF handling | 10 |
| §8 confidence semantics (Amendment 2) | 7 (`confidence.ts` doc-comment), 17 (UI labelling), 19 (report wording) |
| §9 field mapping | 6 (maps), 7 (`mapMrzResult`) |
| §10 profile-application 4-case table | 13 (`documentApply`), 14 (re-extraction rules), tests exhaustive |
| §11 extraction-run tracking (Amendment 3) | 1 (table), 14 (attempt numbering, per-field `extraction_run_id`) |
| §12 never-auto-verify | 2, 13, 14, 15 (guard test) |
| §13 API | 15 |
| §14 review UI | 16, 17, 18 |
| §15 privacy/security | 2 (redaction), 9 (path containment), 10 (encrypted reject), 15 (no-network guard test) |
| §16 dependencies | 10, 11, 15 (each adds its dep with justification) |
| §17 testing + fixtures | every task writes tests; fixtures in 10, 11 |
| §18 acceptance checklist | 19 |
| §19 execution method | this plan's structure |

No gap identified.

**2. Placeholder scan** — the only soft spots are deliberately bounded: Task 10 Step 3 (pdfjs image-extraction API is genuinely uncertain; the plan names the narrow happy path **and** the concrete fallback — "PDF → `pdf_unsupported` this phase" — so the task still has a definite, testable outcome) and Task 11 Step 5 (`.skip` fallback for a slow real-OCR test, explicitly allowed by spec §6). Both are decisions with a defined resolution, not "TODO".

**3. Type consistency** — `ExtractionError` is defined once (Task 10, `pdfImage.ts`) and imported by 12/14; `ExtractedField` defined in Task 6 `types.ts`, used by 7/12/13; `OcrEngine`/`OcrResult` defined Task 10, used by 11/12/14/15; `DocumentDetail`/`DocumentSummary` defined Task 6, produced by 14, consumed by 15/16/17/18; `applyExtractedField` (Task 13) → called by `runExtraction` (Task 14). `mapMrzResult` moved out of Task 6 into Task 7 to resolve the confidence.ts dependency (noted inline in Task 6). `buildTd3`/`ICAO_SPECIMEN` (Task 4 helper) reused by 7/11/12. Names consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-04-phase-3-passport-ocr.md`.

Per the user's instruction: **subagent-driven, Task 1 only, then stop for review.**
