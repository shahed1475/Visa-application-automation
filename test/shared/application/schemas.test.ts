import { describe, expect, it } from 'vitest';
import type { ApplicationPlan } from '../../../src/shared/application/types.js';
import {
  selectionSchema,
  applicationCreateSchema,
  applicationPutSchema,
  applicationFieldValueSchema,
} from '../../../src/shared/application/schemas.js';

// Compile-only sanity check: types.ts has no other importer yet in this task, so
// without this, a typo in types.ts would not fail `npm run typecheck`.
const _sanity: ApplicationPlan | undefined = undefined;
void _sanity;

const FULL_VALID_SELECTION = {
  destination: 'IND',
  applicationMode: 'evisa',
  categoryId: 'evisa.tourist.thirty_day',
  purpose: 'sightseeing',
  entryType: 'double',
  intendedArrivalDate: '2026-10-01',
  intendedStayDays: 30,
  portOfArrival: 'Delhi',
} as const;

describe('selectionSchema', () => {
  it('accepts a full valid selection', () => {
    const r = selectionSchema.safeParse(FULL_VALID_SELECTION);
    expect(r.success).toBe(true);
  });

  it('rejects an unknown applicationMode', () => {
    expect(
      selectionSchema.safeParse({ ...FULL_VALID_SELECTION, applicationMode: 'bogus' }).success,
    ).toBe(false);
  });

  it('rejects an empty categoryId', () => {
    expect(selectionSchema.safeParse({ ...FULL_VALID_SELECTION, categoryId: '' }).success).toBe(false);
    expect(
      selectionSchema.safeParse({ applicationMode: 'evisa', categoryId: '   ' }).success,
    ).toBe(false);
  });

  it('rejects an unknown purpose', () => {
    expect(selectionSchema.safeParse({ ...FULL_VALID_SELECTION, purpose: 'vacation' }).success).toBe(false);
  });

  it('rejects an unknown entryType', () => {
    expect(selectionSchema.safeParse({ ...FULL_VALID_SELECTION, entryType: 'triple' }).success).toBe(false);
  });

  it('accepts only applicationMode + categoryId, all else omitted', () => {
    const r = selectionSchema.safeParse({ applicationMode: 'regular', categoryId: 'regular.business' });
    expect(r.success).toBe(true);
  });

  it('accepts explicit null for the optional fields', () => {
    const r = selectionSchema.safeParse({
      applicationMode: 'evisa',
      categoryId: 'evisa.tourist.thirty_day',
      destination: null,
      purpose: null,
      entryType: null,
      intendedArrivalDate: null,
      intendedStayDays: null,
      portOfArrival: null,
    });
    expect(r.success).toBe(true);
  });

  it('rejects a malformed date', () => {
    expect(
      selectionSchema.safeParse({ ...FULL_VALID_SELECTION, intendedArrivalDate: '2026-13-40' }).success,
    ).toBe(false);
  });

  it('rejects a non-integer or negative intendedStayDays', () => {
    expect(
      selectionSchema.safeParse({ ...FULL_VALID_SELECTION, intendedStayDays: 1.5 }).success,
    ).toBe(false);
    expect(
      selectionSchema.safeParse({ ...FULL_VALID_SELECTION, intendedStayDays: -3 }).success,
    ).toBe(false);
    expect(
      selectionSchema.safeParse({ ...FULL_VALID_SELECTION, intendedStayDays: 0 }).success,
    ).toBe(false);
  });
});

describe('applicationCreateSchema', () => {
  it('same required-field behavior as selectionSchema', () => {
    expect(applicationCreateSchema.safeParse(FULL_VALID_SELECTION).success).toBe(true);
    expect(
      applicationCreateSchema.safeParse({ applicationMode: 'evisa', categoryId: 'evisa.tourist.thirty_day' })
        .success,
    ).toBe(true);
    expect(applicationCreateSchema.safeParse({ applicationMode: 'evisa' }).success).toBe(false);
    expect(applicationCreateSchema.safeParse({ categoryId: 'evisa.tourist.thirty_day' }).success).toBe(false);
  });
});

describe('applicationPutSchema', () => {
  it('accepts {} — every field optional, including applicationMode/categoryId', () => {
    expect(applicationPutSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a partial single-field patch', () => {
    expect(applicationPutSchema.safeParse({ portOfArrival: 'Mumbai' }).success).toBe(true);
    expect(applicationPutSchema.safeParse({ intendedStayDays: 15 }).success).toBe(true);
  });
});

describe('applicationFieldValueSchema', () => {
  it('accepts a valid application.* field path with value and verified', () => {
    const r = applicationFieldValueSchema.safeParse({
      fieldPath: 'application.purpose',
      value: 'tourism',
      verified: true,
    });
    expect(r.success).toBe(true);
  });

  it('rejects a fieldPath that does not start with application.', () => {
    expect(
      applicationFieldValueSchema.safeParse({ fieldPath: 'identity.surname', value: 'x' }).success,
    ).toBe(false);
  });

  it('rejects a malformed path (uppercase-initial segment)', () => {
    expect(applicationFieldValueSchema.safeParse({ fieldPath: 'Bad.Path' }).success).toBe(false);
  });

  it('accepts value: null and value omitted', () => {
    expect(
      applicationFieldValueSchema.safeParse({ fieldPath: 'application.purpose', value: null }).success,
    ).toBe(true);
    expect(applicationFieldValueSchema.safeParse({ fieldPath: 'application.purpose' }).success).toBe(true);
  });

  it('accepts verified omitted (stays undefined, not coerced)', () => {
    const r = applicationFieldValueSchema.safeParse({ fieldPath: 'application.purpose' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.verified).toBeUndefined();
    }
  });
});
