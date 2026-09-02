// @vitest-environment jsdom
// Deliberately does NOT mock src/shared/visa-kb/index — the sibling
// VisaRulesPage.test.tsx mocks the whole module, so nothing there would catch the
// page and the shipped knowledge base drifting apart (a renamed export, a JSON
// file that stops loading under the bundler, a schema change the loader rejects).
// This file renders against the real KB.
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VisaRulesPage } from '../../src/web/src/pages/VisaRules/VisaRulesPage';
import { getVersion } from '../../src/shared/visa-kb/index';

afterEach(() => cleanup());

it('renders real category names and the shipped KB version, with no module mock', async () => {
  render(<MemoryRouter><VisaRulesPage /></MemoryRouter>);

  // A displayName that exists only in the shipped evisa-categories.json.
  await waitFor(() => expect(screen.getByText('e-Tourist Visa — 30 days')).toBeTruthy());

  const { kbVersion } = getVersion();
  expect(kbVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(screen.getByText(new RegExp(`KB version ${kbVersion}`, 'i'))).toBeTruthy();
});

it('the Regular list and a real detail panel come from the shipped KB', async () => {
  render(<MemoryRouter><VisaRulesPage /></MemoryRouter>);

  fireEvent.click(screen.getByRole('button', { name: /regular \/ paper/i }));
  const tourist = await screen.findByText('Tourist Visa');
  fireEvent.click(tourist);

  // Real seeded data: the required-documents list and the Bangladesh eligibility
  // record both have to resolve through the real loader.
  await waitFor(() =>
    expect(screen.getByText(/Recent colour photograph to Indian visa specification/i)).toBeTruthy(),
  );
  expect(screen.getByRole('link', { name: /official source/i })).toBeTruthy();
});
