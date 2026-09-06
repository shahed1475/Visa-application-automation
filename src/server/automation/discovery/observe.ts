// DESIGN NOTE (do not remove): READ-ONLY. captureDiscoveryV2 layers extra
// structure (headings, radio/checkbox groups, buttons, nav-control candidates,
// required indicators, <select> option catalogues, stable-attribute counts) on
// top of captureDiscovery. Like its base it has NO page-mutating call — no
// fill / click / type / press / goto / form.submit / selectOption / check /
// setInputFiles / hover — by design, and it NEVER reads `input.value`. Every
// string it produces is passed through `sanitizeReport` before it is returned
// so no field VALUE can be persisted. It runs against a page the USER has
// already navigated (spec §12, R15).

import type { Page } from 'playwright';
import {
  captureDiscovery,
  type DiscoveryReport,
} from './portalDiscovery.js';

export type { DiscoveryReport, DiscoveryFieldCandidate } from './portalDiscovery.js';

/** Bumped whenever the shape or extraction of a discovery report changes. */
export const DISCOVERY_VERSION = '2026-09-06.1';

export interface DiscoveryGroup {
  name: string;
  kind: 'radio' | 'checkbox';
  options: string[];
}

export interface DiscoveryButton {
  text: string;
  type: string | null;
  isNavCandidate: boolean;
}

export interface DiscoveryReportV2 extends DiscoveryReport {
  discoveryVersion: string;
  headings: string[];
  groups: DiscoveryGroup[];
  buttons: DiscoveryButton[];
  requiredIndicators: string[];
  selectCatalogue: { selector: string; optionLabels: string[] }[];
  stableAttributes: Record<string, number>;
}

/**
 * Minimal browser-DOM shapes, declared locally so this server-side module
 * typechecks without pulling the whole DOM lib into the server program (same
 * precedent as `portalDiscovery.ts` / `engine/pageInspector.ts`). The real
 * objects are supplied by the browser inside `page.evaluate`. Note the absence
 * of any `value` member — reading a control's value is forbidden here.
 */
interface EvaluatedElement {
  tagName: string;
  id: string;
  textContent: string | null;
  previousElementSibling: EvaluatedElement | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  closest(selector: string): EvaluatedElement | null;
  querySelector(selector: string): EvaluatedElement | null;
  querySelectorAll(selector: string): EvaluatedNodeList;
}
interface EvaluatedNodeList {
  length: number;
  item(index: number): EvaluatedElement | null;
}
interface EvaluatedDocument {
  querySelector(selector: string): EvaluatedElement | null;
  querySelectorAll(selector: string): EvaluatedNodeList;
}
declare const document: EvaluatedDocument;

// ---------------------------------------------------------------------------
// PII sanitizer — every string in a persisted discovery report goes through it.
// ---------------------------------------------------------------------------

const VALUE_SHAPES: RegExp[] = [
  /\d{4,}/, //                         any run of 4+ digits (IDs, years, phone, long numbers)
  /\b\d{4}-\d{2}-\d{2}\b/, //          ISO date
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/, // dd/mm/yyyy or dd.mm.yy
  /[^\s@]+@[^\s@]+\.[^\s@]+/, //       email
  /\b[A-Z]{1,2}\d{6,8}\b/, //          passport / document number
];

/**
 * Value-shape scrubber applied to every persisted string. Returns `''` when the
 * TRIMMED input looks like a field VALUE (a number, date, email, document
 * number, or a long low-letter blob); otherwise returns the trimmed input.
 * Idempotent: `sanitizeString(sanitizeString(x)) === sanitizeString(x)`.
 */
export function sanitizeString(s: string): string {
  const trimmed = s.trim();
  if (trimmed === '') return '';
  for (const re of VALUE_SHAPES) {
    if (re.test(trimmed)) return '';
  }
  if (trimmed.length >= 40) {
    const letters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
    if (letters / trimmed.length < 0.4) return '';
  }
  return trimmed;
}

const HEX_SEGMENT = /[0-9a-f]{8,}/i;
const LONG_NUM_SEGMENT = /\d{5,}/;

/**
 * Reduce a full URL to a stable `host + pathname` pattern: path segments that
 * look like ids/hashes (`[0-9a-f]{8,}` or `\d{5,}`) become `*`, and EVERY query
 * value becomes `*` (keys are kept). A malformed URL is returned unchanged.
 */
export function sanitizeUrlToPattern(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // malformed input is passed through unchanged
  }
  const maskedPath = parsed.pathname
    .split('/')
    .map((seg) => (seg !== '' && (HEX_SEGMENT.test(seg) || LONG_NUM_SEGMENT.test(seg)) ? '*' : seg))
    .join('/');
  const keys = Array.from(parsed.searchParams.keys());
  const query = keys.length > 0 ? '?' + keys.map((k) => `${k}=*`).join('&') : '';
  return `${parsed.host}${maskedPath}${query}`;
}

function sanitizeDeep(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v);
    return out;
  }
  return value;
}

/**
 * Scrub every string leaf of a discovery report before it is persisted. `url`
 * is reduced to a pattern; every other string goes through `sanitizeString`.
 */
export function sanitizeReport(r: DiscoveryReportV2): DiscoveryReportV2 {
  const deep = sanitizeDeep(r) as DiscoveryReportV2;
  return {
    ...deep,
    // `url` is reduced to a pattern; `discoveryVersion` is a build constant, not
    // page content, so it is preserved verbatim (its year would otherwise be
    // scrubbed as a digit run).
    url: sanitizeUrlToPattern(r.url),
    discoveryVersion: r.discoveryVersion,
  };
}

// ---------------------------------------------------------------------------
// captureDiscoveryV2
// ---------------------------------------------------------------------------

