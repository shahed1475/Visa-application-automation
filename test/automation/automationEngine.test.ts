import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import type { PortalAdapter } from '../../src/server/automation/adapters/baseAdapter.js';
import { detectPage as detectPageReal } from '../../src/server/automation/engine/pageDetector.js';
import { CheckpointManager } from '../../src/server/automation/checkpoints/checkpointManager.js';
import {
  runLoop,
  type EngineContext,
  type EngineEvent,
  type EngineProgress,
} from '../../src/server/automation/engine/automationEngine.js';
import type {
  ConflictDecision,
  MappedField,
  PortalFieldMap,
  VerificationOutcome,
} from '../../src/shared/automation/types.js';
import type {
  ApplicationPlan,
  DocumentPlan,
  FieldPlan,
  SectionPlan,
} from '../../src/shared/application/types.js';
import type { Source } from '../../src/shared/visa-kb/schema.js';
import { syntheticSelection } from '../helpers/applicationFixtures.js';

// ---- synthetic ApplicationPlan scaffolding ---------------------------------------------------

const SRC: Source = {
  officialUrl: 'https://portal.example.test/',
  retrievedAt: '2026-01-01',
  confidence: 'unverified',
};

function fld(o: {
  appliesTo: string | null;
  sectionId: string;
  present?: boolean;
  verified?: boolean;
  value?: string | null;
  required?: boolean;
}): FieldPlan {
  const required = o.required ?? true;
  return {
    id: o.appliesTo ?? 'synthetic',
    label: o.appliesTo ?? 'field',
    sectionId: o.sectionId,
    requirement: required ? 'required' : 'optional',
    condition: null,
    conditionMet: null,
    effectiveRequirement: required ? 'required' : 'optional',
    appliesTo: o.appliesTo,
    value: o.value ?? null,
    present: o.present ?? true,
    verified: o.verified ?? false,
    source: SRC,
  };
}

function sec(id: string, fields: FieldPlan[]): SectionPlan {
  return { id, label: id, applicable: true, source: SRC, fields };
}

function doc(o: { id: string; uploaded: boolean; required?: boolean }): DocumentPlan {
  return {
    id: o.id,
    label: o.id,
    requirement: 'required',
    condition: null,
    conditionMet: null,
    effectiveRequirement: (o.required ?? true) ? 'required' : 'optional',
    uploaded: o.uploaded,
    matchedDocumentId: null,
    source: SRC,
  };
}

function makePlan(over: {
  sections?: SectionPlan[];
  documents?: DocumentPlan[];
  requiredTotal?: number;
}): ApplicationPlan {
  return {
    selection: syntheticSelection(),
    category: null,
    eligibility: {
      status: 'eligible',
      conditions: [],
      unmetConditions: [],
      warnings: [],
      basis: null,
      source: null,
    },
    sections: over.sections ?? [],
    documents: over.documents ?? [],
    missing: [],
    verification: {
      requiredVerified: 0,
      requiredTotal: over.requiredTotal ?? 0,
      ratio: 0,
      label: 'unverified',
      bySection: {},
    },
    readyForAutomation: { ready: true, blockers: [] },
    provenance: {
      kbVersion: 'test',
      kbRevisionDate: '2026-01-01',
      schemaVersion: 2,
      computedAt: '2026-01-01T00:00:00.000Z',
    },
    warnings: [],
  };
}

// ---- FakeAdapter / FakePage ------------------------------------------------------------------

interface FakePageDef {
  state: string;
  confidence?: number;
  sectionIds?: string[];
  canContinue?: { ok: boolean; reason?: string };
  isFinalReview?: boolean;
  docIds?: string[];
}

