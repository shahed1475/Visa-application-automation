// @vitest-environment jsdom
// Real, JSON-backed visa-kb (nothing to mock) — mirrors ApplicationsSubsection.test.tsx.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ApplicationDashboardPage } from '../../src/web/src/pages/Applications/ApplicationDashboardPage';
import type { ApplicationPlan, VisaApplication } from '../../src/shared/application/types';

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    getApplication: vi.fn(),
    updateApplication: vi.fn(),
    setApplicationFieldValue: vi.fn(),
  },
}));

const SRC = {
  officialUrl: 'https://indianvisaonline.gov.in/evisa/tvoa.html',
  retrievedAt: '2026-01-01',
  confidence: 'official_derived' as const,
};

function makeApplication(overrides: Partial<VisaApplication> = {}): VisaApplication {
  return {
    id: 'app1',
    applicantId: 'a1',
    destination: 'IND',
    applicationMode: 'regular',
    categoryId: 'regular.business',
    purpose: 'business',
    entryType: 'single',
    intendedArrivalDate: '2026-10-01',
    intendedStayDays: 30,
    portOfArrival: 'DEL',
    status: 'draft',
    kbVersion: '2026-01-01',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePlan(overrides: Partial<ApplicationPlan> = {}): ApplicationPlan {
  const unmet = {
    condition: { type: 'passport_validity_months_min', value: 6 } as const,
    conditionMet: false as const,
    text: 'Passport must be valid for at least 6 months',
    source: SRC,
  };
  return {
    selection: {
      destination: 'IND',
      applicationMode: 'regular',
      categoryId: 'regular.business',
      purpose: 'business',
      entryType: 'single',
      intendedArrivalDate: '2026-10-01',
      intendedStayDays: 30,
      portOfArrival: 'DEL',
    },
    category: {
      id: 'regular.business',
      displayName: 'Business Visa',
      applicationMode: 'regular',
      officialCode: 'B',
      subCategory: null,
      entries: 'single',
      extendable: false,
      convertible: false,
      validity: { amount: 1, unit: 'years', from: 'issue' },
      stayLimitations: {},
    },
    eligibility: {
      status: 'conditional',
      conditions: [
        {
          condition: { type: 'purpose_in', value: ['business'] },
          conditionMet: true,
          text: 'Purpose must be business',
          source: SRC,
        },
        unmet,
        {
          condition: { type: 'custom', text: 'no prohibited background' },
          conditionMet: null,
          text: 'You must confirm: no prohibited background',
          source: SRC,
        },
      ],
      unmetConditions: [unmet],
      warnings: [{ text: 'Business visa needs a sponsoring company', severity: 'warn', source: SRC }],
      basis: 'Bilateral arrangement',
      source: SRC,
    },
    sections: [
      {
        id: 'business_details',
        label: 'Business details',
        applicable: true,
        source: SRC,
        fields: [
          {
            id: 'india_company_name',
            label: 'India company name',
            sectionId: 'business_details',
            requirement: 'required',
            condition: null,
            conditionMet: null,
            effectiveRequirement: 'required',
            appliesTo: 'application.indiaCompanyName',
            value: null,
            present: false,
            verified: false,
            source: SRC,
          },
          {
            id: 'surname',
            label: 'Surname',
            sectionId: 'personal_particulars',
            requirement: 'required',
            condition: null,
            conditionMet: null,
            effectiveRequirement: 'required',
            appliesTo: 'identity.surname',
            value: 'JONES',
            present: true,
            verified: true,
            source: SRC,
          },
          {
            id: 'spouse_name',
            label: 'Spouse name',
            sectionId: 'family',
            requirement: 'conditional',
            condition: { type: 'applicant_married' },
            conditionMet: null,
            effectiveRequirement: 'not_applicable',
            appliesTo: 'family.spouseName',
            value: null,
            present: false,
            verified: false,
            source: SRC,
          },
        ],
      },
      { id: 'study_details', label: 'Study details', applicable: false, source: SRC, fields: [] },
    ],
    documents: [],
    missing: [],
    verification: { requiredVerified: 1, requiredTotal: 2, ratio: 0.5, label: 'partial', bySection: {} },
    readyForAutomation: { ready: false, blockers: [] },
    provenance: {
      kbVersion: '2026-01-01',
      kbRevisionDate: '2026-01-01',
      schemaVersion: 4,
      computedAt: '2026-01-01T00:00:00Z',
    },
    warnings: [],
    ...overrides,
  };
}

async function client() {
  const { api } = await import('../../src/web/src/api/client');
  return api as unknown as Record<'getApplication' | 'updateApplication' | 'setApplicationFieldValue', ReturnType<typeof vi.fn>>;
}

function renderAt(id = 'app1') {
  return render(
    <MemoryRouter initialEntries={[`/applications/${id}`]}>
      <Routes>
        <Route path="/applications/:id" element={<ApplicationDashboardPage />} />
        <Route path="/applicants/:id" element={<p>Applicant page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  const api = await client();
  api.getApplication.mockResolvedValue({ application: makeApplication(), plan: makePlan() });
  api.updateApplication.mockResolvedValue({ application: makeApplication(), plan: makePlan() });
  api.setApplicationFieldValue.mockResolvedValue({ application: makeApplication(), plan: makePlan() });
});
afterEach(() => cleanup());

it('renders the 7 dashboard section headings, each with a status chip', async () => {
  const { container } = renderAt();
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Visa selection' })).toBeTruthy());
  for (const name of [
    'Visa selection',
    'Eligibility',
    'Required information',
    'Required documents',
    'Missing information',
    'Verification',
    'Ready for automation',
  ]) {
    expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
  }
  expect(container.querySelectorAll('.status-chip').length).toBeGreaterThanOrEqual(7);
});

it('renders a conditionMet:null eligibility condition as review, not a failure', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('You must confirm: no prohibited background')).toBeTruthy());
  const row = screen.getByText('You must confirm: no prohibited background').closest('li')!;
  expect(within(row).getByText(/Review required — the app cannot determine this/i)).toBeTruthy();
  expect(row.textContent ?? '').not.toContain('✗');
  expect((row.textContent ?? '').toLowerCase()).not.toContain('failed');
});

