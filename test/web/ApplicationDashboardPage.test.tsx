// @vitest-environment jsdom
// Real, JSON-backed visa-kb (nothing to mock) — mirrors ApplicationsSubsection.test.tsx.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ApplicationDashboardPage } from '../../src/web/src/pages/Applications/ApplicationDashboardPage';
import type { ApplicationPlan, VisaApplication } from '../../src/shared/application/types';

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    getApplication: vi.fn(),
    updateApplication: vi.fn(),
    setApplicationFieldValue: vi.fn(),
    setFieldMeta: vi.fn(),
    uploadDocument: vi.fn(),
    extractDocument: vi.fn(),
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
  return api as unknown as Record<
    | 'getApplication'
    | 'updateApplication'
    | 'setApplicationFieldValue'
    | 'setFieldMeta'
    | 'uploadDocument'
    | 'extractDocument',
    ReturnType<typeof vi.fn>
  >;
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
  api.setFieldMeta.mockResolvedValue({ fieldMeta: {} });
  api.uploadDocument.mockResolvedValue({ document: { id: 'newdoc1' } });
  api.extractDocument.mockResolvedValue({ document: { id: 'newdoc1' } });
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

it('shows the review note only on an unresolved conditional Required-information row', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('Spouse name')).toBeTruthy());
  // Scope to the Required-information section — Task 18's Verification section
  // repeats some field labels.
  const ri = within(document.getElementById('required-information')!);

  // (a) conditional + conditionMet:null -> the note is shown
  const conditionalRow = ri.getByText('Spouse name').closest('li')!;
  expect(within(conditionalRow).getByText(/Review required — the app cannot determine this/i)).toBeTruthy();

  // (b) plain required + conditionMet:null -> NO note (null is the engine default there)
  const requiredRow = ri.getByText('Surname').closest('li')!;
  expect(within(requiredRow).queryByText(/Review required/i)).toBeNull();
  const appRow = ri.getByText('India company name').closest('li')!;
  expect(within(appRow).queryByText(/Review required/i)).toBeNull();
});

it('an application-scoped field input calls setApplicationFieldValue', async () => {
  const api = await client();
  renderAt();
  await waitFor(() => expect(screen.getByLabelText('India company name')).toBeTruthy());
  const input = screen.getByLabelText('India company name') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: 'Acme India Pvt Ltd' } });
  });
  await waitFor(() => expect(input.value).toBe('Acme India Pvt Ltd'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /save field/i }));
  });
  await waitFor(() =>
    expect(api.setApplicationFieldValue).toHaveBeenCalledWith('app1', {
      fieldPath: 'application.indiaCompanyName',
      value: 'Acme India Pvt Ltd',
    }),
  );
});

