import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { genericAdapter } from '../../src/server/automation/adapters/genericAdapter.js';
import { resolveAdapter } from '../../src/server/automation/adapters/registry.js';
import type { PageInspection } from '../../src/server/automation/engine/pageInspector.js';

const fakePage = {} as unknown as Page;
const fakeInspection = { pageTitle: null, elementCounts: {}, securityChallengeFlags: {} } as PageInspection;

describe('genericAdapter', () => {
  it('reports UNKNOWN with zero confidence for any page', async () => {
    const id = await genericAdapter.getPageIdentity(fakePage, fakeInspection);
    expect(id.state).toBe('UNKNOWN');
    expect(id.confidence).toBe(0);
  });
  it('has no submit affordance', () => {
    expect(genericAdapter.submitSelector).toBeNull();
  });
  it('refuses to continue and cannot navigate', async () => {
    expect((await genericAdapter.canContinue(fakePage)).ok).toBe(false);
    await expect(genericAdapter.clickNext(fakePage)).rejects.toThrow(/cannot navigate/i);
  });
  it('isFinalReview is always false; getFieldMap is empty; sectionIdsForState is empty', () => {
    expect(genericAdapter.isFinalReview('FINAL_REVIEW')).toBe(false);
    expect(genericAdapter.getFieldMap()).toEqual({});
    expect(genericAdapter.sectionIdsForState('X')).toEqual([]);
  });
  it('resolveAdapter falls back to generic for any url', () => {
    expect(resolveAdapter('https://anything.example/').id).toBe('generic');
  });
});
