import type { PortalAdapter } from './baseAdapter.js';
import { UNKNOWN_STATE } from '../../../shared/automation/types.js';

/**
 * Default adapter: portal-agnostic and knowledge-free. Matches every URL so it is
 * the universal fallback. It forces the UNKNOWN state, holds no field map, and
 * refuses to navigate — an unknown portal stops the run rather than guessing.
 */
export const genericAdapter: PortalAdapter = {
  id: 'generic',
  matches: () => true,
  entryUrl: (u) => u,
  getPageIdentity: async () => ({ state: UNKNOWN_STATE, confidence: 0, signals: [] }),
  sectionIdsForState: () => [],
  documentIdsForState: () => [],
  getFieldMap: () => ({}),
  canContinue: async () => ({ ok: false, reason: 'unknown portal' }),
  clickNext: async () => {
    throw new Error('generic adapter cannot navigate');
  },
  isFinalReview: () => false,
  submitSelector: null,
};
