import { expect, it, describe } from 'vitest';
import {
  sanitizeString,
  sanitizeUrlToPattern,
  sanitizeReport,
  DISCOVERY_VERSION,
  type DiscoveryReportV2,
} from '../../src/server/automation/discovery/observe.js';

describe('sanitizeString', () => {
  it('drops value shapes but keeps field labels', () => {
    expect(sanitizeString('Surname')).toBe('Surname');
    expect(sanitizeString('Passport Number')).toBe('Passport Number');
    expect(sanitizeString('Z1234567')).toBe(''); // passport-like
    expect(sanitizeString('1990-04-12')).toBe(''); // ISO date
    expect(sanitizeString('12/04/1990')).toBe(''); // dd/mm/yyyy
    expect(sanitizeString('john.doe@example.com')).toBe('');
    expect(sanitizeString('998877665544')).toBe(''); // long digit run
    expect(sanitizeString('Enter your 6 digit OTP')).toBe('Enter your 6 digit OTP'); // digits < 4 run
  });

  it('trims surrounding whitespace on kept strings', () => {
    expect(sanitizeString('  Surname  ')).toBe('Surname');
  });

  it('scrubs long low-letter blobs', () => {
    const blob = '::::::::::::::::::::::::::::::::::::::::::::::::';
    expect(sanitizeString(blob)).toBe('');
  });

  it('is idempotent', () => {
    expect(sanitizeString(sanitizeString('Z1234567'))).toBe('');
    expect(sanitizeString(sanitizeString('Surname'))).toBe('Surname');
  });
});

describe('sanitizeUrlToPattern', () => {
  it('masks ids, tokens and query values', () => {
    expect(
      sanitizeUrlToPattern(
        'https://x.gov.in/apply/step/personal?appId=AB1234567&tok=deadbeefcafe',
      ),
    ).toBe('x.gov.in/apply/step/personal?appId=*&tok=*');
    expect(sanitizeUrlToPattern('https://x.gov.in/app/9f8e7d6c5b4a3210/edit')).toBe(
      'x.gov.in/app/*/edit',
    );
  });

  it('masks long numeric path segments', () => {
    expect(sanitizeUrlToPattern('https://x.gov.in/application/1234567/view')).toBe(
      'x.gov.in/application/*/view',
    );
  });

  it('returns a malformed URL unchanged', () => {
    expect(sanitizeUrlToPattern('not a url')).toBe('not a url');
  });
});

function makeReport(overrides: Partial<DiscoveryReportV2> = {}): DiscoveryReportV2 {
  return {
    url: 'https://x.gov.in/apply/step/personal?appId=AB1234567',
    pageTitle: 'Apply',
    fingerprint: { rendering: 'html', hasViewState: false },
    candidates: [],
    signals: { recaptcha: false },
    discoveryVersion: DISCOVERY_VERSION,
    headings: [],
    groups: [],
    buttons: [],
    requiredIndicators: [],
    selectCatalogue: [],
    stableAttributes: {},
    ...overrides,
  };
}

describe('sanitizeReport', () => {
  it('keeps digit-bearing structural selectors verbatim', () => {
    const out = sanitizeReport(
      makeReport({
        candidates: [
          {
            label: 'Given Names',
            primarySelector: '#ctl00_field1234',
            fallbackSelector: 'input[name="q00012345"]',
            selectorConfidence: 'stable',
            control: 'text',
          },
        ],
        selectCatalogue: [{ selector: '#ctl00_country9999', optionLabels: ['India'] }],
        requiredIndicators: ['Field 1234'],
      }),
    );
    expect(out.candidates[0]?.primarySelector).toBe('#ctl00_field1234');
    expect(out.candidates[0]?.fallbackSelector).toBe('input[name="q00012345"]');
    expect(out.candidates[0]?.label).toBe('Given Names');
    expect(out.selectCatalogue[0]?.selector).toBe('#ctl00_country9999');
    expect(out.requiredIndicators).toEqual(['Field 1234']);
  });

  it('drops an aria-label selector when its label was scrubbed to ""', () => {
    const out = sanitizeReport(
      makeReport({
        candidates: [
          {
            label: 'Z1234567',
            primarySelector: 'input[aria-label="Z1234567"]',
            fallbackSelector: null,
            selectorConfidence: 'fragile',
            control: 'text',
          },
        ],
      }),
    );
    expect(out.candidates[0]?.label).toBe('');
    expect(out.candidates[0]?.primarySelector).toBe('');
    expect(JSON.stringify(out)).not.toContain('Z1234567');
  });

  it('scrubs content strings and reduces the url to a pattern', () => {
    const out = sanitizeReport(
      makeReport({
        pageTitle: 'Application AB1234567',
        headings: ['Personal Details', '1990-04-12'],
        buttons: [{ text: 'Save & Continue', type: 'submit', isNavCandidate: true }],
        groups: [{ name: 'sex', kind: 'radio', options: ['Male', 'Female'] }],
      }),
    );
    expect(out.url).toBe('x.gov.in/apply/step/personal?appId=*');
    expect(out.pageTitle).toBe('');
    expect(out.headings).toEqual(['Personal Details']);
    expect(out.groups[0]?.options).toEqual(['Male', 'Female']);
    expect(out.discoveryVersion).toBe(DISCOVERY_VERSION);
  });
});
