// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PortalForm } from '../../src/web/src/pages/Settings/PortalForm';

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    createPortal: vi.fn().mockResolvedValue({
      portal: { id: 'new', name: 'New', url: 'https://ok.example' },
    }),
  },
}));

afterEach(() => cleanup());

it('blocks submit and shows an error for a non-http URL', async () => {
  render(<PortalForm onCancel={() => {}} onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText(/portal name/i), {
    target: { value: 'My Portal' },
  });
  fireEvent.change(screen.getByLabelText(/portal url/i), {
    target: { value: 'ftp://bad' },
  });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() =>
    expect(screen.getByText(/valid http\(s\) url/i)).toBeTruthy(),
  );
  expect(api.createPortal).not.toHaveBeenCalled();
});

it('submits a valid new portal', async () => {
  const onSaved = vi.fn();
  render(<PortalForm onCancel={() => {}} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText(/portal name/i), {
    target: { value: 'My Portal' },
  });
  fireEvent.change(screen.getByLabelText(/portal url/i), {
    target: { value: 'https://portal.example/apply' },
  });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() => expect(api.createPortal).toHaveBeenCalledTimes(1));
  expect(onSaved).toHaveBeenCalled();
});
