import { describe, expect, it } from 'vitest';
import { uploadMetaSchema, fieldPathBodySchema } from '../../../src/shared/documents/schemas.js';

describe('fieldPathBodySchema', () => {
  it('accepts a valid applicant field path', () => {
    expect(fieldPathBodySchema.parse({ fieldPath: 'passport.number' })).toEqual({
      fieldPath: 'passport.number',
    });
  });

  it('trims before validating', () => {
    expect(fieldPathBodySchema.parse({ fieldPath: '  identity.surname  ' })).toEqual({
      fieldPath: 'identity.surname',
    });
  });

  it('rejects an upper-case-initial segment', () => {
    expect(fieldPathBodySchema.safeParse({ fieldPath: 'Identity.Surname' }).success).toBe(false);
  });

  it('rejects a traversal-looking path', () => {
    expect(fieldPathBodySchema.safeParse({ fieldPath: '../x' }).success).toBe(false);
  });

  it('rejects a missing field path', () => {
    expect(fieldPathBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('uploadMetaSchema', () => {
  it('accepts an empty body', () => {
    expect(uploadMetaSchema.parse({})).toEqual({});
  });

  it('accepts a non-empty applicantId', () => {
    expect(uploadMetaSchema.parse({ applicantId: 'abc' })).toEqual({ applicantId: 'abc' });
  });

  it('rejects an empty applicantId', () => {
    expect(uploadMetaSchema.safeParse({ applicantId: '' }).success).toBe(false);
  });
});
