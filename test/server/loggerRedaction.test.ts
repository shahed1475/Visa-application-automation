import { expect, it } from 'vitest';
import { REDACT_PATHS } from '../../src/server/logger.js';

const MUST_INCLUDE = [
  'rawValue',
  'raw_value',
  'surname',
  'givenNames',
  'given_names',
  'dateOfBirth',
  'date_of_birth',
  'passportNumber',
  'email',
  'phone',
  'line1',
  'line2',
  'postalCode',
  'postal_code',
  '*.rawValue',
  '*.surname',
  '*.passportNumber',
];

it('redacts every applicant PII key we care about', () => {
  for (const key of MUST_INCLUDE) {
    expect(REDACT_PATHS, `REDACT_PATHS should contain ${key}`).toContain(key);
  }
});

it('does not use a bare over-broad "number" key', () => {
  // a top-level `number` would redact unrelated numeric fields (counts, ports…)
  expect(REDACT_PATHS).not.toContain('number');
});
