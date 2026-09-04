import { rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import pino from 'pino';
import FormData from 'form-data';
import { buildServer } from '../../src/server/app.js';
import { env } from '../../src/server/env.js';
import { loggerOptions } from '../../src/server/logger.js';
import { MAX_DOCUMENT_BYTES } from '../../src/server/documents/fileType.js';
import { FakeOcrEngine, ocrResultFromLines } from '../helpers/fakeOcrEngine.js';
import { ICAO_SPECIMEN } from '../helpers/mrzFixtures.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

// Minimal valid JPEG: starts `FF D8 FF` so sniffMime -> image/jpeg. The
// FakeOcrEngine ignores the pixels.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);

function makeOcr(): FakeOcrEngine {
  return new FakeOcrEngine(ocrResultFromLines([ICAO_SPECIMEN.line1, ICAO_SPECIMEN.line2], 90));
}

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

const docIds: string[] = [];
let app: FastifyInstance;
let dbPath: string;

function cleanupDocs(): void {
  for (const id of docIds.splice(0)) {
    rmSync(path.join(env.DOCUMENTS_DIR, id), { recursive: true, force: true });
  }
}

beforeEach(async () => {
  dbPath = makeTempDbPath();
  app = await buildServer({ dbPath, ocr: makeOcr() });
});
afterEach(async () => {
  await app.close();
  cleanupTempDb(dbPath);
  cleanupDocs();
});

async function createApplicant(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/applicants',
    payload: { displayName: 'Doc Tester' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().applicant.id as string;
}

async function upload(
  bytes: Buffer,
  opts: { applicantId?: string; filename?: string; contentType?: string } = {},
): Promise<InjectResponse> {
  const fd = new FormData();
  // `applicantId` is appended BEFORE the file so it is available on
  // `mp.fields` when the route calls `await req.file()`.
  if (opts.applicantId !== undefined) fd.append('applicantId', opts.applicantId);
  fd.append('file', bytes, {
    filename: opts.filename ?? 'p.jpg',
    contentType: opts.contentType ?? 'image/jpeg',
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/documents',
    payload: fd.getBuffer(),
    headers: fd.getHeaders(),
  });
  if (res.statusCode === 201) docIds.push(res.json().document.id);
  return res;
}

describe('POST /api/documents', () => {
  it('stores an uploaded document (201 { document })', async () => {
    const applicantId = await createApplicant();
    const res = await upload(JPEG, { applicantId });
    expect(res.statusCode).toBe(201);
    const { document } = res.json();
    expect(typeof document.id).toBe('string');
    expect(document.status).toBe('uploaded');
    expect(document.mimeType).toBe('image/jpeg');
    expect(document.applicantId).toBe(applicantId);
  });

  it('accepts an upload with no applicantId', async () => {
    const res = await upload(JPEG);
    expect(res.statusCode).toBe(201);
    expect(res.json().document.applicantId).toBeNull();
  });

  it('400 when no file part is present', async () => {
    const fd = new FormData();
    fd.append('applicantId', 'x');
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: fd.getBuffer(),
      headers: fd.getHeaders(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('400 VALIDATION_ERROR for an unsupported type (GIF header)', async () => {
    const res = await upload(GIF, { filename: 'a.gif', contentType: 'image/gif' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('400 for a zero-byte file', async () => {
    const res = await upload(Buffer.alloc(0));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('400 for an oversize file', async () => {
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 10);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const res = await upload(big);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/documents/:id/extract', () => {
  it('runs extraction synchronously and returns the detail (200)', async () => {
    const applicantId = await createApplicant();
    const docId = (await upload(JPEG, { applicantId })).json().document.id;

    const res = await app.inject({ method: 'POST', url: `/api/documents/${docId}/extract` });
    expect(res.statusCode).toBe(200);
    const { document } = res.json();
    expect(document.status).toBe('extracted');
    expect(Array.isArray(document.runs)).toBe(true);
    expect(document.runs).toHaveLength(1);
    expect(Array.isArray(document.fields)).toBe(true);
    expect(document.fields.length).toBeGreaterThan(0);
  });

  it('404 for an unknown document', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/documents/${randomUUID()}/extract`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('409 CONFLICT when the document has no applicant', async () => {
    const docId = (await upload(JPEG)).json().document.id;
    const res = await app.inject({ method: 'POST', url: `/api/documents/${docId}/extract` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('a body-less POST still works with the custom JSON parser (explicit content-type)', async () => {
    const applicantId = await createApplicant();
    const docId = (await upload(JPEG, { applicantId })).json().document.id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/documents/${docId}/extract`,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/documents', () => {
  it('lists all and filters by applicantId', async () => {
    const a = await createApplicant();
    const b = await createApplicant();
    await upload(JPEG, { applicantId: a });
    await upload(JPEG, { applicantId: a });
    await upload(JPEG, { applicantId: b });

    const all = await app.inject({ method: 'GET', url: '/api/documents' });
    expect(all.json().documents).toHaveLength(3);

    const filtered = await app.inject({ method: 'GET', url: `/api/documents?applicantId=${a}` });
    expect(filtered.json().documents).toHaveLength(2);
  });
});

describe('GET /api/documents/:id', () => {
  it('returns the detail', async () => {
    const applicantId = await createApplicant();
    const docId = (await upload(JPEG, { applicantId })).json().document.id;
    const res = await app.inject({ method: 'GET', url: `/api/documents/${docId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().document.id).toBe(docId);
  });

  it('404 sanitized envelope for an unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/documents/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'document not found' } });
  });
});

describe('GET /api/documents/:id/file', () => {
  it('streams the exact stored bytes with the right content-type', async () => {
    const applicantId = await createApplicant();
    const docId = (await upload(JPEG, { applicantId })).json().document.id;
    const res = await app.inject({ method: 'GET', url: `/api/documents/${docId}/file` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(Buffer.compare(res.rawPayload, JPEG)).toBe(0);
  });

  it('404 for an unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/documents/${randomUUID()}/file` });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/documents/:id/fields/{apply,dismiss}', () => {
  async function setupHeldField(): Promise<{ docId: string }> {
    const applicantId = await createApplicant();
    // Pre-seed a conflicting profile value so the extracted passport.number is
    // HELD rather than auto-applied.
    app.db
      .prepare('UPDATE applicant_passport SET number = ? WHERE applicant_id = ?')
      .run('PRESET-DIFFERENT', applicantId);
    const docId = (await upload(JPEG, { applicantId })).json().document.id;
    const extract = await app.inject({ method: 'POST', url: `/api/documents/${docId}/extract` });
    const held = extract
      .json()
      .document.fields.find((f: { fieldPath: string }) => f.fieldPath === 'passport.number');
    expect(held.status).toBe('held');
    return { docId };
  }

  it('apply resolves a held field', async () => {
    const { docId } = await setupHeldField();
    const res = await app.inject({
      method: 'POST',
      url: `/api/documents/${docId}/fields/apply`,
      payload: { fieldPath: 'passport.number' },
    });
    expect(res.statusCode).toBe(200);
    const f = res
      .json()
      .document.fields.find((x: { fieldPath: string }) => x.fieldPath === 'passport.number');
    expect(f.status).toBe('applied');
  });

  it('dismiss marks a held field dismissed', async () => {
    const { docId } = await setupHeldField();
    const res = await app.inject({
      method: 'POST',
      url: `/api/documents/${docId}/fields/dismiss`,
      payload: { fieldPath: 'passport.number' },
    });
    expect(res.statusCode).toBe(200);
    const f = res
      .json()
      .document.fields.find((x: { fieldPath: string }) => x.fieldPath === 'passport.number');
    expect(f.status).toBe('dismissed');
  });

  it('409 CONFLICT applying a field that is not held', async () => {
    const applicantId = await createApplicant();
    const docId = (await upload(JPEG, { applicantId })).json().document.id;
    await app.inject({ method: 'POST', url: `/api/documents/${docId}/extract` });
    const res = await app.inject({
      method: 'POST',
      url: `/api/documents/${docId}/fields/apply`,
      payload: { fieldPath: 'passport.number' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('400 for an invalid fieldPath', async () => {
    const applicantId = await createApplicant();
    const docId = (await upload(JPEG, { applicantId })).json().document.id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/documents/${docId}/fields/apply`,
      payload: { fieldPath: 'Bad.Path' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/documents/:id', () => {
  it('deletes then GET returns 404', async () => {
    const applicantId = await createApplicant();
    const docId = (await upload(JPEG, { applicantId })).json().document.id;
    const del = await app.inject({ method: 'DELETE', url: `/api/documents/${docId}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: true });
    const get = await app.inject({ method: 'GET', url: `/api/documents/${docId}` });
    expect(get.statusCode).toBe(404);
  });

  it('404 for an unknown id', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/documents/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
  });
});

describe('privacy — nothing sensitive is logged', () => {
  it('upload + extract leak no PII into the log stream', async () => {
    const captured: string[] = [];
    const stream = {
      write(chunk: string) {
        captured.push(chunk);
      },
    };
    const testLogger = pino(
      { ...loggerOptions, level: 'info', transport: undefined },
      stream,
    ) as unknown as FastifyBaseLogger;

    const capDbPath = makeTempDbPath();
    const capApp = await buildServer({
      dbPath: capDbPath,
      loggerInstance: testLogger,
      ocr: makeOcr(),
    });
    try {
      const ap = await capApp.inject({
        method: 'POST',
        url: '/api/applicants',
        payload: { displayName: 'Cap Tester' },
      });
      const applicantId = ap.json().applicant.id as string;

      const fd = new FormData();
      fd.append('applicantId', applicantId);
      fd.append('file', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' });
      const up = await capApp.inject({
        method: 'POST',
        url: '/api/documents',
        payload: fd.getBuffer(),
        headers: fd.getHeaders(),
      });
      const docId = up.json().document.id as string;
      docIds.push(docId);
      await capApp.inject({ method: 'POST', url: `/api/documents/${docId}/extract` });

      const log = captured.join('');
      expect(log.length).toBeGreaterThan(0);
      expect(log).not.toContain(applicantId);
      expect(log).not.toContain('ERIKSSON');
      expect(log).not.toContain('L898902C3');
      expect(log).not.toContain(JPEG.toString('latin1'));
      expect(log).not.toContain('JFIF');
    } finally {
      await capApp.close();
      cleanupTempDb(capDbPath);
    }
  });
});
