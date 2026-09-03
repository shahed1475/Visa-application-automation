# Phase 3 — Passport OCR & Document Extraction

**Date:** 2026-09-04
**Status:** Approved (design + 3 amendments + acceptance checklist)
**Project:** Visa Application Autofill (local-first)
**Builds on:** Phase 0 (portal settings, app skeleton) / Phase 2 (applicant profile system,
`applicant_field_meta` provenance) / Phase 1 (India visa knowledge base).

**Related documents:**
- Foundation architecture: `docs/ARCHITECTURE.md`
- Data-source taxonomy, confidence model, ICAO 9303 passport reference, per-field
  verification model: `docs/visa-form-analysis.md` §3, §4, §7
- Portal-agnostic risk register: `docs/automation-risks.md`
- Phase 2 report (recommended-next-phase §8): `docs/PHASE-2-REPORT.md`
- Implementation plan: `docs/superpowers/plans/2026-09-04-phase-3-passport-ocr.md` (written next)

---

## 1. Purpose & scope

Add **document intelligence**: turn an uploaded passport image or PDF into
structured applicant-profile fields, each carrying a source, a heuristic
confidence score, a link back to the document it came from, and an explicit
`verified = false` until a human confirms it.

**Primary use case:** a Bangladeshi applicant's passport → an India visa
application. TD3 (passport-book) MRZ is the primary extraction path.

### In scope

1. Local upload of a passport **image (JPEG/PNG)** or a **single-image PDF**,
   stored under `data/` (gitignored), never transmitted anywhere.
2. File validation (magic-byte sniff, size cap) and SHA-256 integrity hash.
3. Document **classification** (`passport` | `unknown`) with a heuristic score.
4. **MRZ extraction** — detection of the machine-readable zone in OCR output,
   then authoritative TD3 parsing with full ICAO 9303 check-digit validation.
5. **OCR fallback** — when no valid MRZ is available, label/pattern extraction of
   passport fields from the OCR text.
6. **Normalization** — MRZ/OCR raw values → the canonical shapes the profile
   stores (ISO dates, `M`/`F`/`X`, trimmed document number, country name).
7. **Heuristic confidence scoring** per field (see §8 — an application-level
   trust hint, *not* a calibrated probability).
8. **Applicant-field mapping** — extracted fields → existing profile
   `field_path`s (`passport.number`, `identity.dateOfBirth`, …).
9. **Provenance** — write `applicant_field_meta` rows (`source`, `confidence`,
   `raw_value`, `document_id`, `verified = 0`).
10. **Profile application** — auto-fill empty profile fields; hold collisions for
    an explicit user decision (§10).
11. **Extraction-run tracking** — every extraction attempt on a document is a
    distinguishable run; every produced field is traceable to its run (§11).
12. **Review & verification UI** — per document: the extracted value, its source,
    its confidence, its current in-profile verification status, and the original
    document. Per-field **Confirm** (the explicit human-verification gate),
    **Apply** (held fields), **Dismiss**.

### Out of scope — hard boundaries (do NOT implement)

- India visa **portal automation**, form filling, automatic submission.
- CAPTCHA bypass, OTP automation, MFA automation, anti-bot bypass.
- **e-passport NFC / chip reading** — the printed page only.
- **Encrypted / password-protected PDF cracking** — such PDFs are *rejected*,
  never opened by force.
- Decoding any machine-readable **security feature** other than the MRZ (the MRZ
  is designed to be optically read; reading it is not a bypass).
- **External / cloud OCR APIs** of any kind. All OCR is local (`tesseract.js`
  WASM + a vendored model). The architecture must not be "silently" changed to
  call a remote service.
- **Real passport fixtures.** Only synthetic / SPECIMEN documents may be
  committed to the repository or used in tests.

### Deferred (YAGNI — not this phase)

Async job queue / background workers; TD1 & TD2 (ID-card) MRZ; non-passport
document types (visa labels, photos, bank letters); MRZ-vs-visual-zone
cross-checking when the MRZ is already valid; image preprocessing (deskew,
binarize, dewarp); a bulk "verify all" action; wiring the visa-kb
`requiredDocuments` lists into a per-application checklist; multi-page PDF
handling; automatic re-extraction triggers.

---

## 2. Architecture overview

### Amendment 1 — explicit stage separation

The extraction path is built as a sequence of **independently testable units**,
each with one responsibility. No unit reaches across a boundary; the pipeline
orchestrator only wires them together and owns no extraction logic of its own.

