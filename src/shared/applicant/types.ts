export type ApplicantStatus = 'draft' | 'archived';
export type Sex = 'M' | 'F' | 'X';
export type ReferenceKind = 'emergency_contact' | 'employer' | 'in_country_host' | 'sponsor' | 'other';
export type FieldSource = 'manual' | 'imported' | 'system' | 'passport_mrz' | 'passport_ocr' | 'document_ocr';
export type SectionKey =
  | 'identity'
  | 'passport'
  | 'contact'
  | 'address'
  | 'family'
  | 'occupation'
  | 'travel'
  | 'references';
export type MaritalStatus = 'single' | 'married' | 'divorced' | 'widowed';
export type YesNo = 'yes' | 'no';

export interface Identity {
  surname: string | null;
  givenNames: string | null;
  fullNameAsInPassport: string | null;
  dateOfBirth: string | null;
  sex: Sex | null;
  placeOfBirth: string | null;
  nationality: string | null;
  otherNationalities: string | null;
  religion: string | null;
  education: string | null;
  nationalId: string | null;
  visibleMarks: string | null;
  nationalityAtBirth: string | null;
}

export interface Family {
  fatherName: string | null;
  fatherNationality: string | null;
  fatherPrevNationality: string | null;
  fatherPlaceOfBirth: string | null;
  motherName: string | null;
  motherNationality: string | null;
  motherPrevNationality: string | null;
  motherPlaceOfBirth: string | null;
  maritalStatus: MaritalStatus | null;
  spouseName: string | null;
  spouseNationality: string | null;
  spousePrevNationality: string | null;
  spousePlaceOfBirth: string | null;
  pakistanAncestry: YesNo | null;
}

export interface Occupation {
  occupation: string | null;
  employerName: string | null;
  employerAddress: string | null;
  designation: string | null;
  militaryPolice: YesNo | null;
}

export interface Passport {
  documentType: string | null;
  number: string | null;
  issuingState: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  placeOfIssue: string | null;
  issuingAuthority: string | null;
}

export interface Contact {
  email: string | null;
  phone: string | null;
  altPhone: string | null;
}

export interface Address {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface TravelRecord {
  id: string;
  applicantId: string;
  sortOrder: number;
  tripType: string | null;
  purpose: string | null;
  destinationCountry: string | null;
  cities: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  portOfEntry: string | null;
  portOfExit: string | null;
  accommodation: string | null;
  previousTravel: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Reference {
  id: string;
  applicantId: string;
  sortOrder: number;
  kind: ReferenceKind;
  name: string | null;
  relationship: string | null;
  organization: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FieldMeta {
  id: string;
  applicantId: string;
  fieldPath: string;
  source: FieldSource;
  confidence: number | null;
  rawValue: string | null;
  verified: boolean;
  verifiedAt: string | null;
  documentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Completeness {
  overall: number;
  bySection: Record<SectionKey, number>;
}

export interface VerificationSummary {
  verified: number;
  total: number;
  ratio: number;
  label: 'unverified' | 'partial' | 'verified';
  bySection: Record<SectionKey, { verified: number; total: number }>;
}

export interface Applicant {
  id: string;
  displayName: string;
  status: ApplicantStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicantSummary extends Applicant {
  nationality: string | null;
  passportNumberLast4: string | null;
  completeness: { overall: number };
  verification: { label: VerificationSummary['label'] };
}

export interface ApplicantDetail extends Applicant {
  identity: Identity;
  passport: Passport;
  contact: Contact;
  address: Address;
  family: Family;
  occupation: Occupation;
  travel: TravelRecord[];
  references: Reference[];
  fieldMeta: FieldMeta[];
  completeness: Completeness;
  verification: VerificationSummary;
  warnings: string[];
}
