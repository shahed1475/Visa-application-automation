import type { PortalAdapter } from './baseAdapter.js';
import { genericAdapter } from './genericAdapter.js';

// Portal-specific adapters are added here in a later phase. Each one must
// declare its own matches(url) and keep its selectors internal to the module.
// The portal URL is never hard-coded in the engine — an adapter only inspects
// whichever page it is handed.
const adapters: PortalAdapter[] = [];

export function resolveAdapter(url: string): PortalAdapter {
  return adapters.find((a) => a.matches(url)) ?? genericAdapter;
}