| # | Stage | Unit | Pure? | Responsibility |
|---|---|---|---|---|
| 1 | Document ingestion | `documentService.createDocument` + `fileType.ts` | no (fs/db) | accept bytes, sniff type, size-check, hash, store, insert `documents` row |
| 2 | Image/PDF preparation | `documents/pdfImage.ts` | no (pdfjs) | image → bytes as-is; single-image PDF → its one image re-encoded to PNG; else reject |
| 3 | OCR | `documents/ocrEngine.ts` (interface) + `tesseractEngine.ts` | no (wasm) | **pixels → text only.** Returns `{ text, lines[], meanConfidence }`. Knows nothing about passports or the MRZ. |
| 4 | MRZ detection | `shared/mrz/detect.ts` | yes | find the 2 candidate TD3 lines inside OCR output (or confirm none) |
| 5 | MRZ parsing | `shared/mrz/td3.ts` + `shared/mrz/checkDigit.ts` | yes | **authoritative** TD3 parser: fields + per-field & composite check digits + `overallValid` |
| 6 | OCR fallback field extraction | `shared/documents/ocrFieldExtract.ts` | yes | label/pattern extraction of passport fields from OCR text — used only when stage 5 has no valid MRZ |
| 7 | Normalization | `shared/mrz/normalize.ts` | yes | raw → canonical (ISO date, sex, country, document number, name split) |
| 8 | Confidence scoring | `shared/documents/confidence.ts` | yes | heuristic per-field score (§8) |
| 9 | Applicant-field mapping | `shared/documents/fieldMap.ts` | yes | extracted key → profile `field_path` + section |
| 10 | Provenance | `documentService` / `documentApply.ts` | no (db) | write `document_fields` + `applicant_field_meta` rows |
| 11 | Profile application | `documentApply.ts` | no (db) | the 4-case rules (§10); auto-apply vs hold |
| 12 | Review / verification | routes + React `Documents` pages | no | surface everything; per-field Confirm / Apply / Dismiss |

**`tesseract.js` is never responsible for MRZ semantics.** It is a text-from-pixels
provider. Stages 4–7 own every rule about what an MRZ is, whether it is valid, and
what its fields mean. When a valid TD3 MRZ is present, `shared/mrz/td3.ts` is the
sole authority for its field values; OCR fallback (stage 6) is used only for
fields the MRZ path could not produce.

### Orchestrator

`src/server/documents/extractionPipeline.ts` — `runExtraction(fileBytes, mime,
{ ocr }): ExtractionOutcome`. Thin: calls stages 2→9 in order, chooses MRZ-primary
vs OCR-fallback per §4, returns a plain data object. **No database access, no
filesystem access beyond what stage 2 needs, no logging of content.**

### Layering (mirrors Phase 2)

- `src/shared/mrz/**` and `src/shared/documents/**` — pure, dependency-free
  (Zod is allowed; nothing else). Compiled by every tsconfig. Server imports them;
  the web bundle imports only the types + `fieldMap` + `confidence` doc constants.
- `src/server/documents/**` — Node-only (fs, `node:sqlite`, `pdfjs-dist`,
  `tesseract.js`). Never imported by the web.
- `src/server/routes/documents.ts` — validate → service → sanitized error
  envelope (existing `routes/errors.ts`).
- `src/web/src/pages/Documents/**` — the UI.

---

## 3. Data model — migration 3

Migration 3 adds three tables and one column. `LATEST_SCHEMA_VERSION` → 3.
Table/column names are code constants (never user input), so string
interpolation in the service stays safe (Phase 2 pattern).

```sql
CREATE TABLE documents (
  id                        TEXT PRIMARY KEY,
  applicant_id              TEXT REFERENCES applicants(id) ON DELETE CASCADE,   -- nullable: upload before assigning
  kind                      TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (kind IN ('passport','unknown')),
  classification_confidence REAL,
  original_name             TEXT,
  mime_type                 TEXT NOT NULL
                            CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  byte_size                 INTEGER NOT NULL,
  sha256                    TEXT NOT NULL,
  storage_path              TEXT NOT NULL,                                       -- relative to env.DOCUMENTS_DIR
  status                    TEXT NOT NULL DEFAULT 'uploaded'
                            CHECK (status IN ('uploaded','extracted','failed')),
  latest_extraction_method  TEXT
                            CHECK (latest_extraction_method IN ('mrz','ocr','mrz_ocr') OR latest_extraction_method IS NULL),
  latest_ocr_mean_confidence REAL,
  page_count                INTEGER,
  error_code                TEXT,                                               -- code only, never content
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX idx_documents_applicant ON documents(applicant_id);

CREATE TABLE extraction_runs (
  id                  TEXT PRIMARY KEY,
  document_id         TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  attempt             INTEGER NOT NULL,                                         -- 1,2,3… per document, computed max+1 inside the write txn
  method              TEXT CHECK (method IN ('mrz','ocr','mrz_ocr') OR method IS NULL),  -- NULL when the run failed before a method was chosen
  status              TEXT NOT NULL CHECK (status IN ('completed','failed')),
  mrz_detected        INTEGER NOT NULL DEFAULT 0 CHECK (mrz_detected IN (0,1)),
  mrz_valid           INTEGER NOT NULL DEFAULT 0 CHECK (mrz_valid IN (0,1)),
  ocr_mean_confidence REAL,
  field_count         INTEGER NOT NULL DEFAULT 0,
  error_code          TEXT,
  engine_detail       TEXT,                                                     -- e.g. 'tesseract.js@<v> / eng (tessdata_fast)'
  created_at          TEXT NOT NULL,
  UNIQUE (document_id, attempt)
);
CREATE INDEX idx_extraction_runs_document ON extraction_runs(document_id);

CREATE TABLE document_fields (
  id                 TEXT PRIMARY KEY,
  document_id        TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  extraction_run_id  TEXT NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,  -- the run that last produced this row
  field_path         TEXT NOT NULL,                                             -- a valid applicant field_path
  value              TEXT,                                                      -- normalized canonical candidate; NULL if unnormalizable
  raw_value          TEXT,                                                      -- what the engine saw (PII — redacted in logs)
  source             TEXT NOT NULL
                     CHECK (source IN ('passport_mrz','passport_ocr','document_ocr')),
  confidence         REAL NOT NULL,                                             -- heuristic score 0..1 (§8)
  check_digit_ok     INTEGER CHECK (check_digit_ok IN (0,1) OR check_digit_ok IS NULL),  -- MRZ fields only
  status             TEXT NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed','applied','held','dismissed')),
  normalization_note TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (document_id, field_path)                                             -- one current proposal per field
);
CREATE INDEX idx_document_fields_document ON document_fields(document_id);

ALTER TABLE applicant_field_meta ADD COLUMN document_id TEXT
  REFERENCES documents(id) ON DELETE SET NULL;
```

