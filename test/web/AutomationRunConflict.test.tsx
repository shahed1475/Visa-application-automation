// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AutomationRunPage } from '../../src/web/src/pages/Automation/AutomationRunPage';
import type { AutomationRunRow } from '../../src/shared/automation/types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    getAutomationRun: vi.fn(),
    getAutomationEvents: vi.fn(),
    getAutomationLive: vi.fn(),
    resumeAutomationRun: vi.fn(),
    abortAutomationRun: vi.fn(),
    getApplication: vi.fn(),
    getApplicant: vi.fn(),
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
    | 'getApplicant',
    ReturnType<typeof vi.fn>
  >;
}

function makeRun(overrides: Partial<AutomationRunRow> = {}): AutomationRunRow {
  return {
    id: 'r1',
    application_id: 'app1',
    portal_id: 'p1',
    portal_url_snapshot: 'https://example.test/evisa/',
    adapter_id: 'india',
    status: 'waiting_for_user',
    waiting_reason: 'value_conflict',
    current_portal_state: 'PERSONAL_DETAILS',
    current_section_id: 'personal_particulars',
    fields_total: 3,
    fields_verified: 1,
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
  api.getAutomationLive.mockResolvedValue({
    mismatches: [{ fieldPath: 'identity.surname', expected: 'RANA', actual: 'RAN' }],
  });
  api.resumeAutomationRun.mockResolvedValue({ run: makeRun({ status: 'running', waiting_reason: null }) });
  api.abortAutomationRun.mockResolvedValue({ run: makeRun({ status: 'aborted', waiting_reason: null }) });
  api.getApplication.mockResolvedValue({
    application: { id: 'app1', applicantId: 'a1' },
    plan: { category: { displayName: 'Business Visa' } },
  });
  api.getApplicant.mockResolvedValue({ applicant: { id: 'a1', displayName: 'RANA, Test' } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('value_conflict: the alert panel shows the single /live pair', async () => {
  const panel = (renderPage(), await screen.findByRole('alert'));
  await waitFor(() => expect(within(panel).getByText('RANA')).toBeTruthy());
  expect(within(panel).getByText('RAN')).toBeTruthy();
  expect(within(panel).getByText(/identity\.surname/)).toBeTruthy();
});

it('Use application value resumes with use_application', async () => {
  const api = await client();
  renderPage();
  const panel = await screen.findByRole('alert');
  fireEvent.click(within(panel).getByRole('button', { name: /use application value/i }));
  await waitFor(() =>
    expect(api.resumeAutomationRun).toHaveBeenCalledWith('r1', 'use_application'),
  );
});

it('Keep portal value resumes with keep_portal', async () => {
  const api = await client();
  renderPage();
  const panel = await screen.findByRole('alert');
  fireEvent.click(within(panel).getByRole('button', { name: /keep portal value/i }));
  await waitFor(() =>
    expect(api.resumeAutomationRun).toHaveBeenCalledWith('r1', 'keep_portal'),
  );
});

it('Edit application aborts then navigates to the application', async () => {
  const api = await client();
  renderPage();
  const panel = await screen.findByRole('alert');
  fireEvent.click(within(panel).getByRole('button', { name: /edit application/i }));
  await waitFor(() => expect(api.abortAutomationRun).toHaveBeenCalledWith('r1'));
  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/applications/app1'));
});

it('the run page stays free of form / submit affordances', async () => {
  const { container } = renderPage();
  await screen.findByRole('alert');
  expect(container.querySelector('form')).toBeNull();
  expect(container.querySelector('button[type="submit"]')).toBeNull();
  expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
});
