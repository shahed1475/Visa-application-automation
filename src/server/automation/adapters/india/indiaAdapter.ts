import type { Page } from 'playwright';
import type { PortalAdapter, CheckpointHints } from '../baseAdapter.js';
import {
  UNKNOWN_STATE,
  type PageIdentity,
  type PortalFieldMap,
  type PortalState,
  type SignalMatch,
} from '../../../../shared/automation/types.js';
import { INDIA_PORTAL_STATES, indiaPortalMap, type IndiaPortalState } from './indiaPortalMap.js';
import {
  classifyMapping,
  isNextSelectorProductionUsable,
  isProductionUsable,
} from './mappingLifecycle.js';

/**
 * India portal adapter — config-driven over {@link indiaPortalMap}.
 *
 * The India selectors are NEVER guessed. This module ships the STRUCTURE with
 * `'TODO:discover'` placeholder selectors; a real run against the live portal is
 * gated on a user-driven discovery session that fills them in (spec §12 / §18.14,
 * `automation-risks.md` R15). Until then `clickNext` fails safe (throws) and the
 * engine cannot proceed past the first page — which is the intended behaviour.
 */

/** Contract version of the India map/adapter — surfaced for run provenance. */
export const INDIA_ADAPTER_VERSION = indiaPortalMap.adapterVersion;

/**
 * Read-only identity scoring: URL + heading + anchor.
 *
 * Per state: `+0.5` if `urlPattern` is set and matches `page.url()`; `+0.3` if
 * `headingPattern` matches the first `h1,h2`; `+0.2` if `anchorField` is a real
 * (non-`'TODO:discover'`) selector present on the page. Highest score wins; a top
 * score of 0 → `UNKNOWN`/0. The adapter returns an HONEST confidence — the 0.6
 * floor that turns a low score into `UNKNOWN` lives in `detectPage`, not here.
 *
 * Since every `anchorField` currently ships as `'TODO:discover'` and the
 * `urlPattern`s are best-guesses, a real pre-discovery page typically scores only
 * 0.3 (heading-only) → below the floor → `UNKNOWN` → the run stops. Fail-closed
 * until discovery.
 */
async function getIndiaPageIdentity(page: Page): Promise<PageIdentity> {
  let headingText = '';
  try {
    headingText = (await page.locator('h1, h2').first().innerText()).trim();
  } catch {
    headingText = '';
  }
  let url = '';
  try {
    url = page.url();
  } catch {
    url = '';
  }
  const headingDetail = headingText.slice(0, 60);

  let best: { state: IndiaPortalState; score: number; signals: SignalMatch[] } | null = null;

  for (const state of INDIA_PORTAL_STATES) {
    const cfg = indiaPortalMap.states[state];
    let score = 0;

    const headingMatched = cfg.headingPattern.test(headingText);
    if (headingMatched) score += 0.3;

    const urlMatched = Boolean(cfg.urlPattern && url && cfg.urlPattern.test(url));
    if (urlMatched) score += 0.5;

    let anchorMatched = false;
    if (cfg.anchorField && cfg.anchorField !== 'TODO:discover') {
      try {
        anchorMatched = (await page.locator(cfg.anchorField).count()) > 0;
      } catch {
        anchorMatched = false;
      }
    }
    if (anchorMatched) score += 0.2;

    const signals: SignalMatch[] = [
      { kind: 'heading', matched: headingMatched, detail: headingDetail },
      { kind: 'url', matched: urlMatched, detail: url.slice(0, 80) },
      { kind: 'field', matched: anchorMatched, detail: cfg.anchorField ?? '' },
    ];

    if (!best || score > best.score) best = { state, score, signals };
  }

  if (!best || best.score === 0) {
    return {
      state: UNKNOWN_STATE,
      confidence: 0,
      signals: best?.signals ?? [{ kind: 'heading', matched: false, detail: headingDetail }],
    };
  }
  return { state: best.state, confidence: best.score, signals: best.signals };
}

/**
 * `getFieldMap` must hand the engine a plain {@link PortalFieldMap} containing
 * ONLY production-usable mappings (`status: 'validated'` AND
 * `validatedAgainstRevision === currentRevision`). Placeholder, discovered, and
 * stale mappings never reach the engine. The lifecycle/provenance keys are
 * projected away so nothing downstream depends on India-only fields.
 */
function toPortalFieldMap(currentRevision: string): PortalFieldMap {
  return Object.fromEntries(
    Object.entries(indiaPortalMap.fields)
      .filter(([, v]) => isProductionUsable(v, currentRevision))
      .map(([k, v]) => [
        k,
        {
          selector: v.selector,
          control: v.control,
          selectorConfidence: v.selectorConfidence,
          ...(v.fallbackSelector ? { fallbackSelector: v.fallbackSelector } : {}),
          ...(v.transform ? { transform: v.transform } : {}),
          ...(v.readBackParse ? { readBackParse: v.readBackParse } : {}),
          ...(v.optionMatch ? { optionMatch: v.optionMatch } : {}),
        },
      ]),
  );
}

export const indiaAdapter: PortalAdapter = {
  id: 'india',

  matches: (url) => {
    try {
      return indiaPortalMap.matchesUrl.test(new URL(url).hostname);
    } catch {
      return false;
    }
  },

  // The India flow entry is whatever the operator configured in Settings —
  // never a constant baked into the adapter.
  entryUrl: (portalUrl) => portalUrl,

  getPageIdentity: (page) => getIndiaPageIdentity(page),

  sectionIdsForState: (state: PortalState) =>
    indiaPortalMap.states[state as IndiaPortalState]?.sectionIds ?? [],

  // Which documents belong to DOCUMENTS is not knowable until discovery. The
  // engine's readiness gate + `plan.documents` still protect against a missing
  // document via the `!ready` refusal path.
  documentIdsForState: () => [],

  getFieldMap: () => toPortalFieldMap(indiaPortalMap.mappingRevision),

  // Why a plan field is absent from `getFieldMap()` — lets the engine pause with
  // a precise reason (`stale_mapping` vs `missing_field_mapping`).
  mappingReadiness: (fieldPath: string) => {
    const m = indiaPortalMap.fields[fieldPath];
    if (!m) return 'unmapped';
    const life = classifyMapping(m, indiaPortalMap.mappingRevision);
    if (life === 'validated') return 'production';
    if (life === 'stale') return 'stale';
    return 'unvalidated'; // 'placeholder' | 'discovered'
  },

  canContinue: async (page) => {
    const errs = await page
      .locator('.error, .field-error, [aria-invalid="true"], .has-error')
      .count()
      .catch(() => 0);
    return errs > 0
      ? { ok: false, reason: 'the portal shows a validation error' }
      : { ok: true };
  },

  clickNext: async (page) => {
    const id = await getIndiaPageIdentity(page);
    const cfg = indiaPortalMap.states[id.state as IndiaPortalState];
    if (!cfg || !isNextSelectorProductionUsable(cfg, indiaPortalMap.mappingRevision)) {
      throw new Error(`india adapter: next-page selector not production-ready for ${id.state}`);
    }
    await page.locator(cfg.nextSelector as string).first().click();
  },

  isFinalReview: (state: PortalState) =>
    indiaPortalMap.states[state as IndiaPortalState]?.isFinalReview === true,

  checkpointHints: indiaPortalMap.checkpointHints satisfies CheckpointHints,

  submitSelector: null,
};
