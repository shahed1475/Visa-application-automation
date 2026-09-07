import type { Page } from 'playwright';
import type { PortalAdapter } from '../adapters/baseAdapter.js';
import type { PageInspection } from './pageInspector.js';
import type { PageIdentity } from '../../../shared/automation/types.js';
import { UNKNOWN_STATE } from '../../../shared/automation/types.js';

/** Below this confidence, a page is treated as UNKNOWN — the engine pauses rather than guesses. */
export const DETECT_CONFIDENCE_THRESHOLD = 0.6;

export async function detectPage(
  page: Page,
  adapter: PortalAdapter,
  inspection: PageInspection,
): Promise<PageIdentity> {
  const result = await adapter.getPageIdentity(page, inspection);
  if (result.state === UNKNOWN_STATE || result.confidence < DETECT_CONFIDENCE_THRESHOLD) {
    return { state: UNKNOWN_STATE, confidence: result.confidence, signals: result.signals };
  }
  return result;
}
