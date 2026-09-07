// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DiscoverySessionPage } from '../../src/web/src/pages/Discovery/DiscoverySessionPage';
import type {
  DiscoveryPageDTO,
  DiscoverySessionDTO,
  DiscoveryFieldCandidateDTO,
  MappingView,
} from '../../src/shared/discovery/types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    getDiscoverySession: vi.fn(),
    captureDiscoveryPage: vi.fn(),
    endDiscoverySession: vi.fn(),
    promoteCandidate: vi.fn(),
    validateAdapter: vi.fn(),
    getAdapterMappings: vi.fn(),
    getAdapterDiagnostics: vi.fn(),
  },
}));

async function client() {
  const { api } = await import('../../src/web/src/api/client');
  return api as unknown as Record<
    | 'getDiscoverySession'
    | 'captureDiscoveryPage'
    | 'endDiscoverySession'
    | 'promoteCandidate'
    | 'validateAdapter'
    | 'getAdapterMappings'
    | 'getAdapterDiagnostics',
    ReturnType<typeof vi.fn>
  >;
}

// Carries value-like fields the component must NEVER surface — if a future
// regression widened rendering from named field access to a spread/dump, these
// canaries would appear in the DOM and the "no value leak" test would bite.
const CAND = {
  label: 'Surname',
  primarySelector: '#surname',
  fallbackSelector: 'input[name="surname"]',
  selectorConfidence: 'stable',
  control: 'text',
  value: 'LEAKCANARY',
  prefilledValue: 'LEAKCANARY2',
} as unknown as DiscoveryFieldCandidateDTO;

function session(o: Partial<DiscoverySessionDTO> = {}): DiscoverySessionDTO {
  return {
    id: 'sess-1',
    portal_id: 'p1',
    adapter_id: 'india',
    status: 'active',
    started_at: '2026-09-07T00:00:00Z',
    ended_at: null,
    page_count: 1,
    last_validation_json: null,
    notes: null,
    ...o,
  };
}

function page(o: Partial<DiscoveryPageDTO> = {}): DiscoveryPageDTO {
  return {
    id: 'pg-1',
    session_id: 'sess-1',
    seq: 1,
    created_at: '2026-09-07T00:00:00Z',
    state_guess: 'PERSONAL_DETAILS',
    url_pattern: '/evisa/personal',
    page_title: 'Applicant Details',
    headings_json: '[]',
    fingerprint_json: '{}',
    candidates_json: JSON.stringify([CAND]),
    signals_json: '{}',
    ...o,
  };
}

