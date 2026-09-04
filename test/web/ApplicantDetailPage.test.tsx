// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ApplicantDetailPage } from '../../src/web/src/pages/Applicants/ApplicantDetailPage';

vi.mock('../../src/web/src/api/client', () => {
  const detail = {
    id: 'a1', displayName: 'Aisha Khan', status: 'draft',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    identity: { surname: 'Khan', givenNames: 'Aisha', fullNameAsInPassport: null, dateOfBirth: '2000-01-01', sex: 'F', placeOfBirth: 'Dhaka', nationality: 'Bangladeshi', otherNationalities: null },
    passport: { documentType: 'P', number: 'AB1234567', issuingState: 'BGD', issueDate: '2020-01-01', expiryDate: '2030-01-01', placeOfIssue: 'Dhaka', issuingAuthority: null },
    contact: { email: 'a@b.co', phone: null, altPhone: null },
    address: { line1: null, line2: null, city: null, region: null, postalCode: null, country: null },
    travel: [], references: [],
    fieldMeta: [
      { id: 'm1', applicantId: 'a1', fieldPath: 'passport.number', source: 'passport_mrz', confidence: 0.99, rawValue: null, verified: false, verifiedAt: null, documentId: 'doc1', createdAt: 't', updatedAt: 't' },
      { id: 'm2', applicantId: 'a1', fieldPath: 'identity.surname', source: 'manual', confidence: null, rawValue: null, verified: false, verifiedAt: null, documentId: null, createdAt: 't', updatedAt: 't' },
    ],
    completeness: { overall: 0.55, bySection: { identity: 1, passport: 1, contact: 0.5, address: 0, travel: 0, references: 0 } },
    verification: { verified: 1, total: 10, ratio: 0.1, label: 'partial', bySection: { identity: { verified: 1, total: 6 }, passport: { verified: 0, total: 6 }, contact: { verified: 0, total: 1 }, address: { verified: 0, total: 0 }, travel: { verified: 0, total: 0 }, references: { verified: 0, total: 0 } } },
    warnings: [],
  };
  return {
    api: {
      getApplicant: vi.fn().mockResolvedValue({ applicant: detail }),
      updateApplicant: vi.fn().mockResolvedValue({ applicant: detail }),
      setFieldMeta: vi.fn().mockResolvedValue({ fieldMeta: {} }),
      deleteApplicant: vi.fn(),
      duplicateApplicant: vi.fn().mockResolvedValue({ applicant: { id: 'copy' } }),
      addTravel: vi.fn(), updateTravel: vi.fn(), deleteTravel: vi.fn(),
      addReference: vi.fn(), updateReference: vi.fn(), deleteReference: vi.fn(),
      listDocuments: vi.fn().mockResolvedValue({ documents: [{ id: 'doc1', applicantId: 'a1', kind: 'passport', originalName: 'passport.jpg', status: 'extracted', fieldCount: 6, runCount: 1, mimeType: 'image/jpeg', createdAt: 't', updatedAt: 't' }] }),
      uploadDocument: vi.fn().mockResolvedValue({ document: { id: 'doc9' } }),
      extractDocument: vi.fn().mockResolvedValue({ document: { id: 'doc9' } }),
    },
  };
});

// Module-scope fixture mirroring the `detail` inlined in the vi.mock factory
// (the factory's copy is not visible outside it). Used by the describe block below.
const detail = {
  id: 'a1', displayName: 'Aisha Khan', status: 'draft',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  identity: { surname: 'Khan', givenNames: 'Aisha', fullNameAsInPassport: null, dateOfBirth: '2000-01-01', sex: 'F', placeOfBirth: 'Dhaka', nationality: 'Bangladeshi', otherNationalities: null },
  passport: { documentType: 'P', number: 'AB1234567', issuingState: 'BGD', issueDate: '2020-01-01', expiryDate: '2030-01-01', placeOfIssue: 'Dhaka', issuingAuthority: null },
  contact: { email: 'a@b.co', phone: null, altPhone: null },
  address: { line1: null, line2: null, city: null, region: null, postalCode: null, country: null },
  travel: [], references: [],
  fieldMeta: [
    { id: 'm1', applicantId: 'a1', fieldPath: 'passport.number', source: 'passport_mrz', confidence: 0.99, rawValue: null, verified: false, verifiedAt: null, documentId: 'doc1', createdAt: 't', updatedAt: 't' },
    { id: 'm2', applicantId: 'a1', fieldPath: 'identity.surname', source: 'manual', confidence: null, rawValue: null, verified: false, verifiedAt: null, documentId: null, createdAt: 't', updatedAt: 't' },
  ],
  completeness: { overall: 0.55, bySection: { identity: 1, passport: 1, contact: 0.5, address: 0, travel: 0, references: 0 } },
  verification: { verified: 1, total: 10, ratio: 0.1, label: 'partial', bySection: { identity: { verified: 1, total: 6 }, passport: { verified: 0, total: 6 }, contact: { verified: 0, total: 1 }, address: { verified: 0, total: 0 }, travel: { verified: 0, total: 0 }, references: { verified: 0, total: 0 } } },
  warnings: [],
};

function renderAt(id = 'a1') {
  return render(
    <MemoryRouter initialEntries={[`/applicants/${id}`]}>
      <Routes>
        <Route path="/applicants/:id" element={<ApplicantDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('loads and renders the four sections and the completeness header', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('Aisha Khan')).toBeTruthy());
  expect(screen.getByText('Identity')).toBeTruthy();
  expect(screen.getByText('Passport')).toBeTruthy();
  expect(screen.getByText('Contact')).toBeTruthy();
  expect(screen.getByText('Address')).toBeTruthy();
  expect(screen.getByText(/55%|complete/i)).toBeTruthy();
  expect(screen.getByText('Khan')).toBeTruthy();
});

