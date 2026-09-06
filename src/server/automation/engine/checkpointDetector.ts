// DESIGN NOTE (do not remove): this module DETECTS security challenges and
// returns a label only. It has no page.fill / page.click / page.type /
// page.press / page.check / solver / OTP-retrieval / CAPTCHA-service path — by
// design (spec §13, automation-risks.md R7). Detection reads the page only
// (getAttribute / isVisible / innerText / locator.count). A detected checkpoint
// makes the engine PAUSE for a human; this file must never act on the page.

import type { Page } from 'playwright';
import type { PageInspection } from './pageInspector.js';
import type { CheckpointHints } from '../adapters/baseAdapter.js';

export type CheckpointKind = 'otp' | 'captcha' | 'mfa' | 'anti_bot';

export interface Checkpoint {
  kind: CheckpointKind;
  /** Short, value-free human-readable reasons — never OTP digits or raw page content. */
  signals: string[];
}

/** Short bound so a slow/broken page can never stall detection. */
const SHORT_TIMEOUT_MS = 1500;

/**
 * Matches label/placeholder/aria-label text that identifies a one-time-code input.
 * Deliberately narrow: a plain "code" or "password" field must NOT trip it.
 */
const OTP_INPUT_RE =
  /\b(otp|one[\s-]?time (?:password|code|pin)|verification code|passcode|security code)\b/i;

const OTP_INPUT_TYPES = new Set(['text', 'tel', 'number', '']);

function isTrue(flag: boolean | undefined): boolean {
  return flag === true;
}

async function readBodyText(page: Page): Promise<string> {
  try {
    return (await page.locator('body').innerText({ timeout: SHORT_TIMEOUT_MS })).toLowerCase();
  } catch {
    return '';
  }
}

async function anyCaptchaSelectorPresent(
  page: Page,
  selectors: string[],
): Promise<string | null> {
  for (const sel of selectors) {
    try {
      if ((await page.locator(sel).count()) > 0) return sel;
    } catch {
      /* malformed selector or detached page — treat as absent */
    }
  }
  return null;
}

/**
 * READ-ONLY heuristic: is there a visible <input> (type text/tel/number/none)
 * whose associated <label>, placeholder, or aria-label reads like a one-time
 * code field? Uses getAttribute / isVisible / innerText only.
 * Returns the matched label word for the signal, or null.
 */
async function visibleOtpInputLabel(page: Page): Promise<string | null> {
  try {
    const inputs = page.locator('input');
    const count = await inputs.count();
    for (let i = 0; i < count; i += 1) {
      const el = inputs.nth(i);
      if (!(await el.isVisible({ timeout: SHORT_TIMEOUT_MS }))) continue;
      const type = ((await el.getAttribute('type')) ?? '').toLowerCase();
      if (!OTP_INPUT_TYPES.has(type)) continue;

      const placeholder = (await el.getAttribute('placeholder')) ?? '';
      const ariaLabel = (await el.getAttribute('aria-label')) ?? '';
      let labelText = '';
      const id = await el.getAttribute('id');
      if (id !== null && id !== '') {
        const label = page.locator(`label[for="${CSS_escape(id)}"]`);
        if ((await label.count()) > 0) {
          labelText = (await label.first().innerText({ timeout: SHORT_TIMEOUT_MS })).trim();
        }
      }

      const haystacks = [labelText, placeholder, ariaLabel];
      for (const text of haystacks) {
        if (text !== '' && OTP_INPUT_RE.test(text)) {
          return text.length > 40 ? text.slice(0, 40) : text;
        }
      }
    }
  } catch {
    /* any read failure → treat as no OTP input */
  }
  return null;
}

/** Minimal CSS.escape for the id-in-attribute-selector case (no DOM lib here). */
function CSS_escape(value: string): string {
  return value.replace(/["\\\]]/g, '\\$&');
}

/**
 * DETECT-ONLY: identify an OTP / CAPTCHA / MFA / anti-bot challenge on the
 * current page from the inspection flags and, secondarily, from adapter hints
 * and a read-only DOM heuristic. Precedence: captcha > anti_bot > mfa > otp.
 * Returns the first matching checkpoint, or null when the page is clean.
 */
export async function detectCheckpoint(
  inspection: PageInspection,
  page: Page,
  hints?: CheckpointHints,
): Promise<Checkpoint | null> {
  const flags = inspection.securityChallengeFlags;

  // 1. captcha ---------------------------------------------------------------
  for (const key of ['recaptcha', 'hcaptcha', 'turnstile'] as const) {
    if (isTrue(flags[key])) {
      return { kind: 'captcha', signals: [`securityChallengeFlags.${key}`] };
    }
  }
  if (hints?.captchaSelectors && hints.captchaSelectors.length > 0) {
    const sel = await anyCaptchaSelectorPresent(page, hints.captchaSelectors);
    if (sel !== null) {
      return { kind: 'captcha', signals: [`hints.captchaSelectors matched "${sel}"`] };
    }
  }

  // 2. anti_bot -------------------------------------------------------------
  if (isTrue(flags.cloudflareInterstitial)) {
    return { kind: 'anti_bot', signals: ['securityChallengeFlags.cloudflareInterstitial'] };
  }

  // 3. mfa ----------------------------------------------------------------
  if (isTrue(flags.mentionsMfa)) {
    return { kind: 'mfa', signals: ['securityChallengeFlags.mentionsMfa'] };
  }
  if (hints?.mfaPatterns && hints.mfaPatterns.length > 0) {
    const text = await readBodyText(page);
    if (text !== '' && hints.mfaPatterns.some((re) => re.test(text))) {
      return { kind: 'mfa', signals: ['hints.mfaPatterns matched'] };
    }
  }

  // 4. otp ----------------------------------------------------------------
  if (isTrue(flags.mentionsOtp)) {
    return { kind: 'otp', signals: ['securityChallengeFlags.mentionsOtp'] };
  }
  if (hints?.otpLabelPatterns && hints.otpLabelPatterns.length > 0) {
    const text = await readBodyText(page);
    if (text !== '' && hints.otpLabelPatterns.some((re) => re.test(text))) {
      return { kind: 'otp', signals: ['hints.otpLabelPatterns matched'] };
    }
  }
  const otpLabel = await visibleOtpInputLabel(page);
  if (otpLabel !== null) {
    return { kind: 'otp', signals: [`visible input labelled "${otpLabel}"`] };
  }

  return null;
}
