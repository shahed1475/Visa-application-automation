// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DocumentDetailPage } from '../../src/web/src/pages/Documents/DocumentDetailPage';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    applicantId: 'a1',
    kind: 'passport',
    originalName: 'passport.jpg',
    mimeType: 'image/jpeg',
    status: 'extracted',
    classificationConfidence: 0.97,
    latestExtractionMethod: 'mrz',
    latestOcrMeanConfidence: 91,
    pageCount: null,
    errorCode: null,
    byteSize: 1234,
    runCount: 1,
    fieldCount: 4,
    createdAt: '2026-09-04T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
    runs: [
      {
        id: 'r1',
        attempt: 1,
        method: 'mrz',
        status: 'completed',
        mrzDetected: true,
        mrzValid: true,
        ocrMeanConfidence: 91,
        fieldCount: 4,
        errorCode: null,
        engineDetail: 'test-engine',
        createdAt: '2026-09-04T00:00:00Z',
      },
    ],
    fields: [
      {
        id: 'f1',
        fieldPath: 'passport.number',
        value: 'A01234567',
        raw: 'A01234567',
        source: 'passport_mrz',
        confidence: 0.99,
        checkDigitOk: true,
        normalizationNote: null,
        status: 'applied',
        extractionRunId: 'r1',
        inProfile: true,
        profileMatches: true,
        verified: false,
      },
      {
        id: 'f2',
        fieldPath: 'identity.surname',
        value: 'JONES',
        raw: 'JONES',
        source: 'passport_mrz',
        confidence: 0.95,
        checkDigitOk: null,
        normalizationNote: null,
        status: 'held',
        extractionRunId: 'r1',
        inProfile: false,
        profileMatches: false,
        verified: false,
      },
      {
        id: 'f3',
        fieldPath: 'identity.givenNames',
        value: 'MARIA',
        raw: 'MARIA',
        source: 'passport_ocr',
        confidence: 0.4,
        checkDigitOk: null,
        normalizationNote: null,
        status: 'dismissed',
        extractionRunId: 'r1',
        inProfile: false,
        profileMatches: false,
        verified: false,
      },
      {
        id: 'f4',
        fieldPath: 'identity.dateOfBirth',
        value: null,
        raw: '999999',
        source: 'passport_mrz',
        confidence: 0.3,
        checkDigitOk: false,
        normalizationNote: 'MRZ date did not resolve to a real calendar date',
        status: 'held',
        extractionRunId: 'r1',
        inProfile: false,
        profileMatches: false,
        verified: false,
      },
    ],
    ...overrides,
  };
}

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    getDocument: vi.fn(),
    extractDocument: vi.fn().mockResolvedValue({ document: {} }),
    applyDocumentField: vi.fn().mockResolvedValue({ document: {} }),
    dismissDocumentField: vi.fn().mockResolvedValue({ document: {} }),
    deleteDocument: vi.fn().mockResolvedValue({ deleted: true }),
    setFieldMeta: vi.fn().mockResolvedValue({ fieldMeta: {} }),
    documentFileUrl: vi.fn((id: string) => `/api/documents/${id}/file`),
  },
}));

type Mock = ReturnType<typeof vi.fn>;

async function client() {
  const { api } = await import('../../src/web/src/api/client');
  return api as unknown as Record<
    | 'getDocument'
    | 'extractDocument'
    | 'applyDocumentField'
    | 'dismissDocumentField'
    | 'deleteDocument'
    | 'setFieldMeta'
    | 'documentFileUrl',
    Mock
  >;
}

function renderAt(id = 'd1') {
  return render(
    <MemoryRouter initialEntries={[`/documents/${id}`]}>
      <Routes>
        <Route path="/documents/:id" element={<DocumentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  (await client()).getDocument.mockResolvedValue({ document: makeDetail() });
});
afterEach(() => cleanup());

it('renders the header — kind badge, method, classification as a labelled heuristic', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  expect(screen.getByText('passport')).toBeTruthy();
  expect(screen.getByText('Method MRZ')).toBeTruthy();
  const cls = screen.getByText(/Classification:/);
  const text = (cls.textContent ?? '').toLowerCase();
  expect(text).toContain('heuristic');
  expect(text).toContain('0.97');
  expect(text).not.toContain('97%');
  expect(text).not.toContain('probability');
});

it('classification for a non-passport reads "not a passport", not "unknown · 0.90"', async () => {
  const api = await client();
  api.getDocument.mockResolvedValue({
    document: makeDetail({ kind: 'unknown', classificationConfidence: 0.9, fields: [] }),
  });
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  const cls = screen.getByText(/Classification:/);
  expect((cls.textContent ?? '').toLowerCase()).toContain('not a passport');
});

