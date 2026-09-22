import { describe, expect, it } from 'vitest';
import {
  classifyMapping,
  isProductionUsable,
  isNextSelectorProductionUsable,
} from '../../src/server/automation/adapters/india/mappingLifecycle.js';
import type { IndiaFieldMapping } from '../../src/server/automation/adapters/india/indiaPortalMap.js';

const REV = '2026-09-07';
const base: IndiaFieldMapping = {
  selector: '#x',
  control: 'text',
  selectorConfidence: 'stable',
  status: 'validated',
  discoverySessionRef: 's1',
  validatedAt: '2026-09-07T00:00:00Z',
  validatedAgainstRevision: REV,
};

describe('classifyMapping', () => {
  it('placeholder passes through', () => {
    expect(
      classifyMapping({ ...base, selector: 'TODO:discover', status: 'placeholder' }, REV),
    ).toBe('placeholder');
  });

  it('discovered passes through', () => {
    expect(
      classifyMapping(
        { ...base, status: 'discovered', validatedAt: undefined, validatedAgainstRevision: undefined },
        REV,
      ),
    ).toBe('discovered');
  });

  it('validated + current revision => validated', () => {
    expect(classifyMapping(base, REV)).toBe('validated');
  });

  it('validated + old revision => stale', () => {
    expect(classifyMapping({ ...base, validatedAgainstRevision: '2026-01-01' }, REV)).toBe('stale');
  });

  it('validated + missing stamp => stale (never silently trusted)', () => {
    expect(classifyMapping({ ...base, validatedAgainstRevision: undefined }, REV)).toBe('stale');
  });
});

describe('isProductionUsable', () => {
  it('true only for validated + current revision', () => {
    expect(isProductionUsable(base, REV)).toBe(true);
    expect(isProductionUsable({ ...base, validatedAgainstRevision: 'old' }, REV)).toBe(false);
    expect(isProductionUsable({ ...base, status: 'discovered' }, REV)).toBe(false);
    expect(
      isProductionUsable({ ...base, selector: 'TODO:discover', status: 'placeholder' }, REV),
    ).toBe(false);
  });
});

describe('isNextSelectorProductionUsable', () => {
  it('true only for a validated nextSelector stamped against the current revision', () => {
    expect(
      isNextSelectorProductionUsable(
        {
          nextSelector: 'a.next',
          nextSelectorStatus: 'validated',
          nextSelectorValidatedAgainstRevision: REV,
        },
        REV,
      ),
    ).toBe(true);
  });

  it('false for a validated nextSelector stamped against an old revision', () => {
    expect(
      isNextSelectorProductionUsable(
        {
          nextSelector: 'a.next',
          nextSelectorStatus: 'validated',
          nextSelectorValidatedAgainstRevision: 'old',
        },
        REV,
      ),
    ).toBe(false);
  });

  it('false for a placeholder or null nextSelector', () => {
    expect(
      isNextSelectorProductionUsable(
        { nextSelector: 'TODO:discover', nextSelectorStatus: 'placeholder' },
        REV,
      ),
    ).toBe(false);
    expect(
      isNextSelectorProductionUsable({ nextSelector: null, nextSelectorStatus: 'placeholder' }, REV),
    ).toBe(false);
  });
});
