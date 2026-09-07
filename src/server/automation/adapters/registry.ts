import type { PortalAdapter } from './baseAdapter.js';
import { genericAdapter } from './genericAdapter.js';
import { indiaAdapter } from './india/indiaAdapter.js';

// Portal-specific adapters are tried in order; `genericAdapter` is the universal
// fallback (it matches every URL) and is applied last by `resolveAdapter`. Each
// adapter declares its own matches(url) and keeps its selectors internal to the
// module. The portal URL is never hard-coded in the engine — an adapter only
// inspects whichever page it is handed.
const adapters: PortalAdapter[] = [indiaAdapter];

export function resolveAdapter(url: string): PortalAdapter {
  return adapters.find((a) => a.matches(url)) ?? genericAdapter;
}