it('editing identity and saving calls updateApplicant with a section patch', async () => {
  renderAt();
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() => expect(screen.getByText('Khan')).toBeTruthy());
  fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0]!); // Identity card
  fireEvent.change(screen.getByLabelText(/surname/i), { target: { value: 'Rahman' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() =>
    expect(api.updateApplicant).toHaveBeenCalledWith('a1', expect.objectContaining({ identity: expect.objectContaining({ surname: 'Rahman' }) })),
  );
});

it('an invalid date blocks the save (no API call)', async () => {
  renderAt();
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() => expect(screen.getByText('Khan')).toBeTruthy());
  fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0]!);
  fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '2000/01/01' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(screen.getByText(/YYYY-MM-DD/i)).toBeTruthy());
  expect(api.updateApplicant).not.toHaveBeenCalled();
});

it('toggling a field verify control calls setFieldMeta', async () => {
  renderAt();
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() => expect(screen.getByText('Khan')).toBeTruthy());
  // Every filled field gets a toggle; the first is identity.surname, which the
  // fixture already marks verified, so this asserts the un-verify direction.
  const confirmButtons = screen.getAllByRole('button', { name: /confirm|verified/i });
  fireEvent.click(confirmButtons[0]!);
  await waitFor(() => expect(api.setFieldMeta).toHaveBeenCalled());
  expect((api.setFieldMeta as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual(
    expect.objectContaining({ fieldPath: expect.stringMatching(/^identity\./), verified: expect.any(Boolean) }),
  );
});

it('surfaces a failed verify toggle instead of floating the rejection', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: PromiseRejectionEvent) => {
    e.preventDefault();
    unhandled.push(e.reason);
  };
  window.addEventListener('unhandledrejection', onUnhandled);
  try {
    const { api } = await import('../../src/web/src/api/client');
    (api.setFieldMeta as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Field meta write failed'),
    );
    renderAt();
    await waitFor(() => expect(screen.getByText('Khan')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: /confirm|verified/i })[0]!);

    await waitFor(() => expect(screen.getByText('Field meta write failed')).toBeTruthy());
    // the message lands in the owning section card's inline error slot
    expect(screen.getByRole('alert').textContent).toContain('Field meta write failed');
    // the page itself stays rendered (not replaced by the page-level error branch)
    expect(screen.getByText('Aisha Khan')).toBeTruthy();

    await new Promise((r) => setTimeout(r, 0));
    expect(unhandled).toEqual([]);
  } finally {
    window.removeEventListener('unhandledrejection', onUnhandled);
  }
});

describe('document provenance', () => {
  it('shows a provenance hint with confidence + a link to the source document on a non-manual field', async () => {
    renderAt();
    await waitFor(() => expect(screen.getByText('Aisha Khan')).toBeTruthy());
    const row = screen.getByText('Passport number').closest('.section-card__row') as HTMLElement;
    const hint = row.querySelector('.provenance-hint') as HTMLElement;
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('Passport MRZ');
    expect(hint.textContent).toContain('0.99');
    const link = within(hint).getByRole('link', { name: /source document/i });
    expect(link.getAttribute('href')).toBe('/documents/doc1');
  });

  it('renders no provenance hint on a manual field', async () => {
    renderAt();
    await waitFor(() => expect(screen.getByText('Aisha Khan')).toBeTruthy());
    const row = screen.getByText('Surname').closest('.section-card__row') as HTMLElement;
    expect(row.querySelector('.provenance-hint')).toBeNull();
  });

  it('renders a Documents subsection listing the applicant documents', async () => {
    renderAt();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Documents' })).toBeTruthy());
    const link = screen.getByRole('link', { name: 'passport.jpg' });
    expect(link.getAttribute('href')).toBe('/documents/doc1');
  });
});

describe('travel & references', () => {
  const withChildren = {
    ...detail,
    travel: [{ id: 't1', applicantId: 'a1', sortOrder: 0, tripType: 'tourism', purpose: 'Holiday', destinationCountry: 'FR', cities: null, arrivalDate: '2026-05-01', departureDate: null, portOfEntry: null, portOfExit: null, accommodation: null, previousTravel: null, notes: null, createdAt: '', updatedAt: '' }],
    references: [{ id: 'r1', applicantId: 'a1', sortOrder: 0, kind: 'employer', name: 'ACME', relationship: null, organization: 'ACME Ltd', phone: null, email: null, address: null, createdAt: '', updatedAt: '' }],
  };

  it('renders travel + reference cards and calls the API on add/delete', async () => {
    const { api } = await import('../../src/web/src/api/client');
    (api.getApplicant as ReturnType<typeof vi.fn>).mockResolvedValue({ applicant: withChildren });
    (api.addTravel as ReturnType<typeof vi.fn>).mockResolvedValue({ travel: {} });
    (api.deleteReference as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted: true });
    renderAt();
    await waitFor(() => expect(screen.getByText('Holiday')).toBeTruthy());
    expect(screen.getByText('ACME')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /add travel record/i }));
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: 'Conference' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(api.addTravel).toHaveBeenCalledWith('a1', expect.objectContaining({ purpose: 'Conference' })),
    );

    window.confirm = () => true;
    fireEvent.click(screen.getAllByRole('button', { name: /delete/i }).find((b) => b.closest('.reference-card'))!);
    await waitFor(() => expect(api.deleteReference).toHaveBeenCalledWith('a1', 'r1'));
  });
});
