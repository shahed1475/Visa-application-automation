// Shared test fixtures for the application-plan engine (Tasks 11, 12, 19, 20). Entirely
// synthetic data -- invented "RANA / MITHU" holder, no real person or document.
import type {
  DocumentCoverage,
  FlatApplicant,
  Selection,
} from '../../src/shared/application/types.js';

/** A fully-populated, entirely synthetic `FlatApplicant`: adult BGD national, valid passport
 *  several years from expiry, married, one in-country host reference, nothing pre-verified.
 *  Every field on every section is non-null; tests needing a `null` build their own literal or
 *  pass `overrides` rather than mutate this shared fixture. */
export function syntheticApplicant(overrides?: Partial<FlatApplicant>): FlatApplicant {
  const base: FlatApplicant = {
    identity: {
      surname: 'RANA',
      givenNames: 'MITHU',
      fullNameAsInPassport: 'RANA MITHU',
      dateOfBirth: '1990-05-20',
      sex: 'M',
      placeOfBirth: 'Dhaka',
      nationality: 'BGD',
      otherNationalities: 'None',
      religion: 'Islam',
      education: 'Bachelor of Commerce',
      nationalId: 'BGD1234567890',
      visibleMarks: 'None',
      nationalityAtBirth: 'BGD',
    },
    passport: {
      documentType: 'ordinary',
      number: 'BG1234567',
      issuingState: 'BGD',
      issueDate: '2020-01-01',
      expiryDate: '2030-01-01',
      placeOfIssue: 'Dhaka',
      issuingAuthority: 'Department of Immigration and Passports, Dhaka',
    },
    contact: {
      email: 'rana.mithu@example.com',
      phone: '+8801700000000',
      altPhone: '+8801800000000',
    },
    address: {
      line1: 'House 12, Road 4, Dhanmondi',
      line2: 'Block C',
      city: 'Dhaka',
      region: 'Dhaka Division',
      postalCode: '1209',
      country: 'BGD',
    },
    family: {
      fatherName: 'Rana Karim',
      fatherNationality: 'BGD',
      fatherPrevNationality: 'BGD',
      fatherPlaceOfBirth: 'Dhaka',
      motherName: 'Rana Begum',
      motherNationality: 'BGD',
      motherPrevNationality: 'BGD',
      motherPlaceOfBirth: 'Dhaka',
      maritalStatus: 'married',
      spouseName: 'Mithu Sultana',
      spouseNationality: 'BGD',
      spousePrevNationality: 'BGD',
      spousePlaceOfBirth: 'Dhaka',
      pakistanAncestry: 'no',
    },
    occupation: {
      occupation: 'Software Engineer',
      employerName: 'Dhaka Software House Ltd.',
      employerAddress: 'Gulshan Avenue, Dhaka',
      designation: 'Senior Engineer',
      militaryPolice: 'no',
    },
    travel: [],
    references: [
      {
        id: 'ref-host-1',
        applicantId: 'applicant-1',
        sortOrder: 0,
        kind: 'in_country_host',
        name: 'Host Person',
        relationship: 'friend',
        organization: null,
        phone: '+911234567890',
        email: 'host@example.com',
        address: 'New Delhi, India',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    fieldMeta: [],
  };
  return { ...base, ...overrides };
}

/** Default synthetic selection: a regular tourist visa application to India. */
export function syntheticSelection(overrides?: Partial<Selection>): Selection {
  const base: Selection = {
    destination: 'IND',
    applicationMode: 'regular',
    categoryId: 'regular.tourist',
    purpose: 'recreation',
    entryType: 'single',
    intendedArrivalDate: '2027-01-15',
    intendedStayDays: 10,
    portOfArrival: 'Delhi',
  };
  return { ...base, ...overrides };
}

export function emptyDocumentCoverage(): DocumentCoverage {
  return { fieldCoverage: {}, documents: [] };
}

export function coverageWith(fieldPaths: string[]): DocumentCoverage {
  return {
    fieldCoverage: Object.fromEntries(fieldPaths.map((p) => [p, { applied: true, verified: true }])),
    documents: [],
  };
}
