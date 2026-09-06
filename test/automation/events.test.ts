import { describe, expect, it } from 'vitest';
import { EVENT_MESSAGES, EVENT_TYPES, isEventType } from '../../src/shared/automation/events.js';

describe('event vocabulary', () => {
  it('every event type has a message', () => {
    for (const t of EVENT_TYPES) expect(typeof EVENT_MESSAGES[t]).toBe('string');
    expect(Object.keys(EVENT_MESSAGES).sort()).toEqual([...EVENT_TYPES].sort());
  });
  it('no message contains an interpolation placeholder or a value slot', () => {
    for (const [t, m] of Object.entries(EVENT_MESSAGES)) {
      expect(m, t).not.toMatch(/\$\{|%s|\{\{|\bvalue\b:/i);
    }
  });
  it('includes the safety-critical event types and no submit type', () => {
    for (const t of ['OTP_REQUIRED', 'CAPTCHA_REQUIRED', 'REVIEW_READY', 'BLOCKED_MISSING_DOCUMENT', 'CHECKPOINT_STILL_PRESENT']) {
      expect(EVENT_TYPES).toContain(t);
    }
    expect(EVENT_TYPES.some((t) => /submit|confirm|lodge|pay/i.test(t))).toBe(false);
    expect(isEventType('NOT_A_REAL_EVENT')).toBe(false);
  });
});
