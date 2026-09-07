import type { Page } from 'playwright';
import type { ControlKind } from '../../../shared/automation/types.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Thrown when a selector matches no element on the page at action time.
 */
export class SelectorNotFoundError extends Error {
  constructor(readonly selector: string) {
    super(`selector not found: ${selector}`);
    this.name = 'SelectorNotFoundError';
  }
}

/**
 * Thrown when a dropdown / autocomplete has no option whose visible text
 * matches the requested value.
 */
export class OptionNotFoundError extends Error {
  constructor(
    readonly selector: string,
    readonly optionText: string,
  ) {
    super(`option "${optionText}" not found for ${selector}`);
    this.name = 'OptionNotFoundError';
  }
}

/**
 * Minimal local shape of a `<select>` element — declared here so this
 * server-side module typechecks without the DOM lib (same precedent as
 * `pageInspector.ts`). The real object is supplied by the browser.
 */
interface EvaluatedSelect {
  selectedOptions: { text: string }[];
}

async function requireSelector(page: Page, selector: string): Promise<void> {
  try {
    await page.locator(selector).first().waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT_MS });
  } catch {
    throw new SelectorNotFoundError(selector);
  }
}

/**
 * Wait for the page to reach a stable state: DOM parsed, and — when an anchor
 * selector is supplied — that anchor visible. Purely condition-based.
 */
export async function waitForPageSettled(
  page: Page,
  anchorSelector?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  if (anchorSelector) {
    await page
      .locator(anchorSelector)
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
  }
}

/**
 * Read the current value of a control, normalised to a string (or `null` when
 * nothing is selected). Read semantics vary by {@link ControlKind}.
 */
export async function readControl(
  page: Page,
  selector: string,
  control: ControlKind,
): Promise<string | null> {
  await requireSelector(page, selector);
  const locator = page.locator(selector);
  switch (control) {
    case 'text':
    case 'textarea':
    case 'number':
    case 'date':
    case 'autocomplete':
      return locator.inputValue();
    case 'native_select':
      return locator.evaluate(
        (el) => (el as unknown as EvaluatedSelect).selectedOptions[0]?.text ?? null,
      );
    case 'custom_select':
    case 'searchable_select':
      return (await locator.innerText()).trim();
    case 'radio': {
      const checked = page.locator(`${selector}:checked`);
      if ((await checked.count()) === 0) return null;
      return checked.getAttribute('value');
    }
    case 'checkbox':
      return String(await locator.isChecked());
  }
}

/**
 * Clear the field and type `value` (Playwright `.fill` clears first).
 */
export async function fillText(page: Page, selector: string, value: string): Promise<void> {
  await requireSelector(page, selector);
  await page.locator(selector).fill(value);
}

/**
 * Choose an option in a native `<select>` by label, value, or (for `'exact'`)
 * label falling back to value.
 */
export async function selectNative(
  page: Page,
  selector: string,
  value: string,
  match: 'exact' | 'label' | 'value',
): Promise<void> {
  await requireSelector(page, selector);
  const locator = page.locator(selector);
  try {
    if (match === 'label') {
      await locator.selectOption({ label: value }, { timeout: 2_000 });
    } else if (match === 'value') {
      await locator.selectOption({ value }, { timeout: 2_000 });
    } else {
      try {
        await locator.selectOption({ label: value }, { timeout: 2_000 });
      } catch {
        await locator.selectOption({ value }, { timeout: 2_000 });
      }
    }
  } catch (err) {
    if (await nativeOptionExists(page, selector, value)) throw err;
    throw new OptionNotFoundError(selector, value);
  }
}

/** True when the `<select>` has an option whose label OR value equals `value`. */
async function nativeOptionExists(
  page: Page,
  selector: string,
  value: string,
): Promise<boolean> {
  const options = page.locator(`${selector} option`);
  const labels = await options.allInnerTexts();
  if (labels.some((l) => l.trim() === value)) return true;
  const values = await options.evaluateAll((els) =>
    els.map((el) => (el as unknown as { value: string }).value),
  );
  return values.includes(value);
}

/**
 * Read-only PRE-FILL check for a `<select>`: does it currently have an ENABLED
 * option matching `value` under `match` (`'label'`, `'value'`, or `'exact'` =
 * either)? Throws {@link OptionNotFoundError} if not — BEFORE any write, so the
 * engine can pause on `option_unavailable` without ever mutating the control.
 *
 * EXACT string equality only. A disabled option, a placeholder option, or a
 * "close" option is NOT a match — the automation never guesses a dropdown value.
 */
export async function assertNativeOptionAvailable(
  page: Page,
  selector: string,
  value: string,
  match: 'exact' | 'label' | 'value',
): Promise<void> {
  await requireSelector(page, selector);
  const options = await page.locator(`${selector} option`).evaluateAll((els) =>
    els.map((el) => {
      const o = el as unknown as { textContent: string | null; value: string; disabled: boolean };
      return { label: (o.textContent ?? '').trim(), value: o.value, disabled: o.disabled };
    }),
  );
  const hit = options.some((o) => {
    if (o.disabled) return false;
    if (match === 'label') return o.label === value;
    if (match === 'value') return o.value === value;
    return o.label === value || o.value === value;
  });
  if (!hit) throw new OptionNotFoundError(selector, value);
}

/**
 * Open a custom (non-native) dropdown by clicking `triggerSelector`, wait for
 * its listbox, and click the option whose visible text matches `optionText`.
 */
export async function selectCustom(
  page: Page,
  triggerSelector: string,
  optionText: string,
): Promise<void> {
  await requireSelector(page, triggerSelector);
  await page.locator(triggerSelector).click();
  await page
    .locator('[role="listbox"]:visible')
    .first()
    .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
  const option = page
    .locator('[role="option"]:visible, [role="listbox"]:visible li')
    .filter({ hasText: optionText })
    .first();
  if ((await option.count()) === 0) {
    throw new OptionNotFoundError(triggerSelector, optionText);
  }
  await option.click();
}

/**
 * Select a radio button in a group by its `value`.
 * `groupSelector` is like `input[name="r"]`.
 */
export async function setRadio(
  page: Page,
  groupSelector: string,
  value: string,
): Promise<void> {
  const target = `${groupSelector}[value="${value}"]`;
  await requireSelector(page, target);
  await page.locator(target).check();
}

/**
 * Check or uncheck a checkbox.
 */
export async function setCheckbox(
  page: Page,
  selector: string,
  checked: boolean,
): Promise<void> {
  await requireSelector(page, selector);
  const locator = page.locator(selector);
  if (checked) await locator.check();
  else await locator.uncheck();
}

/**
 * Fill an `<input type="date">` with an ISO `YYYY-MM-DD` value.
 */
export async function setDate(page: Page, selector: string, value: string): Promise<void> {
  await requireSelector(page, selector);
  await page.locator(selector).fill(value);
}

/**
 * Type into an autocomplete field character-by-character, wait for the
 * suggestion list, and click the suggestion whose text equals `value` exactly.
 */
export async function typeAutocomplete(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  await requireSelector(page, selector);
  const locator = page.locator(selector);
  await locator.fill('');
  await locator.pressSequentially(value, { delay: 15 });
  await page
    .locator('[role="listbox"]:visible')
    .first()
    .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
  const option = page.getByRole('option', { name: value, exact: true }).first();
  if ((await option.count()) === 0) {
    throw new OptionNotFoundError(selector, value);
  }
  await option.click();
}