function makeFakeAdapter(
  pages: FakePageDef[],
  fieldMap: PortalFieldMap,
): { adapter: PortalAdapter; advance: () => void; index: () => number } {
  let i = 0;
  const cur = (): FakePageDef => {
    const p = pages[Math.min(i, pages.length - 1)];
    if (p === undefined) throw new Error('FakeAdapter: no pages');
    return p;
  };
  const adapter: PortalAdapter = {
    id: 'fake',
    matches: () => true,
    entryUrl: (u) => u,
    getPageIdentity: async () => ({
      state: cur().state,
      confidence: cur().confidence ?? 0.9,
      signals: [],
    }),
    sectionIdsForState: () => cur().sectionIds ?? [],
    documentIdsForState: () => cur().docIds ?? [],
    getFieldMap: () => fieldMap,
    canContinue: async () => cur().canContinue ?? { ok: true },
    clickNext: async () => {
      i += 1;
    },
    isFinalReview: () => cur().isFinalReview ?? false,
    submitSelector: null,
  };
  return { adapter, advance: () => { i += 1; }, index: () => i };
}

function makeFakePage(bringToFront: () => Promise<void> = async () => {}): Page {
  return {
    url: () => 'about:blank',
    title: async () => '',
    bringToFront,
  } as unknown as Page;
}

interface CtxOpts {
  adapter: PortalAdapter;
  plan: ApplicationPlan;
  page?: Page;
  flags?: Record<string, boolean>;
  applyFieldFn?: (
    m: MappedField,
  ) => { filled: boolean; outcome: VerificationOutcome; alreadySet: boolean };
  readControlValue?: string | null;
  initialVerifiedCount?: number;
  classifyPreFill?: EngineContext['classifyPreFill'];
  conflictDecisions?: ReadonlyMap<string, ConflictDecision>;
}

function makeCtx(o: CtxOpts) {
  const events: EngineEvent[] = [];
  const progress: EngineProgress[] = [];
  const mismatches: { fieldPath: string; expected: string; actual: string }[] = [];
  const applyFieldCalls: string[] = [];
  const page = o.page ?? makeFakePage();
  const ctx: EngineContext = {
    page,
    adapter: o.adapter,
    plan: o.plan,
    checkpoints: new CheckpointManager(),
    runId: 'run-1',
    onProgress: (p) => {
      progress.push(p);
    },
    emit: (e) => {
      events.push(e);
    },
    recordMismatch: (m) => {
      mismatches.push(m);
    },
    now: () => '2026-01-01T00:00:00.000Z',
    inspect: async () => ({
      pageTitle: null,
      elementCounts: {},
      securityChallengeFlags: o.flags ?? {},
    }),
    detectPage: detectPageReal,
    applyField: async (_page, m) => {
      applyFieldCalls.push(m.fieldPath);
      return o.applyFieldFn
        ? o.applyFieldFn(m)
        : { filled: true, outcome: 'verified' as VerificationOutcome, alreadySet: false };
    },
    readControl: async () => (o.readControlValue === undefined ? null : o.readControlValue),
    settle: async () => {},
    initialVerifiedCount: o.initialVerifiedCount,
    classifyPreFill: o.classifyPreFill ?? (async () => 'empty'),
    conflictDecisions: o.conflictDecisions ?? new Map(),
  };
  return { ctx, events, progress, mismatches, applyFieldCalls };
}

const types = (events: EngineEvent[]) => events.map((e) => e.type);

// ---- scenarios ------------------------------------------------------------------------------

