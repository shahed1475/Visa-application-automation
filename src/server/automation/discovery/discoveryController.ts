// DESIGN NOTE (do not remove): READ-ONLY. DiscoveryController owns a single
// headed browser context for a portal-discovery session. It opens the configured
// portal URL exactly ONCE — the lone `page.goto` in this file, and its argument
// is ALWAYS the resolved portal URL (a variable, never a literal). After that the
// USER drives the browser by hand; the controller only OBSERVES, persisting
// sanitized page STRUCTURE via `captureDiscoveryV2` (which runs `sanitizeReport`
// internally and never reads a control value). It has NO page-mutating call — no
// fill / click / type / press / check / uncheck / selectOption / setInputFiles /
// hover / dragTo / tap / keyboard.* / mouse.* / form.submit — by design
// (spec §5.2, §12, R15).

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { BrowserContext, Page } from 'playwright';
import { env } from '../../env.js';
import { getPortal } from '../../services/portalService.js';
import { PortalNotFoundError } from '../../services/errors.js';
import { BrowserManager } from '../engine/browserManager.js';
import { inspectPage } from '../engine/pageInspector.js';
import { resolveAdapter as defaultResolveAdapter } from '../adapters/registry.js';
import type { PortalAdapter } from '../adapters/baseAdapter.js';
import { UNKNOWN_STATE } from '../../../shared/automation/types.js';
import { assertPolicyAck } from './policyGate.js';
import { captureDiscoveryV2, sanitizeUrlToPattern } from './observe.js';
import {
  appendDiscoveryPage,
  createDiscoverySession,
  findActiveDiscoverySession,
  getDiscoverySession,
  updateDiscoverySession,
  type DiscoveryPageRow,
  type DiscoverySessionRow,
} from './discoverySessionStore.js';

export class DiscoverySessionActiveError extends Error {
  constructor(readonly adapterId: string) {
    super(`A discovery session is already active for adapter '${adapterId}'.`);
    this.name = 'DiscoverySessionActiveError';
  }
}

export class DiscoverySessionNotActiveError extends Error {
  constructor(readonly sessionId: string) {
    super(`Discovery session '${sessionId}' is not active.`);
    this.name = 'DiscoverySessionNotActiveError';
  }
}

