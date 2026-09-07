import type { Page } from 'playwright';
import type {
  MappedField,
  PortalFieldSpec,
  VerificationOutcome,
} from '../../../shared/automation/types.js';
import {
  assertNativeOptionAvailable,
  fillText,
  readControl,
  selectCustom,
  selectNative,
  setCheckbox,
  setDate,
  setRadio,
  typeAutocomplete,
} from './pageActions.js';

/** Trim-only normalisation applied to both sides of every comparison. */
const norm = (s: string): string => s.trim();

const SELECT_CONTROLS = new Set(['native_select', 'custom_select', 'searchable_select']);

/**
 * Read the control named by `spec` and compare it to `expected`.
 *
 * - `readControl` returned `null` (unreadable) -> `'unreadable'`.
 * - For a select whose `optionMatch` is `'value'`, `readControl` yields the
 *   option *label*, not its value, so the underlying `inputValue()` is read and
 *   compared instead; for a custom widget with no `inputValue()` this falls back
 *   to the label comparison.
 * - Otherwise a trimmed string equality decides `'verified'` vs `'mismatch'`.
 *
 * Never returns, logs, or persists the read value.
 */
export async function verifyControl(
  page: Page,
  spec: PortalFieldSpec,
  expected: string,
): Promise<VerificationOutcome> {
  const actual = await readControl(page, spec.selector, spec.control);
  if (actual === null) return 'unreadable';

  if (SELECT_CONTROLS.has(spec.control) && spec.optionMatch === 'value') {
    let value: string | null = null;
    try {
      value = await page.locator(spec.selector).inputValue();
    } catch {
      value = null;
    }
    if (value !== null) {
      return norm(value) === norm(expected) ? 'verified' : 'mismatch';
    }
    // Custom widget with no inputValue(): fall through to the label comparison.
  }

  return norm(actual) === norm(expected) ? 'verified' : 'mismatch';
}

/**
 * Read-only pre-fill triage: what does the portal already hold for this field?
 *
 * - `readControl` returned `null` (unreadable / nothing selected) -> `'empty'`
 *   (defer to `applyField`, which handles the write and read-back).
 * - The control is blank after trimming -> `'empty'`.
 * - The control is sitting in its DEFAULT state -> `'empty'`: a `<select>` whose
 *   current option has an empty `value` (a `"— Select —"` placeholder still
 *   reads back a non-empty label), or an unchecked checkbox when the plan wants
 *   it checked. Neither is a value the operator entered, so pausing on it would
 *   be a spurious `value_conflict`.
 * - It already equals `expected` (same trim-equality / select-by-value rule
 *   `verifyControl` uses, so a value-matched `<select>` is never a false
 *   conflict) -> `'match'`.
 * - It holds some other non-empty value -> `'conflict'`.
 *
 * Never writes to the page and never returns, logs, or persists the read value.
 */
export async function classifyPreFill(
  page: Page,
  spec: PortalFieldSpec,
  expected: string,
): Promise<'empty' | 'match' | 'conflict'> {
  const actual = await readControl(page, spec.selector, spec.control);
  if (actual === null || norm(actual) === '') return 'empty';

  // A `<select>` resting on a placeholder option (`<option value="">`) reads back
  // a non-empty label but carries no chosen value.
  if (SELECT_CONTROLS.has(spec.control)) {
    let value: string | null = null;
    try {
      value = await page.locator(spec.selector).inputValue();
    } catch {
      value = null; // custom widget with no inputValue() — fall through
    }
    if (value !== null && norm(value) === '') return 'empty';
  }
  // An unchecked checkbox is the default state, not a pre-existing choice —
  // unless the plan also wants it unchecked (then it is a genuine match below).
  if (spec.control === 'checkbox' && norm(actual) === 'false' && norm(expected) !== 'false') {
    return 'empty';
  }

  return (await verifyControl(page, spec, expected)) === 'verified' ? 'match' : 'conflict';
}

/** Dispatch `m.expected` to the right pageActions writer for `m.spec.control`. */
async function writeControl(page: Page, spec: PortalFieldSpec, expected: string): Promise<void> {
  const sel = spec.selector;
  switch (spec.control) {
    case 'text':
    case 'textarea':
    case 'number':
      await fillText(page, sel, expected);
      return;
    case 'autocomplete':
    case 'searchable_select':
      // searchable_select behaves like an autocomplete: type then pick.
      await typeAutocomplete(page, sel, expected);
      return;
    case 'native_select':
      // Pre-fill guard: confirm the exact option exists and is enabled BEFORE
      // any write, so a missing / disabled / removed option pauses the run on
      // `option_unavailable` with the control untouched (spec §7).
      await assertNativeOptionAvailable(page, sel, expected, spec.optionMatch ?? 'label');
      await selectNative(page, sel, expected, spec.optionMatch ?? 'label');
      return;
    case 'custom_select':
      await selectCustom(page, sel, expected);
      return;
    case 'radio':
      await setRadio(page, sel, expected);
      return;
    case 'checkbox':
      await setCheckbox(page, sel, expected === 'true');
      return;
    case 'date':
      await setDate(page, sel, expected);
      return;
  }
}

/**
 * Apply a mapped field's expected value and confirm it by read-back.
 *
 * Precondition (caller guarantees; asserted defensively): `m.spec !== null`,
 * `m.present`, `m.expected !== null`.
 *
 * 1. Read the current value; a `SelectorNotFoundError` from `readControl`
 *    propagates to the engine.
 * 2. If it already equals `expected` -> `{ filled: false, outcome: 'verified',
 *    alreadySet: true }` (no write).
 * 3. Otherwise write via the control's writer, then `verifyControl`.
 * 4. On `'mismatch'`, re-run the writer exactly once and verify again.
 *
 * Returns only an outcome enum + booleans — never the value read or written.
 */
export async function applyField(
  page: Page,
  m: MappedField,
): Promise<{ filled: boolean; outcome: VerificationOutcome; alreadySet: boolean }> {
  if (m.spec === null || !m.present || m.expected === null) {
    throw new Error(
      'applyField precondition violated: requires m.spec !== null, m.present, m.expected !== null',
    );
  }
  const spec = m.spec;
  const expected = m.expected;

  const current = await readControl(page, spec.selector, spec.control);
  if (current !== null && norm(current) === norm(expected)) {
    return { filled: false, outcome: 'verified', alreadySet: true };
  }

  await writeControl(page, spec, expected);
  let outcome = await verifyControl(page, spec, expected);
  if (outcome === 'mismatch') {
    await writeControl(page, spec, expected);
    outcome = await verifyControl(page, spec, expected);
  }
  return { filled: true, outcome, alreadySet: false };
}
