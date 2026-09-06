import { expect, it, describe } from 'vitest';
import {
  sanitizeString,
  sanitizeUrlToPattern,
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
