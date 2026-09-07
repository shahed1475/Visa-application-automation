import type { RunStatus } from './types.js';

export const RUN_STATES = ['pending', 'running', 'waiting_for_user', 'paused', 'review_ready', 'failed', 'aborted'] as const;
export const TERMINAL_STATES = ['review_ready', 'failed', 'aborted'] as const satisfies readonly RunStatus[];

export const LEGAL_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  pending: ['running', 'aborted', 'failed'],
  running: ['waiting_for_user', 'paused', 'review_ready', 'failed', 'aborted'],
  waiting_for_user: ['running', 'paused', 'aborted', 'failed'],
  paused: ['running', 'aborted', 'failed'],
  review_ready: [],
  failed: [],
  aborted: [],
};

export function isTerminal(s: RunStatus): boolean {
  return (TERMINAL_STATES as readonly RunStatus[]).includes(s);
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!LEGAL_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`illegal automation run transition: ${from} -> ${to}`);
  }
}
