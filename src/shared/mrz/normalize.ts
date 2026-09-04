/**
 * MRZ value normalization — raw parsed fields → canonical candidates.
 *
 * Pure module: no I/O, no dependencies. Each function turns one raw MRZ field
 * into a canonical form, or returns `null` / a passthrough when the raw value
 * cannot be trusted. Nothing here fabricates data it was not given.
 */

/**
 * ISO alpha-3 → country name, for a small set of known issuers.
 *
 * This label is a display convenience ONLY. It is deliberately partial:
 * `normalizeCountry` returns any code not in this map verbatim, so an
 * unrecognised issuer is never guessed at or silently rewritten.
 */
export const COUNTRY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  BGD: 'Bangladesh',
  IND: 'India',
  NPL: 'Nepal',
  LKA: 'Sri Lanka',
  PAK: 'Pakistan',
  USA: 'United States',
  GBR: 'United Kingdom',
  CAN: 'Canada',
  AUS: 'Australia',
  ARE: 'United Arab Emirates',
  SAU: 'Saudi Arabia',
  MYS: 'Malaysia',
  SGP: 'Singapore',
  CHN: 'China',
  THA: 'Thailand',
});

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');

/**
 * `YYMMDD` → ISO `YYYY-MM-DD`, resolving the 2-digit year with a century window:
 *
 * - `birth`  — the resolved year is never in the future; a `20YY` that would be
 *   ahead of `ref` rolls back one century (`19YY`).
 * - `expiry` — the resolved year sits in a forward window; a `20YY` more than
 *   ten years before `ref` rolls forward one century (`21YY`).
 *
 * Returns `null` for a non-`\d{6}` input or an impossible calendar date
 * (verified by round-tripping through `Date.UTC`).
 */
export function normalizeMrzDate(
  yymmdd: string,
  kind: 'birth' | 'expiry',
  ref: Date = new Date(),
): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));

  let year = 2000 + yy;
  if (kind === 'birth') {
    if (year > ref.getUTCFullYear()) year -= 100;
  } else {
    if (year < ref.getUTCFullYear() - 10) year += 100;
  }

  const d = new Date(Date.UTC(year, mm - 1, dd));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== mm - 1 ||
    d.getUTCDate() !== dd
  ) {
    return null;
  }
  return `${pad4(year)}-${pad2(mm)}-${pad2(dd)}`;
}

/** MRZ sex code → `'M' | 'F' | 'X'`. Anything else (`'<'`, `''`, `'X'`) → `'X'`. */
export function normalizeSex(raw: string): 'M' | 'F' | 'X' {
  if (raw === 'M') return 'M';
  if (raw === 'F') return 'F';
  return 'X';
}

/**
 * ISO alpha-3 issuer code → country name when known, otherwise the code
 * unchanged. An unrecognised code is never guessed at.
 */
export function normalizeCountry(alpha3: string): string {
  return COUNTRY_NAMES[alpha3] ?? alpha3;
}

/** Document number: strip trailing filler and uppercase. */
export function normalizeDocNumber(raw: string): string {
  return raw.replace(/<+$/, '').toUpperCase();
}
