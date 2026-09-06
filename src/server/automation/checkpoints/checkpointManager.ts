import type { Page } from 'playwright';
import type { PageInspection } from '../engine/pageInspector.js';
import type { CheckpointHints } from '../adapters/baseAdapter.js';
import { detectCheckpoint, type Checkpoint } from '../engine/checkpointDetector.js';

/**
 * Pause/resume signalling for the automation engine. When the engine hits a
 * human checkpoint (OTP / CAPTCHA / MFA / anti-bot) it persists `waiting_for_user`
 * and then `await`s `awaitResume(runId)`. The ONLY thing that resolves that
 * promise is an explicit `signalResume(runId)` call, driven by the user's
 * POST /resume. There is no timeout and no auto-resume path — a paused run
 * stays paused until the user acts (or the process restarts, in which case the
 * DB record drives a fresh resume). (spec §5, §10; automation-risks.md R7.)
 */
export class CheckpointManager {
  private readonly pending = new Map<string, () => void>();

  /** Resolves when signalResume(runId) is called. If a pause is already pending
   *  for this run (shouldn't happen — the engine pauses once per checkpoint),
   *  the stale resolver is released first so its promise never dangles. */
  awaitResume(runId: string): Promise<void> {
    const stale = this.pending.get(runId);
    if (stale) {
      this.pending.delete(runId);
      stale();
    }
    return new Promise<void>((resolve) => {
      this.pending.set(runId, resolve);
    });
  }

  /** Resolve a pending awaitResume for runId. Returns whether one was pending.
   *  A second call for the same run (with nothing pending) returns false. */
  signalResume(runId: string): boolean {
    const resolve = this.pending.get(runId);
    if (!resolve) return false;
    this.pending.delete(runId);
    resolve();
    return true;
  }

  hasPending(runId: string): boolean {
    return this.pending.has(runId);
  }

  /** Re-run checkpoint detection — the engine calls this on resume to refuse
   *  (409 checkpoint_still_present) while a challenge is still on the page. */
  async stillBlocked(
    page: Page,
    inspection: PageInspection,
    hints?: CheckpointHints,
  ): Promise<Checkpoint | null> {
    return detectCheckpoint(inspection, page, hints);
  }
}
