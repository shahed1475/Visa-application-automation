import type { PortalInput } from '../../../shared/schemas';
import type { ConnectionTestResult, VisaPortal } from '../../../shared/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  listPortals: () => request<{ portals: VisaPortal[] }>('/portals'),
  createPortal: (input: PortalInput) =>
    request<{ portal: VisaPortal }>('/portals', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updatePortal: (id: string, input: PortalInput) =>
    request<{ portal: VisaPortal }>(`/portals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deletePortal: (id: string) =>
    request<{ deleted: true }>(`/portals/${id}`, { method: 'DELETE' }),
  getActivePortal: () =>
    request<{ activePortalId: string | null; portal: VisaPortal | null }>(
      '/settings/active-portal',
    ),
  setActivePortal: (portalId: string | null) =>
    request<{ activePortalId: string | null; portal: VisaPortal | null }>(
      '/settings/active-portal',
      { method: 'PUT', body: JSON.stringify({ portalId }) },
    ),
  testConnection: (id: string) =>
    request<{ result: ConnectionTestResult }>(`/portals/${id}/test-connection`, {
      method: 'POST',
    }),
};
