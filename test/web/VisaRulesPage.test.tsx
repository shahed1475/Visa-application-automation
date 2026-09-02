// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VisaRulesPage } from '../../src/web/src/pages/VisaRules/VisaRulesPage';

vi.mock('../../src/shared/visa-kb/index', () => {
  const src = { officialUrl: 'https://indianvisaonline.gov.in/evisa/', retrievedAt: '2026-09-02' };
  const mk = (id: string, applicationMode: string, category: string, displayName: string) => ({
    id, applicationMode, category, displayName, subCategory: null, officialCode: null,
    purpose: ['recreation'], validity: { amount: 30, unit: 'days', from: 'first_arrival' },
    entries: 'multiple', stayLimitations: {}, extendable: false, convertible: false,
    applicationTiming: {}, travelRequirements: {},
    requiredDocuments: [{ id: 'passport_bio_page', label: 'Passport bio page' }],
    optionalDocuments: [], specialConditions: [], restrictions: [], source: src, lastVerified: '2026-09-02',
  });
  const evisa = [mk('evisa.tourist.30d', 'evisa', 'tourist', 'e-Tourist 30d')];
  const regular = [mk('regular.tourist', 'regular', 'tourist', 'Tourist (paper)')];
  const all = [...evisa, ...regular];
  return {
    getVersion: () => ({ schemaVersion: 1, kbVersion: '2026-09-02', revisionDate: '2026-09-02', destination: 'IND' }),
    getCategoriesForMode: (m: string) => (m === 'evisa' ? evisa : regular),
    getCategory: (id: string) => all.find((c) => c.id === id) ?? null,
    getDocumentRequirements: (id: string) => {
      const c = all.find((x) => x.id === id);
      return c ? { required: c.requiredDocuments, optional: c.optionalDocuments } : null;
    },
    checkEligibility: (_n: string, m: string, id: string) =>
      id === 'evisa.tourist.30d'
        ? { status: 'eligible', conditions: [], basis: 'listed', source: src, lastVerified: '2026-09-02' }
        : { status: 'unknown', reason: 'no eligibility rule recorded' },
  };
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('renders the KB version and the e-Visa category list by default', async () => {
  render(<MemoryRouter><VisaRulesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/KB version 2026-09-02/i)).toBeTruthy());
  expect(screen.getByText('e-Tourist 30d')).toBeTruthy();
});

it('the mode toggle switches to the Regular list', async () => {
  render(<MemoryRouter><VisaRulesPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /regular \/ paper/i }));
  await waitFor(() => expect(screen.getByText('Tourist (paper)')).toBeTruthy());
  expect(screen.queryByText('e-Tourist 30d')).toBeNull();
});

it('selecting a category shows its documents, eligibility, and an external source link', async () => {
  render(<MemoryRouter><VisaRulesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByText('e-Tourist 30d'));
  await waitFor(() => expect(screen.getByText('Passport bio page')).toBeTruthy());
  expect(screen.getByText(/eligible/i)).toBeTruthy();
  const link = screen.getByRole('link', { name: /official source/i }) as HTMLAnchorElement;
  expect(link.href).toContain('indianvisaonline.gov.in');
});

it('a category with no eligibility rule shows the "no rule recorded" message, never "eligible"', async () => {
  render(<MemoryRouter><VisaRulesPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /regular \/ paper/i }));
  fireEvent.click(await screen.findByText('Tourist (paper)'));
  await waitFor(() => expect(screen.getByText(/no Bangladesh eligibility rule recorded/i)).toBeTruthy());
  expect(screen.queryByText(/^eligible$/i)).toBeNull();
});
