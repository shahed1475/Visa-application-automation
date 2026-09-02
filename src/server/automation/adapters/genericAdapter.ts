import type { PortalAdapter } from './baseAdapter.js';
import { inspectPage } from '../engine/pageInspector.js';

/**
 * Default adapter: portal-agnostic, inspect-only. Matches every URL so it is the
 * universal fallback. Holds no portal-specific selectors or knowledge.
 */
export const genericAdapter: PortalAdapter = {
  id: 'generic',
  matches: () => true,
  inspect: (page) => inspectPage(page),
};