it('an application-scoped field input calls setApplicationFieldValue', async () => {
  const api = await client();
  renderAt();
  await waitFor(() => expect(screen.getByLabelText('India company name')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('India company name'), { target: { value: 'Acme India Pvt Ltd' } });
  fireEvent.click(screen.getByRole('button', { name: /save field/i }));
  await waitFor(() =>
    expect(api.setApplicationFieldValue).toHaveBeenCalledWith('app1', {
      fieldPath: 'application.indiaCompanyName',
      value: 'Acme India Pvt Ltd',
    }),
  );
});

it('a profile-mapped field shows "Edit in profile" linking to the applicant page', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('Surname')).toBeTruthy());
  const links = screen.getAllByRole('link', { name: /edit in profile/i });
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(link.getAttribute('href')).toBe('/applicants/a1');
  }
});

it('renders source confidence as a label, never a bare percentage', async () => {
  const { container } = renderAt();
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Eligibility' })).toBeTruthy());
  expect(screen.getAllByText(/confidence: official derived/i).length).toBeGreaterThan(0);
  expect(container.textContent ?? '').not.toContain('%');
});

it('the Visa selection form submit calls api.updateApplication', async () => {
  const api = await client();
  renderAt();
  await waitFor(() => expect(screen.getByLabelText(/port of arrival/i)).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/port of arrival/i), { target: { value: 'BOM' } });
  fireEvent.click(screen.getByRole('button', { name: /save selection/i }));
  await waitFor(() => expect(api.updateApplication).toHaveBeenCalled());
  const call = api.updateApplication.mock.calls[0] ?? [];
  expect(call[0]).toBe('app1');
  expect(call[1]).toMatchObject({ portOfArrival: 'BOM', categoryId: 'regular.business' });
});

it('shows a not-found message when the application does not exist', async () => {
  const api = await client();
  api.getApplication.mockRejectedValueOnce(new Error('not found'));
  renderAt('missing');
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
});
