import type { Page } from 'playwright';
import type { PageInspection } from '../engine/pageInspector.js';
import type {
  PageIdentity,
  PortalState,
  PortalFieldMap,
  SignalMatch,
} from '../../../shared/automation/types.js';

export interface CheckpointHints {
  otpLabelPatterns?: RegExp[];
  captchaSelectors?: string[];
  mfaPatterns?: RegExp[];
}

export interface PortalStateConfig {
  signals: (page: Page, inspection: PageInspection) => Promise<SignalMatch[]>;
  sectionIds: string[];
  nextSelector: string | null; // null on the final review state
  isFinalReview?: boolean;
}

export interface PortalAdapter {
  readonly id: string;
  matches(url: string): boolean;
  entryUrl(portalUrl: string): string;
  getPageIdentity(page: Page, inspection: PageInspection): Promise<PageIdentity>;
  sectionIdsForState(state: PortalState): string[];
  /** Document ids (matching `ApplicationPlan.documents[].id`) the portal collects while in `state`. */
  documentIdsForState(state: PortalState): string[];
  getFieldMap(): PortalFieldMap;
  canContinue(page: Page): Promise<{ ok: boolean; reason?: string }>;
  clickNext(page: Page): Promise<void>;
  isFinalReview(state: PortalState): boolean;
  checkpointHints?: CheckpointHints;
  readonly submitSelector: null;
}
