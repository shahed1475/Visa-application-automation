import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../src/web/src/api/client';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function lastInit(): RequestInit {
  const call = fetchMock.mock.calls.at(-1);
  return (call?.[1] ?? {}) as RequestInit;
}

it('body-less requests send no JSON content-type (regression: FST_ERR_CTP_EMPTY_JSON_BODY)', async () => {
  await api.testConnection('p1');
  const init = lastInit();
  expect(init.body).toBeUndefined();
  expect(new Headers(init.headers).has('content-type')).toBe(false);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/portals/p1/test-connection');
});

it('DELETE carries no body and no JSON content-type', async () => {
  await api.deletePortal('p1');
  const init = lastInit();
  expect(init.method).toBe('DELETE');
  expect(init.body).toBeUndefined();
  expect(new Headers(init.headers).has('content-type')).toBe(false);
});

it('requests with a body still declare application/json', async () => {
  await api.createPortal({
    name: 'X',
    url: 'https://example.com',
    portalType: 'evisa',
    country: null,
    applicationType: null,
    notes: null,
    enabled: true,
  });
  const init = lastInit();
  expect(typeof init.body).toBe('string');
  expect(new Headers(init.headers).get('content-type')).toBe('application/json');
});

it('a FormData body does NOT get content-type: application/json (the browser sets the boundary)', async () => {
  await api.uploadDocument(new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
  const init = lastInit();
  expect(init.body instanceof FormData).toBe(true);
  expect(new Headers(init.headers).has('content-type')).toBe(false);
});

it('uploadDocument appends applicantId BEFORE the file part', async () => {
  await api.uploadDocument(new File(['x'], 'p.jpg', { type: 'image/jpeg' }), 'a1');
  const fd = lastInit().body as FormData;
  expect([...fd.entries()].map((e) => e[0])).toEqual(['applicantId', 'file']);
});

it('documentFileUrl builds the raw-bytes path', () => {
  expect(api.documentFileUrl('x')).toBe('/api/documents/x/file');
});

it('throws the server error message on non-2xx', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'portal not found' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await expect(api.getActivePortal()).rejects.toThrow('portal not found');
});