export class DiscoverySessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Discovery session not found: ${sessionId}`);
    this.name = 'DiscoverySessionNotFoundError';
  }
}

export interface DiscoveryControllerDeps {
  browserManager?: BrowserManager;
  resolveAdapter?: (url: string) => PortalAdapter;
  profileDir?: string;
}

/**
 * Session lifecycle for user-driven, read-only portal discovery. One controller
 * owns at most one live headed context + page at a time. `start` opens the portal
 * once; `capture` snapshots whatever page the user has since navigated to; `end`
 * / `abort` close the context and mark the DB row terminal. `dispose` closes the
 * context WITHOUT any DB write (app-shutdown hook).
 */
export class DiscoveryController {
  private readonly bm: BrowserManager;
  private readonly resolveAdapter: (url: string) => PortalAdapter;
  private readonly profileDir: string;

  private ctx: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionId: string | null = null;
  private portalUrl: string | null = null;

  constructor(deps: DiscoveryControllerDeps = {}) {
    this.bm = deps.browserManager ?? new BrowserManager();
    this.resolveAdapter = deps.resolveAdapter ?? defaultResolveAdapter;
    this.profileDir = deps.profileDir ?? env.DISCOVERY_PROFILE_DIR;
  }

  /** The live page (for a validation pass); null when no session is running. */
  get activePage(): Page | null {
    return this.page;
  }

  async start(db: DatabaseSync, portalId: string): Promise<DiscoverySessionRow> {
    const portal = getPortal(db, portalId);
    if (!portal) throw new PortalNotFoundError(portalId);

    const adapter = this.resolveAdapter(portal.url);
    // Runtime Terms-of-Service gate — first wiring of the Phase 6 policy gate.
    assertPolicyAck(db, portalId, adapter.id, portal.url);

    if (findActiveDiscoverySession(db, adapter.id)) {
      throw new DiscoverySessionActiveError(adapter.id);
    }

    const now = new Date().toISOString();
    const session = createDiscoverySession(db, {
      id: randomUUID(),
      portalId,
      adapterId: adapter.id,
      now,
    });

    const ctx = await this.bm.launchPersistentDiscovery({ userDataDir: this.profileDir });
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(portal.url);
      this.ctx = ctx;
      this.page = page;
      this.sessionId = session.id;
      this.portalUrl = portal.url;
    } catch (err) {
      const failedAt = new Date().toISOString();
      updateDiscoverySession(db, session.id, { status: 'aborted', ended_at: failedAt }, failedAt);
      await this.bm.closeDiscovery().catch(() => {});
      throw err;
    }

    return session;
  }

  async capture(db: DatabaseSync, sessionId: string): Promise<DiscoveryPageRow> {
    const session = getDiscoverySession(db, sessionId);
    if (!session) throw new DiscoverySessionNotFoundError(sessionId);
    if (session.status !== 'active') throw new DiscoverySessionNotActiveError(sessionId);
    if (!this.page || this.sessionId !== sessionId) {
      throw new DiscoverySessionNotActiveError(sessionId);
    }
    const page = this.page;

    const report = await captureDiscoveryV2(page);

    const portalUrl =
      this.portalUrl ??
      (session.portal_id ? (getPortal(db, session.portal_id)?.url ?? null) : null);

    let stateGuess: string = UNKNOWN_STATE;
    if (portalUrl) {
      try {
        const identity = await this.resolveAdapter(portalUrl).getPageIdentity(
          page,
          await inspectPage(page),
        );
        stateGuess = identity.state;
      } catch {
        stateGuess = UNKNOWN_STATE;
      }
    }

    return appendDiscoveryPage(db, {
      id: randomUUID(),
      sessionId,
      now: new Date().toISOString(),
      stateGuess,
      urlPattern: sanitizeUrlToPattern(page.url()),
      pageTitle: report.pageTitle,
      headingsJson: JSON.stringify(report.headings),
      fingerprintJson: JSON.stringify({
        ...report.fingerprint,
        _v2: {
          discoveryVersion: report.discoveryVersion,
          groups: report.groups,
          buttons: report.buttons,
          requiredIndicators: report.requiredIndicators,
          selectCatalogue: report.selectCatalogue,
          stableAttributes: report.stableAttributes,
        },
      }),
      candidatesJson: JSON.stringify(report.candidates),
      signalsJson: JSON.stringify(report.signals),
    });
  }

  async end(db: DatabaseSync, sessionId: string): Promise<DiscoverySessionRow> {
    return this.finish(db, sessionId, 'ended');
  }

  async abort(db: DatabaseSync, sessionId: string): Promise<DiscoverySessionRow> {
    return this.finish(db, sessionId, 'aborted');
  }

  private async finish(
    db: DatabaseSync,
    sessionId: string,
    status: 'ended' | 'aborted',
  ): Promise<DiscoverySessionRow> {
    const session = getDiscoverySession(db, sessionId);
    if (!session) throw new DiscoverySessionNotFoundError(sessionId);
    if (session.status !== 'active') throw new DiscoverySessionNotActiveError(sessionId);

    const now = new Date().toISOString();
    const updated = updateDiscoverySession(db, sessionId, { status, ended_at: now }, now);

    await this.bm.closeDiscovery();
    if (this.sessionId === sessionId) this.clearLiveState();

    return updated;
  }

  /** Close the headed context with NO DB write (app onClose hook). */
  async dispose(): Promise<void> {
    await this.bm.closeDiscovery();
    this.clearLiveState();
  }

  private clearLiveState(): void {
    this.ctx = null;
    this.page = null;
    this.sessionId = null;
    this.portalUrl = null;
  }
}