Notes:

- `document_fields` holds the **current** proposal per `(document_id, field_path)`;
  its `extraction_run_id` names the run that last wrote it. Superseded per-field
  values are not retained — `extraction_runs` is the attempt-level audit trail
  (method, counts, `mrz_valid`). This is the "keep it minimal" reading of
  Amendment 3.
- `applicant_field_meta.document_id` is `ON DELETE SET NULL`: deleting a document
  keeps any profile values it filled but drops the back-link.
- `duplicateApplicant` (Phase 2) is updated to write `document_id = NULL` when it
  clones field-meta rows — documents themselves are not duplicated.

---

## 4. Extraction pipeline (stages 2–9)

`runExtraction(fileBytes, mime, { ocr }): ExtractionOutcome`

1. **Prepare** (stage 2): `image/jpeg`|`image/png` → bytes unchanged.
   `application/pdf` → `pdfImage.extractSingleImage(bytes)`:
   - encrypted / password-protected → throw `ExtractionError('pdf_encrypted')`.
   - exactly one page **and** exactly one image XObject → return
     `{ bytes: <png>, mime: 'image/png' }` (pdfjs's decoded pixels re-encoded).
   - anything else → `ExtractionError('pdf_unsupported')` (guidance: upload the
     photo page as a JPEG/PNG).
2. **OCR** (stage 3): `ocr.recognize(imageBytes)` → `OcrResult`. Failure →
   `ExtractionError('unreadable')`.
3. **MRZ detect** (stage 4): `detectMrzLines(ocrResult.lines)` → `{ line1, line2 }`
   or `null`. Heuristic: two consecutive lines, each ~44 chars of `[A-Z0-9<]`
   after light cleanup (uppercase, strip spaces, map common OCR confusions only
   for the *shape test* — not for parsed values), the second starting plausibly
   with a document number block.
4. **MRZ parse** (stage 5): if lines found, `parseTd3(line1, line2)` →
   `Td3Result` with every field's `{ raw, checkDigit? }` and
   `composite.ok` / `overallValid`.
5. **Classify** (stage): `classifyDocument({ mrzDetected, mrzDocType,
   mrzOverallValid, ocrText })` → `{ kind, confidence }`.
   - 2 TD3 lines + doc code `P`/`P<` → `passport` (0.97 if `overallValid`, else 0.80).
   - no MRZ but OCR text matches passport keywords (`PASSPORT`, `P<`, `REPUBLIC OF`,
     `MRZ`) → `passport` (0.55).
   - else → `unknown` (confidence = 1 − passport-likelihood).
6. **Field extraction** (stages 6–7):
   - **MRZ primary** — when `Td3Result` exists and any of: `overallValid`;
     `composite.ok`; or the document-number, date-of-birth and expiry-date check
     digits are all OK. Produce one candidate per MRZ-mapped field from `td3`
     values, `source = 'passport_mrz'`. (A field whose *own* check digit failed
     is still emitted, at the lower score in §8.)
   - **OCR fallback** — otherwise: `extractFieldsFromOcr(text, lines, kind)` →
     candidates, `source = 'passport_ocr'` if `kind === 'passport'` else
     `'document_ocr'`.
   - **Mixed** — if MRZ is primary but produced no value for a mapped field, that
     one field may be taken from OCR fallback (marks the run `method = 'mrz_ocr'`).
   - Each candidate is normalized (stage 7). A value that fails normalization is
     still emitted with `value = null`, `raw` kept, `normalizationNote` set.
7. **Score** (stage 8): `confidence.ts` assigns each candidate a heuristic score.
8. **Map** (stage 9): `fieldMap.ts` resolves each candidate key to its profile
   `field_path`; unmappable keys are dropped.
9. Return:

```ts
interface ExtractionOutcome {
  kind: 'passport' | 'unknown';
  classificationConfidence: number;
  method: 'mrz' | 'ocr' | 'mrz_ocr';
  mrzDetected: boolean;
  mrzValid: boolean;
  ocrMeanConfidence: number | null;
  fields: ExtractedField[];          // { fieldPath, value|null, raw, source, confidence, checkDigitOk|null, normalizationNote|null }
  warnings: string[];
}
```

Errors from any stage are `ExtractionError` with a stable `code`
(`pdf_encrypted`, `pdf_unsupported`, `unreadable`, `not_an_image`,
`internal`). Never carry document content in a message.

---

## 5. MRZ subsystem (`src/shared/mrz/`)

Pure, zero runtime dependency. TD3 only (2 lines × 44 chars).

- **`checkDigit.ts`** — `charValue(c)` (0–9 → digit, A–Z → 10–35, `<` → 0),
  `computeCheckDigit(field: string): number` (weights cycle 7, 3, 1),
  `verifyCheckDigit(field: string, digit: string): boolean` (a non-numeric or
  `<` supplied digit is a fail, not a throw).
- **`detect.ts`** — `detectMrzLines(lines: OcrLine[]): DetectedMrz | null`.
  Shape heuristics only; produces the two raw candidate strings (padded/truncated
  to 44). Independent of `td3.ts`.
- **`td3.ts`** — `parseTd3(line1: string, line2: string): Td3Result`.
  Line 1: document code, issuing state (pos 3–5), name field (surname `<<` given,
  `<` word separators, `<`-padding trimmed). Line 2: document number + check,
  nationality, date of birth `YYMMDD` + check, sex, expiry date `YYMMDD` + check,
  optional personal number + check, composite check over the defined ranges.
  Returns each field's `raw`, its `checkDigit` result where one exists, and:
  - `composite: { input, expected, actual, ok }`
  - `overallValid: boolean` — composite OK **and** all mandatory field checks OK.
- **`normalize.ts`**:
  - `normalizeMrzDate(yymmdd, kind: 'birth' | 'expiry'): string | null` — ISO
    `YYYY-MM-DD`; century window: `birth` → not in the future (else −100y);
    `expiry` → within [today − 10y, today + 20y]. Invalid calendar date → `null`.
  - `normalizeSex('M'|'F'|'<'|'X'): 'M'|'F'|'X'` (`<` → `X`).
  - `normalizeCountry(alpha3): string` — map to country name for a small known
    set (`BGD`→Bangladesh, `IND`→India, plus common issuers); unknown → the raw
    code (never guessed).
  - `normalizeDocNumber(raw): string` — strip trailing `<`, uppercase.
  - `splitName(nameField): { surname: string|null, givenNames: string|null }`.

---

## 6. OCR engine (`src/server/documents/`)

### Amendment 1 — local only, isolated behind an interface

```ts
export interface OcrResult {
  text: string;
  lines: { text: string; confidence: number; bbox?: [number,number,number,number] }[];
  meanConfidence: number;   // 0..100 (tesseract scale)
}
export interface OcrEngine {
  recognize(image: Uint8Array): Promise<OcrResult>;
  dispose(): Promise<void>;
}
```

- **`tesseractEngine.ts`** — the only real implementation. `tesseract.js` WASM,
  language `eng`, model **vendored** at `vendor/tessdata/eng.traineddata`
  (`tessdata_fast`, ~4 MB), core & worker resolved from `node_modules`. A lazily
  created worker, reused across calls, torn down by `dispose()`. It is constructed
  with **local file paths only** — no `langPath`/`corePath` URL, no network.
  `engine_detail` string records the library version + model source.
- **`FakeOcrEngine`** (`test/helpers/fakeOcrEngine.ts`) — returns a caller-supplied
  `OcrResult`. Every pipeline / service test uses it. Injected via
  `buildServer({ ocr })` and defaulted to `tesseractEngine` in production
  (`src/server/index.ts`).
- One real-OCR integration test (`test/server/tesseractEngine.slow.test.ts`)
  runs the real engine against a committed **synthetic** MRZ image and asserts the
  MRZ lines come back parseable. If it proves slow/flaky in execution it is
  marked `.skip` with a deferred-follow-up note — it must never block the gate.

`.gitignore` gains `!vendor/` + `!vendor/tessdata/` + `!vendor/tessdata/*`
(the root `data/` rule is unaffected). The vendored model is documented in
`vendor/tessdata/README.md` (source URL, SHA-256, licence — Apache 2.0).

---

## 7. PDF handling (`src/server/documents/pdfImage.ts`)

`pdfjs-dist` legacy build, worker disabled, **no canvas, no network**
(`isEvalSupported: false`, `useSystemFonts: false`, no `standardFontDataUrl`).

- Encrypted PDF (`PasswordException`) → `ExtractionError('pdf_encrypted')`.
  **No password attempt.**
- Load page 1; walk its operator list for `paintImageXObject` /
  `paintImageXObjectRepeat`; resolve the image object(s).
- Exactly one image → take pdfjs's **decoded pixels** (`img.kind` 2 = RGB, 3 =
  RGBA; kind 1 / 1-bit grayscale is rejected) and **re-encode to PNG** with
  `node:zlib` (pdfjs 4.x does not hand back the original JPEG stream), returning
  `{ bytes: <png>, mime: 'image/png' }`. tesseract reads PNG natively, so the
  downstream pipeline is unaffected.
