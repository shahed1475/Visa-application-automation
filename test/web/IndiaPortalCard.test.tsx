// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IndiaPortalCard } from '../../src/web/src/pages/Settings/IndiaPortalCard';
import type { VisaPortal } from '../../src/shared/types';
import type {
  IndiaDiagnostics,
  MappingStatusCounts,
} from '../../src/shared/discovery/types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    getAdapterMappings: vi.fn(),
    getAdapterDiagnostics: vi.fn(),
    listDiscoverySessions: vi.fn(),
    startDiscoverySession: vi.fn(),
    recordPolicyAck: vi.fn(),
  },
}));

async function client() {
  const { api } = await import('../../src/web/src/api/client');
  return api as unknown as Record<
    | 'getAdapterMappings'
    | 'getAdapterDiagnostics'
    | 'listDiscoverySessions'
    | 'startDiscoverySession'
    | 'recordPolicyAck',
    ReturnType<typeof vi.fn>
  >;
}

const PORTAL: VisaPortal = {
  id: 'p1',
  name: 'India e-Visa',
  url: 'https://example.test/evisa',
  portalType: 'evisa',
  country: 'IN',
  applicationType: 'business',
  notes: null,
  enabled: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

function counts(o: Partial<MappingStatusCounts> = {}): MappingStatusCounts {
  return {
    placeholder: 10,
    discovered: 0,
    validated: 0,
    stale: 0,
    productionUsable: 0,
    total: 10,
    requiredRemaining: 10,
    ...o,
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
    mappings: counts(),
    staleMappings: 0,
    productionUsableMappings: 0,
    unknownPagesEncountered: 0,
    selectorStaleEvents: 0,
    lastValidation: null,
    ...o,
  };
}

function renderCard() {
  return render(
    <MemoryRouter>
      <IndiaPortalCard portal={PORTAL} />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('self-hides when the adapter-mappings call fails (non-india / 404)', async () => {
  const api = await client();
  api.getAdapterMappings.mockRejectedValue(new Error('Request failed (404)'));
  api.getAdapterDiagnostics.mockRejectedValue(new Error('Request failed (404)'));
  api.listDiscoverySessions.mockResolvedValue({ sessions: [] });
  const { container } = renderCard();
  await waitFor(() => expect(api.getAdapterMappings).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  expect(container.textContent).not.toMatch(/India portal adapter/i);
});

it('shows "Needs Discovery" when no discovery has happened', async () => {
  const api = await client();
  api.getAdapterMappings.mockResolvedValue({ mappings: [], status: counts() });
  api.getAdapterDiagnostics.mockResolvedValue({ diagnostics: diag() });
  api.listDiscoverySessions.mockResolvedValue({ sessions: [] });
  renderCard();
  expect(await screen.findByText(/Needs Discovery/i)).toBeTruthy();
});

it('shows "Needs Mapping" when a session exists but every mapping is still placeholder', async () => {
  const api = await client();
  api.getAdapterMappings.mockResolvedValue({ mappings: [], status: counts() });
  api.getAdapterDiagnostics.mockResolvedValue({
    diagnostics: diag({ pagesDiscovered: 4, lastDiscoveryAt: '2026-09-07T00:00:00Z' }),
  });
  api.listDiscoverySessions.mockResolvedValue({ sessions: [] });
  renderCard();
  expect(await screen.findByText(/Needs Mapping/i)).toBeTruthy();
});

it('shows "Needs Validation" when mappings are discovered but none validated', async () => {
  const api = await client();
  api.getAdapterMappings.mockResolvedValue({
    mappings: [],
    status: counts({ placeholder: 6, discovered: 4, validated: 0, requiredRemaining: 10 }),
  });
  api.getAdapterDiagnostics.mockResolvedValue({
    diagnostics: diag({ pagesDiscovered: 4, lastDiscoveryAt: '2026-09-07T00:00:00Z' }),
  });
  api.listDiscoverySessions.mockResolvedValue({ sessions: [] });
  renderCard();
  expect(await screen.findByText(/Needs Validation/i)).toBeTruthy();
});

it('shows "Ready" when nothing remains and every mapping is validated', async () => {
  const api = await client();
  api.getAdapterMappings.mockResolvedValue({
    mappings: [],
    status: counts({ placeholder: 0, discovered: 0, validated: 10, requiredRemaining: 0 }),
  });
  api.getAdapterDiagnostics.mockResolvedValue({
    diagnostics: diag({ pagesDiscovered: 6, lastDiscoveryAt: '2026-09-07T00:00:00Z' }),
  });
  api.listDiscoverySessions.mockResolvedValue({ sessions: [] });
  const { container } = renderCard();
  await waitFor(() =>
    expect(container.querySelector('.india-portal-card__status')?.textContent).toBe('Ready'),
  );
});

it('Start Discovery posts and navigates to the session page', async () => {
  const api = await client();
  api.getAdapterMappings.mockResolvedValue({ mappings: [], status: counts() });
  api.getAdapterDiagnostics.mockResolvedValue({ diagnostics: diag() });
  api.listDiscoverySessions.mockResolvedValue({ sessions: [] });
  api.startDiscoverySession.mockResolvedValue({ session: { id: 'sess-1' } });
  renderCard();
  const btn = await screen.findByRole('button', { name: /start discovery/i });
  fireEvent.click(btn);
  await waitFor(() => expect(api.startDiscoverySession).toHaveBeenCalledWith('p1'));
  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/discovery/sess-1'));
});

it('a TOS_NOT_ACKNOWLEDGED 409 shows an inline ack prompt whose confirm acks then retries', async () => {
  const api = await client();
  api.getAdapterMappings.mockResolvedValue({ mappings: [], status: counts() });
  api.getAdapterDiagnostics.mockResolvedValue({ diagnostics: diag() });
  api.listDiscoverySessions.mockResolvedValue({ sessions: [] });
  api.startDiscoverySession
    .mockRejectedValueOnce(
      new Error('acknowledge the portal Terms of Service before starting discovery'),
    )
    .mockResolvedValueOnce({ session: { id: 'sess-2' } });
  api.recordPolicyAck.mockResolvedValue({
    status: { portalId: 'p1', acknowledgedAt: '2026-09-07T00:00:00Z' },
  });
  renderCard();

  fireEvent.click(await screen.findByRole('button', { name: /start discovery/i }));
  const confirm = await screen.findByRole('button', { name: /acknowledge/i });
  fireEvent.click(confirm);

  await waitFor(() => expect(api.recordPolicyAck).toHaveBeenCalledWith('p1'));
  await waitFor(() => expect(api.startDiscoverySession).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/discovery/sess-2'));
});

it('renders no applicant / field values', async () => {
  const api = await client();
  api.getAdapterMappings.mockResolvedValue({ mappings: [], status: counts() });
  api.getAdapterDiagnostics.mockResolvedValue({ diagnostics: diag() });
  api.listDiscoverySessions.mockResolvedValue({ sessions: [] });
  const { container } = renderCard();
  await screen.findByText(/Needs Discovery/i);
  expect(container.querySelector('input[value]')).toBeNull();
});
