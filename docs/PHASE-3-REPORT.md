# Phase 3 — Passport OCR & Document Extraction — end-of-phase report

**Status:** Complete. Gate green.
**Branch:** `phase-0-portal-settings` (established non-main working branch for all phases).
**Range:** `237c90b..e72982d` — spec `237c90b`, plan `8f5fdca`, 18 implementation
commits, 6 controller spec-reconciliation commits (28 commits total). This
docs commit adds the report + the `ARCHITECTURE.md` paragraph + the synthetic
acceptance fixture, with no `src/` change.
**Last verified:** 2026-09-04 — `npm run typecheck` (4 tsc passes), `npm run lint`,
`npm test` (423 passed / 48 files), `npm run build` (web bundle 375.59 kB JS /
101.54 kB gzip, css 7.15 kB) all green.
**Spec:** `docs/superpowers/specs/2026-09-04-phase-3-passport-ocr-design.md`
**Plan:** `docs/superpowers/plans/2026-09-04-phase-3-passport-ocr.md`

Phase 3 turns an uploaded passport image or single-image PDF into structured
applicant-profile fields, each carrying a source, a heuristic confidence, a
back-link to the document, and `verified = 0` until a human confirms it. All
extraction is **local** — a vendored `tesseract.js` model and `pdfjs-dist`, no
network anywhere in the path. No portal automation, no chip/NFC, no encrypted-PDF
cracking, no external OCR service.

---

## 1. What was built — the 12 pipeline stages (spec §2) and where each lives

The extraction path is a sequence of independently testable units (Amendment 1).
The orchestrator only wires them; it owns no extraction logic.

| # | Stage | Unit | Pure? | Location |
|---|---|---|---|---|
| 1 | Document ingestion | `createDocument` + `fileType.ts` | no (fs/db) | `src/server/documents/documentService.ts`, `src/server/documents/fileType.ts` |
| 2 | Image / PDF preparation | `pdfImage.extractSingleImage` | no (pdfjs) | `src/server/documents/pdfImage.ts` |
| 3 | OCR (pixels → text only) | `OcrEngine` iface + `tesseractEngine` | no (wasm) | `src/server/documents/ocrEngine.ts`, `tesseractEngine.ts` |
| 4 | MRZ detection | `detectMrzLines` | yes | `src/shared/mrz/detect.ts` |
| 5 | MRZ parsing (authoritative) | `parseTd3` + `checkDigit.ts` | yes | `src/shared/mrz/td3.ts`, `src/shared/mrz/checkDigit.ts` |
| 6 | OCR-fallback field extraction | `extractFieldsFromOcr` | yes | `src/shared/documents/ocrFieldExtract.ts` |
| 7 | Normalization | `normalizeMrzDate` / `normalizeSex` / `normalizeCountry` / `normalizeDocNumber` / `splitName` | yes | `src/shared/mrz/normalize.ts` |
| 8 | Confidence scoring | `scoreMrzField` / `scoreOcrField` / `penalizeUnnormalized` | yes | `src/shared/documents/confidence.ts` |
| 9 | Applicant-field mapping | `MRZ_FIELD_MAP` / `OCR_FIELD_MAP` / `mapMrzResult` | yes | `src/shared/documents/fieldMap.ts` |
| 10 | Provenance (write rows) | `documentService` / `applyExtractedField` | no (db) | `src/server/documents/documentService.ts`, `documentApply.ts` |
| 11 | Profile application (§10 rules) | `applyExtractedField` / re-extraction rules | no (db) | `src/server/documents/documentApply.ts` |
| 12 | Review / verification | routes + React `Documents` pages | no | `src/server/routes/documents.ts`, `src/web/src/pages/Documents/**` |

Supporting: `src/shared/mrz/index.ts` and `src/shared/documents/index.ts`
(barrels), `src/shared/documents/types.ts` (`ExtractedField`, `ExtractionOutcome`,
`DocumentSummary`, `DocumentDetail`), `src/shared/documents/classify.ts`
(`classifyDocument`), `src/shared/documents/schemas.ts` (request Zod schemas),
`src/server/documents/storage.ts` (local originals + SHA-256 + path-containment),
`src/server/documents/extractionPipeline.ts` (the thin `runExtraction`
orchestrator — no DB, no fs beyond stage 2, no content logging).