- 0 images, > 1 image, kind 1, or > 1 page → `ExtractionError('pdf_unsupported')`.
- `page_count` recorded on the `documents` row regardless.

---

## 8. Confidence scoring

### Amendment 2 — semantics

`confidence` is an **application-level heuristic trust score in [0, 1]**. It
exists to order the review list and flag fields that need a closer look. It is
**not** a statistically calibrated probability. A score of `0.99` means "this
value came from an MRZ field whose ICAO 9303 check digit passed" — a strong
structural-integrity signal — **not** "99 % chance the value is correct". The
scoring rules below are the whole definition; they are documented in
`confidence.ts` as a module doc-comment and surfaced to the user in the review UI
as a labelled heuristic ("MRZ check digit OK", "OCR — low"), not as a bare
percentage claiming certainty.

**Never invented for manual input.** `applicant_field_meta.confidence` stays
`NULL` for `manual` / `imported` / `system` sources (already enforced by
`fieldMetaInputSchema` and the Phase 2 write path). Extraction is the only writer
of a non-null confidence.

### Rules (`shared/documents/confidence.ts`, pure, every branch tested)

| Situation | Score | `check_digit_ok` |
|---|---|---|
| MRZ field, own check digit present and **OK** | `0.99` | `1` |
| MRZ field, own check digit present and **FAILED** | `0.55` | `0` |
| MRZ field, no own check digit (name, issuing country, doc type), line's other checks OK | `0.95` | `null` |
| MRZ field, no own check digit, sibling checks failed | `0.60` | `null` |
| OCR fallback, value found next to its printed label / strong anchor | `clamp(0.35 + 0.5·(lineConf/100), 0.30, 0.75)` | `null` |
| OCR fallback, value found without a strong anchor | `clamp(0.15 + 0.4·(lineConf/100), 0.15, 0.55)` | `null` |
| Any of the above, but **normalization failed** (`value = null`) | `score · 0.5` | unchanged |

