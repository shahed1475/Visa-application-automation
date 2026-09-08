// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AutomationRunPage } from '../../src/web/src/pages/Automation/AutomationRunPage';
import { EVENT_MESSAGES } from '../../src/shared/automation/events';
import type { AutomationRunRow, AutomationEventRow } from '../../src/shared/automation/types';

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
    portal_url_snapshot: 'https://indianvisaonline.gov.in/evisa/',
    adapter_id: 'india-evisa-v1',
    status: 'running',
    waiting_reason: null,
    current_portal_state: 'PERSONAL_DETAILS',
    current_section_id: 'personal_particulars',
    fields_total: 3,
    fields_verified: 1,
    documents_total: 2,
    documents_ready: 2,
    error_code: null,
    error_message: null,
    started_at: '2026-09-06T00:00:00Z',
    updated_at: '2026-09-06T00:01:00Z',
    ended_at: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<AutomationEventRow> = {}): AutomationEventRow {
  return {
    id: 'e1',
    run_id: 'r1',
    seq: 1,
    created_at: '2026-09-06T00:00:00Z',
    type: 'RUN_STARTED',
    portal_state: null,
    field_path: null,
    status: null,
    message: 'fallback',
    evidence_path: null,
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
  api.getAutomationLive.mockResolvedValue({ mismatches: [] });
  api.resumeAutomationRun.mockResolvedValue({ run: makeRun() });
  api.abortAutomationRun.mockResolvedValue({ run: makeRun({ status: 'aborted' }) });
  api.getApplication.mockResolvedValue({
    application: { id: 'app1', applicantId: 'a1', categoryId: 'regular.business' },
    plan: { category: { displayName: 'Business Visa' } },
  });
  api.getApplicant.mockResolvedValue({ applicant: { id: 'a1', displayName: 'RANA, Test' } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('(a) renders the event log from EVENT_MESSAGES with no values', async () => {
  const api = await client();
  api.getAutomationRun.mockResolvedValue({
    run: makeRun({ fields_verified: 1, fields_total: 3 }),
    events: [
      makeEvent({ id: 'e1', seq: 1, type: 'RUN_STARTED' }),
      makeEvent({ id: 'e2', seq: 2, type: 'PAGE_DETECTED', portal_state: 'PERSONAL_DETAILS' }),
    ],
  });
  const { container } = renderPage();
  await waitFor(() => expect(screen.getByText(EVENT_MESSAGES.RUN_STARTED)).toBeTruthy());
  expect(screen.getByText(EVENT_MESSAGES.PAGE_DETECTED)).toBeTruthy();
  // the event log carries no values by construction
  const log = container.querySelector('.event-log')!;
  expect(log.textContent ?? '').not.toMatch(/RANA/);
});

it('(b) waiting_for_user/otp shows the OTP instruction and a working Resume button', async () => {
  const api = await client();
  api.getAutomationRun.mockResolvedValue({
    run: makeRun({ status: 'waiting_for_user', waiting_reason: 'otp' }),
    events: [],
  });
  renderPage();
  await waitFor(() => expect(screen.getByText(/Complete the OTP/i)).toBeTruthy());
  const btn = screen.getByRole('button', { name: /resume automation/i });
  fireEvent.click(btn);
  await waitFor(() => expect(api.resumeAutomationRun).toHaveBeenCalledWith('r1'));
});

it('(c) value_mismatch lists expected vs actual from /live', async () => {
  const api = await client();
  api.getAutomationRun.mockResolvedValue({
    run: makeRun({ status: 'waiting_for_user', waiting_reason: 'value_mismatch' }),
    events: [],
  });
  api.getAutomationLive.mockResolvedValue({
    mismatches: [{ fieldPath: 'identity.surname', expected: 'RANA', actual: 'RAN' }],
  });
  renderPage();
  const panel = await screen.findByRole('alert');
  await waitFor(() => expect(within(panel).getByText('RANA')).toBeTruthy());
  expect(within(panel).getByText('RAN')).toBeTruthy();
  expect(within(panel).getByText(/identity\.surname/)).toBeTruthy();
});

it('(d) review_ready shows the SAFE STOP banner verbatim and no submit control', async () => {
  const api = await client();
  api.getAutomationRun.mockResolvedValue({
    run: makeRun({ status: 'review_ready' }),
    events: [],
  });
  const { container } = renderPage();
  await waitFor(() => expect(screen.getByText(/NOT submitted/)).toBeTruthy());
  expect(screen.getByText('Preparation complete')).toBeTruthy();
  expect(screen.getByText(/Submission is your responsibility/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
  expect(container.querySelector('form')).toBeNull();
  expect(container.querySelector('button[type="submit"]')).toBeNull();
});

it('(f) shows an elapsed timer and hides the ETA until a field is verified', async () => {
  const api = await client();
  api.getAutomationRun.mockResolvedValue({
    run: makeRun({
      status: 'running',
      started_at: new Date(Date.now() - 42_000).toISOString(),
      fields_verified: 0,
      fields_total: 30,
    }),
    events: [],
  });
  renderPage();
  expect(await screen.findByText(/elapsed 00:4[0-5]/i)).toBeTruthy();
  expect(screen.queryByText(/est\. remaining/i)).toBeNull();
});

it('(g) shows an ETA once progress exists', async () => {
  const api = await client();
  api.getAutomationRun.mockResolvedValue({
    run: makeRun({
      status: 'running',
      started_at: new Date(Date.now() - 40_000).toISOString(),
      fields_verified: 10,
      fields_total: 30,
    }),
    events: [],
  });
  renderPage();
  expect(await screen.findByText(/est\. remaining ~01:2\d/i)).toBeTruthy();
});

it('(h) renders a value-free milestone timeline from the event stream', async () => {
  const api = await client();
  api.getAutomationRun.mockResolvedValue({
    run: makeRun({ status: 'waiting_for_user', waiting_reason: 'otp' }),
    events: [
      makeEvent({ id: 'e1', seq: 1, type: 'RUN_STARTED' }),
      makeEvent({ id: 'e2', seq: 2, type: 'PAGE_DETECTED', portal_state: 'PASSPORT-1234567' }),
      makeEvent({ id: 'e3', seq: 3, type: 'OTP_REQUIRED', field_path: 'identity.surname' }),
    ],
  });
  renderPage();
  const tl = await screen.findByRole('list', { name: /progress timeline/i });
  expect(within(tl).getByText(/portal opened/i)).toBeTruthy();
  expect(within(tl).getByText(/human action required/i)).toBeTruthy();
  // no portal value / field path / applicant value anywhere in the timeline
  expect(tl.textContent).not.toMatch(/PASSPORT-|@|\d{7}/);
});

it('(e) polling halts once the run reaches a terminal status', async () => {
  vi.useFakeTimers();
  const api = await client();
  api.getAutomationRun
    .mockResolvedValueOnce({ run: makeRun({ status: 'running' }), events: [] })
    .mockResolvedValue({ run: makeRun({ status: 'review_ready' }), events: [] });

  renderPage();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(api.getAutomationRun).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(api.getAutomationRun).toHaveBeenCalledTimes(2);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(api.getAutomationRun).toHaveBeenCalledTimes(2);
});
