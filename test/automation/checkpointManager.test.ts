import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import type { PageInspection } from '../../src/server/automation/engine/pageInspector.js';
import { CheckpointManager } from '../../src/server/automation/checkpoints/checkpointManager.js';

const insp = (flags: Record<string, boolean>): PageInspection => ({
  pageTitle: null,
  elementCounts: {},
  securityChallengeFlags: flags,
});

describe('CheckpointManager', () => {
  it('awaitResume yields a pending promise that resolves on signalResume', async () => {
    const m = new CheckpointManager();
    let resolved = false;
    const p = m.awaitResume('r').then(() => {
      resolved = true;
    });
    expect(m.hasPending('r')).toBe(true);
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(m.signalResume('r')).toBe(true);
    await p;
    expect(resolved).toBe(true);
    expect(m.hasPending('r')).toBe(false);
  });

  it('a second signalResume for the same run returns false', () => {
    const m = new CheckpointManager();
    void m.awaitResume('r');
    expect(m.signalResume('r')).toBe(true);
    expect(m.signalResume('r')).toBe(false);
  });

  it('signalResume for an unknown run returns false', () => {
    expect(new CheckpointManager().signalResume('nope')).toBe(false);
  });

  it('resolving one run does not touch another', async () => {
    const m = new CheckpointManager();
    let aDone = false;
    let bDone = false;
    void m.awaitResume('a').then(() => {
      aDone = true;
    });
    void m.awaitResume('b').then(() => {
      bDone = true;
    });
    m.signalResume('a');
    await Promise.resolve();
    await Promise.resolve();
    expect(aDone).toBe(true);
    expect(bDone).toBe(false);
    expect(m.hasPending('b')).toBe(true);
  });

  it('a duplicate awaitResume for the same run releases the stale promise', async () => {
    const m = new CheckpointManager();
    let firstResolved = false;
    void m.awaitResume('r').then(() => {
      firstResolved = true;
    });
    const second = m.awaitResume('r');
    await Promise.resolve();
    await Promise.resolve();
    expect(firstResolved).toBe(true);
    expect(m.signalResume('r')).toBe(true);
    await second;
  });

  it('stillBlocked re-runs detectCheckpoint (captcha flag -> captcha)', async () => {
    const m = new CheckpointManager();
    const cp = await m.stillBlocked({} as Page, insp({ recaptcha: true }));
    expect(cp?.kind).toBe('captcha');
  });

  it('stillBlocked returns null for a clean page', async () => {
    const m = new CheckpointManager();
    expect(await m.stillBlocked({} as Page, insp({}))).toBeNull();
  });
});