The 12 stages map to the spec §2 table one-for-one; `tesseract.js` is a
text-from-pixels provider only, and `td3.ts` is the sole authority for a valid
MRZ. OCR fallback fills only the `field_path`s the MRZ path did not produce.

---

## 2. Files & dependencies

### New source modules

```
src/shared/mrz/            checkDigit.ts  td3.ts  detect.ts  normalize.ts  index.ts
src/shared/documents/      types.ts  fieldMap.ts  confidence.ts  classify.ts
                           ocrFieldExtract.ts  schemas.ts  index.ts
src/server/documents/      fileType.ts  storage.ts  pdfImage.ts  ocrEngine.ts
                           tesseractEngine.ts  extractionPipeline.ts
                           documentApply.ts  documentService.ts
src/server/routes/         documents.ts                     (8 endpoints, §13)
src/web/src/pages/Documents/  DocumentsPage.tsx  DocumentDetailPage.tsx
                              ExtractedFieldsTable.tsx  DocumentsSubsection.tsx
```

### Changed source

- `src/server/db/migrations.ts` — migration 3 (`LATEST_SCHEMA_VERSION` → 3).
- `src/server/env.ts` — derived `DOCUMENTS_DIR = ${DATA_DIR}/documents`.
- `src/server/app.ts` — register `routes/documents.ts`; `@fastify/multipart`;
  `app.ocr` decorated and disposed on close.
- `src/server/logger.ts` — `REDACT_PATHS` gains `ocrText` / `mrzLine(s)` /
  `extractedFields` / `text` / `lines` / `fields` (+ `*.` wildcard variants).
- `src/web/src/api/client.ts` — 8 document methods; `FormData` bodies are sent
  without a JSON `content-type` so the browser sets the multipart boundary.
- `src/web/src/pages/Applicants/SectionCard.tsx` — provenance-hint line under a
  non-`manual` field.
- `src/web/src/App.tsx` / `main.tsx` — `/documents` and `/documents/:id` routes.
- `.gitignore` — `!vendor/` + `!vendor/tessdata/**` (root `data/` rule intact).

### Dependencies added (spec §16)

| Package | Kind | Why | Offline / WDAC |
|---|---|---|---|
| `tesseract.js@^5.1.1` | prod | the local OCR engine (Amendment 1) | pure JS + WASM; model **vendored**, constructed with local file paths only |
| `pdfjs-dist@^4.10.38` | prod | single-image PDF → its one decoded image; detect encryption | pure JS + WASM; run with `isEvalSupported: false`, `useSystemFonts: false`, no `standardFontDataUrl`, worker disabled |
| `@fastify/multipart@^9.4.0` | prod | file upload for Fastify 5 | pure JS |
| `form-data@^4.0.6` | dev | build multipart bodies in route tests | test only |

No native addon (WDAC constraint from Phase 0 Amendment 01 holds). Check digits,
TD3 parsing, detection, classification, confidence, normalization, and OCR field
extraction are all hand-written and dependency-free.

### Vendored asset

`vendor/tessdata/eng.traineddata` — 4,113,088 B, SHA-256
`7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`,
`tessdata_fast` `eng`, Apache-2.0. Source URL, hash and licence are recorded in
`vendor/tessdata/README.md`. Git-exempt like the visa-kb JSON.

### Test count

217 (end of Phase 1) → **423** (+206), 48 test files. New test files cover: MRZ
check digits / TD3 / detect / normalize; confidence / classify / fieldMap /
`mapMrzResult` / ocrFieldExtract; migration 3; fileType; storage; pdfImage;
extractionPipeline; documentApply; documentService; documentRoutes; logger
redaction; the no-network guard; the slow real-OCR smoke; and the two web pages.

---

## 3. The three Amendments — and how each is honored

