// DESIGN NOTE (do not remove): READ-ONLY. captureDiscovery enumerates the current
// page's form controls + labels and ranks selectors per docs/visa-form-analysis.md §8.1.
// It has NO page.fill / page.click / page.type / page.press / page.goto / form.submit —
// by design. It runs against a page the USER has already navigated (spec §12, R15).

import type { Page } from 'playwright';
import { inspectPage, type PageInspection } from '../engine/pageInspector.js';
import type { SelectorConfidence, ControlKind } from '../../../shared/automation/types.js';

export type { SelectorConfidence, ControlKind } from '../../../shared/automation/types.js';

/**
 * Minimal browser-DOM shapes, declared locally so this server-side module
 * typechecks without pulling the whole DOM lib into the server program (same
 * precedent as `engine/pageInspector.ts`). The real objects are supplied by the
 * browser inside `page.evaluate`.
 */
interface EvaluatedElement {
  tagName: string;
  id: string;
  textContent: string | null;
  previousElementSibling: EvaluatedElement | null;
  getAttribute(name: string): string | null;
  closest(selector: string): EvaluatedElement | null;
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

export interface DiscoveryFieldCandidate {
  label: string;
  primarySelector: string;
  fallbackSelector: string | null;
  selectorConfidence: SelectorConfidence;
  control: ControlKind | 'unknown';
}

export interface DiscoveryReport {
  url: string;
  pageTitle: string | null;
  fingerprint: Record<string, string | boolean>;
  candidates: DiscoveryFieldCandidate[];
  signals: PageInspection['securityChallengeFlags'];
}

/**
 * Read-only snapshot of the form controls on whatever page `page` currently
 * shows. Never fills, clicks, types, navigates or submits — a discovery run is
 * driven by the user; this tool only observes and ranks selectors per §8.1.
 */
export async function captureDiscovery(page: Page): Promise<DiscoveryReport> {
  const url = page.url();
  const rawTitle = await page.title();
  const pageTitle = rawTitle.length > 0 ? rawTitle : null;

  const html = (await page.content()).toLowerCase();
  const fingerprint: Record<string, string | boolean> = {
    rendering: /data-reactroot|id="__next"|ng-version|data-v-[0-9a-f]|__nuxt|data-vue/.test(html)
      ? 'spa'
      : 'html',
    hasViewState: html.includes('__viewstate'),
    framesPresent: html.includes('<iframe'),
    shadowDomHint: html.includes('shadowroot') || html.includes('template shadowrootmode'),
  };

  const candidates = await page.evaluate(() => {
    const AUTOGEN = /^:r|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;
    const TEXT_TYPES = ['', 'text', 'email', 'tel', 'search', 'url', 'password'];

    const controlOf = (tag: string, type: string): string => {
      if (tag === 'textarea') return 'textarea';
      if (tag === 'select') return 'native_select';
      if (tag !== 'input') return 'unknown';
      if (type === 'radio') return 'radio';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'date' || type === 'datetime-local' || type === 'month') return 'date';
      if (type === 'number') return 'number';
      if (TEXT_TYPES.indexOf(type) !== -1) return 'text';
      return 'unknown';
    };

    const nodes = document.querySelectorAll('input, select, textarea');
    const seen: Record<string, number> = {};
    const out: {
      label: string;
      primarySelector: string;
      fallbackSelector: string | null;
      selectorConfidence: string;
      control: string;
    }[] = [];

    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes.item(i);
      if (!el) continue;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (
        tag === 'input' &&
        (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset')
      ) {
        continue;
      }
      seen[tag] = (seen[tag] ?? 0) + 1;

      const id = el.id ?? '';
      const name = el.getAttribute('name');
      const testId =
        el.getAttribute('data-testid') ??
        el.getAttribute('data-qa') ??
        el.getAttribute('data-cy');

      let label = '';
      if (id) {
        const forLabel = document.querySelector(`label[for="${id}"]`);
        if (forLabel?.textContent) label = forLabel.textContent.trim();
      }
      if (!label) label = (el.getAttribute('aria-label') ?? '').trim();
      if (!label) {
        const wrap = el.closest('label');
        if (wrap?.textContent) label = wrap.textContent.trim();
      }
      if (!label) label = (el.getAttribute('placeholder') ?? '').trim();
      if (!label) {
        const prev = el.previousElementSibling;
        if (prev?.textContent) label = prev.textContent.trim();
      }

      let primarySelector: string;
      let selectorConfidence: string;
      let fallbackSelector: string | null = null;
      if (id && !AUTOGEN.test(id)) {
        primarySelector = `#${id}`;
        selectorConfidence = 'stable';
        if (name) fallbackSelector = `${tag}[name="${name}"]`;
      } else if (name) {
        primarySelector = `${tag}[name="${name}"]`;
        selectorConfidence = 'moderate';
        if (testId) fallbackSelector = `[data-testid="${testId}"]`;
      } else if (testId) {
        primarySelector = `[data-testid="${testId}"]`;
        selectorConfidence = 'moderate';
      } else if (label) {
        primarySelector = `${tag}[aria-label="${label.replace(/"/g, '\\"')}"]`;
        selectorConfidence = 'fragile';
      } else {
        primarySelector = `${tag}:nth-of-type(${seen[tag]})`;
        selectorConfidence = 'fragile';
      }

      out.push({
        label,
        primarySelector,
        fallbackSelector,
        selectorConfidence,
        control: controlOf(tag, type),
      });
    }
    return out;
  });

  const inspection = await inspectPage(page);

  return {
    url,
    pageTitle,
    fingerprint,
    candidates: candidates as DiscoveryFieldCandidate[],
    signals: inspection.securityChallengeFlags,
  };
}
