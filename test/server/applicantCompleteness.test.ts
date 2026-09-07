import { describe, expect, it } from 'vitest';
import {
  computeCompleteness,
  computeVerification,
  collectWarnings,
} from '../../src/server/services/applicantCompleteness.js';

const empty = {
  identity: {
    surname: null, givenNames: null, fullNameAsInPassport: null, dateOfBirth: null, sex: null,
    placeOfBirth: null, nationality: null, otherNationalities: null,
    religion: null, education: null, nationalId: null, visibleMarks: null, nationalityAtBirth: null,
  },
  passport: { documentType: null, number: null, issuingState: null, issueDate: null, expiryDate: null, placeOfIssue: null, issuingAuthority: null },
  contact: { email: null, phone: null, altPhone: null },
  address: { line1: null, line2: null, city: null, region: null, postalCode: null, country: null },
  family: {
    fatherName: null, fatherNationality: null, fatherPrevNationality: null, fatherPlaceOfBirth: null,
    motherName: null, motherNationality: null, motherPrevNationality: null, motherPlaceOfBirth: null,
    maritalStatus: null, spouseName: null, spouseNationality: null, spousePrevNationality: null,
    spousePlaceOfBirth: null, pakistanAncestry: null,
  },
  occupation: { occupation: null, employerName: null, employerAddress: null, designation: null, militaryPolice: null },
  travel: [] as any[],
  references: [] as any[],
  fieldMeta: [] as any[],
};

describe('computeCompleteness', () => {
  it('empty profile is 0 overall and 0 per section', () => {
    const c = computeCompleteness(empty);
    expect(c.overall).toBe(0);
    expect(c.bySection.identity).toBe(0);
    expect(c.bySection.travel).toBe(0);
    expect(c.bySection.references).toBe(0);
  });

  it('a fully filled profile is 1', () => {
    const full = {
      ...empty,
      identity: { ...empty.identity, surname: 'K', givenNames: 'A', dateOfBirth: '2000-01-01', sex: 'F', placeOfBirth: 'Dhaka', nationality: 'Bangladeshi' },
      passport: { ...empty.passport, documentType: 'P', number: 'A1', issuingState: 'BGD', issueDate: '2020-01-01', expiryDate: '2030-01-01' },
      contact: { ...empty.contact, email: 'a@b.co', phone: '123' },
      address: { ...empty.address, line1: '1 St', city: 'Dhaka', country: 'BGD' },
      family: { ...empty.family, fatherName: 'Karim', motherName: 'Amina', maritalStatus: 'married' },
      occupation: { ...empty.occupation, occupation: 'Engineer' },
      travel: [{ purpose: 'Tourism', arrivalDate: '2026-05-01' }],
      references: [{ name: 'Bob' }],
    };
    const c = computeCompleteness(full as any);
    expect(c.bySection.identity).toBe(1);
    expect(c.bySection.passport).toBe(1);
    expect(c.bySection.family).toBe(1);
    expect(c.bySection.occupation).toBe(1);
    expect(c.bySection.travel).toBe(1);
    expect(c.bySection.references).toBe(1);
    expect(c.overall).toBe(1);
  });

  it('counts family/occupation using their small PROFILE_SECTIONS subset', () => {
    const partial = computeCompleteness({
      ...empty,
      family: { ...empty.family, fatherName: 'Karim' }, // 1 of 3 counting fields
      occupation: { ...empty.occupation, occupation: 'Engineer' }, // 1 of 1 counting field
    } as any);
    expect(partial.bySection.family).toBeCloseTo(1 / 3, 5);
    expect(partial.bySection.occupation).toBe(1);
  });

  it('partial identity yields a fraction', () => {
    const c = computeCompleteness({ ...empty, identity: { ...empty.identity, surname: 'K', givenNames: 'A', nationality: 'X' } });
    expect(c.bySection.identity).toBeCloseTo(0.5, 5); // 3 of 6
  });

  it('travel section needs both purpose and arrivalDate', () => {
    expect(computeCompleteness({ ...empty, travel: [{ purpose: 'X' }] as any }).bySection.travel).toBe(0);
    expect(computeCompleteness({ ...empty, travel: [{ purpose: 'X', arrivalDate: '2026-01-01' }] as any }).bySection.travel).toBe(1);
  });
});

describe('computeVerification', () => {
  it('unverified when nothing has a value', () => {
    const v = computeVerification(empty);
    expect(v.label).toBe('unverified');
    expect(v.total).toBe(0);
  });

  it('total counts only non-null canonical fields; verified counts verified meta', () => {
    const d = {
      ...empty,
      identity: { ...empty.identity, surname: 'K', givenNames: 'A' },
      passport: { ...empty.passport, number: 'A1' },
      fieldMeta: [
        { fieldPath: 'identity.surname', verified: true },
        { fieldPath: 'identity.givenNames', verified: false },
      ] as any[],
    };
    const v = computeVerification(d);
    expect(v.total).toBe(3);
    expect(v.verified).toBe(1);
    expect(v.label).toBe('partial');
    expect(v.bySection.identity).toEqual({ verified: 1, total: 2 });
    expect(v.bySection.passport).toEqual({ verified: 0, total: 1 });
  });

  it('verified when every non-null field has a verified meta row', () => {
    const d = {
      ...empty,
      identity: { ...empty.identity, surname: 'K' },
      fieldMeta: [{ fieldPath: 'identity.surname', verified: true }] as any[],
    };
    expect(computeVerification(d).label).toBe('verified');
  });

  it('counts family/occupation fields', () => {
    const d = {
      ...empty,
      family: { ...empty.family, fatherName: 'Karim', motherName: 'Amina' },
      occupation: { ...empty.occupation, occupation: 'Engineer' },
      fieldMeta: [{ fieldPath: 'family.fatherName', verified: true }] as any[],
    };
    const v = computeVerification(d);
    expect(v.bySection.family).toEqual({ verified: 1, total: 2 });
    expect(v.bySection.occupation).toEqual({ verified: 0, total: 1 });
    expect(v.total).toBe(3);
    expect(v.verified).toBe(1);
  });
});

describe('collectWarnings', () => {
  it('flags passport expiry <= issue when both present', () => {
    expect(collectWarnings({ passport: { issueDate: '2020-01-01', expiryDate: '2019-01-01' } as any, travel: [] })).toEqual(
      expect.arrayContaining([expect.stringMatching(/expiry/i)]),
    );
  });
  it('flags a travel record where departure < arrival', () => {
    const w = collectWarnings({ passport: {} as any, travel: [{ arrivalDate: '2026-05-10', departureDate: '2026-05-01' }] as any });
    expect(w.some((s) => /departure/i.test(s))).toBe(true);
  });
  it('no warnings when data is consistent or absent', () => {
    expect(collectWarnings({ passport: {} as any, travel: [] })).toEqual([]);
  });
});
