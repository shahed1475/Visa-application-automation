// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalsPage } from '../../src/web/src/pages/Settings/PortalsPage';

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    listPortals: vi.fn().mockResolvedValue({
      portals: [
        {
          id: 'p1', name: 'Example Visa', url: 'https://example.com',
          portalType: 'evisa', country: 'Exampleland', applicationType: 'Tourist',
          notes: null, enabled: true,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    }),
    getActivePortal: vi.fn().mockResolvedValue({ activePortalId: null, portal: null }),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('renders the portal list from the API', async () => {
  render(
    <MemoryRouter>
      <PortalsPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('Example Visa')).toBeTruthy());
  expect(screen.getByText('https://example.com')).toBeTruthy();
});

it('shows an empty state when there are no portals', async () => {
  const { api } = await import('../../src/web/src/api/client');
  (api.listPortals as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ portals: [] });
  render(
    <MemoryRouter>
      <PortalsPage />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByText(/no visa portals configured/i)).toBeTruthy(),
  );
});
