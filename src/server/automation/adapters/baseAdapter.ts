import type { Page } from 'playwright';
import type { PageInspection } from '../engine/pageInspector.js';

export interface PortalAdapter {
  readonly id: string;
  matches(url: string): boolean;
  inspect(page: Page): Promise<PageInspection>;
}
