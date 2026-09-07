// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AutomationRunPage } from '../../src/web/src/pages/Automation/AutomationRunPage';
import type { AutomationRunRow } from '../../src/shared/automation/types';
import type { IndiaDiagnostics } from '../../src/shared/discovery/types';

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    getAutomationRun: vi.fn(),
    getAutomationEvents: vi.fn(),
    getAutomationLive: vi.fn(),
    resumeAutomationRun: vi.fn(),
    abortAutomationRun: vi.fn(),
    getApplication: vi.fn(),
    getApplicant: vi.fn(),
    getAdapterDiagnostics: vi.fn(),
  },
}));

async function client() {
  const { api } = await import('../../src/web/src/api/client');
  return api as unknown as Record<
    | 'getAutomationRun'
    | 'getAutomationEvents'
    | 'getAutomationLive'
    | 'resumeAutomationRun'
    | 'abortAutomationRun'
    | 'getApplication'
    | 'getApplicant'
    | 'getAdapterDiagnostics',
    ReturnType<typeof vi.fn>
  >;
}

function makeRun(overrides: Partial<AutomationRunRow> = {}): AutomationRunRow {
  return {
    id: 'r1',
    application_id: 'app1',
    portal_id: 'p1',
    portal_url_snapshot: 'https://indianvisaonline.gov.in/evisa/',
    adapter_id: 'india',
    status: 'running',
    waiting_reason: null,
    current_portal_state: 'PERSONAL_DETAILS',
    current_section_id: 'personal_particulars',
    fields_total: 3,
    fields_verified: 0,
    documents_total: 0,
    documents_ready: 0,
    error_code: null,
    error_message: null,
    started_at: '2026-09-06T00:00:00Z',
    updated_at: '2026-09-06T00:01:00Z',
    ended_at: null,
    ...overrides,
  };
}

function diag(o: Partial<IndiaDiagnostics> = {}): IndiaDiagnostics {
  return {
    adapterId: 'india',
    adapterVersion: '6.0.0',
    mappingRevision: '2026-09-07',
    lastDiscoveryAt: null,
    pagesDiscovered: 0,
    fieldsDiscovered: 0,
    mappings: {
      placeholder: 22,
      discovered: 0,
      validated: 4,
      stale: 0,
      productionUsable: 4,
      total: 26,
      requiredRemaining: 22,
    },
    staleMappings: 0,
    productionUsableMappings: 4,
    unknownPagesEncountered: 0,
    selectorStaleEvents: 0,
    lastValidation: null,
    ...o,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/automation-runs/r1']}>
      <Routes>
        <Route path="/automation-runs/:id" element={<AutomationRunPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  const api = await client();
  api.getAutomationRun.mockResolvedValue({ run: makeRun(), events: [] });
  api.getAutomationEvents.mockResolvedValue({ events: [] });
  api.getAutomationLive.mockResolvedValue({ mismatches: [] });
  api.getApplication.mockResolvedValue({ application: { id: 'app1', applicantId: 'a1' }, plan: {} });
  api.getApplicant.mockResolvedValue({ applicant: { id: 'a1', displayName: 'RANA, Test' } });
  api.getAdapterDiagnostics.mockResolvedValue({ diagnostics: diag() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('renders a value-free adapter provenance line for an india run', async () => {
  renderPage();
  const line = await screen.findByText(/India adapter v6\.0\.0/);
  expect(line.textContent).toMatch(/mapping rev 2026-09-07/);
  expect(line.textContent).toMatch(/4\s*\/\s*26 production-ready/);
  // no PII / applicant name anywhere in the provenance line
  expect(line.textContent).not.toMatch(/RANA/);
});

it('shows the stale-mapping warning when staleMappings > 0', async () => {
  const api = await client();
  api.getAdapterDiagnostics.mockResolvedValue({
    diagnostics: diag({ staleMappings: 3, productionUsableMappings: 1 }),
  });
  renderPage();
  expect(await screen.findByText(/stale or not yet validated/i)).toBeTruthy();
});

it('shows the stale-mapping warning when nothing is production-usable', async () => {
  const api = await client();
  api.getAdapterDiagnostics.mockResolvedValue({
    diagnostics: diag({ productionUsableMappings: 0, staleMappings: 0 }),
  });
  renderPage();
  expect(await screen.findByText(/stale or not yet validated/i)).toBeTruthy();
});

it('hides the stale-mapping warning when there are production-usable mappings and none stale', async () => {
  renderPage();
  await screen.findByText(/India adapter v6\.0\.0/);
  expect(screen.queryByText(/stale or not yet validated/i)).toBeNull();
});

it('does not fetch adapter diagnostics for a non-india adapter', async () => {
  const api = await client();
  api.getAutomationRun.mockResolvedValue({
    run: makeRun({ adapter_id: 'generic' }),
    events: [],
  });
  renderPage();
  await screen.findByText(/Automation run/);
  expect(api.getAdapterDiagnostics).not.toHaveBeenCalled();
  expect(screen.queryByText(/India adapter v/)).toBeNull();
});

it('review_ready banner says NOT submitted and adds no submit-shaped control', async () => {
  const api = await client();
  api.getAutomationRun.mockResolvedValue({
    run: makeRun({ status: 'review_ready' }),
    events: [],
  });
  const { container } = renderPage();
  expect(await screen.findByText(/NOT submitted/)).toBeTruthy();
  expect(screen.getByText(/Submission is your responsibility/i)).toBeTruthy();
  expect(container.querySelector('form')).toBeNull();
  expect(container.querySelector('button[type="submit"]')).toBeNull();
  expect(
    screen.queryByRole('button', { name: /submit|pay|book appointment|complete application/i }),
  ).toBeNull();
});
