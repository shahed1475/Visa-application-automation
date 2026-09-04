import { describe, expect, it } from 'vitest';
import { portalInputSchema } from '../../src/shared/schemas.js';
import { isHttpUrl } from '../../src/shared/url.js';

const valid = {
  name: 'Example Visa',
  url: 'https://example.com/apply',
  portalType: 'evisa' as const,
};

describe('isHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('https://example.com/x?y=1')).toBe(true);
  });
  it('rejects non-http protocols and garbage', () => {
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('example.com')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});

describe('portalInputSchema', () => {
  it('accepts a minimal valid portal and defaults enabled to true', () => {
    const parsed = portalInputSchema.parse(valid);
    expect(parsed.enabled).toBe(true);
    expect(parsed.country).toBeNull();
  });
  it('rejects a non-http URL', () => {
    const r = portalInputSchema.safeParse({ ...valid, url: 'ftp://x.com' });
    expect(r.success).toBe(false);
  });
  it('rejects an empty name', () => {
    expect(portalInputSchema.safeParse({ ...valid, name: '  ' }).success).toBe(false);
  });
  it('rejects an unknown portalType', () => {
    expect(portalInputSchema.safeParse({ ...valid, portalType: 'other' }).success).toBe(false);
  });
  it('trims name and coerces blank optionals to null', () => {
    const parsed = portalInputSchema.parse({ ...valid, name: '  Trimmed  ', country: '  ' });
    expect(parsed.name).toBe('Trimmed');
    expect(parsed.country).toBeNull();
  });
});
