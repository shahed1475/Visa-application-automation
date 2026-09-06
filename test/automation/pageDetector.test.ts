import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import type { PortalAdapter } from '../../src/server/automation/adapters/baseAdapter.js';
import type { PageInspection } from '../../src/server/automation/engine/pageInspector.js';
import type { PageIdentity } from '../../src/shared/automation/types.js';
import { detectPage, DETECT_CONFIDENCE_THRESHOLD } from '../../src/server/automation/engine/pageDetector.js';

const page = {} as Page;
const inspection = {} as PageInspection;
function adapterReturning(id: PageIdentity): PortalAdapter {
  return { getPageIdentity: async () => id } as unknown as PortalAdapter;
}
const sig = [{ kind: 'heading' as const, matched: true, detail: 'Passport Details' }];

describe('detectPage', () => {
  it('passes through a high-confidence identity with its signals', async () => {
    const out = await detectPage(page, adapterReturning({ state: 'PASSPORT_DETAILS', confidence: 0.9, signals: sig }), inspection);
    expect(out).toEqual({ state: 'PASSPORT_DETAILS', confidence: 0.9, signals: sig });
  });
  it('forces UNKNOWN when confidence is below the threshold, keeping the raw confidence + signals', async () => {
    const out = await detectPage(page, adapterReturning({ state: 'PASSPORT_DETAILS', confidence: 0.4, signals: sig }), inspection);
    expect(out.state).toBe('UNKNOWN');
    expect(out.confidence).toBe(0.4);
    expect(out.signals).toEqual(sig);
  });
  it('leaves an already-UNKNOWN identity as UNKNOWN', async () => {
    const out = await detectPage(page, adapterReturning({ state: 'UNKNOWN', confidence: 0, signals: [] }), inspection);
    expect(out.state).toBe('UNKNOWN');
  });
  it('the threshold is 0.6', () => {
    expect(DETECT_CONFIDENCE_THRESHOLD).toBe(0.6);
  });
  it('exactly at the threshold passes through (>= is fine, < is the reject)', async () => {
    const out = await detectPage(page, adapterReturning({ state: 'ADDRESS', confidence: 0.6, signals: [] }), inspection);
    expect(out.state).toBe('ADDRESS');
  });
});