/**
 * Read-only snapshot of the current page: the base `captureDiscovery` report
 * plus page structure that helps an adapter author map fields and locate the
 * "next" control. Never mutates the page and never reads a control's value; the
 * result is sanitized before it is returned.
 */
export async function captureDiscoveryV2(page: Page): Promise<DiscoveryReportV2> {
  const base = await captureDiscovery(page);

  const extra = await page.evaluate(() => {
    const NAV_RE = /next|continue|proceed|forward|save|submit|finish|review|→|>>/i;
    const listToArray = (list: EvaluatedNodeList): EvaluatedElement[] => {
      const arr: EvaluatedElement[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const el = list.item(i);
        if (el) arr.push(el);
      }
      return arr;
    };

    const labelFor = (el: EvaluatedElement): string => {
      const id = el.id ?? '';
      if (id) {
        const forLabel = document.querySelector(`label[for="${id}"]`);
        if (forLabel?.textContent) return forLabel.textContent.trim();
      }
      const aria = (el.getAttribute('aria-label') ?? '').trim();
      if (aria) return aria;
      const wrap = el.closest('label');
      if (wrap?.textContent) return wrap.textContent.trim();
      const ph = (el.getAttribute('placeholder') ?? '').trim();
      if (ph) return ph;
      const prev = el.previousElementSibling;
      if (prev?.textContent) return prev.textContent.trim();
      return (el.getAttribute('value') ?? '').trim();
    };

    // Headings ------------------------------------------------------------
    const headings = listToArray(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map((h) => (h.textContent ?? '').trim())
      .filter((t) => t !== '');

    // Radio / checkbox groups ------------------------------------------------
    const groups: { name: string; kind: 'radio' | 'checkbox'; options: string[] }[] = [];
    const groupIndex: Record<string, number> = {};
    for (const el of listToArray(
      document.querySelectorAll('input[type="radio"], input[type="checkbox"]'),
    )) {
      const name = el.getAttribute('name');
      if (!name) continue;
      const kind = (el.getAttribute('type') ?? '').toLowerCase() === 'checkbox' ? 'checkbox' : 'radio';
      let at = groupIndex[name];
      if (at === undefined) {
        at = groups.length;
        groupIndex[name] = at;
        groups.push({ name, kind, options: [] });
      }
      const group = groups[at];
      const opt = labelFor(el);
      if (group && opt) group.options.push(opt);
    }

    // Buttons + nav candidates --------------------------------------------
    const buttons = listToArray(
      document.querySelectorAll('button, input[type="submit"], input[type="button"]'),
    ).map((b) => {
      const tag = b.tagName.toLowerCase();
      const text =
        tag === 'button'
          ? (b.textContent ?? '').trim()
          : (b.getAttribute('value') ?? '').trim();
      const type = b.getAttribute('type');
      const isNavCandidate = NAV_RE.test(text) || (type ?? '').toLowerCase() === 'submit';
      return { text, type, isNavCandidate };
    });

    // Required indicators -------------------------------------------------
    const requiredIndicators: string[] = [];
    for (const el of listToArray(document.querySelectorAll('input, select, textarea'))) {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') continue;
      const required =
        el.hasAttribute('required') ||
        (el.getAttribute('aria-required') ?? '').toLowerCase() === 'true';
      if (!required) continue;
      const label = labelFor(el);
      if (label && requiredIndicators.indexOf(label) === -1) requiredIndicators.push(label);
    }
    for (const marker of listToArray(
      document.querySelectorAll('.required, .mandatory, abbr[title="required"]'),
    )) {
      const t = (marker.textContent ?? '').trim();
      if (t && t.length <= 40 && requiredIndicators.indexOf(t) === -1) requiredIndicators.push(t);
    }

    // <select> option catalogues ----------------------------------------
    let selectSeen = 0;
    const selectCatalogue = listToArray(document.querySelectorAll('select')).map((sel) => {
      selectSeen += 1;
      const id = sel.id ?? '';
      const name = sel.getAttribute('name');
      let selector: string;
      if (id) selector = `#${id}`;
      else if (name) selector = `select[name="${name}"]`;
      else selector = `select:nth-of-type(${selectSeen})`;
      const optionLabels = listToArray(sel.querySelectorAll('option'))
        .map((o) => (o.textContent ?? '').trim())
        .filter((t) => t !== '');
      return { selector, optionLabels };
    });

    // Stable-attribute census ------------------------------------------
    let cId = 0;
    let cName = 0;
    let cTestId = 0;
    let cAria = 0;
    let cPlaceholder = 0;
    for (const el of listToArray(document.querySelectorAll('input, select, textarea'))) {
      if (el.id) cId += 1;
      if (el.getAttribute('name')) cName += 1;
      if (el.getAttribute('data-testid') ?? el.getAttribute('data-qa') ?? el.getAttribute('data-cy'))
        cTestId += 1;
      if (el.getAttribute('aria-label')) cAria += 1;
      if (el.getAttribute('placeholder')) cPlaceholder += 1;
    }
    const stableAttributes: Record<string, number> = {
      id: cId,
      name: cName,
      'data-testid': cTestId,
      'aria-label': cAria,
      placeholder: cPlaceholder,
    };

    return {
      headings,
      groups,
      buttons,
      requiredIndicators,
      selectCatalogue,
      stableAttributes,
    };
  });

  const report: DiscoveryReportV2 = {
    ...base,
    discoveryVersion: DISCOVERY_VERSION,
    headings: extra.headings,
    groups: extra.groups as DiscoveryGroup[],
    buttons: extra.buttons as DiscoveryButton[],
    requiredIndicators: extra.requiredIndicators,
    selectCatalogue: extra.selectCatalogue,
    stableAttributes: extra.stableAttributes,
  };

  return sanitizeReport(report);
}
