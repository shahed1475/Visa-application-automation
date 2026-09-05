import type { ReferenceKind, Sex, FieldSource, MaritalStatus, YesNo } from '../../../shared/applicant/types';

export const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'X', label: 'Unspecified / X' },
];

export const REFERENCE_KIND_OPTIONS: { value: ReferenceKind; label: string }[] = [
  { value: 'emergency_contact', label: 'Emergency contact' },
  { value: 'employer', label: 'Employer' },
  { value: 'in_country_host', label: 'In-country host' },
  { value: 'sponsor', label: 'Sponsor' },
  { value: 'other', label: 'Other' },
];

export const TRIP_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'tourism', label: 'Tourism' },
  { value: 'business', label: 'Business' },
  { value: 'family_visit', label: 'Family visit' },
  { value: 'study', label: 'Study' },
  { value: 'transit', label: 'Transit' },
  { value: 'other', label: 'Other' },
];

export const MARITAL_STATUS_OPTIONS: { value: MaritalStatus; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
];

export const YES_NO_OPTIONS: { value: YesNo; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export const FIELD_SOURCE_LABELS: Record<FieldSource, string> = {
  manual: 'Entered manually',
  imported: 'Imported',
  system: 'Derived by the app',
  passport_mrz: 'Passport MRZ',
  passport_ocr: 'Passport OCR',
  document_ocr: 'Document OCR',
};
