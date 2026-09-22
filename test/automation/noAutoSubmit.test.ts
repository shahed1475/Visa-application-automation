import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

import { EVENT_TYPES } from '../../src/shared/automation/events.js';

/**
 * Phase 5 safety invariant (spec §5.6 / §13): the automation NEVER submits,
 * confirms, lodges or pays on the user's behalf, and it never tries to defeat
 * a CAPTCHA / OTP / MFA challenge. It prepares the application up to the portal's
 * final review page and then stops — submission is the user's act.
 *
 * Source-grep guard over the whole automation tree. Comments are stripped first
 * so a doc-comment ("the loop NEVER submits", "no `form.submit()`") does not
 * trip it. If a grep matches, the fix is in the SOURCE, never a looser regex.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const SCAN = [
  ...walk(path.join('src', 'server', 'automation')),
  ...walk(path.join('src', 'shared', 'automation')),
];
const scanned = `scanned ${SCAN.length} files:\n${SCAN.join('\n')}`;

/** Each pattern that must never appear in the comment-stripped automation source. */
const SUBMIT_PATTERNS: RegExp[] = [
  /\.click\([^)]*submit/i,
  /\.click\([^)]*confirm/i,
  /\.click\([^)]*lodge/i,
  /\.click\([^)]*\bpay\b/i,
  /form\s*=>\s*form\.submit\(\)/,
  /\.evaluate\([^)]*\.submit\(\)/,
  /\brequestSubmit\s*\(/,
  /page\.on\(\s*['"]dialog['"]/,
  // Pressing Enter in a text input inside a <form> triggers implicit form
  // submission — the one submit vector with no selector and no `submit` token.
  // `typeAutocomplete` uses `pressSequentially` (types characters, no Enter);
  // nothing in the tree presses Enter today and nothing should start.
  /(?:keyboard\.)?\bpress\s*\(\s*['"]Enter['"]/i,
];

/**
 * The idiom this codebase actually uses is `page.locator(sel).click()` /
 * `page.getByRole('button', { name: 'Submit' }).click()`, NOT the `page.click(sel)`
 * shorthand the patterns above catch. This one bites a submit/confirm/lodge
 * affordance named in ANY selector-bearing locator or a `.click(...)` argument.
 * `pay` is deliberately NOT in this pattern (`payload`, `page` false positives);
 * the narrow `/\.click\([^)]*\bpay\b/i` above still covers `page.click('...pay...')`.
 */
const SUBMIT_LOCATOR_PATTERN =
  /(?:locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|click)\s*\([^)]*\b(?:submit|confirm|lodge)\b/i;

/** CAPTCHA / OTP solver libraries — referencing any of these would mean the
 *  automation is trying to defeat a challenge instead of handing it to the user. */
const SOLVER_PATTERN =
  /2captcha|anti-?captcha|deathbycaptcha|capsolver|solveRecaptcha|speakeasy|otplib|otpauth|imap-simple|node-imap|tesseract.*captcha/i;

it('has a non-empty scan set', () => {
  expect(SCAN.length, scanned).toBeGreaterThan(15);
});

it('never clicks a submit/confirm/lodge/pay control', () => {
  for (const file of SCAN) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of [...SUBMIT_PATTERNS, SUBMIT_LOCATOR_PATTERN]) {
      expect(
        src,
        `${file} matches ${pattern} — the automation must never submit/confirm/lodge/pay ` +
          `or auto-accept a dialog on the user's behalf.\n${scanned}`,
      ).not.toMatch(pattern);
    }
  }
});

it('the submit-click guard is non-vacuous', () => {
  expect(
    SUBMIT_LOCATOR_PATTERN.test("await page.locator('#submit-application').click()"),
  ).toBe(true);
  expect(
    SUBMIT_LOCATOR_PATTERN.test(
      "await page.getByRole('button', { name: 'Confirm & Pay' }).click()",
    ),
  ).toBe(true);
  expect(
    SUBMIT_LOCATOR_PATTERN.test("await page.getByRole('button', { name: 'Lodge' }).click()"),
  ).toBe(true);
  // benign controls must NOT trip it
  expect(SUBMIT_LOCATOR_PATTERN.test("await page.locator('#surname').click()")).toBe(false);
  expect(SUBMIT_LOCATOR_PATTERN.test('const payload = buildPayload(page)')).toBe(false);

  // the implicit-form-submit guard bites on both spellings …
  const enterPattern = SUBMIT_PATTERNS.find((p) => p.source.includes('Enter'));
  expect(enterPattern, 'no Enter-press pattern in SUBMIT_PATTERNS').toBeDefined();
  expect(enterPattern!.test("await page.keyboard.press('Enter')")).toBe(true);
  expect(enterPattern!.test('await field.press("Enter")')).toBe(true);
  // … and leaves a benign key press alone
  expect(enterPattern!.test("await page.keyboard.press('Tab')")).toBe(false);
  expect(enterPattern!.test("pressSequentially('Enterprise')")).toBe(false);
});

it('the no-submit / no-solver grep visibly covers the discovery tree, non-vacuously', () => {
  // Phase 6 Task 14 Step 1: `src/server/automation/discovery/**` is pulled into
  // SCAN by the recursive `walk` above, so the submit/solver guards run over it.
  const discoveryFiles = SCAN.filter((file) =>
    file.includes(`${path.sep}discovery${path.sep}`),
  );
  expect(
    discoveryFiles.length,
    `no discovery/*.ts file is in the scan set — the no-submit guard would not cover discovery/**.\n${scanned}`,
  ).toBeGreaterThan(0);

  // …and the guard patterns genuinely bite on a discovery-flavoured string
  // (keep this non-vacuous — a real match in discovery/** must still fail).
  expect(SUBMIT_LOCATOR_PATTERN.test("page.locator('#discovery-submit').click()")).toBe(true);
  expect(
    SUBMIT_LOCATOR_PATTERN.test("await page.getByRole('button', { name: 'Confirm discovery' }).click()"),
  ).toBe(true);
  expect(SOLVER_PATTERN.test('import { solveRecaptcha } from "./discovery-2captcha"')).toBe(true);
  // a benign discovery string is left alone
  expect(SUBMIT_LOCATOR_PATTERN.test("page.locator('#discovery-heading').textContent()")).toBe(false);
});

it('the no-submit / no-solver grep visibly covers the Phase 7 additions, non-vacuously', () => {
  const mustCover = [
    ['adapters', 'india', 'mappingLifecycle.ts'],
    ['adapters', 'india', 'transforms.ts'],
    ['adapters', 'india', 'indiaAdapter.ts'],
    ['engine', 'fieldActions.ts'],
    ['engine', 'pageActions.ts'],
    ['engine', 'automationEngine.ts'],
  ].map((parts) => path.join('src', 'server', 'automation', ...parts));
  for (const file of mustCover) {
    expect(SCAN, `${file} is not in the no-submit scan set\n${scanned}`).toContain(file);
  }
  // still bites a real match
  expect(SUBMIT_LOCATOR_PATTERN.test("page.locator('#confirm-submission').click()")).toBe(true);
  expect(SOLVER_PATTERN.test("import x from 'otplib'")).toBe(true);
});

it('the PortalAdapter interface pins submitSelector to null', () => {
  const src = readFileSync(
    path.join('src', 'server', 'automation', 'adapters', 'baseAdapter.ts'),
    'utf8',
  );
  expect(src).toMatch(/submitSelector\s*:\s*null/);
});

it('the automation event vocabulary has no submit-like type', () => {
  const offending = EVENT_TYPES.filter((t) => /submit|confirm|lodge|pay/i.test(t));
  expect(
    offending,
    `EVENT_TYPES contains a submit-like entry: ${offending.join(', ')}`,
  ).toEqual([]);
  expect(EVENT_TYPES.every((t) => !/submit|confirm|lodge|pay/i.test(t))).toBe(true);
});

it('no CAPTCHA/OTP solver library is referenced', () => {
  for (const file of SCAN) {
    const src = stripComments(readFileSync(file, 'utf8'));
    expect(
      src,
      `${file} references a CAPTCHA/OTP solver — challenges are handed to the user, never solved.\n${scanned}`,
    ).not.toMatch(SOLVER_PATTERN);
  }
});
