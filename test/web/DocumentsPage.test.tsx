// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DocumentsPage } from '../../src/web/src/pages/Documents/DocumentsPage';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

// Inlined into the factory (house convention — `vi.mock` is hoisted above consts).
vi.mock('../../src/web/src/api/client', () => ({
  api: {
    listDocuments: vi.fn().mockResolvedValue({
      documents: [
        {
          id: 'd1', applicantId: 'a1', kind: 'passport', originalName: 'passport.jpg',
          mimeType: 'image/jpeg', status: 'extracted', runCount: 1, fieldCount: 7,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
        },
        {
          id: 'd2', applicantId: null, kind: 'unknown', originalName: null,
          mimeType: 'application/pdf', status: 'uploaded', runCount: 0, fieldCount: 0,
          createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z',
        },
      ],
    }),
    listApplicants: vi.fn().mockResolvedValue({
      applicants: [{ id: 'a1', displayName: 'Aisha Khan' }],
    }),
    uploadDocument: vi.fn().mockResolvedValue({ document: { id: 'd9', kind: 'unknown', status: 'uploaded' } }),
    extractDocument: vi.fn().mockResolvedValue({ document: { id: 'd9', kind: 'passport', status: 'extracted' } }),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('renders the document list with kind badge + status', async () => {
  render(<MemoryRouter><DocumentsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());
  expect(screen.getByText('passport')).toBeTruthy();
  expect(screen.getByText('unknown')).toBeTruthy();
  expect(screen.getByText('extracted')).toBeTruthy();
  expect(screen.getByText('uploaded')).toBeTruthy();
});

it('shows an empty state', async () => {
  const { api } = await import('../../src/web/src/api/client');
  (api.listDocuments as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ documents: [] });
  render(<MemoryRouter><DocumentsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/no documents yet/i)).toBeTruthy());
});

it('selecting a file + an applicant then submitting uploads, extracts, and navigates', async () => {
  const { api } = await import('../../src/web/src/api/client');
  render(<MemoryRouter><DocumentsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Aisha Khan')).toBeTruthy());

  const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText(/applicant/i), { target: { value: 'a1' } });
  fireEvent.click(screen.getByRole('button', { name: /upload/i }));

  await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledWith(file, 'a1'));
  await waitFor(() => expect(api.extractDocument).toHaveBeenCalledWith('d9'));
  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/documents/d9'));
});

it('uploading without an applicant skips auto-extract but still navigates', async () => {
  const { api } = await import('../../src/web/src/api/client');
  render(<MemoryRouter><DocumentsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('passport.jpg')).toBeTruthy());

  const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: /upload/i }));

  await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledWith(file, undefined));
  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/documents/d9'));
  expect(api.extractDocument).not.toHaveBeenCalled();
});
