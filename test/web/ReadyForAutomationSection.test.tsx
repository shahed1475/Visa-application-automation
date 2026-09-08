// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReadyForAutomationSection } from '../../src/web/src/pages/Applications/ReadyForAutomationSection';
import type { Blocker } from '../../src/shared/application/types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    startAutomationRun: vi.fn(),
  },
}));

async function client() {
  const { api } = await import('../../src/web/src/api/client');
  return api as unknown as { startAutomationRun: ReturnType<typeof vi.fn> };
}

const SRC = {
  officialUrl: 'https://indianvisaonline.gov.in/evisa/tvoa.html',
  retrievedAt: '2026-01-01',
  confidence: 'official_derived' as const,
};

const AUTOMATION_HELPER =
  'This fills the portal form under your control. It never submits, pays, or books an appointment — you review every field in the portal and submit it yourself.';
const READINESS_HINT =
  'Readiness reflects only the local preparation data against the current knowledge base. It is not a submission and not an approval.';

function renderSection(
  readyForAutomation: { ready: boolean; blockers: Blocker[] },
  applicationId = 'app1',
) {
  return render(
    <MemoryRouter>
      <ReadyForAutomationSection readyForAutomation={readyForAutomation} applicationId={applicationId} />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('when ready: the Start automation button is enabled, starts a run, and navigates to it', async () => {
  const api = await client();
  api.startAutomationRun.mockResolvedValue({ run: { id: 'run-1' } });
  renderSection({ ready: true, blockers: [] });

  const btn = screen.getByRole('button', { name: /start automation/i }) as HTMLButtonElement;
  expect(btn.disabled).toBe(false);

  fireEvent.click(btn);
  await waitFor(() => expect(api.startAutomationRun).toHaveBeenCalledWith('app1'));
  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/automation-runs/run-1'));
});

it('when not ready: the button is disabled, inert, and the blockers render', async () => {
  const api = await client();
  renderSection({
    ready: false,
    blockers: [{ text: 'Passport must be valid for at least 6 months', kind: 'eligibility', source: SRC }],
  });

  const btn = screen.getByRole('button', { name: /start automation/i }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  fireEvent.click(btn);
  expect(api.startAutomationRun).not.toHaveBeenCalled();
  expect(navigateMock).not.toHaveBeenCalled();
  expect(screen.getByText('Passport must be valid for at least 6 months')).toBeTruthy();
});

it('keeps both verbatim helper hint lines', async () => {
  renderSection({ ready: true, blockers: [] });
  expect(screen.getByText(AUTOMATION_HELPER)).toBeTruthy();
  expect(screen.getByText(READINESS_HINT)).toBeTruthy();
});

it('labels the button "Start automation" even when blocked, with an accurate hint', () => {
  render(
    <MemoryRouter>
      <ReadyForAutomationSection readyForAutomation={{ ready: false, blockers: [] }} applicationId="a1" />
    </MemoryRouter>,
  );
  const btn = screen.getByRole('button', { name: 'Start automation' }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  expect(screen.queryByText(/phase 5/i)).toBeNull();
  expect(screen.getByText(/never submits, pays, or books an appointment/i)).toBeTruthy();
});

it('adds no submit affordance', async () => {
  renderSection({ ready: true, blockers: [] });
  expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
});

it('surfaces a 409 (run already in progress) inline and does not navigate', async () => {
  const api = await client();
  api.startAutomationRun.mockRejectedValue(
    new Error('a run is already in progress for this application'),
  );
  renderSection({ ready: true, blockers: [] });

  fireEvent.click(screen.getByRole('button', { name: /start automation/i }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'a run is already in progress for this application',
    ),
  );
  expect(navigateMock).not.toHaveBeenCalled();
});
