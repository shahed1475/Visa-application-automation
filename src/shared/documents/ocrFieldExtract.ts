/**
 * OCR-fallback field extraction (design §2 stage 6, §4 step 6).
 *
 * Used only when the MRZ path produced no valid TD3 result, or for the one
 * mapped field the MRZ path could not fill. Runs label / pattern matching over
 * the visual-inspection-zone (VIZ) OCR text — never the MRZ — and emits one
 * `ExtractedField` per recognised field.
 *
 * Interpretation (recorded in task-8-report.md §"field paths"): §9's
 * `OCR_FIELD_MAP` names the three targets that are *only ever* OCR-sourced
 * (`placeOfIssue` / `issueDate` / `fullName`). §4 step 6 requires the fallback
 * to also produce the core passport fields when there is no MRZ at all, so this
 * module additionally emits the MRZ-set paths it can label-match:
 * `passport.number`, `identity.dateOfBirth`, `passport.expiryDate`,
 * `identity.surname`, `identity.givenNames`, `identity.nationality`. Those
 * paths come from `MRZ_FIELD_MAP` so the mapping stays single-sourced.
 *
 * Pure module: imports only `./types.js`, `./fieldMap.js`, `./confidence.js`,
 * and the `OcrLine` type from `../mrz/types.js`. No Node / browser / npm surface.
 */

import type { OcrLine } from '../mrz/types.js';
import { MRZ_FIELD_MAP, OCR_FIELD_MAP } from './fieldMap.js';
import { penalizeUnnormalized, scoreOcrField } from './confidence.js';
import type { DocumentKind, ExtractedField, ExtractionSource } from './types.js';

type ValueKind = 'number' | 'date' | 'text';
type DateKind = 'birth' | 'issue' | 'expiry';

interface LabelPattern {
  fieldPath: string;
  label: RegExp;
  kind: ValueKind;
  dateKind?: DateKind;
}

/**
 * Priority order — the first pattern whose label matches a line owns that line
 * (one field per line). More specific labels come first so `DATE OF ISSUE` is
 * not shadowed by a bare `ISSUE`, etc.
 */
