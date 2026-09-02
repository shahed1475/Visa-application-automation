import type { PortalInput } from '../../../shared/schemas';
import type { ConnectionTestResult, VisaPortal } from '../../../shared/types';
import type {
  ApplicantDetail,
  ApplicantSummary,
  Reference,
  TravelRecord,
  FieldMeta,
} from '../../../shared/applicant/types';
import type {
  ApplicantCreate,
  ApplicantPut,
  TravelInput,
  ReferenceInput,
  FieldMetaInput,
} from '../../../shared/applicant/schemas';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // Only declare a JSON body when we actually send one. A body-less POST/DELETE
  // that still carries `content-type: application/json` trips Fastify's
  // empty-JSON-body guard (FST_ERR_CTP_EMPTY_JSON_BODY) — e.g. test-connection.
  if (init.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(`/api${path}`, { ...init, headers });
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
  listApplicants: (q?: string) =>
    request<{ applicants: ApplicantSummary[] }>(
      `/applicants${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),
  createApplicant: (input: ApplicantCreate) =>
    request<{ applicant: ApplicantDetail }>('/applicants', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getApplicant: (id: string) =>
    request<{ applicant: ApplicantDetail }>(`/applicants/${id}`),
  updateApplicant: (id: string, patch: ApplicantPut) =>
    request<{ applicant: ApplicantDetail }>(`/applicants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteApplicant: (id: string) =>
    request<{ deleted: true }>(`/applicants/${id}`, { method: 'DELETE' }),
  duplicateApplicant: (id: string) =>
    request<{ applicant: ApplicantDetail }>(`/applicants/${id}/duplicate`, { method: 'POST' }),
  addTravel: (id: string, input: TravelInput) =>
    request<{ travel: TravelRecord }>(`/applicants/${id}/travel`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTravel: (id: string, travelId: string, input: TravelInput) =>
    request<{ travel: TravelRecord }>(`/applicants/${id}/travel/${travelId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteTravel: (id: string, travelId: string) =>
    request<{ deleted: true }>(`/applicants/${id}/travel/${travelId}`, { method: 'DELETE' }),
  addReference: (id: string, input: ReferenceInput) =>
    request<{ reference: Reference }>(`/applicants/${id}/references`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateReference: (id: string, refId: string, input: ReferenceInput) =>
    request<{ reference: Reference }>(`/applicants/${id}/references/${refId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteReference: (id: string, refId: string) =>
    request<{ deleted: true }>(`/applicants/${id}/references/${refId}`, { method: 'DELETE' }),
  setFieldMeta: (id: string, input: FieldMetaInput) =>
    request<{ fieldMeta: FieldMeta }>(`/applicants/${id}/field-meta`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
};
