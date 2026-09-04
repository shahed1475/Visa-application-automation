import { computeCheckDigit } from './checkDigit.js';
import type { Td3CheckDigit, Td3Field, Td3Result } from './types.js';

/**
 * Authoritative ICAO 9303 TD3 (passport) MRZ parser.
 *
 * When a valid TD3 MRZ is present this module is the SOLE authority for the
 * field values it exposes — raw OCR of the visual inspection zone is never
 * trusted for MRZ semantics. Every field check digit and the composite check
 * digit are verified. The parser never throws on a short or garbled line: a
 * missing / unreadable slice yields `raw = ''` (or the partial) and
 * `checkDigit.ok = false`.
 */

const TD3_LEN = 44;

/** Uppercase, drop spaces, right-pad short lines with filler. Long lines are left as-is. */
function normalize(line: string): string {
  const up = line.toUpperCase().replace(/\s+/g, '');
  return up.length < TD3_LEN ? up + '<'.repeat(TD3_LEN - up.length) : up;
}

const slice = (s: string, a: number, b: number): string => s.slice(a, b);
const trimFiller = (s: string): string => s.replace(/<+$/, '');
const charAt = (s: string, i: number): string => s[i] ?? '';

/** Compute a field check digit safely — an invalid character never throws here. */
function makeCheckDigit(input: string, actual: string, isOptionalData = false): Td3CheckDigit {
  let expected = -1;
  try {
    expected = computeCheckDigit(input);
  } catch {
    expected = -1;
  }
  let ok = /^[0-9]$/.test(actual) && Number(actual) === expected;
  // All-filler optional-data field: the printed digit is often '<' or '0'.
  // computeCheckDigit of all-filler is 0; verifyCheckDigit rejects '<', so
  // accept a supplied '<' here explicitly. This exception is scoped to the
  // optionalData field only — for any other field an all-filler slice (e.g. a
  // truncated line 2) is a parse failure, not a passing check digit.
  if (isOptionalData && !ok && input.length > 0 && /^<+$/.test(input) && actual === '<') ok = true;
  return { input, expected, actual, ok };
}

function buildField(
  fixedWidthInput: string,
  rawTrimmed: string,
  actual: string,
  isOptionalData = false,
): Td3Field {
  return { raw: rawTrimmed, checkDigit: makeCheckDigit(fixedWidthInput, actual, isOptionalData) };
}

export function parseTd3(line1Raw: string, line2Raw: string): Td3Result {
  const line1 = normalize(line1Raw);
  const line2 = normalize(line2Raw);

  // ---- Line 1: header ----
  const codeSlice = slice(line1, 0, 2);
  const documentCode = charAt(codeSlice, 0) || charAt(line1, 0);
  const issuingState = trimFiller(slice(line1, 2, 5));

  const nameField = slice(line1, 5, 44);
  const nameParts = nameField.split(/<<+/);
  const surname = (nameParts[0] ?? '').replace(/</g, ' ').trim();
  const givenNames = (nameParts[1] ?? '')
    .split(/<+/)
    .filter(Boolean)
    .join(' ');

  // ---- Line 2: data ----
  const docNumFixed = slice(line2, 0, 9);
  const documentNumber = buildField(docNumFixed, trimFiller(docNumFixed), charAt(line2, 9));

  const nationality = trimFiller(slice(line2, 10, 13));

  const dobSlice = slice(line2, 13, 19);
  const dateOfBirth = buildField(dobSlice, dobSlice, charAt(line2, 19));

  const sex = charAt(line2, 20);

  const expirySlice = slice(line2, 21, 27);
  const expiryDate = buildField(expirySlice, expirySlice, charAt(line2, 27));

  const optSlice = slice(line2, 28, 42);
  const optionalData = buildField(optSlice, trimFiller(optSlice), charAt(line2, 42), true);

  // ---- Composite check digit ----
  const compositeInput = slice(line2, 0, 10) + slice(line2, 13, 20) + slice(line2, 21, 43);
  let compositeExpected = -1;
  try {
    compositeExpected = computeCheckDigit(compositeInput);
  } catch {
    compositeExpected = -1;
  }
  const compositeActual = charAt(line2, 43);
  const composite: Td3CheckDigit = {
    input: compositeInput,
    expected: compositeExpected,
    actual: compositeActual,
    ok: /^[0-9]$/.test(compositeActual) && Number(compositeActual) === compositeExpected,
  };

  const overallValid = Boolean(
    composite.ok &&
      documentNumber.checkDigit?.ok &&
      dateOfBirth.checkDigit?.ok &&
      expiryDate.checkDigit?.ok,
  );

  return {
    documentCode,
    issuingState,
    surname,
    givenNames,
    documentNumber,
    nationality,
    dateOfBirth,
    sex,
    expiryDate,
    optionalData,
    composite,
    overallValid,
    line1,
    line2,
  };
}