const PATTERNS: readonly LabelPattern[] = [
  { fieldPath: MRZ_FIELD_MAP.documentNumber.fieldPath, label: /PASSPORT\s*(?:NO|NUMBER|#)/, kind: 'number' },
  {
    fieldPath: MRZ_FIELD_MAP.dateOfBirth.fieldPath,
    label: /DATE OF BIRTH|BIRTH DATE|\bDOB\b/,
    kind: 'date',
    dateKind: 'birth',
  },
  {
    fieldPath: OCR_FIELD_MAP.issueDate.fieldPath,
    label: /DATE OF ISSUE|ISSUE DATE|DATE OF ISSUANCE/,
    kind: 'date',
    dateKind: 'issue',
  },
  {
    fieldPath: MRZ_FIELD_MAP.expiryDate.fieldPath,
    label: /DATE OF EXPIRY|DATE OF EXPIRATION|EXPIR/,
    kind: 'date',
    dateKind: 'expiry',
  },
  { fieldPath: OCR_FIELD_MAP.placeOfIssue.fieldPath, label: /PLACE OF ISSUE|ISSUING AUTHORITY|AUTHORITY/, kind: 'text' },
  { fieldPath: MRZ_FIELD_MAP.surname.fieldPath, label: /SURNAME|FAMILY NAME/, kind: 'text' },
  { fieldPath: MRZ_FIELD_MAP.givenNames.fieldPath, label: /GIVEN NAMES?|FORENAMES?/, kind: 'text' },
  { fieldPath: MRZ_FIELD_MAP.nationality.fieldPath, label: /NATIONALITY/, kind: 'text' },
];

const DATE_NOTE = 'OCR date did not resolve to a real calendar date';

const MONTHS: Readonly<Record<string, number>> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** `DD sep (MM | MON) sep (YY | YYYY)` — the VIZ convention is day-first. */
const DATE_RE = /\b(\d{1,2})[ /.-](\d{1,2}|[A-Z]{3})[ /.-](\d{2,4})\b/;

const NUMBER_TOKEN_RE = /\b[A-Z0-9]{6,9}\b/g;
const LEADING_SEP_RE = /^[\s:.–—-]+/;

function resolveTwoDigitYear(yy: number, kind: DateKind, ref: Date): number {
  const nowYear = ref.getUTCFullYear();
  let year = 2000 + yy;
  if (kind === 'expiry') {
    // Expiry may legitimately be in the future; only roll back an absurd value.
    if (year > nowYear + 25) year -= 100;
    return year;
  }
  // Birth and issue dates are never in the future.
  if (year > nowYear) year -= 100;
  return year;
}

/** `Date.UTC` round-trip — rejects `2024-02-31`, `2024-13-01` and friends. */
function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Parse a VIZ date string (day-first) to ISO `YYYY-MM-DD`, or `null`. */
function parseVizDate(raw: string, kind: DateKind, ref: Date): string | null {
  const m = DATE_RE.exec(raw.toUpperCase());
  if (!m) return null;
  const [, dRaw, moRaw, yRaw] = m;
  if (dRaw === undefined || moRaw === undefined || yRaw === undefined) return null;

  const day = Number(dRaw);
  const month = /^\d+$/.test(moRaw) ? Number(moRaw) : (MONTHS[moRaw] ?? NaN);
  let year = Number(yRaw);
  if (yRaw.length <= 2) year = resolveTwoDigitYear(year, kind, ref);

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  return toIso(year, month, day);
}

/** Pull the candidate value text out of the segment that follows a label. */
function extractRaw(segment: string, kind: ValueKind): string | null {
  if (kind === 'number') {
    const tokens = segment.toUpperCase().match(NUMBER_TOKEN_RE);
    if (!tokens || tokens.length === 0) return null;
    return tokens.find((t) => /\d/.test(t)) ?? tokens[0] ?? null;
  }
  const cleaned = segment.replace(LEADING_SEP_RE, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function nextNonEmpty(lines: readonly OcrLine[], from: number): OcrLine | null {
  for (let i = from + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l && l.text.trim().length > 0) return l;
  }
  return null;
}

export function extractFieldsFromOcr(
  text: string,
  lines: OcrLine[],
  kind: DocumentKind,
  ref: Date = new Date(),
): ExtractedField[] {
  const src: ExtractionSource = kind === 'passport' ? 'passport_ocr' : 'document_ocr';

  const rows: OcrLine[] =
    lines.length > 0
      ? lines
      : text.split(/\r?\n/).map((t) => ({ text: t, confidence: 0 }));

  // fieldPath -> { field, anchored }. First anchored match wins; else first match.
  const found = new Map<string, { field: ExtractedField; anchored: boolean }>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const upper = row.text.toUpperCase();

    for (const p of PATTERNS) {
      const lm = p.label.exec(upper);
      if (!lm) continue;

      const existing = found.get(p.fieldPath);

      // Value on the label line itself = a strong anchor.
      let raw = extractRaw(row.text.slice(lm.index + lm[0].length), p.kind);
      let anchored = true;
      let lineConfidence = row.confidence;

      if (raw === null) {
        const nx = nextNonEmpty(rows, i);
        if (nx) {
          raw = extractRaw(nx.text, p.kind);
          anchored = false;
          lineConfidence = nx.confidence;
        }
      }

      // One field per line: this label owns the line even when it yields nothing.
      if (raw === null) break;
      if (existing && (existing.anchored || !anchored)) break;

      let value: string | null;
      let note: string | null = null;
      if (p.kind === 'date') {
        value = parseVizDate(raw, p.dateKind ?? 'issue', ref);
        if (value === null) note = DATE_NOTE;
      } else if (p.kind === 'number') {
        value = raw.toUpperCase();
      } else {
        value = raw;
      }

      const base = scoreOcrField({ anchored, lineConfidence });
      found.set(p.fieldPath, {
        anchored,
        field: {
          fieldPath: p.fieldPath,
          value,
          raw,
          source: src,
          confidence: value === null ? penalizeUnnormalized(base) : base,
          checkDigitOk: null,
          normalizationNote: note,
        },
      });
      break;
    }
  }

  return [...found.values()].map((e) => e.field);
}