const MAPPINGS: MappingView[] = [
  {
    canonicalFieldPath: 'identity.surname',
    label: 'identity.surname',
    selector: 'TODO:discover',
    control: 'text',
    status: 'placeholder',
    confidence: 'fragile',
  },
  {
    canonicalFieldPath: 'identity.givenName',
    label: 'identity.givenName',
    selector: '#given',
    control: 'text',
    status: 'validated',
    confidence: 'stable',
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/discovery/sess-1']}>
      <Routes>
        <Route path="/discovery/:sessionId" element={<DiscoverySessionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  const api = await client();
  api.getDiscoverySession.mockResolvedValue({ session: session(), pages: [page()] });
  api.getAdapterMappings.mockResolvedValue({
    mappings: MAPPINGS,
    status: { placeholder: 1, discovered: 0, validated: 1, total: 2, requiredRemaining: 1 },
  });
  api.getAdapterDiagnostics.mockResolvedValue({
    diagnostics: {
      adapterId: 'india',
      adapterVersion: '6.0.0',
      mappingRevision: '2026-09-07',
      lastDiscoveryAt: '2026-09-07T00:00:00Z',
      pagesDiscovered: 1,
      fieldsDiscovered: 0,
      mappings: { placeholder: 1, discovered: 0, validated: 1, total: 2, requiredRemaining: 1 },
      unknownPagesEncountered: 0,
      lastValidation: null,
    },
  });
  api.captureDiscoveryPage.mockResolvedValue({ page: page({ id: 'pg-2', seq: 2 }) });
  api.endDiscoverySession.mockResolvedValue({ session: session({ status: 'ended' }) });
  api.promoteCandidate.mockResolvedValue({
    mappingEdit: {
      canonicalFieldPath: 'identity.surname',
      literal: "'identity.surname': {\n  selector: '#surname',\n},",
      warnings: ['selector confidence is ok'],
    },
  });
  api.validateAdapter.mockResolvedValue({
    report: {
      adapterVersion: '6.0.0',
      mappingRevision: '2026-09-07',
      ranAt: '2026-09-07T00:00:00Z',
      fields: [{ fieldPath: 'identity.givenName', resolvable: true, nodeCount: 1, controlMatches: true }],
      states: [{ state: 'PERSONAL_DETAILS', nextResolvable: true }],
      ok: true,
    },
  });
});
afterEach(() => cleanup());

it('renders the captured page list with state guess, url pattern and title', async () => {
  renderPage();
  expect(await screen.findByText('PERSONAL_DETAILS')).toBeTruthy();
  expect(screen.getByText('/evisa/personal')).toBeTruthy();
  expect(screen.getByText('Applicant Details')).toBeTruthy();
});

it('Capture this page calls the API and refetches', async () => {
  const api = await client();
  renderPage();
  await screen.findByText('PERSONAL_DETAILS');
  fireEvent.click(screen.getByRole('button', { name: /capture this page/i }));
  await waitFor(() => expect(api.captureDiscoveryPage).toHaveBeenCalledWith('sess-1'));
  await waitFor(() => expect(api.getDiscoverySession).toHaveBeenCalledTimes(2));
});

it('expands a page to a candidate table with no value column, and promotes a candidate', async () => {
  const api = await client();
  const { container } = renderPage();
  await screen.findByText('PERSONAL_DETAILS');
  fireEvent.click(screen.getByRole('button', { name: /candidates|expand|show/i }));

  const table = await screen.findByRole('table');
  const headers = within(table)
    .getAllByRole('columnheader')
    .map((h) => h.textContent?.toLowerCase() ?? '');
  expect(headers.some((h) => h.includes('label'))).toBe(true);
  expect(headers.some((h) => h.includes('selector'))).toBe(true);
  expect(headers.some((h) => h.includes('control'))).toBe(true);
  expect(headers.some((h) => h.includes('value'))).toBe(false);

  // only the placeholder canonical path is offered
  const select = within(table).getByRole('combobox') as HTMLSelectElement;
  const opts = within(select).getAllByRole('option').map((o) => o.textContent);
  expect(opts).toContain('identity.surname');
  expect(opts).not.toContain('identity.givenName');

  fireEvent.change(select, { target: { value: 'identity.surname' } });
  fireEvent.click(within(table).getByRole('button', { name: /promote/i }));

  await waitFor(() =>
    expect(api.promoteCandidate).toHaveBeenCalledWith('sess-1', {
      pageSeq: 1,
      candidateIndex: 0,
      canonicalFieldPath: 'identity.surname',
    }),
  );
  expect(await screen.findByText(/'identity.surname': \{/)).toBeTruthy();
  expect(container.querySelector('pre')?.textContent).toContain('#surname');
});

it('End Session ends and navigates back to the portals page', async () => {
  const api = await client();
  renderPage();
  await screen.findByText('PERSONAL_DETAILS');
  fireEvent.click(screen.getByRole('button', { name: /end session/i }));
  await waitFor(() => expect(api.endDiscoverySession).toHaveBeenCalledWith('sess-1'));
  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/settings/portals'));
});

it('Validate Adapter shows the ok result and a pass list', async () => {
  const api = await client();
  renderPage();
  await screen.findByText('PERSONAL_DETAILS');
  fireEvent.click(screen.getByRole('button', { name: /validate adapter/i }));
  await waitFor(() => expect(api.validateAdapter).toHaveBeenCalledWith('sess-1'));
  const report = await screen.findByTestId('validation-report');
  expect(within(report).getByText(/identity\.givenName/)).toBeTruthy();
  expect(within(report).getAllByText(/pass/i).length).toBeGreaterThan(0);
});

it('shows a value-free diagnostics panel with role=status', async () => {
  renderPage();
  const panel = await screen.findByRole('status');
  expect(within(panel).getByText(/6\.0\.0/)).toBeTruthy();
});

it('renders only labels / selectors / control kinds — never a portal field value', async () => {
  const { container } = renderPage();
  await screen.findByText('PERSONAL_DETAILS');
  fireEvent.click(screen.getByRole('button', { name: /candidates|expand|show/i }));
  const table = await screen.findByRole('table');

  // the candidate row DID render — label, selector and control kind are shown...
  expect(within(table).getByText('Surname')).toBeTruthy();
  expect(within(table).getByText('#surname')).toBeTruthy();
  expect(within(table).getByText('text')).toBeTruthy();

  // ...but the value-like fields on the fixture are nowhere in the DOM.
  expect(screen.queryByText('LEAKCANARY')).toBeNull();
  expect(screen.queryByText('LEAKCANARY2')).toBeNull();
  expect(screen.queryByText(/LEAKCANARY/)).toBeNull();

  // and no free-text input carries a value
  container.querySelectorAll('input').forEach((el) => {
    expect((el as HTMLInputElement).value).toBe('');
  });
});