### Amendment 1 — explicit stage separation

The pipeline is 12 single-responsibility units (§1 table). `tesseract.js` returns
`{ text, lines[], meanConfidence }` and knows nothing about passports or the MRZ.
Stages 4–7 own every rule about what an MRZ is, whether it is valid, and what its
fields mean; when a valid TD3 MRZ is present `td3.ts` is the sole authority for
its values and OCR fallback fills only the fields it did not produce. There is no
external OCR service — `test/server/documentsNoNetwork.test.ts` fails the build on
any `http` / `https` / `fetch` import in the documents / mrz / shared-documents
modules, and `tesseractEngine.ts` is constructed with vendored local paths only.

### Amendment 2 — confidence is a documented heuristic, not a probability

`confidence` is an application-level **trust score in [0, 1]** whose only jobs are
to order the review list and flag fields for a closer look. The `confidence.ts`
module doc-comment states it verbatim: *"a score of `0.99` means 'this value came
from an MRZ field whose ICAO 9303 check digit passed' — a strong
structural-integrity signal — and NOT 'there is a 99% chance this value is
correct'. The functions below, with their exact constants, are the entire
definition of the score; the review UI surfaces them as labelled heuristics ('MRZ
check digit OK', 'OCR — low'), not as a bare percentage asserting certainty."*
The web review UI renders confidence as a labelled heuristic with a "✓ check
digit" chip, never as "% correct". Confidence is **never invented for manual
input**: `applicant_field_meta.confidence` stays `NULL` for `manual` / `imported`
/ `system` sources (Phase 2 write path + `fieldMetaInputSchema`); extraction is
the only writer of a non-null confidence.

### Amendment 3 — extraction-run tracking, no job queue

Every `POST /api/documents/:id/extract` call is exactly one `extraction_runs` row.
`attempt` is `1 + max(existing attempt for this document)`, computed inside the
write transaction. Every `document_fields` row carries `extraction_run_id` — the
run that last produced it. A pipeline that fails before choosing a method is still
a recorded run (`status = 'failed'`, `method = NULL`, `error_code` set). No queue,
no scheduler, no async workers — extraction runs synchronously inside the request
(the async pipeline call itself is issued outside the DB transaction; only the
persistence — run row + every `document_fields` upsert + every profile write — is
one transaction).

---

## 4. Data model — migration 3

`LATEST_SCHEMA_VERSION` → 3. A fresh DB and a v2→v3 upgrade both succeed
(`test/server/documentMigrations.test.ts`, `test/server/migrations.test.ts`).
Table/column names are code constants, so the Phase 2 string-interpolation-safe
SQL pattern holds.

| Table / column | Role |
|---|---|
| `documents` | `id`, nullable `applicant_id` (`ON DELETE CASCADE`; upload can precede assignment), `kind` (`passport`/`unknown`), `classification_confidence`, `original_name`, `mime_type` (`image/jpeg`/`image/png`/`application/pdf`), `byte_size`, `sha256`, `storage_path` (relative to `DOCUMENTS_DIR`), `status` (`uploaded`/`extracted`/`failed`), `latest_extraction_method`, `latest_ocr_mean_confidence`, `page_count`, `error_code` (code only), timestamps |
| `extraction_runs` | `id`, `document_id` (`ON DELETE CASCADE`), `attempt` (per-document, `UNIQUE(document_id, attempt)`), `method` (`mrz`/`ocr`/`mrz_ocr`/`NULL`), `status` (`completed`/`failed`), `mrz_detected`, `mrz_valid`, `ocr_mean_confidence`, `field_count`, `error_code`, `engine_detail` (e.g. `tesseract.js@… / eng (tessdata_fast)`), `created_at` |
| `document_fields` | `id`, `document_id`, `extraction_run_id` (both `ON DELETE CASCADE`), `field_path` (a valid applicant `field_path`), `value` (normalized canonical candidate; `NULL` if unnormalizable), `raw_value` (PII — redacted in logs), `source` (`passport_mrz`/`passport_ocr`/`document_ocr`), `confidence` (REAL, NOT NULL), `check_digit_ok` (`0`/`1`/`NULL` — MRZ fields only), `status` (`proposed`/`applied`/`held`/`dismissed`), `normalization_note`, timestamps, `UNIQUE(document_id, field_path)` — one current proposal per field |
| `applicant_field_meta.document_id` | new column, `REFERENCES documents(id) ON DELETE SET NULL` — deleting a document keeps any profile values it filled, drops the back-link |

`document_fields` holds only the **current** proposal per `(document_id,
field_path)`; superseded per-field values are not retained — `extraction_runs` is
the attempt-level audit trail. `duplicateApplicant` (Phase 2) now writes
`document_id = NULL` when it clones field-meta rows; documents are not duplicated.

Indexes: `idx_documents_applicant`, `idx_extraction_runs_document`,
`idx_document_fields_document`.

---

## 5. Profile-application rules (spec §10) as implemented — `documentApply.ts`

For each mapped `ExtractedField` (path `P`, normalized value `V`, provenance
`{source, confidence, raw}`), against the current canonical value `C` at `P` and
the current `applicant_field_meta` row `M`:

| Case | Condition | Action |
|---|---|---|
| **EMPTY FIELD** | `C` is `NULL`/`''` | write `V` to the section table; upsert `M = {source, confidence, raw_value, document_id, verified: 0}`; `document_fields.status = 'applied'` |
| **SAME VALUE** | `C === V` post-normalization | no collision; `status = 'applied'`. If `M.verified` → `M` untouched. Else: absent `M` → create `{…, verified: 0}`; `M.source === 'manual'` unverified → upgrade; `M` already OCR → refresh `confidence` / `raw_value` / `document_id` |
| **EXISTING DIFFERENT VALUE** | `C` set, `C !== V`, `M?.verified !== true` | do not overwrite; `status = 'held'`; section table and `M` untouched |
| **EXISTING VERIFIED VALUE** | `M?.verified === true`, `C !== V` | never overwrite automatically; `status = 'held'` |
| **UNNORMALIZABLE** | `V` is `null` | `status = 'held'`, `normalization_note` set, nothing written to the profile; Apply disabled — the row prompts manual entry |

**`applied != verified`.** Auto-apply never sets `verified = 1`. The only path to
`verified = 1` is the separate Phase 2 `PUT /api/applicants/:id/field-meta
{ fieldPath, verified: true }`, which omits `source` and so preserves provenance.

**Held-field resolution:** `POST /api/documents/:id/fields/apply { fieldPath }`
writes the held `V` and upserts `M` with `verified: 0` **even over a previously
verified value** (the new value must be re-confirmed); `.../fields/dismiss` sets
`status = 'dismissed'` — sticky, never re-offered, including on re-extraction.

**Re-extraction:** a new `extraction_runs` row (`attempt = max + 1`). Per field:
`dismissed` target → untouched; absent → insert then evaluate the case table;
present and not dismissed → update `value` / `raw_value` / `source` /
`confidence` / `check_digit_ok` / `extraction_run_id`, then re-evaluate `status`
against **current** profile state. Fields a prior run produced that the new run
does not are left as-is.

---

## 6. Confidence semantics (Amendment 2)

The whole definition, from `shared/documents/confidence.ts` (pure, every branch
tested against `test/shared/documents/confidence.test.ts`):

| Situation | Score | `check_digit_ok` |
|---|---|---|
| MRZ field, own check digit present and **OK** | `0.99` | `1` |
| MRZ field, own check digit present and **FAILED** | `0.55` | `0` |
| MRZ field, no own check digit (name, issuing country, doc type), siblings OK | `0.95` | `null` |
| MRZ field, no own check digit, sibling checks failed | `0.60` | `null` |
| OCR fallback, value next to its printed label / strong anchor | `clamp(0.35 + 0.5·lc, 0.30, 0.75)` | `null` |
| OCR fallback, value without a strong anchor | `clamp(0.15 + 0.4·lc, 0.15, 0.55)` | `null` |
| any of the above but **normalization failed** (`value = null`) | `score · 0.5` | unchanged |

`lc = lineConfidence / 100` (tesseract line confidence). The doc-comment's stated
intent: *the score orders the review list and flags fields for a closer look; it
is deliberately not a calibrated probability; the constants are uncalibrated
heuristic knobs — only their ordering is load-bearing.* The review UI renders
this as a labelled heuristic ("MRZ check digit OK", "OCR — low") plus a
check-digit chip, never as a bare "% correct".

---

## 7. Extraction-run model (Amendment 3)

- One `POST /extract` = one `extraction_runs` row; `attempt = 1 + max(prior)`,
  computed inside the write transaction; `UNIQUE(document_id, attempt)`.
- The row records `method`, `status` (`completed`/`failed`), `mrz_detected`,
  `mrz_valid`, `ocr_mean_confidence`, `field_count`, `error_code` on failure, and
  `engine_detail` (library version + model source).
- A pipeline failure before a method is chosen is still a recorded run
  (`status = 'failed'`, `method = NULL`).
- Every `document_fields` row names its producing run. `GET /api/documents/:id`
  returns the run list plus, per field, which run produced it.
- No job queue, no scheduler, no async workers. Extraction is synchronous inside
  the request (a few seconds locally). `runExtraction`'s persistence is one
  SQLite transaction; the async pipeline call runs outside it.

---

## 8. Security & privacy checklist

| Boundary | How it holds | Evidence |
|---|---|---|
| **No network in the extraction path** | `tesseractEngine.ts` uses vendored local file paths only (no `langPath`/`corePath` URL); `pdfImage.ts` runs pdfjs with `isEvalSupported: false`, `useSystemFonts: false`, no `standardFontDataUrl`, worker disabled | `test/server/documentsNoNetwork.test.ts` fails on any `http`/`https`/`fetch` import in `src/server/documents/**`, `src/shared/mrz/**`, `src/shared/documents/**`; the `.slow` real-OCR test asserts a clean offline recognize |
| **No chip / NFC** | printed page only; no NFC/BAC/PACE code exists anywhere | grep — no chip/NFC surface |
| **Encrypted PDF rejected, no password attempt** | `pdfImage.ts` maps pdfjs `PasswordException` → `ExtractionError('pdf_encrypted')` before any `getPage`; never passes a password | `test/server/pdfImage.test.ts`; acceptance walkthrough row 4 (`errorCode: pdf_encrypted`, failed run, no password attempt) |
| **No security-feature decoding beyond the MRZ** | the MRZ is designed to be optically read; nothing else is decoded | spec §1 out-of-scope; code review |
| **Synthetic fixtures only** | every committed fixture is invented (`RAHMAN / ABDUL KARIM`, `ANNA MARIA ERIKSSON / UTO`, `SPECIMEN`); no real passport image is committed or used in any test | `test/server/pdfImage.test.ts` provenance comment; `test/helpers/mrzFixtures.ts` header; §9 fixture notes |
| **PII redaction** | `REDACT_PATHS` gains `ocrText`, `mrzLine(s)`, `extractedFields`, `text`, `lines`, `fields` (+ `*.` variants); the pipeline and service pass no extracted content to any logger; `error_code` columns hold codes only; `serializeRequest` already strips query strings | `test/server/loggerRedaction.test.ts` |
| **Loopback only** | server still binds `127.0.0.1`; stored originals are served only from the loopback server, never transmitted | unchanged from Phase 0 |
| **Path containment** | `storage.ts` — the document id is a generated UUID; the resolved storage path must stay within `DOCUMENTS_DIR`, and the store root itself is rejected | `test/server/documentStorage.test.ts` (write/read/delete + containment + root reject) |
| **File validation** | magic-byte sniff (JPEG/PNG/PDF only), 15 MiB cap, zero-byte reject; wrong type → `400 VALIDATION_ERROR` sanitized envelope | `test/server/documentFileType.test.ts`; acceptance walkthrough row 6 (GIF → 400) |
| **Never auto-verify** | no extraction code path writes `verified = 1` / `verified: true`; a service test asserts every touched `applicant_field_meta` row is `verified = 0` after any extraction | `test/server/documentsNoNetwork.test.ts` (no `verified: 1` literal in the modules); `test/server/documentApply.test.ts` |

---

## 9. Acceptance walkthrough

Run by the controller against a **live production server** (`PORT=5280 npm start`,
real `tesseract.js`, clean DB).

| Scenario | Result |
|---|---|
| `passport-specimen.png` (synthetic **labelled** mock passport data page) → upload + extract | `kind: passport`, `method: ocr`, OCR mean conf 88, **8 fields** `passport_ocr` **auto-applied**: `identity.surname` = RAHMAN, `givenNames` = ABDUL KARIM, `dateOfBirth` = 1990-01-15, `nationality` = BANGLADESHI; `passport.number` = A01234567, `issueDate` = 2019-01-02, `expiryDate` = 2030-01-14; `placeOfIssue` = "NIPMHAKA" @ conf 0.49 — an OCR misread of "DIP/DHAKA", which is exactly why every field is confirmed individually. Anchored fields conf 0.75. All `verified: 0`. |
| `mrz-clean.png` (synthetic MRZ strip, no VIZ labels) → extract | `kind: passport`, `method: ocr`, `mrzDetected: true`, `mrzValid: false`, **0 fields** — the synthetic Consolas MRZ font defeats OCR check-digit validation (0↔@, <↔K), so the MRZ path is correctly not trusted and there are no labels for the OCR fallback. Honest result; a real passport photo hits the `passport_mrz` path. |
| plain grey non-passport PNG → extract | `kind: unknown` (classification conf 0.9), `method: ocr`, 0 fields, no error. |
| `test/fixtures/documents/encrypted.pdf` → extract | `status: failed`, `errorCode: pdf_encrypted`, a `failed` `extraction_runs` row (`method: null`) recorded. **No password attempt.** |
| `test/fixtures/documents/multi-page.pdf` → extract | `status: failed`, `errorCode: pdf_unsupported`, failed run recorded. |
| GIF upload (magic bytes present) | `400 VALIDATION_ERROR` — `"unsupported file type (JPEG, PNG or PDF only)"` (sanitized envelope). |
| full lifecycle: create applicant → upload → extract → persist | applicant + document + run + `document_fields` + `applicant_field_meta` all persisted; auto-applied fields `verified: 0`; Confirm (UI) flips one field to verified and the applicant page shows the provenance hint. |

### Fixture provenance

`test/fixtures/documents/passport-specimen.png` is a synthetic labelled mock
passport data page, Pillow-rendered, holder "RAHMAN / ABDUL KARIM" — an invented
person, no real document, no real personal data. Committed with this report so the
walkthrough is reproducible. It is not referenced by any automated test (the
`.slow` OCR smoke uses `mrz-clean.png`); PDF-fixture provenance is documented in
`test/server/pdfImage.test.ts` and MRZ-specimen provenance in
`test/helpers/mrzFixtures.ts`.

---

## 10. Spec §18 acceptance checklist — 13 items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | `typecheck` (×4), `lint`, `test`, `build` all green | **PASS** | §"Last verified" — 4 tsc passes, lint clean, 423 tests / 48 files, build OK |
| 2 | Migration 3 creates the three tables + `applicant_field_meta.document_id`; `LATEST_SCHEMA_VERSION === 3`; fresh DB and v2→v3 both succeed | **PASS** | `test/server/documentMigrations.test.ts`, `test/server/migrations.test.ts`; `migrations.ts` `version: 3` |
| 3 | Upload JPEG/PNG/single-image-PDF stores under `data/documents/`, sniffs by magic bytes, rejects everything else, never transmits | **PASS** | `documentFileType.test.ts`, `documentStorage.test.ts`, `documentRoutes.test.ts`; walkthrough row 6 |
| 4 | A synthetic passport MRZ image yields the 8 MRZ fields as `document_fields` with `source = 'passport_mrz'` and check-digit-backed confidence | **PARTIAL** | The MRZ path is fully implemented and unit-proven with supplied TD3 text (`td3.test.ts`, `extractionPipeline.test.ts`, `mapMrzResult.test.ts`, `confidence.test.ts`). End-to-end from a **committed image**, real `tesseract.js` cannot read the synthetic Consolas MRZ font well enough to pass ICAO check digits (walkthrough row 2), and no real passport fixture may be committed. A real passport photo exercises `passport_mrz`; a high-fidelity synthetic OCR-B fixture or a manual QA pass is the recommended close (§11). |
| 5 | TD3 parsing is done by `td3.ts`, not tesseract; with the Fake injected the MRZ path still works from supplied text | **PASS** | `td3.test.ts` (SPECIMEN pairs, every check digit, composite, `overallValid`); `extractionPipeline.test.ts` uses `FakeOcrEngine`; `documentsNoNetwork.test.ts` |
| 6 | MRZ absent/invalid → OCR-fallback fields with `source = 'passport_ocr'` / `'document_ocr'`, lower confidence, run `method = 'ocr'` | **PASS** | `ocrFieldExtract.test.ts`, `extractionPipeline.test.ts` (fake returns broken MRZ); walkthrough row 1 (8 `passport_ocr` @ 0.75) and row 3 |
| 7 | Every extraction is an `extraction_runs` row with an incrementing `attempt`; every `document_fields` row names its run; re-extraction is a distinct run | **PASS** | `documentService.test.ts` (lifecycle + attempt numbering + `field_count`); `document_fields.extraction_run_id` NOT NULL |
| 8 | Profile application follows §10 exactly — EMPTY auto-fills (`verified = 0`), DIFFERENT/verified holds, SAME no false-collide + preserves verification, unnormalizable holds with a note; `applied != verified` | **PASS** | `documentApply.test.ts` (case table exhaustive incl. all `M` sub-cases, apply-over-verified → `verified: 0`, dismiss stickiness, re-extraction re-evaluation) |
| 9 | No extraction path sets `verified = 1`; guard test passes; confidence `NULL` for manual values | **PASS** | `documentsNoNetwork.test.ts` (no `verified: 1` literal); `documentApply.test.ts` asserts `verified = 0`; Phase 2 `fieldMetaInputSchema` keeps manual confidence `NULL` |
| 10 | Review UI shows per field: value, source, labelled heuristic confidence, in-profile status, verification status, link to original; per-field Confirm / Apply / Dismiss work | **PASS** | `DocumentDetailPage.tsx` + `ExtractedFieldsTable.tsx`; `test/web/DocumentDetailPage.test.tsx` (columns, Confirm → `field-meta` verify call, Apply/Dismiss, Confirm disabled on mismatch); walkthrough row 7 |
| 11 | Encrypted PDF rejected with `pdf_encrypted` and no password attempt; no chip/NFC; no external OCR call (import + behaviour tests) | **PASS** | `pdfImage.test.ts`; `documentsNoNetwork.test.ts`; walkthrough rows 4–5 |
| 12 | `REDACT_PATHS` covers the new PII keys; no OCR/MRZ/field content in logs; error envelopes sanitized | **PASS** | `loggerRedaction.test.ts`; `documentRoutes.test.ts` sanitized-envelope assertions; `error_code` columns are code-only |
| 13 | Only synthetic/SPECIMEN fixtures committed; `vendor/tessdata/` has a README with source + SHA-256 + licence | **PASS** | `vendor/tessdata/README.md` (URL, SHA-256 `7d4322bd…70b2`, Apache-2.0); fixture provenance §9; `pdfImage.test.ts` + `mrzFixtures.ts` headers |

**12 PASS, 1 PARTIAL (item 4)** — the partial is a fixture-fidelity limitation of
the synthetic MRZ image versus real OCR-B, not a gap in the MRZ code path, which
is complete and unit-verified.

---

## 11. Deferred follow-ups

### Should fix before operational use

- **`identity.fullNameAsInPassport` has no producer (Task 8 / spec §9).**
  `mapMrzResult` iterates `MRZ_FIELD_MAP` (surname / givenNames, not fullName);
  `ocrFieldExtract` emits surname + givenNames separately. Spec §9 lists
  `ocr.fullName` as an OCR-fallback field with no code emitting it. **Decision
  needed:** add a "NAME" / "FULL NAME" OCR label pattern, OR compose it from
  surname + givenNames in the pipeline, OR accept that surname + givenNames covers
  the India e-visa form need (which takes them separately) and drop
  `OCR_FIELD_MAP.fullName`. Recommendation: the third, or document the gap.
- **Real-OCR quality gap.** `tesseract.js` + `tessdata_fast` reads OCR-B MRZ on a
  real passport far better than the synthetic Consolas fixtures; the `.slow` test
  asserts only token presence, and no real passport fixture may be committed. Do a
  manual QA pass with a real (or high-fidelity synthetic OCR-B) passport before
  relying on the `passport_mrz` path. (This is the §10 item-4 PARTIAL.)
- **`sourceConfidence` enum for visa-kb schema v2** (carried from Phase 1) — still
  recommended before operational use of the Regular-visa data.

### Code hygiene / robustness (non-blocking)

- **Task 2** — a one-line in-code caveat that `text` / `lines` / `fields` are
  generic redaction keys (rationale currently only in this report).
- **Task 11 #1** — `tesseractEngine` poisoned-init promise: a failed worker init
  leaves the promise rejected forever and `dispose()` would throw (broken-install
  path only).
- **Task 12** — `internal` and `not_an_image` pipeline error paths are untested
  (one-liners).
- **Task 13** — `!M` and `M.source === 'manual'` branches are byte-identical
  (collapse); `META_COLS[key]` is unguarded in the hand-written SQL SET builder
  (safe today — keys are code constants).
- **Task 14** — `getDocument` N+1 (one meta SELECT per field); a failed-branch
  `return` sits inside the `try`.
- **Task 15** — `documentsNoNetwork` guard misses dynamic
  `await import('node:https')` (add an `import\(` pattern); `field_has_no_value`
  → 409 could be 400.
- **Task 17** — a page-level Re-extract/Delete error replaces the whole review
  view; the "In profile?" column shows status, not `profileMatches` divergence.
- **Task 18** — dead `.documents-subsection__list` CSS class.
- **Tasks 3–7 test hygiene** — MRZ date-window boundary coverage is one-sided;
  `mapMrzResult`'s drop rule is not directly tested; a few missing
  `toHaveLength` / `raw_value` assertions.

### Process note

6 controller spec-reconciliation commits during execution — `58c24ff` / `4d56f49`
/ `0e68880` (PDF → re-encoded PNG + vendored-model size); `3324d8b`
(`scoreOcrField` unanchored base 0.20 → 0.15); `c7fb6b5` (§4 Mixed path wording).
All doc-only, aligning the spec with `pdfjs-4.x` reality and the plan's own tests.

---

## 12. Recommended next phase

**Phase 4 — per-application document checklist + field reconciliation UI.**

1. Wire the visa-kb `requiredDocuments` / `optionalDocuments` lists (Phase 1) into
   a per-applicant, per-category checklist: which required documents are uploaded,
   classified, extracted and verified.
2. Surface the `profileMatches` divergence in the review table (Task 17
   follow-up): show, per field, the extracted value **beside** the current
   profile value and its verification state, not just an `applied`/`held` label.
3. Resolve the `fullNameAsInPassport` producer decision (§11).
4. A manual QA pass with a real passport to validate the `passport_mrz` path, and
   — if it proves solid — an MRZ-vs-visual-zone cross-check for a valid MRZ
   (deferred this phase).
5. Keep every hard boundary: no portal automation, no submission, no
   CAPTCHA/OTP/MFA, no chip/NFC, no external OCR, loopback only, PII never logged.

Still open before operational use: re-verify the Phase 1 Regular-visa entries
against `hcidhaka.gov.in`, and add the `sourceConfidence` enum to the visa-kb
schema.
