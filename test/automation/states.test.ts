import { describe, expect, it } from 'vitest';
import { LEGAL_TRANSITIONS, RUN_STATES, TERMINAL_STATES, assertTransition, isTerminal } from '../../src/shared/automation/states.js';

describe('run state machine', () => {
  it('has no completed / submitted state', () => {
    expect(RUN_STATES).not.toContain('completed');
    expect(RUN_STATES).not.toContain('submitted');
    expect(RUN_STATES).toContain('review_ready');
  });
  it('review_ready, failed, aborted are terminal with no outgoing transitions', () => {
    for (const s of TERMINAL_STATES) {
      expect(isTerminal(s)).toBe(true);
      expect(LEGAL_TRANSITIONS[s]).toEqual([]);
    }
  });
  it('allows running -> waiting_for_user -> running (resume)', () => {
    expect(() => assertTransition('running', 'waiting_for_user')).not.toThrow();
    expect(() => assertTransition('waiting_for_user', 'running')).not.toThrow();
  });
  it('rejects waiting_for_user -> review_ready (must go through running)', () => {
    expect(() => assertTransition('waiting_for_user', 'review_ready')).toThrow(/illegal/i);
  });
  it('rejects any transition out of review_ready', () => {
    expect(() => assertTransition('review_ready', 'running')).toThrow(/illegal/i);
  });
});