it('a profile-mapped field shows "Edit in profile" linking to the applicant page', async () => {
  renderAt();
  await waitFor(() => expect(screen.getAllByText('Surname').length).toBeGreaterThan(0));
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

// ---- Task 18: sections 4–7 ------------------------------------------------

const DOC_REQUIRED = {
  id: 'photo',
  label: 'Passport photograph',
  requirement: 'required' as const,
  condition: null,
  conditionMet: null,
  effectiveRequirement: 'required' as const,
  uploaded: false,
  matchedDocumentId: null,
  source: SRC,
};
const DOC_MATCHED = {
  id: 'passport_bio',
  label: 'Passport bio page',
  requirement: 'required' as const,
  condition: null,
  conditionMet: null,
  effectiveRequirement: 'required' as const,
  uploaded: true,
  matchedDocumentId: 'doc1',
  source: SRC,
};

it('renders each required document with its requirement and uploaded state; a matched doc links to /documents/:id', async () => {
  const api = await client();
  api.getApplication.mockResolvedValue({
    application: makeApplication(),
    plan: makePlan({ documents: [DOC_REQUIRED, DOC_MATCHED] }),
  });
  renderAt();
  await waitFor(() => expect(screen.getByText('Passport photograph')).toBeTruthy());

  const notUploaded = screen.getByText('Passport photograph').closest('li')!;
  expect(within(notUploaded).getByText(/required/i)).toBeTruthy();
  expect(within(notUploaded).getByText(/not uploaded/i)).toBeTruthy();

  const matched = screen.getByText('Passport bio page').closest('li')!;
  const link = within(matched).getByRole('link', { name: /view document/i });
  expect(link.getAttribute('href')).toBe('/documents/doc1');
});

it('a document row shows its effectiveRequirement, not its base requirement', async () => {
  // The evisa.tourist.30d return_ticket case: listed optional, promoted to required by the
  // category's onwardOrReturnTicket rule, so it also appears in Missing info and as a blocker.
  // The chip must agree with the gate.
  const promotedTicket = {
    id: 'return_ticket',
    label: 'Return or onward ticket',
    requirement: 'optional' as const,
    condition: null,
    conditionMet: null,
    effectiveRequirement: 'required' as const,
    uploaded: false,
    matchedDocumentId: null,
    source: SRC,
  };
  const api = await client();
  api.getApplication.mockResolvedValue({
    application: makeApplication(),
    plan: makePlan({ documents: [promotedTicket] }),
  });
  renderAt();
  await waitFor(() => expect(screen.getByText('Return or onward ticket')).toBeTruthy());

  const row = screen.getByText('Return or onward ticket').closest('li')!;
  expect(within(row).getByText('required')).toBeTruthy();
  expect(within(row).queryByText('optional')).toBeNull();
  // the base requirement is still disclosed, just not as the chip
  expect(within(row).getByText(/listed as optional/i)).toBeTruthy();
});

it('the required-documents upload control reuses the Phase 3 upload + extract, then reloads', async () => {
  const api = await client();
  api.getApplication.mockResolvedValue({
    application: makeApplication(),
    plan: makePlan({ documents: [DOC_REQUIRED] }),
  });
  renderAt();
  await waitFor(() => expect(screen.getByText('Passport photograph')).toBeTruthy());

  const file = new File(['x'], 'photo.png', { type: 'image/png' });
  const input = screen.getByLabelText(/add a document/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

  await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledWith(file, 'a1'));
  await waitFor(() => expect(api.extractDocument).toHaveBeenCalledWith('newdoc1'));
  await waitFor(() => expect(api.getApplication).toHaveBeenCalledTimes(2));
});

it('renders each missing item with its kind and an anchor link to the owning section', async () => {
  const api = await client();
  api.getApplication.mockResolvedValue({
    application: makeApplication(),
    plan: makePlan({
      missing: [
        { kind: 'field', id: 'india_company_name', label: 'India company name', sectionId: 'business_details', appliesTo: 'application.indiaCompanyName', source: SRC },
        { kind: 'document', id: 'photo', label: 'Passport photograph', source: SRC },
      ],
    }),
  });
  renderAt();
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Missing information' })).toBeTruthy());
  const mi = within(document.getElementById('missing-information')!);

  const fieldItem = mi.getByText('India company name').closest('li')!;
  expect(within(fieldItem).getByText('field')).toBeTruthy();
  expect(
    within(fieldItem).getByRole('link', { name: 'Required information' }).getAttribute('href'),
  ).toBe('#required-information');

  const docItem = mi.getByText('Passport photograph').closest('li')!;
  expect(within(docItem).getByText('document')).toBeTruthy();
  expect(
    within(docItem).getByRole('link', { name: 'Required documents' }).getAttribute('href'),
  ).toBe('#required-documents');
});

it('renders the verification rollup and per-field verify buttons for profile and application fields', async () => {
  const api = await client();
  const sections = [
    {
      id: 'personal_particulars',
      label: 'Personal particulars',
      applicable: true,
      source: SRC,
      fields: [
        {
          id: 'surname', label: 'Surname', sectionId: 'personal_particulars',
          requirement: 'required' as const, condition: null, conditionMet: null,
          effectiveRequirement: 'required' as const, appliesTo: 'identity.surname',
          value: 'JONES', present: true, verified: false, source: SRC,
        },
        {
          id: 'india_company_name', label: 'India company name', sectionId: 'personal_particulars',
          requirement: 'required' as const, condition: null, conditionMet: null,
          effectiveRequirement: 'required' as const, appliesTo: 'application.indiaCompanyName',
          value: 'Acme', present: true, verified: false, source: SRC,
        },
      ],
    },
  ];
  api.getApplication.mockResolvedValue({
    application: makeApplication(),
    plan: makePlan({
      sections,
      verification: { requiredVerified: 1, requiredTotal: 3, ratio: 1 / 3, label: 'partial', bySection: { personal_particulars: { verified: 1, total: 3 } } },
    }),
  });
  renderAt();
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Verification' })).toBeTruthy());

  const rollup = screen.getByRole('heading', { level: 2, name: 'Verification' }).closest('section')!;
  expect(rollup.textContent ?? '').toMatch(/1\s*(of|\/)\s*3/);
  expect(rollup.textContent ?? '').toMatch(/partial/i);

  const verifyBtns = within(rollup).getAllByRole('button', { name: /verify/i });
  const surnameRow = within(rollup).getByText('Surname').closest('li')!;
  fireEvent.click(within(surnameRow).getByRole('button', { name: /verify/i }));
  await waitFor(() =>
    expect(api.setFieldMeta).toHaveBeenCalledWith('a1', { fieldPath: 'identity.surname', verified: true }),
  );

  const companyRow = within(rollup).getByText('India company name').closest('li')!;
  fireEvent.click(within(companyRow).getByRole('button', { name: /verify/i }));
  await waitFor(() =>
    expect(api.setApplicationFieldValue).toHaveBeenCalledWith('app1', {
      fieldPath: 'application.indiaCompanyName',
      verified: true,
    }),
  );
  expect(verifyBtns.length).toBeGreaterThanOrEqual(2);
});

it('the Start automation (Phase 5) button is present, disabled, inert, with verbatim helper text', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Ready for automation' })).toBeTruthy());
  const btn = screen.getByRole('button', { name: /start automation \(phase 5\)/i }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  expect(btn.onclick).toBeNull();
  fireEvent.click(btn); // no-op
  expect(
    screen.getByText(
      'Available in Phase 5. This does not submit anything, and does not mean the visa is approved.',
    ),
  ).toBeTruthy();
});

it('when readiness is false the blockers list renders, each with a source or "no recorded source"', async () => {
  const api = await client();
  api.getApplication.mockResolvedValue({
    application: makeApplication(),
    plan: makePlan({
      readyForAutomation: {
        ready: false,
        blockers: [
          { text: 'Passport must be valid for at least 6 months', kind: 'eligibility', source: SRC },
          { text: 'A warning without a source', kind: 'warning', source: null },
        ],
      },
    }),
  });
  renderAt();
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Ready for automation' })).toBeTruthy());
  const ready = screen.getByRole('heading', { level: 2, name: 'Ready for automation' }).closest('section')!;
  const withSource = within(ready).getByText('Passport must be valid for at least 6 months').closest('li')!;
  expect(within(withSource).getByRole('link', { name: /official source/i })).toBeTruthy();
  const noSource = within(ready).getByText('A warning without a source').closest('li')!;
  expect(within(noSource).getByText(/no recorded source/i)).toBeTruthy();
});