`lineConf` is the tesseract line confidence (0–100) for the line the value came
from. The unanchored base was `0.20` in the first draft; it is `0.15` here so the
floor is the lc-0 value (parallel to the anchored formula's base-above-floor
shape). These constants are uncalibrated heuristic knobs (see Amendment 2) — the
exact numbers are not load-bearing, only their ordering.

---

## 9. Applicant-field mapping (`src/shared/documents/fieldMap.ts`)

Single source of truth for "what a passport can fill". Every target is an
existing Phase 2 `field_path` and must satisfy `isValidFieldPath`.

| Extracted key | `field_path` | Section |
|---|---|---|
| `mrz.documentCode` → derived | `passport.documentType` | passport |
| `mrz.documentNumber` | `passport.number` | passport |
| `mrz.issuingState` | `passport.issuingState` | passport |
| `mrz.expiryDate` | `passport.expiryDate` | passport |
| `mrz.surname` | `identity.surname` | identity |
| `mrz.givenNames` | `identity.givenNames` | identity |
| `mrz.nationality` | `identity.nationality` | identity |
| `mrz.dateOfBirth` | `identity.dateOfBirth` | identity |
| `mrz.sex` | `identity.sex` | identity |
| `ocr.placeOfIssue` (fallback only) | `passport.placeOfIssue` | passport |
| `ocr.issueDate` (fallback only) | `passport.issueDate` | passport |
| `ocr.fullName` (fallback only) | `identity.fullNameAsInPassport` | identity |

`fullNameAsInPassport` from the MRZ path = `surname + ', ' + givenNames`
reconstruction is **not** done automatically (MRZ names are truncated/transliterated);
it stays an OCR-fallback field only. Mapping completeness is unit-tested.

---

## 10. Profile application rules (`src/server/documents/documentApply.ts`)

For each mapped `ExtractedField` E (path `P`, normalized value `V`, provenance
`{source, confidence, raw}`), with current canonical value `C` at `P` (from the
section table) and current `applicant_field_meta` row `M` at `P` (may be absent):

**Remember: `applied != verified`.** Auto-apply never sets `verified = 1`.
The only path to `verified = 1` is the existing separate
`PUT /api/applicants/:id/field-meta { fieldPath, verified: true }` (Phase 2),
which omits `source` and so preserves provenance.

| Case | Condition | Action |
|---|---|---|
| **EMPTY FIELD** | `C` is `NULL`/`''` | write `V` to the section table; upsert `M` = `{source, confidence, raw_value, document_id, verified: 0}`; `document_fields.status = 'applied'` |
| **SAME VALUE** | `C === V` (post-normalization) | **no collision.** `document_fields.status = 'applied'`. Preserve verification state: if `M.verified` → leave `M` untouched. Else update provenance appropriately: absent `M` → create `{source, confidence, raw_value, document_id, verified: 0}`; `M.source === 'manual'` (unverified) → upgrade to `{source, confidence, raw_value, document_id, verified: 0}`; `M` already an OCR source → refresh `confidence`/`raw_value`/`document_id` to this run's |
| **EXISTING DIFFERENT VALUE** | `C` set, `C !== V`, `M?.verified !== true` | **do not overwrite.** `document_fields.status = 'held'`. Section table and `M` untouched. |
| **EXISTING VERIFIED VALUE** | `M?.verified === true`, `C !== V` | **never overwrite automatically.** `document_fields.status = 'held'`. |
| **UNNORMALIZABLE** | `V` is `null` | `document_fields.status = 'held'`, `normalization_note` set, nothing written to the profile (Apply is disabled for a null value — the row prompts manual entry) |

**Held-field resolution** (explicit user action):

- `POST /api/documents/:id/fields/apply { fieldPath }` — write the held `V` into
  the section table; upsert `M` = `{source, confidence, raw_value, document_id,
  verified: 0}` (**even if the previous value was verified — the new value must be
  re-confirmed**); `document_fields.status = 'applied'`.
- `POST /api/documents/:id/fields/dismiss { fieldPath }` — `document_fields.status
  = 'dismissed'`; never auto-offered again, including on re-extraction.

**Re-extraction** (a 2nd+ run on the same document): a new `extraction_runs` row
(`attempt = max + 1`). For each field the new run produces:

- target `document_fields` row is `dismissed` → untouched (sticky).
- absent → insert, then apply the case table above against current profile state.
- present, not dismissed → update
  `value`/`raw_value`/`source`/`confidence`/`check_digit_ok`/`extraction_run_id`,
  then re-evaluate `status` via the case table against **current** profile state.

Fields a prior run produced that the new run does not → left as-is.

The whole of `runExtraction`'s persistence (run row + every `document_fields`
upsert + every profile write) is one SQLite transaction.

---

## 11. Extraction-run tracking

### Amendment 3

- One `POST /api/documents/:id/extract` call = one `extraction_runs` row.
- `attempt` is `1 + max(existing attempt for this document)`.
- The row records `method` (`mrz` / `ocr` / `mrz_ocr`), `status`
  (`completed` / `failed`), `mrz_detected`, `mrz_valid`, `ocr_mean_confidence`,
  `field_count`, `error_code` (on failure), `engine_detail`.
- Every `document_fields` row carries `extraction_run_id` — the run that last
  produced it. `GET /api/documents/:id` returns the run list plus, per field,
  which run it came from.
- No job queue, no async processing, no scheduler. Extraction runs synchronously
  inside the request (acceptable for a local single-user tool; a few seconds).

---

## 12. Provenance & the never-auto-verify guarantee

- Extraction has **no code path** that writes `verified = 1` /
  `verified: true` — enforced by a source-grep guard test over
  `src/server/documents/**`, `src/shared/mrz/**`, `src/shared/documents/**`.
- `fieldMetaInputSchema.superRefine` already rejects `{ source: <ocr>,
  verified: true }` in one write (Phase 2, finding I3).
- A service test asserts: after any extraction, every `applicant_field_meta` row
  the run touched has `verified = 0`.
- `FIELD_SOURCES` in `src/shared/applicant/fieldPaths.ts` already contains
  `passport_mrz`, `passport_ocr`, `document_ocr` — no change needed. `OCR_SOURCES`
  likewise.
- The `documents.error_code` / `extraction_runs.error_code` columns hold codes
  only.

---

## 13. API

All under the existing loopback-only Fastify server; all error responses go
through `routes/errors.ts` (sanitized envelope).

| Method | Route | Body / query | Response |
|---|---|---|---|
| `POST` | `/api/documents` | `multipart/form-data`: `file` (required), `applicantId` (optional) | `201 { document }` — uploaded + stored + sniffed; **no extraction yet** |
| `POST` | `/api/documents/:id/extract` | — | `200 { document }` — full detail incl. runs + fields (or `{ document }` with `status:'failed'` + `error_code`) |
| `GET` | `/api/documents` | `?applicantId=` (optional) | `{ documents: DocumentSummary[] }` |
| `GET` | `/api/documents/:id` | — | `{ document: DocumentDetail }` (runs, fields with live verification status) |
| `GET` | `/api/documents/:id/file` | — | the stored original bytes, correct `content-type`, `content-disposition: inline` |
| `POST` | `/api/documents/:id/fields/apply` | `{ fieldPath }` | `{ document }` |
| `POST` | `/api/documents/:id/fields/dismiss` | `{ fieldPath }` | `{ document }` |
| `DELETE` | `/api/documents/:id` | — | `{ deleted: true }` — row + stored file removed; profile values kept, `document_id` nulled |

- `@fastify/multipart` with `limits: { fileSize: 15 MiB, files: 1, fields: 4 }`.
  Oversize / wrong-type / zero-byte → `400 VALIDATION_ERROR`.
- `POST /extract` on an already-extracted document performs a re-extraction
  (new run).
- Route bodies are never logged (Phase 2 pattern); `fieldPath` values are
  validated against `isValidFieldPath`.

---

## 14. Review & verification UI

### `/documents` — `DocumentsPage.tsx`

Upload control (file input + optional applicant select) and a table of documents:
original name, `kind` badge, status, run count, extracted-field count, link to
detail. Upload → `POST /api/documents` → navigate to detail → auto-trigger
`POST /extract` (with a visible "Extracting…" state).

### `/documents/:id` — `DocumentDetailPage.tsx` (the review UI)

- **Header:** original filename · classified `kind` + classification confidence ·
  latest extraction method (MRZ / OCR / MRZ+OCR) · latest OCR mean confidence ·
  a "Re-extract" button.
- **Original document reference:** `<img src="/api/documents/:id/file">` for an
  image; a download link for a PDF.
- **Runs:** a compact list — attempt #, method, `mrz_valid`, field count, time.
- **Extracted fields table** — columns:
  `Field` · `Extracted value` · `Source` · `Confidence` (labelled heuristic +
  a "✓ check digit" chip when `check_digit_ok = 1`) · `In profile?`
  (applied / held / dismissed / not applied) · `Verified?` (from
  `applicant_field_meta`) · `Actions`.
  Row actions: **Confirm** (→ `PUT /api/applicants/:applicantId/field-meta
  { fieldPath, verified: true }` — the explicit human gate; disabled unless the
  field is applied and its profile value equals the extracted value),
  **Apply** (held rows with a non-null value), **Dismiss**.
- No bulk verify. Each Confirm is the user asserting they checked that one field
  against the document.
- A document with no `applicantId` shows an "Assign to applicant" control;
  extraction requires an assigned applicant.