it('shows the uploaded image pointing at the document file URL', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());
  expect(screen.getByRole('img').getAttribute('src')).toBe('/api/documents/d1/file');
});

it('lists the extraction run', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  const runs = screen.getByText(/#1/).textContent ?? '';
  expect(runs).toContain('#1');
  expect(runs).toContain('MRZ valid');
  expect(runs).toContain('4 fields');
});

it('renders the seven table columns', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  for (const h of ['Field', 'Extracted value', 'Source', 'Confidence', 'In profile?', 'Verified?', 'Actions']) {
    expect(screen.getByRole('columnheader', { name: h })).toBeTruthy();
  }
});

it('shows the raw value + note for a normalization-failed row, value cell dash', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  const row = screen.getByText('identity.dateOfBirth').closest('tr')!;
  expect(within(row).getByText(/999999/)).toBeTruthy();
  expect(within(row).getByText(/did not resolve/)).toBeTruthy();
  expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
});

it('renders confidence as a labelled heuristic, never a correctness claim', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  const row = screen.getByText('passport.number').closest('tr')!;
  const text = row.textContent ?? '';
  expect(text).toContain('0.99');
  expect(text.toLowerCase()).toContain('check digit');
  expect(text.toLowerCase()).not.toContain('correct');
  expect(text.toLowerCase()).not.toContain('probability');
});

it('Confirm on an applied+matching+unverified field calls setFieldMeta then reloads', async () => {
  const api = await client();
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  const row = screen.getByText('passport.number').closest('tr')!;
  const confirm = within(row).getByRole('button', { name: /confirm/i });
  expect(confirm.hasAttribute('disabled')).toBe(false);
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(api.setFieldMeta).toHaveBeenCalledWith('a1', {
      fieldPath: 'passport.number',
      verified: true,
    }),
  );
  await waitFor(() => expect(api.getDocument).toHaveBeenCalledTimes(2));
});

it('Confirm is disabled for a held field whose value is not in the profile', async () => {
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  const row = screen.getByText('identity.surname').closest('tr')!;
  expect(within(row).getByRole('button', { name: /confirm/i }).hasAttribute('disabled')).toBe(true);
});

it('Apply on a held row calls applyDocumentField', async () => {
  const api = await client();
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  const row = screen.getByText('identity.surname').closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: /apply/i }));
  await waitFor(() =>
    expect(api.applyDocumentField).toHaveBeenCalledWith('d1', 'identity.surname'),
  );
});

it('Dismiss on a non-dismissed row calls dismissDocumentField', async () => {
  const api = await client();
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  const row = screen.getByText('passport.number').closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: /dismiss/i }));
  await waitFor(() =>
    expect(api.dismissDocumentField).toHaveBeenCalledWith('d1', 'passport.number'),
  );
});

it('Re-extract calls extractDocument then reloads', async () => {
  const api = await client();
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /re-extract/i }));
  await waitFor(() => expect(api.extractDocument).toHaveBeenCalledWith('d1'));
});

it('Delete confirms, deletes and navigates to /documents', async () => {
  const api = await client();
  window.confirm = () => true;
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /delete/i }));
  await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith('d1'));
  expect(navigateSpy).toHaveBeenCalledWith('/documents');
});

it('a failed Re-extract shows an error banner but keeps the review view on screen', async () => {
  const api = await client();
  api.extractDocument.mockRejectedValueOnce(new Error('Re-extraction failed'));
  renderAt();
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /re-extract/i }));
  await waitFor(() => expect(screen.getByText('Re-extraction failed')).toBeTruthy());
  // the runs list + fields table are still rendered
  expect(screen.getByText('Extraction runs')).toBeTruthy();
  expect(screen.getByText('passport.number')).toBeTruthy();
});

it('a failed extraction shows the friendly error message', async () => {
  const api = await client();
  api.getDocument.mockResolvedValue({
    document: makeDetail({ status: 'failed', errorCode: 'pdf_encrypted', fields: [] }),
  });
  renderAt();
  await waitFor(() => expect(screen.getByText(/password-protected/i)).toBeTruthy());
});

it('an unlinked document disables Re-extract and shows a hint', async () => {
  const api = await client();
  api.getDocument.mockResolvedValue({ document: makeDetail({ applicantId: null }) });
  renderAt();
  await waitFor(() => expect(screen.getByText(/isn't linked to an applicant/i)).toBeTruthy());
  expect(screen.getByRole('button', { name: /re-extract/i }).hasAttribute('disabled')).toBe(true);
});
