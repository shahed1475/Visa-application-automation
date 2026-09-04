import type { Page } from 'playwright';

/**
 * Minimal shape of the browser `document` global, declared locally so this
 * server-side module can typecheck without pulling the whole DOM lib into the
 * server program. The real object is provided by the browser inside
 * `page.evaluate`.
 */
interface EvaluatedDocument {
  title: string;
  documentElement: { outerHTML: string };
  querySelectorAll(selector: string): { length: number };
}
declare const document: EvaluatedDocument;

export interface PageInspection {
  pageTitle: string | null;
  elementCounts: Record<string, number>;
  securityChallengeFlags: Record<string, boolean>;
}

/**
 * Portal-agnostic, inspect-only snapshot of the current page. Security-challenge
 * markers are DETECTED only (booleans) and never acted on.
 */
export async function inspectPage(page: Page): Promise<PageInspection> {
  const data = await page.evaluate(() => {
    const count = (sel: string) => document.querySelectorAll(sel).length;
    const html = document.documentElement.outerHTML.toLowerCase();
    return {
      title: document.title,
      counts: {
        forms: count('form'),
        inputs: count('input'),
        textInputs: count('input[type="text"], input:not([type])'),
        selects: count('select'),
        radios: count('input[type="radio"]'),
        checkboxes: count('input[type="checkbox"]'),
        dateInputs: count('input[type="date"]'),
        fileInputs: count('input[type="file"]'),
        buttons: count('button, input[type="submit"], input[type="button"]'),
        links: count('a[href]'),
      },
      flags: {
        recaptcha: html.includes('recaptcha') || count('.g-recaptcha') > 0,
        hcaptcha: html.includes('hcaptcha'),
        turnstile: html.includes('cf-turnstile'),
        cloudflareInterstitial:
          html.includes('just a moment') && html.includes('cloudflare'),
        mentionsOtp: /\botp\b|one[-\s]?time password/.test(html),
        mentionsMfa: /\bmfa\b|multi[-\s]?factor|two[-\s]?factor|\b2fa\b/.test(html),
      },
    };
  });
  return {
    pageTitle: data.title.length > 0 ? data.title : null,
    elementCounts: data.counts,
    securityChallengeFlags: data.flags,
  };
}