### `ApplicantDetailPage.tsx`

- New "Documents" subsection: the applicant's documents + an inline upload.
- `SectionCard` rows whose `applicant_field_meta.source !== 'manual'` show a hint
  line under the value: `passport MRZ · 0.99 · from <original_name>` linking to
  the document. (`SectionCard` already receives `fieldMeta`; add the render + the
  optional `document` lookup.)

### `api/client.ts`

- `request()` gains: if `init.body instanceof FormData`, do not set
  `content-type` (the browser sets the multipart boundary). Regression-tested.
- New methods: `uploadDocument`, `extractDocument`, `listDocuments`,
  `getDocument`, `documentFileUrl`, `applyDocumentField`, `dismissDocumentField`,
  `deleteDocument`.

---

## 15. Privacy & security boundaries

- **No network in the extraction path.** tesseract.js uses vendored local paths;
  pdfjs runs with eval/system-font/network features off. A test asserts no
  `node:http(s)` / `fetch` / `undici` import under `src/server/documents/**`,
  `src/shared/mrz/**`, `src/shared/documents/**`.
- **PII never logged.** `REDACT_PATHS` gains `ocrText`, `text`, `lines`,
  `mrzLine`, `mrzLines`, `extractedFields`, `fields`, `documentText`.
  `serializeRequest` already strips query strings. The pipeline and service pass
  no extracted content to any logger; errors carry codes.
- **Stored originals** live under `env.DOCUMENTS_DIR` (`<DATA_DIR>/documents/`,
  gitignored), served only from the loopback server, never transmitted anywhere.
  `storage.ts` guards against path traversal (id is a generated UUID; the
  resolved path must stay within `DOCUMENTS_DIR`).
- **No document-security bypass:** encrypted PDF → rejected, no password attempt;
  no chip/NFC; no security-feature decoding beyond the MRZ.
- **SHA-256** stored for integrity and (future) dedup, computed with
  `node:crypto`.
- Existing boundaries unchanged: server binds `127.0.0.1` only; no portal
  interaction; final submission (future phases) always user-controlled.

---

## 16. Dependencies (justification)

| Package | Kind | Why | WDAC / offline |
|---|---|---|---|
| `tesseract.js` (v5/v6) | prod | the local OCR engine (Amendment 1 decision) | pure JS + WASM — safe; model vendored |
| `pdfjs-dist` (legacy build) | prod | parse a single-image PDF, take its one decoded image, detect encryption | pure JS + WASM — safe; run with no network |
| `@fastify/multipart` (v9) | prod | file upload for Fastify 5 | pure JS — safe |
| `form-data` | dev | build multipart bodies in route tests | test only |
| `vendor/tessdata/eng.traineddata` | vendored asset (~4 MB, tessdata_fast eng) | offline + reproducible OCR | committed, git-exempt like the visa-kb JSON |

No native addon is added (WDAC constraint from Phase 0 Amendment 01 holds).
MRZ parsing, check digits, classification, confidence, normalization, and OCR
field extraction are **hand-written, dependency-free**.

---

## 17. Testing strategy

Vitest 3, same 4-tsconfig gate as Phase 1/2. Target ~90–120 new tests. The gate
(`typecheck` ×4, `lint`, `test`, `build`) stays green at the end of every task.

**Shared (pure):**
- `test/shared/mrz/checkDigit.test.ts` — ICAO 9303 published vectors; `<`/bad digit.
- `test/shared/mrz/td3.test.ts` — SPECIMEN TD3 pairs: field slicing, `<` filler,
  name split, each check digit, composite, `overallValid`, truncated names.
- `test/shared/mrz/detect.test.ts` — finds MRZ lines amid noise; returns `null`
  when absent; tolerates OCR shape confusions.
- `test/shared/mrz/normalize.test.ts` — date century windows (birth vs expiry),
  invalid calendar dates → `null`, sex, country map + passthrough, doc number.
- `test/shared/documents/confidence.test.ts` — every row of the §8 table.
- `test/shared/documents/classify.test.ts` — passport via MRZ, passport via
  keywords, unknown.
- `test/shared/documents/fieldMap.test.ts` — every target is a valid `field_path`;
  mapping is total over the MRZ field set.
- `test/shared/documents/ocrFieldExtract.test.ts` — labelled extraction, anchors,
  misses.

**Server:**
- `test/server/documentMigrations.test.ts` — v3 tables, CHECK constraints, FKs,
  `applicant_field_meta.document_id` + `ON DELETE SET NULL`, `UNIQUE`s.
- `test/server/migrations.test.ts` — `LATEST_SCHEMA_VERSION === 3` (update).
- `test/server/documentFileType.test.ts` — magic-byte accept/reject, size.
- `test/server/documentStorage.test.ts` — write/read/delete, path containment.
- `test/server/pdfImage.test.ts` — single-image PDF → PNG; encrypted → reject
  (no password attempt); 0-image / multi-image / multi-page → reject. (A single
  image of any XObject filter is accepted — pdfjs has already decoded it — so
  there is no filter-based reject.)
- `test/server/extractionPipeline.test.ts` — `FakeOcrEngine`: MRZ-primary path;
  OCR-fallback path (fake returns broken MRZ); mixed `mrz_ocr`; classification;
  normalization failure surfaces `value:null`; no content in errors.
