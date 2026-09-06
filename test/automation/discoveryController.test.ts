import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';
import * as policyGate from '../../src/server/automation/discovery/policyGate.js';
import {
  getDiscoverySession,
  listDiscoveryPages,
} from '../../src/server/automation/discovery/discoverySessionStore.js';
import {
  DiscoveryController,
  DiscoverySessionActiveError,
} from '../../src/server/automation/discovery/discoveryController.js';

// Seeded PII lives ONLY in the fixture control VALUES. The controller persists
// page STRUCTURE via captureDiscoveryV2 (which never reads a value), so none of
// these may appear anywhere in a persisted discovery-page row.
const SEEDED_PII = ['Z9998887', '1988-11-03', 'seed.applicant@example.com', 'Fitzgerald'];

const PAGE_ONE = `<!doctype html><html><head><title>Personal</title></head><body>
  <h1>Personal Details</h1>
  <form><label for="surname">Surname</label>
  <input id="surname" name="surname" type="text" value="Fitzgerald" required /></form>
</body></html>`;

const PAGE_TWO = `<!doctype html><html><head><title>Passport</title></head><body>
  <h1>Passport Details</h1>
  <form>
    <p><label for="pnum">Passport Number</label>
      <input id="pnum" name="pnum" type="text" value="Z9998887" required /></p>
    <p><label for="pdob">Date of Birth</label>
      <input id="pdob" name="pdob" type="text" value="1988-11-03" /></p>
    <p><label for="pmail">Email</label>
      <input id="pmail" name="pmail" type="email" value="seed.applicant@example.com" /></p>
  </form>
</body></html>`;

interface Fixture {
  base: string;
  passportUrl: string;
  close(): Promise<void>;
}

async function startFixture(): Promise<Fixture> {
  const server: Server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end((req.url ?? '/').startsWith('/passport') ? PAGE_TWO : PAGE_ONE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/`;
  return {
    base,
    passportUrl: `${base}passport`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('DiscoveryController — read-only session lifecycle', () => {
  let db: DatabaseSync;
  let dbPath: string;
  let fixture: Fixture;
  let profileDir: string;
  let controller: DiscoveryController;
  let portalId: string;
  let sessionId: string;
  let ackSpy: ReturnType<typeof vi.spyOn>;
  const realBm = new BrowserManager();
  let gotoUrls: string[] = [];

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    db = openDatabase(dbPath);
    runMigrations(db);
    fixture = await startFixture();
    portalId = 'portal-disco';
    db.prepare(
      `INSERT INTO visa_portals (id, name, url, portal_type, enabled, created_at, updated_at)
       VALUES (?, 'Discovery portal', ?, 'evisa', 1, 't0', 't0')`,
    ).run(portalId, fixture.base);
    profileDir = mkdtempSync(path.join(tmpdir(), 'disco-ctl-'));
    ackSpy = vi.spyOn(policyGate, 'assertPolicyAck');

    // A BrowserManager that delegates to a real headed persistent context but
    // records every navigation the page performs, so the test can assert the
    // controller navigates exactly once (during start).
    const bm = {
      launchPersistentDiscovery: async (opts: { userDataDir: string }) => {
        const ctx = await realBm.launchPersistentDiscovery(opts);
        const page = ctx.pages()[0] ?? (await ctx.newPage());
        const orig = page.goto.bind(page);
        page.goto = ((url: string, o?: Parameters<typeof orig>[1]) => {
          gotoUrls.push(url);
          return orig(url, o);
        }) as typeof page.goto;
        return ctx;
      },
      closeDiscovery: () => realBm.closeDiscovery(),
    } as unknown as BrowserManager;

    controller = new DiscoveryController({ browserManager: bm, profileDir });
  }, 60_000);

  afterAll(async () => {
    await controller.dispose().catch(() => {});
    await realBm.closeDiscovery().catch(() => {});
    db.close();
    cleanupTempDb(dbPath);
    rmSync(profileDir, { recursive: true, force: true });
    await fixture.close();
    ackSpy.mockRestore();
  });

  it('start creates an active session, calls assertPolicyAck, and opens the portal URL exactly once', async () => {
    const session = await controller.start(db, portalId);
    sessionId = session.id;

    expect(session.status).toBe('active');
    expect(session.adapter_id).toBe('generic');
    expect(getDiscoverySession(db, session.id)?.status).toBe('active');

    expect(ackSpy).toHaveBeenCalledWith(db, portalId, 'generic', fixture.base);

    // exactly one navigation, and it is the resolved portal URL (not a literal)
    expect(gotoUrls).toEqual([fixture.base]);
    expect(controller.activePage).not.toBeNull();
    expect(controller.activePage!.url()).toBe(fixture.base);
  }, 60_000);

  it('a second start for the same adapter throws DiscoverySessionActiveError', async () => {
    await expect(controller.start(db, portalId)).rejects.toBeInstanceOf(
      DiscoverySessionActiveError,
    );
    // no extra navigation happened
    expect(gotoUrls).toEqual([fixture.base]);
  });

  it('capture persists a sanitized page row after the USER navigates the page', async () => {
    // The TEST drives the browser between captures, simulating the operator.
    await controller.activePage!.goto(fixture.passportUrl, { waitUntil: 'domcontentloaded' });

    const session = sessionId;
    const row = await controller.capture(db, session);

    expect(row.session_id).toBe(session);
    expect(row.candidates_json).not.toBe('[]');
    expect(JSON.parse(row.candidates_json).length).toBeGreaterThan(0);

    // url_pattern is a host+path pattern, never a full URL with a value
    expect(row.url_pattern).toContain('127.0.0.1');

    const serialized = JSON.stringify(row);
    for (const pii of SEEDED_PII) {
      expect(serialized, `row leaked seeded PII ${pii}`).not.toContain(pii);
    }

    expect(listDiscoveryPages(db, session).map((p) => p.id)).toEqual([row.id]);
    expect(getDiscoverySession(db, session)?.page_count).toBe(1);
  }, 60_000);

  it('end marks the session ended, stamps ended_at, and closes the context', async () => {
    const session = sessionId;
    const ended = await controller.end(db, session);

    expect(ended.status).toBe('ended');
    expect(ended.ended_at).not.toBeNull();
    expect(controller.activePage).toBeNull();
    expect(getDiscoverySession(db, session)?.status).toBe('ended');
  }, 60_000);

  it('abort marks a fresh session aborted', async () => {
    gotoUrls = [];
    const session = await controller.start(db, portalId);
    expect(session.status).toBe('active');

    const aborted = await controller.abort(db, session.id);
    expect(aborted.status).toBe('aborted');
    expect(aborted.ended_at).not.toBeNull();
    expect(getDiscoverySession(db, session.id)?.status).toBe('aborted');
    expect(controller.activePage).toBeNull();
  }, 60_000);
});
