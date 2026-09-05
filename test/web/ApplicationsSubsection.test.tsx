// @vitest-environment jsdom
// Deliberately does NOT mock src/shared/visa-kb/index -- real, synchronous,
// JSON-backed data, nothing to mock (mirrors VisaRulesPage.realKb.test.tsx).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ApplicationsSubsection } from '../../src/web/src/pages/Applicants/ApplicationsSubsection';
import { getCategory } from '../../src/shared/visa-kb/index';

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    listApplications: vi.fn().mockResolvedValue({ applications: [] }),
    createApplication: vi.fn(),
  },
}));

function renderSubsection() {
  return render(
    <MemoryRouter initialEntries={['/applicants/a1']}>
      <Routes>
        <Route path="/applicants/:id" element={<ApplicationsSubsection applicantId="a1" />} />
        <Route path="/applications/:id" element={<p>Application dashboard stub</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('renders "No applications yet." when there are none', async () => {
  const { api } = await import('../../src/web/src/api/client');
  (api.listApplications as ReturnType<typeof vi.fn>).mockResolvedValue({ applications: [] });
  renderSubsection();
  await waitFor(() => expect(screen.getByText('No applications yet.')).toBeTruthy());
});

it('renders a table row with the real category displayName', async () => {
  const { api } = await import('../../src/web/src/api/client');
  const displayName = getCategory('regular.tourist')!.displayName;
  (api.listApplications as ReturnType<typeof vi.fn>).mockResolvedValue({
    applications: [
      {
        id: 'app1', applicantId: 'a1', destination: 'IN', applicationMode: 'regular',
        categoryId: 'regular.tourist', purpose: null, entryType: null,
        intendedArrivalDate: null, intendedStayDays: null, portOfArrival: null,
        status: 'draft', kbVersion: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  });
  renderSubsection();
  await waitFor(() => expect(screen.getByText(displayName)).toBeTruthy());
  expect(screen.getByText('draft')).toBeTruthy();
  expect(screen.getByText('2026-01-01')).toBeTruthy(); // kbVersion, not the formatted created date
});

it('the mode select cascades the category options', async () => {
  const { api } = await import('../../src/web/src/api/client');
  (api.listApplications as ReturnType<typeof vi.fn>).mockResolvedValue({ applications: [] });
  renderSubsection();
  await waitFor(() => expect(screen.getByText('No applications yet.')).toBeTruthy());

  const evisaOnly = getCategory('evisa.entry_x')!.displayName; // "e-Miscellaneous (X) Visa"
  const regularOnly = getCategory('regular.employment')!.displayName; // "Employment Visa"

  // Default mode is evisa: the evisa-only category is present, the regular-only one is not.
  expect(screen.getByRole('option', { name: evisaOnly })).toBeTruthy();
  expect(screen.queryByRole('option', { name: regularOnly })).toBeNull();

  fireEvent.change(screen.getByLabelText(/mode/i), { target: { value: 'regular' } });

  expect(screen.getByRole('option', { name: regularOnly })).toBeTruthy();
  expect(screen.queryByRole('option', { name: evisaOnly })).toBeNull();
});

it('submits the new-application form and calls createApplication with the selected values', async () => {
  const { api } = await import('../../src/web/src/api/client');
  (api.listApplications as ReturnType<typeof vi.fn>).mockResolvedValue({ applications: [] });
  (api.createApplication as ReturnType<typeof vi.fn>).mockResolvedValue({
    application: { id: 'new-app-1' },
  });
  renderSubsection();
  await waitFor(() => expect(screen.getByText('No applications yet.')).toBeTruthy());

  fireEvent.change(screen.getByLabelText(/mode/i), { target: { value: 'regular' } });
  fireEvent.change(screen.getByLabelText(/visa category/i), { target: { value: 'regular.tourist' } });
  fireEvent.click(screen.getByRole('button', { name: /new application/i }));

  await waitFor(() =>
    expect(api.createApplication).toHaveBeenCalledWith('a1', {
      applicationMode: 'regular',
      categoryId: 'regular.tourist',
    }),
  );
});

it('shows an inline error and does not call the API when no category is chosen', async () => {
  const { api } = await import('../../src/web/src/api/client');
  (api.listApplications as ReturnType<typeof vi.fn>).mockResolvedValue({ applications: [] });
  renderSubsection();
  await waitFor(() => expect(screen.getByText('No applications yet.')).toBeTruthy());

  fireEvent.click(screen.getByRole('button', { name: /new application/i }));

  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(api.createApplication).not.toHaveBeenCalled();
});
