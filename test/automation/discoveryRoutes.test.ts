import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Page } from 'playwright';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import { createPortal, setActivePortal } from '../../src/server/services/portalService.js';
import {
  DiscoverySessionActiveError,
  DiscoverySessionNotActiveError,
  DiscoverySessionNotFoundError,
} from '../../src/server/automation/discovery/discoveryController.js';
import { ToSNotAcknowledgedError, getPolicyAck } from '../../src/server/automation/discovery/policyGate.js';
import {
  appendDiscoveryPage,
  createDiscoverySession,
  findActiveDiscoverySession,
  getDiscoverySession,
  updateDiscoverySession,
  type DiscoveryPageRow,
  type DiscoverySessionRow,
} from '../../src/server/automation/discovery/discoverySessionStore.js';

// ---- fake DiscoveryController -------------------------------------------------
// In-memory driver: no real browser. Persists sanitized rows through the real
// store so the GET routes (which read the store directly) see them.

const ADAPTER_ID = 'india';

class FakeDiscoveryController {
  constructor(private readonly opts: { requireAck?: boolean } = {}) {}

  get activePage(): Page | null {
    return null;
  }

  async start(db: DatabaseSync, portalId: string): Promise<DiscoverySessionRow> {
    if (this.opts.requireAck && getPolicyAck(db, portalId).acknowledgedAt === null) {
      throw new ToSNotAcknowledgedError(portalId);
    }
    if (findActiveDiscoverySession(db, ADAPTER_ID)) {
      throw new DiscoverySessionActiveError(ADAPTER_ID);
    }
    return createDiscoverySession(db, {
      id: randomUUID(),
      portalId,
      adapterId: ADAPTER_ID,
      now: new Date().toISOString(),
    });
  }

  async capture(db: DatabaseSync, sessionId: string): Promise<DiscoveryPageRow> {
    const session = getDiscoverySession(db, sessionId);
    if (!session) throw new DiscoverySessionNotFoundError(sessionId);
    if (session.status !== 'active') throw new DiscoverySessionNotActiveError(sessionId);
    return appendDiscoveryPage(db, {
      id: randomUUID(),
      sessionId,
      now: new Date().toISOString(),
      stateGuess: 'UNKNOWN',
      urlPattern: '/apply',
      pageTitle: 'Apply',
      headingsJson: '[]',
      fingerprintJson: '{}',
      candidatesJson: '[]',
      signalsJson: '[]',
    });
  }

  async end(db: DatabaseSync, sessionId: string): Promise<DiscoverySessionRow> {
    return this.finish(db, sessionId, 'ended');
  }

  async abort(db: DatabaseSync, sessionId: string): Promise<DiscoverySessionRow> {
    return this.finish(db, sessionId, 'aborted');
  }

  private finish(
    db: DatabaseSync,
    sessionId: string,
    status: 'ended' | 'aborted',
  ): DiscoverySessionRow {
    const session = getDiscoverySession(db, sessionId);
    if (!session) throw new DiscoverySessionNotFoundError(sessionId);
    if (session.status !== 'active') throw new DiscoverySessionNotActiveError(sessionId);
    const now = new Date().toISOString();
    return updateDiscoverySession(db, sessionId, { status, ended_at: now }, now);
  }

  async dispose(): Promise<void> {}
}

// ---- harness ---------------------------------------------------------------

let app: FastifyInstance;
let dbPath: string;

beforeEach(() => {
  dbPath = makeTempDbPath();
});
afterEach(async () => {
  if (app) await app.close();
  cleanupTempDb(dbPath);
});

// Sentinel that must never appear in any discovery response body.
const PII = 'SECRET-OPERATOR-NOTE-9f3a';

async function build(
  controller: FakeDiscoveryController,
): Promise<{ app: FastifyInstance; portalId: string }> {
  app = await buildServer({
    dbPath,
    discovery: controller as unknown as never,
  });
  const db = (app as unknown as { db: DatabaseSync }).db;
  const portal = createPortal(db, {
    name: 'India Portal',
    url: 'https://indianvisaonline.gov.in/visa/',
    portalType: 'evisa',
    country: 'IND',
    applicationType: null,
    notes: PII,
    enabled: true,
  });
  setActivePortal(db, portal.id);
  return { app, portalId: portal.id };
}