describe('runLoop', () => {
  it('1. happy path: fills a page, navigates, stops at the final review without submitting', async () => {
    const fieldMap: PortalFieldMap = {
      'identity.surname': { selector: '#surname', control: 'text', selectorConfidence: 'stable' },
    };
    const plan = makePlan({
      sections: [
        sec('personal_particulars', [
          fld({
            appliesTo: 'identity.surname',
            sectionId: 'personal_particulars',
            value: 'RANA',
            verified: true,
          }),
        ]),
      ],
      requiredTotal: 1,
    });
    const { adapter } = makeFakeAdapter(
      [
        { state: 'PERSONAL', sectionIds: ['personal_particulars'] },
        { state: 'REVIEW', isFinalReview: true, sectionIds: [] },
      ],
      fieldMap,
    );
    const { ctx, events, progress } = makeCtx({ adapter, plan });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'review_ready' });
    expect(types(events)).toEqual([
      'RUN_STARTED',
      'PAGE_DETECTED',
      'FIELD_FILL_STARTED',
      'FIELD_VERIFIED',
      'NAVIGATION_STARTED',
      'NAVIGATION_COMPLETED',
      'PAGE_DETECTED',
      'REVIEW_READY',
    ]);
    expect(types(events)).not.toContain('FIELD_FILLED_UNVERIFIED');
    expect(events.some((e) => /submit|confirm|lodge|pay/i.test(e.type))).toBe(false);
    // Two progress calls per page: an early one (location, counters as they stand)
    // then one after the field loop (updated verified count).
    expect(progress[0]).toMatchObject({ current_portal_state: 'PERSONAL', fields_verified: 0, fields_total: 1 });
    expect(progress[1]).toMatchObject({ current_portal_state: 'PERSONAL', fields_verified: 1, fields_total: 1 });
    expect(progress.at(-1)).toMatchObject({ current_portal_state: 'REVIEW' });
  });

  it('2. unknown page: pauses immediately, never fills a field', async () => {
    const { adapter } = makeFakeAdapter([{ state: 'UNKNOWN', confidence: 0 }], {});
    const { ctx, events, applyFieldCalls } = makeCtx({ adapter, plan: makePlan({}) });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'waiting', reason: 'unknown_page' });
    expect(types(events)).toContain('UNKNOWN_PORTAL_STATE');
    expect(applyFieldCalls).toEqual([]);
  });

  it('3. OTP checkpoint: brings the tab forward and pauses with reason otp', async () => {
    const { adapter } = makeFakeAdapter(
      [{ state: 'PERSONAL', sectionIds: ['personal_particulars'] }],
      {},
    );
    const bringToFront = vi.fn(async () => {});
    const { ctx, events } = makeCtx({
      adapter,
      plan: makePlan({}),
      page: makeFakePage(bringToFront),
      flags: { mentionsOtp: true },
    });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'waiting', reason: 'otp' });
    expect(types(events)).toContain('OTP_REQUIRED');
    expect(bringToFront).toHaveBeenCalledTimes(1);
  });

  it('4. unmapped required field: pauses with missing_field_mapping', async () => {
    const plan = makePlan({
      sections: [
        sec('personal_particulars', [
          fld({ appliesTo: 'identity.surname', sectionId: 'personal_particulars', present: true }),
        ]),
      ],
      requiredTotal: 1,
    });
    const { adapter } = makeFakeAdapter(
      [{ state: 'PERSONAL', sectionIds: ['personal_particulars'] }],
      {}, // empty field map => 'identity.surname' is unmapped
    );
    const { ctx, events, applyFieldCalls } = makeCtx({ adapter, plan });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'waiting', reason: 'missing_field_mapping' });
    const unmapped = events.find((e) => e.type === 'FIELD_UNMAPPED');
    expect(unmapped).toMatchObject({ fieldPath: 'identity.surname', status: 'blocked' });
    expect(applyFieldCalls).toEqual([]);
  });

  it('5. value mismatch: records raw values only via recordMismatch, never in an event', async () => {
    const fieldMap: PortalFieldMap = {
      'identity.surname': { selector: '#surname', control: 'text', selectorConfidence: 'stable' },
    };
    const plan = makePlan({
      sections: [
        sec('personal_particulars', [
          fld({ appliesTo: 'identity.surname', sectionId: 'personal_particulars', value: 'RANA' }),
        ]),
      ],
      requiredTotal: 1,
    });
    const { adapter } = makeFakeAdapter(
      [{ state: 'PERSONAL', sectionIds: ['personal_particulars'] }],
      fieldMap,
    );
    const { ctx, events, mismatches } = makeCtx({
      adapter,
      plan,
      applyFieldFn: () => ({ filled: true, outcome: 'mismatch', alreadySet: false }),
      readControlValue: 'WRONG',
    });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'waiting', reason: 'value_mismatch' });
    expect(mismatches).toEqual([
      { fieldPath: 'identity.surname', expected: 'RANA', actual: 'WRONG' },
    ]);
    const mismatchEvent = events.find((e) => e.type === 'FIELD_MISMATCH');
    expect(mismatchEvent).toMatchObject({ fieldPath: 'identity.surname', status: 'mismatch' });
    for (const e of events) {
      expect(e).not.toHaveProperty('value');
      expect(e).not.toHaveProperty('expected');
      expect(e).not.toHaveProperty('actual');
      const blob = `${e.type} ${e.status ?? ''} ${e.fieldPath ?? ''}`;
      expect(blob).not.toMatch(/RANA|WRONG/);
    }
  });

  it('6. validation error: adapter refuses to continue → pauses with validation_error', async () => {
    const fieldMap: PortalFieldMap = {
      'identity.surname': { selector: '#surname', control: 'text', selectorConfidence: 'stable' },
    };
    const plan = makePlan({
      sections: [
        sec('personal_particulars', [
          fld({
            appliesTo: 'identity.surname',
            sectionId: 'personal_particulars',
            value: 'RANA',
            verified: true,
          }),
        ]),
      ],
      requiredTotal: 1,
    });
    const { adapter } = makeFakeAdapter(
      [
        {
          state: 'PERSONAL',
          sectionIds: ['personal_particulars'],
          canContinue: { ok: false, reason: 'required field empty' },
        },
      ],
      fieldMap,
    );
    const { ctx, events } = makeCtx({ adapter, plan });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'waiting', reason: 'validation_error' });
    expect(types(events)).toContain('VALIDATION_ERROR');
  });

  it('7. missing document: fails with error code missing_document', async () => {
    const plan = makePlan({
      documents: [doc({ id: 'invitation', uploaded: false })],
    });
    const { adapter } = makeFakeAdapter(
      [{ state: 'DOCS', sectionIds: [], docIds: ['invitation'] }],
      {},
    );
    const { ctx, events } = makeCtx({ adapter, plan });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'failed', errorCode: 'missing_document' });
    const blocked = events.find((e) => e.type === 'BLOCKED_MISSING_DOCUMENT');
    expect(blocked).toMatchObject({ fieldPath: 'invitation', status: 'blocked' });
  });

  it('8. optional verified fields emit FIELD_VERIFIED but never inflate the required-only count', async () => {
    const fieldMap: PortalFieldMap = {
      'identity.surname': { selector: '#surname', control: 'text', selectorConfidence: 'stable' },
      'identity.givenNames': { selector: '#given', control: 'text', selectorConfidence: 'stable' },
    };
    const plan = makePlan({
      sections: [
        sec('personal_particulars', [
          fld({
            appliesTo: 'identity.surname',
            sectionId: 'personal_particulars',
            value: 'RANA',
            verified: true,
          }),
          fld({
            appliesTo: 'identity.givenNames',
            sectionId: 'personal_particulars',
            value: 'MITHU',
            verified: true,
            required: false,
          }),
        ]),
      ],
      requiredTotal: 1,
    });
    const { adapter } = makeFakeAdapter(
      [
        { state: 'PERSONAL', sectionIds: ['personal_particulars'] },
        { state: 'REVIEW', isFinalReview: true, sectionIds: [] },
      ],
      fieldMap,
    );
    const { ctx, events, progress } = makeCtx({ adapter, plan });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'review_ready' });
    // both fields verified → two events …
    expect(events.filter((e) => e.type === 'FIELD_VERIFIED')).toHaveLength(2);
    // … but only the required one counts toward fields_verified (== fields_total).
    const personal = progress.filter((p) => p.current_portal_state === 'PERSONAL');
    expect(personal.at(-1)).toMatchObject({ fields_verified: 1, fields_total: 1 });
    expect(personal.every((p) => (p.fields_verified ?? 0) <= (p.fields_total ?? 0))).toBe(true);
  });

  it('9. iteration cap: an adapter that cycles states forever is stopped', async () => {
    const pages: FakePageDef[] = Array.from({ length: 200 }, (_, k) => ({
      state: k % 2 === 0 ? 'A' : 'B',
      sectionIds: [],
    }));
    const { adapter } = makeFakeAdapter(pages, {});
    const { ctx, events } = makeCtx({ adapter, plan: makePlan({}) });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'waiting', reason: 'unknown_page' });
    expect(types(events)).toContain('NAVIGATION_STALLED');
  });

  it('10. a resumed run carries fields_verified in — the count is not reset to 0', async () => {
    // Models the second `runLoop` call after an OTP pause: the earlier pages
    // (and their verified fields) are behind us; this walk only sees the review
    // page. Without `initialVerifiedCount` the run would report 0/3 at success.
    const { adapter } = makeFakeAdapter(
      [{ state: 'REVIEW', isFinalReview: true, sectionIds: [] }],
      {},
    );
    const { ctx, progress } = makeCtx({
      adapter,
      plan: makePlan({ requiredTotal: 3 }),
      initialVerifiedCount: 3,
    });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'review_ready' });
    expect(progress.at(-1)).toMatchObject({ fields_verified: 3, fields_total: 3 });
    expect(progress.every((p) => p.fields_verified === 3)).toBe(true);
  });

  it('11. initialVerifiedCount is the floor, then the loop keeps counting up', async () => {
    const fieldMap: PortalFieldMap = {
      'identity.surname': { selector: '#s', control: 'text', selectorConfidence: 'stable' },
    };
    const plan = makePlan({
      sections: [
        sec('personal_particulars', [
          fld({ appliesTo: 'identity.surname', sectionId: 'personal_particulars', value: 'RANA' }),
        ]),
      ],
      requiredTotal: 2,
    });
    const { adapter } = makeFakeAdapter(
      [
        { state: 'PERSONAL', sectionIds: ['personal_particulars'] },
        { state: 'REVIEW', isFinalReview: true, sectionIds: [] },
      ],
      fieldMap,
    );
    const { ctx, progress } = makeCtx({ adapter, plan, initialVerifiedCount: 1 });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'review_ready' });
    // 1 carried in + 1 verified on this page = 2
    expect(progress.at(-1)).toMatchObject({ fields_verified: 2, fields_total: 2 });
  });

  // ---- value_conflict branch --------------------------------------------------------------

  const conflictPlan = () =>
    makePlan({
      sections: [
        sec('personal_particulars', [
          fld({ appliesTo: 'identity.surname', sectionId: 'personal_particulars', value: 'RANA' }),
        ]),
      ],
      requiredTotal: 1,
    });
  const conflictFieldMap: PortalFieldMap = {
    'identity.surname': { selector: '#surname', control: 'text', selectorConfidence: 'stable' },
  };

  it('12. pre-existing different value, no decision → pauses on value_conflict, does not fill', async () => {
    const { adapter } = makeFakeAdapter(
      [{ state: 'PERSONAL', sectionIds: ['personal_particulars'] }],
      conflictFieldMap,
    );
    const { ctx, events, mismatches, applyFieldCalls } = makeCtx({
      adapter,
      plan: conflictPlan(),
      classifyPreFill: async () => 'conflict',
      readControlValue: 'SMITH',
    });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({
      kind: 'waiting',
      reason: 'value_conflict',
      conflictFieldPath: 'identity.surname',
    });
    expect(types(events)).toContain('VALUE_CONFLICT');
    expect(mismatches).toEqual([
      { fieldPath: 'identity.surname', expected: 'RANA', actual: 'SMITH' },
    ]);
    expect(applyFieldCalls).toEqual([]);
    for (const e of events) {
      const blob = `${e.type} ${e.status ?? ''} ${e.fieldPath ?? ''}`;
      expect(blob).not.toMatch(/RANA|SMITH/);
    }
  });

  it('13. conflict + keep_portal decision → emits FIELD_CONFLICT_KEPT, skips the field, loop continues', async () => {
    const { adapter } = makeFakeAdapter(
      [
        { state: 'PERSONAL', sectionIds: ['personal_particulars'] },
        { state: 'REVIEW', isFinalReview: true, sectionIds: [] },
      ],
      conflictFieldMap,
    );
    const { ctx, events, applyFieldCalls } = makeCtx({
      adapter,
      plan: conflictPlan(),
      classifyPreFill: async () => 'conflict',
      conflictDecisions: new Map<string, ConflictDecision>([['identity.surname', 'keep_portal']]),
    });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'review_ready' });
    expect(types(events)).toContain('FIELD_CONFLICT_KEPT');
    expect(types(events)).not.toContain('VALUE_CONFLICT');
    expect(applyFieldCalls).toEqual([]);
  });

  it('14. conflict + use_application decision → emits FIELD_CONFLICT_OVERWRITTEN then fills and verifies', async () => {
    const { adapter } = makeFakeAdapter(
      [
        { state: 'PERSONAL', sectionIds: ['personal_particulars'] },
        { state: 'REVIEW', isFinalReview: true, sectionIds: [] },
      ],
      conflictFieldMap,
    );
    const { ctx, events, applyFieldCalls } = makeCtx({
      adapter,
      plan: conflictPlan(),
      classifyPreFill: async () => 'conflict',
      conflictDecisions: new Map<string, ConflictDecision>([
        ['identity.surname', 'use_application'],
      ]),
    });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'review_ready' });
    expect(types(events)).toContain('FIELD_CONFLICT_OVERWRITTEN');
    expect(applyFieldCalls).toEqual(['identity.surname']);
    expect(types(events)).toContain('FIELD_VERIFIED');
  });

  it("15. classifyPreFill 'match' → no conflict event, applyField still called (unchanged behaviour)", async () => {
    const { adapter } = makeFakeAdapter(
      [
        { state: 'PERSONAL', sectionIds: ['personal_particulars'] },
        { state: 'REVIEW', isFinalReview: true, sectionIds: [] },
      ],
      conflictFieldMap,
    );
    const { ctx, events, applyFieldCalls } = makeCtx({
      adapter,
      plan: conflictPlan(),
      classifyPreFill: async () => 'match',
      applyFieldFn: () => ({ filled: false, outcome: 'verified', alreadySet: true }),
    });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'review_ready' });
    expect(applyFieldCalls).toEqual(['identity.surname']);
    expect(types(events)).not.toContain('VALUE_CONFLICT');
    expect(types(events)).not.toContain('FIELD_CONFLICT_KEPT');
    expect(types(events)).not.toContain('FIELD_CONFLICT_OVERWRITTEN');
  });

  it('16. a required field kept as a portal-value conflict is not counted toward fields_verified', async () => {
    const { adapter } = makeFakeAdapter(
      [
        { state: 'PERSONAL', sectionIds: ['personal_particulars'] },
        { state: 'REVIEW', isFinalReview: true, sectionIds: [] },
      ],
      conflictFieldMap,
    );
    const { ctx, progress } = makeCtx({
      adapter,
      plan: conflictPlan(),
      classifyPreFill: async () => 'conflict',
      conflictDecisions: new Map<string, ConflictDecision>([['identity.surname', 'keep_portal']]),
    });

    const stop = await runLoop(ctx);

    expect(stop).toEqual({ kind: 'review_ready' });
    const personal = progress.filter((p) => p.current_portal_state === 'PERSONAL');
    expect(personal.at(-1)).toMatchObject({ fields_verified: 0, fields_total: 1 });
  });
});
