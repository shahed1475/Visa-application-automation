import type { PortalInput } from '../../../shared/schemas';
import type { ConnectionTestResult, VisaPortal } from '../../../shared/types';
import type {
  ApplicantDetail,
  ApplicantSummary,
  Reference,
  TravelRecord,
  FieldMeta,
} from '../../../shared/applicant/types';
// Request bodies use the schemas' *input* shapes (what a caller may send) rather
// than the parsed output shapes — pre-parse, every section key is genuinely
// optional, so callers need no casts.
import type {
  ApplicantCreateInput,
  ApplicantPutInput,
  TravelPatchInput,
  ReferencePatchInput,
  FieldMetaPatchInput,
} from '../../../shared/applicant/schemas';
import type { DocumentSummary, DocumentDetail } from '../../../shared/documents/types';
import type { ApplicationPlan, VisaApplication, VisaApplicationSummary } from '../../../shared/application/types';
import type {
  ApplicationCreate,
  ApplicationFieldValueInput,
  ApplicationPut,
} from '../../../shared/application/schemas';
import type { AutomationRunRow, AutomationEventRow } from '../../../shared/automation/types';
import type {
  DiscoverySessionDTO,
  DiscoveryPageDTO,
  MappingView,
  MappingStatusCounts,
  PromotedMappingEdit,
  IndiaDiagnostics,
  AdapterValidationReport,
} from '../../../shared/discovery/types';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body instanceof FormData) {
    // Leave content-type unset: the browser adds `multipart/form-data` with the
    // boundary parameter itself. Setting it here would break the boundary.
  } else if (init.body != null && !headers.has('content-type')) {
    // Only declare a JSON body when we actually send one. A body-less POST/DELETE
    // that still carries `content-type: application/json` trips Fastify's
    // empty-JSON-body guard (FST_ERR_CTP_EMPTY_JSON_BODY) — e.g. test-connection.
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
  createApplicant: (input: ApplicantCreateInput) =>
    request<{ applicant: ApplicantDetail }>('/applicants', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getApplicant: (id: string) =>
    request<{ applicant: ApplicantDetail }>(`/applicants/${id}`),
  updateApplicant: (id: string, patch: ApplicantPutInput) =>
    request<{ applicant: ApplicantDetail }>(`/applicants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteApplicant: (id: string) =>
    request<{ deleted: true }>(`/applicants/${id}`, { method: 'DELETE' }),
  duplicateApplicant: (id: string) =>
    request<{ applicant: ApplicantDetail }>(`/applicants/${id}/duplicate`, { method: 'POST' }),
  addTravel: (id: string, input: TravelPatchInput) =>
    request<{ travel: TravelRecord }>(`/applicants/${id}/travel`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTravel: (id: string, travelId: string, input: TravelPatchInput) =>
    request<{ travel: TravelRecord }>(`/applicants/${id}/travel/${travelId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteTravel: (id: string, travelId: string) =>
    request<{ deleted: true }>(`/applicants/${id}/travel/${travelId}`, { method: 'DELETE' }),
  addReference: (id: string, input: ReferencePatchInput) =>
    request<{ reference: Reference }>(`/applicants/${id}/references`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateReference: (id: string, refId: string, input: ReferencePatchInput) =>
    request<{ reference: Reference }>(`/applicants/${id}/references/${refId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteReference: (id: string, refId: string) =>
    request<{ deleted: true }>(`/applicants/${id}/references/${refId}`, { method: 'DELETE' }),
  setFieldMeta: (id: string, input: FieldMetaPatchInput) =>
    request<{ fieldMeta: FieldMeta }>(`/applicants/${id}/field-meta`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  // ---- Documents (Phase 3) ------------------------------------------------
  uploadDocument: (file: File, applicantId?: string) => {
    const fd = new FormData();
    // order matters: @fastify/multipart's req.file() only buffers form fields
    // it sees BEFORE the file part, so applicantId must be appended first.
    if (applicantId) fd.append('applicantId', applicantId);
    fd.append('file', file);
    return request<{ document: DocumentSummary }>('/documents', { method: 'POST', body: fd });
  },
  extractDocument: (id: string) =>
    request<{ document: DocumentDetail }>(`/documents/${id}/extract`, { method: 'POST' }),
  listDocuments: (applicantId?: string) =>
    request<{ documents: DocumentSummary[] }>(
      `/documents${applicantId ? `?applicantId=${encodeURIComponent(applicantId)}` : ''}`,
    ),
  getDocument: (id: string) =>
    request<{ document: DocumentDetail }>(`/documents/${id}`),
  documentFileUrl: (id: string) => `/api/documents/${id}/file`,
  applyDocumentField: (id: string, fieldPath: string) =>
    request<{ document: DocumentDetail }>(`/documents/${id}/fields/apply`, {
      method: 'POST',
      body: JSON.stringify({ fieldPath }),
    }),
  dismissDocumentField: (id: string, fieldPath: string) =>
    request<{ document: DocumentDetail }>(`/documents/${id}/fields/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ fieldPath }),
    }),
  deleteDocument: (id: string) =>
    request<{ deleted: true }>(`/documents/${id}`, { method: 'DELETE' }),

  // ---- Applications (Phase 4) ----------------------------------------------
  createApplication: (applicantId: string, input: ApplicationCreate) =>
    request<{ application: VisaApplicationSummary }>(`/applicants/${applicantId}/applications`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listApplications: (applicantId: string) =>
    request<{ applications: VisaApplicationSummary[] }>(`/applicants/${applicantId}/applications`),
  getApplication: (id: string) =>
    request<{ application: VisaApplication; plan: ApplicationPlan }>(`/applications/${id}`),
  updateApplication: (id: string, patch: ApplicationPut) =>
    request<{ application: VisaApplication; plan: ApplicationPlan }>(`/applications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  setApplicationFieldValue: (id: string, input: ApplicationFieldValueInput) =>
    request<{ application: VisaApplication; plan: ApplicationPlan }>(`/applications/${id}/field-values`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteApplication: (id: string) =>
    request<{ deleted: true }>(`/applications/${id}`, { method: 'DELETE' }),

  // ---- Automation runs (Phase 5) -----------------------------------------
  startAutomationRun: (applicationId: string) =>
    request<{ run: AutomationRunRow }>(`/applications/${applicationId}/automation-runs`, {
      method: 'POST',
    }),
  listAutomationRuns: (applicationId: string) =>
    request<{ runs: AutomationRunRow[] }>(`/applications/${applicationId}/automation-runs`),
  getAutomationRun: (runId: string) =>
    request<{ run: AutomationRunRow; events: AutomationEventRow[] }>(`/automation-runs/${runId}`),
  getAutomationEvents: (runId: string, afterSeq: number) =>
    request<{ events: AutomationEventRow[] }>(`/automation-runs/${runId}/events?after=${afterSeq}`),
  getAutomationLive: (runId: string) =>
    request<{ mismatches: { fieldPath: string; expected: string; actual: string }[] }>(
      `/automation-runs/${runId}/live`,
    ),
  resumeAutomationRun: (runId: string, decision?: 'use_application' | 'keep_portal') =>
    request<{ run: AutomationRunRow }>(`/automation-runs/${runId}/resume`, {
      method: 'POST',
      body: decision ? JSON.stringify({ decision }) : undefined,
    }),
  abortAutomationRun: (runId: string) =>
    request<{ run: AutomationRunRow }>(`/automation-runs/${runId}/abort`, { method: 'POST' }),

  // ---- Portal discovery & India adapter (Phase 6) -----------------------
  startDiscoverySession: (portalId: string) =>
    request<{ session: DiscoverySessionDTO }>(`/portals/${portalId}/discovery-sessions`, {
      method: 'POST',
    }),
  listDiscoverySessions: (portalId: string) =>
    request<{ sessions: DiscoverySessionDTO[] }>(`/portals/${portalId}/discovery-sessions`),
  getDiscoverySession: (sessionId: string) =>
    request<{ session: DiscoverySessionDTO; pages: DiscoveryPageDTO[] }>(
      `/discovery-sessions/${sessionId}`,
    ),
  captureDiscoveryPage: (sessionId: string) =>
    request<{ page: DiscoveryPageDTO }>(`/discovery-sessions/${sessionId}/capture`, {
      method: 'POST',
    }),
  endDiscoverySession: (sessionId: string) =>
    request<{ session: DiscoverySessionDTO }>(`/discovery-sessions/${sessionId}/end`, {
      method: 'POST',
    }),
  promoteCandidate: (
    sessionId: string,
    input: { pageSeq: number; candidateIndex: number; canonicalFieldPath: string },
  ) =>
    request<{ mappingEdit: PromotedMappingEdit }>(`/discovery-sessions/${sessionId}/promote`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  promoteBundle: (
    sessionId: string,
    picks: { pageSeq: number; candidateIndex: number; canonicalFieldPath: string }[],
  ) =>
    request<{ bundle: { literal: string; warnings: string[] } }>(
      `/discovery-sessions/${sessionId}/promote-bundle`,
      { method: 'POST', body: JSON.stringify({ picks }) },
    ),
  validateAdapter: (sessionId: string) =>
    request<{ report: AdapterValidationReport }>(
      `/discovery-sessions/${sessionId}/validate-adapter`,
      { method: 'POST' },
    ),
  getAdapterMappings: (portalId: string) =>
    request<{ mappings: MappingView[]; status: MappingStatusCounts }>(
      `/portals/${portalId}/adapter-mappings`,
    ),
  getAdapterDiagnostics: (portalId: string) =>
    request<{ diagnostics: IndiaDiagnostics }>(`/portals/${portalId}/adapter-diagnostics`),
  recordPolicyAck: (portalId: string) =>
    request<{ status: { portalId: string; acknowledgedAt: string } }>(
      `/portals/${portalId}/policy-ack`,
      { method: 'POST' },
    ),
};