function noPII(body: unknown): void {
  expect(JSON.stringify(body)).not.toContain(PII);
}

describe('discovery routes', () => {
  it('POST /api/portals/:id/discovery-sessions → 201 { session }', async () => {
    const { portalId } = await build(new FakeDiscoveryController());
    const res = await app.inject({
      method: 'POST',
      url: `/api/portals/${portalId}/discovery-sessions`,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.session.id).toBe('string');
    expect(body.session.status).toBe('active');
    noPII(body);
  });

  it('second create while one is active → 409 SESSION_ACTIVE', async () => {
    const { portalId } = await build(new FakeDiscoveryController());
    await app.inject({ method: 'POST', url: `/api/portals/${portalId}/discovery-sessions` });
    const res = await app.inject({
      method: 'POST',
      url: `/api/portals/${portalId}/discovery-sessions`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SESSION_ACTIVE');
  });

  it('create is blocked by TOS_NOT_ACKNOWLEDGED, then succeeds after POST /policy-ack', async () => {
    const { portalId } = await build(new FakeDiscoveryController({ requireAck: true }));

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/portals/${portalId}/discovery-sessions`,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('TOS_NOT_ACKNOWLEDGED');

    const ack = await app.inject({
      method: 'POST',
      url: `/api/portals/${portalId}/policy-ack`,
    });
    expect(ack.statusCode).toBe(200);
    expect(typeof ack.json().status.acknowledgedAt).toBe('string');

    const ok = await app.inject({
      method: 'POST',
      url: `/api/portals/${portalId}/discovery-sessions`,
    });
    expect(ok.statusCode).toBe(201);
  });

  it('GET /api/portals/:id/discovery-sessions → 200 { sessions }', async () => {
    const { portalId } = await build(new FakeDiscoveryController());
    await app.inject({ method: 'POST', url: `/api/portals/${portalId}/discovery-sessions` });
    const res = await app.inject({
      method: 'GET',
      url: `/api/portals/${portalId}/discovery-sessions`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions).toHaveLength(1);
    noPII(body);
  });

  it('GET /api/discovery-sessions/:id → 200 { session, pages }', async () => {
    const { portalId } = await build(new FakeDiscoveryController());
    const created = (
      await app.inject({ method: 'POST', url: `/api/portals/${portalId}/discovery-sessions` })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${created.session.id}/capture`,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/discovery-sessions/${created.session.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.session.id).toBe(created.session.id);
    expect(Array.isArray(body.pages)).toBe(true);
    expect(body.pages).toHaveLength(1);
    noPII(body);
  });

  it('POST /api/discovery-sessions/:id/capture → 201 { page }', async () => {
    const { portalId } = await build(new FakeDiscoveryController());
    const created = (
      await app.inject({ method: 'POST', url: `/api/portals/${portalId}/discovery-sessions` })
    ).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${created.session.id}/capture`,
    });
    expect(res.statusCode).toBe(201);
    expect(typeof res.json().page.id).toBe('string');
    noPII(res.json());
  });

  it('POST /end → 202 { session: ended }; POST /abort on another → 202 aborted', async () => {
    const { portalId } = await build(new FakeDiscoveryController());
    const first = (
      await app.inject({ method: 'POST', url: `/api/portals/${portalId}/discovery-sessions` })
    ).json();
    const ended = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${first.session.id}/end`,
    });
    expect(ended.statusCode).toBe(202);
    expect(ended.json().session.status).toBe('ended');

    const second = (
      await app.inject({ method: 'POST', url: `/api/portals/${portalId}/discovery-sessions` })
    ).json();
    const aborted = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${second.session.id}/abort`,
    });
    expect(aborted.statusCode).toBe(202);
    expect(aborted.json().session.status).toBe('aborted');
  });

  it('capture on an ended session → 409 SESSION_NOT_ACTIVE', async () => {
    const { portalId } = await build(new FakeDiscoveryController());
    const created = (
      await app.inject({ method: 'POST', url: `/api/portals/${portalId}/discovery-sessions` })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${created.session.id}/end`,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${created.session.id}/capture`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SESSION_NOT_ACTIVE');
  });

  it('unknown discovery session → 404', async () => {
    await build(new FakeDiscoveryController());
    for (const url of [
      '/api/discovery-sessions/does-not-exist',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    }
    const cap = await app.inject({
      method: 'POST',
      url: '/api/discovery-sessions/does-not-exist/capture',
    });
    expect(cap.statusCode).toBe(404);
  });

  it('GET /api/portals/:id/adapter-mappings → 200 { mappings, status }', async () => {
    const { portalId } = await build(new FakeDiscoveryController());
    const res = await app.inject({
      method: 'GET',
      url: `/api/portals/${portalId}/adapter-mappings`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.mappings)).toBe(true);
    expect(body.mappings.length).toBeGreaterThan(0);
    expect(body.status.total).toBe(body.mappings.length);
    expect(body.status.placeholder).toBe(body.mappings.length);
    for (const m of body.mappings) {
      expect(m.status).toBe('placeholder');
      expect(m).not.toHaveProperty('value');
    }
    noPII(body);
  });

  it('POST /api/discovery-sessions/:id/promote → 200 { mappingEdit }', async () => {
    const { portalId } = await build(new FakeDiscoveryController());
    const db = (app as unknown as { db: DatabaseSync }).db;
    const session = createDiscoverySession(db, {
      id: randomUUID(),
      portalId,
      adapterId: ADAPTER_ID,
      now: new Date().toISOString(),
    });
    appendDiscoveryPage(db, {
      id: randomUUID(),
      sessionId: session.id,
      now: new Date().toISOString(),
      stateGuess: 'PERSONAL_DETAILS',
      urlPattern: '/personal',
      pageTitle: 'Personal',
      headingsJson: '[]',
      fingerprintJson: '{}',
      candidatesJson: JSON.stringify([
        {
          label: 'Surname',
          primarySelector: '#f_surname',
          fallbackSelector: null,
          selectorConfidence: 'stable',
          control: 'text',
        },
      ]),
      signalsJson: '[]',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${session.id}/promote`,
      payload: { pageSeq: 1, candidateIndex: 0, canonicalFieldPath: 'identity.surname' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mappingEdit.canonicalFieldPath).toBe('identity.surname');
    expect(body.mappingEdit.literal).toContain("selector: '#f_surname'");
    expect(body.mappingEdit.literal).toContain("status: 'discovered'");
    expect(body.mappingEdit.warnings).toStrictEqual([]);
    noPII(body);
  });

  it('POST /promote on an unknown session → 404', async () => {
    await build(new FakeDiscoveryController());
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery-sessions/does-not-exist/promote',
      payload: { pageSeq: 1, candidateIndex: 0, canonicalFieldPath: 'identity.surname' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('POST /promote with an invalid body → 400', async () => {
    const { portalId } = await build(new FakeDiscoveryController());
    const db = (app as unknown as { db: DatabaseSync }).db;
    const session = createDiscoverySession(db, {
      id: randomUUID(),
      portalId,
      adapterId: ADAPTER_ID,
      now: new Date().toISOString(),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/discovery-sessions/${session.id}/promote`,
      payload: { pageSeq: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('unknown portal → 404 for create and policy-ack', async () => {
    await build(new FakeDiscoveryController());
    const create = await app.inject({
      method: 'POST',
      url: '/api/portals/nope/discovery-sessions',
    });
    expect(create.statusCode).toBe(404);
    expect(create.json().error.code).toBe('NOT_FOUND');

    const ack = await app.inject({ method: 'POST', url: '/api/portals/nope/policy-ack' });
    expect(ack.statusCode).toBe(404);
  });
});
