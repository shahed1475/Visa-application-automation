// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApplicantsPage } from '../../src/web/src/pages/Applicants/ApplicantsPage';

// Inlined into the factory (house convention — see PortalsPage.test.tsx) because
// `vi.mock` is hoisted above module-scope consts.
vi.mock('../../src/web/src/api/client', () => ({
  api: {
    listApplicants: vi.fn().mockResolvedValue({
      applicants: [
        {
          id: 'a1', displayName: 'Aisha Khan', status: 'draft', nationality: 'Bangladeshi',
          passportNumberLast4: '4567', completeness: { overall: 0.5 },
          verification: { label: 'partial' },
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
        },
      ],
    }),
    createApplicant: vi.fn().mockResolvedValue({ applicant: { id: 'new', displayName: 'New' } }),
    deleteApplicant: vi.fn().mockResolvedValue({ deleted: true }),
    duplicateApplicant: vi.fn().mockResolvedValue({ applicant: { id: 'copy' } }),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('renders applicant summaries from the API', async () => {
  render(<MemoryRouter><ApplicantsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Aisha Khan')).toBeTruthy());
  expect(screen.getByText('Bangladeshi')).toBeTruthy();
  expect(screen.getByText(/4567/)).toBeTruthy();
  // no full passport number anywhere
  expect(document.body.textContent).not.toMatch(/AB1234567/);
});

it('shows an empty state', async () => {
  const { api } = await import('../../src/web/src/api/client');
  (api.listApplicants as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ applicants: [] });
  render(<MemoryRouter><ApplicantsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/no applicants yet/i)).toBeTruthy());
});

it('typing in search re-queries with q', async () => {
  render(<MemoryRouter><ApplicantsPage /></MemoryRouter>);
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() => expect(api.listApplicants).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'khan' } });
  await waitFor(() =>
    expect((api.listApplicants as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe('khan'),
  );
});

it('creating an applicant calls the API', async () => {
  render(<MemoryRouter><ApplicantsPage /></MemoryRouter>);
  const { api } = await import('../../src/web/src/api/client');
  fireEvent.click(screen.getByRole('button', { name: /new applicant/i }));
  fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Bob' } });
  fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
  await waitFor(() => expect(api.createApplicant).toHaveBeenCalledWith({ displayName: 'Bob' }));
});
