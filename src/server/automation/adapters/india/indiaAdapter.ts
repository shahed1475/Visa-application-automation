import type { Page } from 'playwright';
import type { PortalAdapter, CheckpointHints } from '../baseAdapter.js';
import { UNKNOWN_STATE, type PageIdentity, type PortalState } from '../../../../shared/automation/types.js';
import { INDIA_PORTAL_STATES, indiaPortalMap, type IndiaPortalState } from './indiaPortalMap.js';

/**
 * India portal adapter — config-driven over {@link indiaPortalMap}.
 *
 * The India selectors are NEVER guessed. This module ships the STRUCTURE with
 * `'TODO:discover'` placeholder selectors; a real run against the live portal is
 * gated on a user-driven discovery session that fills them in (spec §12 / §18.14,
 * `automation-risks.md` R15). Until then `clickNext` fails safe (throws) and the
 * engine cannot proceed past the first page — which is the intended behaviour.
 */

/** Read-only: derive the portal state from the page's first heading + URL. */
async function getIndiaPageIdentity(page: Page): Promise<PageIdentity> {
  let headingText = '';
  try {
    headingText = (await page.locator('h1, h2').first().innerText()).trim();
  } catch {
    headingText = '';
  }
  const detail = headingText.slice(0, 60);
  for (const state of INDIA_PORTAL_STATES) {
    if (indiaPortalMap.states[state].headingPattern.test(headingText)) {
      return { state, confidence: 0.7, signals: [{ kind: 'heading', matched: true, detail }] };
    }
  }
  return { state: UNKNOWN_STATE, confidence: 0, signals: [{ kind: 'heading', matched: false, detail }] };
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

  getFieldMap: () => indiaPortalMap.fields,

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
    const sel = indiaPortalMap.states[id.state as IndiaPortalState]?.nextSelector;
    if (!sel || sel === 'TODO:discover') {
      throw new Error(`india adapter: next-page selector not yet discovered for ${id.state}`);
    }
    await page.locator(sel).first().click();
  },

  isFinalReview: (state: PortalState) =>
    indiaPortalMap.states[state as IndiaPortalState]?.isFinalReview === true,

  checkpointHints: indiaPortalMap.checkpointHints satisfies CheckpointHints,

  submitSelector: null,
};