- `test/server/documentApply.test.ts` — the §10 case table exhaustively: EMPTY,
  SAME (all `M` sub-cases), DIFFERENT-unverified, DIFFERENT-verified, null value;
  apply-held (incl. over a verified value → `verified:0`); dismiss stickiness;
  re-extraction status re-evaluation.
- `test/server/documentService.test.ts` — upload→extract→re-extract lifecycle;
  run rows + attempt numbering; `field_count`; delete removes file + row and
  nulls `applicant_field_meta.document_id`; `duplicateApplicant` writes
  `document_id = NULL`.
- `test/server/documentRoutes.test.ts` — multipart upload (via `form-data`);
  extract; list/detail; file streaming with correct headers; apply/dismiss;
  sanitized validation + not-found envelopes; oversize/zero-byte/wrong-type.
- `test/server/loggerRedaction.test.ts` — the new PII keys are redacted (extend).
- `test/server/documentsNoNetwork.test.ts` — no `http(s)`/`fetch`/`undici` import
  in the documents/mrz modules; no `verified:1|true` literal in them.
- `test/server/tesseractEngine.slow.test.ts` — real engine vs a synthetic MRZ
  image (may be `.skip` + deferred note if slow/flaky).

**Web:**
- `test/web/DocumentsPage.test.tsx` — list render; upload calls `uploadDocument`
  then `extractDocument`.
- `test/web/DocumentDetailPage.test.tsx` — header, original `<img>`, runs list,
  fields table columns, Confirm → `field-meta` verify call, Apply/Dismiss calls,
  Confirm disabled when value mismatches profile.
- `test/web/apiClient.test.ts` — `FormData` body does not get a JSON
  `content-type` (extend).

**Fixtures — `test/fixtures/documents/` (synthetic / SPECIMEN only):**
`mrz-clean.png` (a rendered TD3 MRZ, SPECIMEN holder), `single-image.pdf`
(Pillow, one DCT image), `multi-page.pdf` (Pillow, two pages), `no-image.pdf`
(minimal, one page, zero images), `encrypted.pdf` (hand-rolled stdlib RC4,
non-empty user password). Produced by the controller during planning and
committed; each contains only invented data. `vendor/tessdata/eng.traineddata`
is downloaded during planning, its SHA-256 recorded in
`vendor/tessdata/README.md`.

---

## 18. Acceptance checklist

1. `npm run typecheck` (×4), `npm run lint`, `npm test`, `npm run build` all green.
2. Migration 3 creates `documents`, `extraction_runs`, `document_fields` and adds
   `applicant_field_meta.document_id`; `LATEST_SCHEMA_VERSION === 3`; a fresh DB
   and a v2→v3 upgrade both succeed.
3. Uploading a JPEG/PNG or single-image PDF stores it under `data/documents/`,
   sniffs the type by magic bytes, rejects everything else, and never transmits
   the file.
4. A synthetic passport MRZ image, extracted, yields `passport.number`,
   `identity.dateOfBirth`, `identity.sex`, `passport.expiryDate`,
   `identity.nationality`, `identity.surname`, `identity.givenNames`,
   `passport.issuingState` as `document_fields` with `source = 'passport_mrz'`
   and check-digit-backed confidence.
5. TD3 parsing is done by `src/shared/mrz/td3.ts`, not by tesseract; with the
   real engine removed (Fake injected) the MRZ path still works from supplied
   text.
6. When the MRZ is absent/invalid, the OCR-fallback path produces fields with
   `source = 'passport_ocr'` / `'document_ocr'` and lower confidence; the run is
   recorded as `method = 'ocr'`.
7. Every extraction is an `extraction_runs` row with an incrementing `attempt`;
   every `document_fields` row names its producing run; a re-extraction is a
   distinct run.
8. Profile application follows §10 exactly — EMPTY auto-fills (`verified = 0`),
   DIFFERENT/verified holds, SAME does not false-collide and preserves
   verification, unnormalizable holds with a note. `applied != verified`.
9. No extraction path sets `verified = 1`; the guard test passes; confidence is
   `NULL` for manual values.
10. The review UI shows, per field: value, source, heuristic confidence (labelled,
    not a certainty claim), in-profile status, verification status, and links to
    the original document. Per-field Confirm / Apply / Dismiss work.
11. Encrypted PDF is rejected with `pdf_encrypted` and no password attempt; no
    chip/NFC code; no external OCR call anywhere (import + behaviour tests pass).
12. `REDACT_PATHS` covers the new PII keys; no OCR/MRZ/field content appears in
    logs; error envelopes are sanitized.
13. Only synthetic/SPECIMEN fixtures are committed; `vendor/tessdata/` carries a
    README with source + SHA-256 + licence.

---

## 19. Execution method

`superpowers:subagent-driven-development` — the workflow used for Phases 1 & 2.
One task at a time. For every task: read this spec, implement only the assigned
scope, write tests first where appropriate, run the task tests, run the full
regression gate, inspect the diff, commit, report (implementation summary / files
changed / tests / results / typecheck / lint / build / security checks / commit
hash / remaining limitations), **stop for review**. Do not start the next task
automatically. A whole-branch review closes the phase. Work continues on branch
`phase-0-portal-settings` (the established multi-phase branch). Commit trailer:

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KEBRLEQyErZX3ABjvh7ua2
```

Stop after this phase.
