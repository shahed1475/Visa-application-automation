// Deterministic India date transforms (Phase 7 spec §8).
//
// ONE shape per function. NO fuzzy parsing, NO locale guessing, NO runtime
// format detection. A validated portal mapping picks the exact forward/inverse
// pair that matches the discovered field; the real `indiaPortalMap.ts` date
// fields stay `'TODO:discover'` with NO transform until a discovery session
// establishes the format.
//
// Forward:  ISO 'YYYY-MM-DD'  ->  portal string   (used as PortalFieldSpec.transform)
// Inverse:  portal string     ->  ISO 'YYYY-MM-DD' (used as PortalFieldSpec.readBackParse)
//
// Every parser rejects anything that is not exactly its own shape by throwing
// DateFormatError — the caller (verifyControl) turns that into 'unreadable' so
// the run pauses rather than accepting an ambiguous value.

export class DateFormatError extends Error {
  constructor(
    readonly input: string,
    readonly expectedShape: string,
  ) {
    super(`date "${input}" is not in the expected format (${expectedShape})`);
    this.name = 'DateFormatError';
  }
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const toIso = (y: number, m: number, d: number): string => `${y}-${pad2(m)}-${pad2(d)}`;

/** Reject an impossible calendar date (bad month, bad day-of-month incl. leap years). */
function assertValidDate(y: number, m: number, d: number, input: string, shape: string): void {
  if (m < 1 || m > 12 || d < 1 || d > 31) throw new DateFormatError(input, shape);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) throw new DateFormatError(input, shape);
}

/** Parse a strict ISO date `YYYY-MM-DD` into its parts (validated). */
function partsFromIso(s: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!match) throw new DateFormatError(s, 'YYYY-MM-DD');
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  assertValidDate(y, m, d, s, 'YYYY-MM-DD');
  return { y, m, d };
}

// ---- forward: ISO -> portal string ----------------------------------------

export function isoToDMY(s: string): string {
  const { y, m, d } = partsFromIso(s);
  return `${pad2(d)}/${pad2(m)}/${y}`;
}

export function isoToMDY(s: string): string {
  const { y, m, d } = partsFromIso(s);
  return `${pad2(m)}/${pad2(d)}/${y}`;
}

export function isoToYMD(s: string): string {
  const { y, m, d } = partsFromIso(s);
  return `${y}/${pad2(m)}/${pad2(d)}`;
}

export function isoToDdMonYyyy(s: string): string {
  const { y, m, d } = partsFromIso(s);
  return `${pad2(d)} ${MONTHS[m - 1]} ${y}`;
}

// ---- inverse: portal string -> ISO ---------------------------------------

/** Validate + canonicalise an ISO date. Use as both `transform` and
 *  `readBackParse` for a native `<input type="date">` (portal format IS ISO). */
export function parseIso(s: string): string {
  const { y, m, d } = partsFromIso(s);
  return toIso(y, m, d);
}

type SlashOrder = 'dmy' | 'mdy' | 'ymd';

function parseSlashed(s: string, shape: string, order: SlashOrder): string {
  const match = /^(\d{1,4})\/(\d{1,4})\/(\d{1,4})$/.exec(s.trim());
  if (!match) throw new DateFormatError(s, shape);
  const a = Number(match[1]);
  const b = Number(match[2]);
  const c = Number(match[3]);
  const { y, m, d } =
    order === 'dmy'
      ? { d: a, m: b, y: c }
      : order === 'mdy'
        ? { m: a, d: b, y: c }
        : { y: a, m: b, d: c };
  if (String(y).length !== 4) throw new DateFormatError(s, shape);
  assertValidDate(y, m, d, s, shape);
  return toIso(y, m, d);
}

export function parseDMY(s: string): string {
  return parseSlashed(s, 'DD/MM/YYYY', 'dmy');
}

export function parseMDY(s: string): string {
  return parseSlashed(s, 'MM/DD/YYYY', 'mdy');
}

export function parseYMD(s: string): string {
  return parseSlashed(s, 'YYYY/MM/DD', 'ymd');
}

export function parseDdMonYyyy(s: string): string {
  const match = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(s.trim());
  if (!match) throw new DateFormatError(s, 'DD Mon YYYY');
  const d = Number(match[1]);
  const y = Number(match[3]);
  const m = MONTHS.findIndex((mon) => mon.toLowerCase() === match[2]!.toLowerCase()) + 1;
  if (m === 0) throw new DateFormatError(s, 'DD Mon YYYY');
  assertValidDate(y, m, d, s, 'DD Mon YYYY');
  return toIso(y, m, d);
}
