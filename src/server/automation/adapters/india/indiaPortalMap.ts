// Selectors are placeholders. Populate from a user-driven discovery session against the authenticated portal per docs/visa-form-analysis.md §1 and record findings in docs/portals/india.md. Never guess.

import type { PortalFieldMap } from '../../../../shared/automation/types.js';
import type { CheckpointHints } from '../baseAdapter.js';

export const INDIA_PORTAL_STATES = [
  'REGISTRATION',
  'OTP',
  'PERSONAL_DETAILS',
  'PASSPORT_DETAILS',
  'ADDRESS',
  'FAMILY',
  'OCCUPATION',
  'VISA_DETAILS',
  'REFERENCES',
  'DOCUMENTS',
  'REVIEW',
  'FINAL_REVIEW',
] as const;
export type IndiaPortalState = (typeof INDIA_PORTAL_STATES)[number];

export interface IndiaPortalStateConfig {
  headingPattern: RegExp;
  anchorField: string | null;
  sectionIds: string[];
  nextSelector: string | null;
  isFinalReview: boolean;
}

export interface IndiaPortalMap {
  matchesUrl: RegExp;
  states: Record<IndiaPortalState, IndiaPortalStateConfig>;
  fields: PortalFieldMap;
  uploadStates: readonly IndiaPortalState[];
  checkpointHints: CheckpointHints;
  readonly submitSelector: null;
}

export const indiaPortalMap: IndiaPortalMap = {
  // known India visa-portal hosts — this is adapter knowledge, lives here (excluded from the arch guard)
  matchesUrl: /(?:indianvisaonline|ivacbd|ivac)\.[a-z.]+/i,
  states: {
    REGISTRATION: {
      headingPattern: /register|create account/i,
      anchorField: null,
      sectionIds: [],
      nextSelector: null,
      isFinalReview: false,
    },
    OTP: {
      headingPattern: /otp|one[-\s]?time|verification code/i,
      anchorField: null,
      sectionIds: [],
      nextSelector: null,
      isFinalReview: false,
    },
    PERSONAL_DETAILS: {
      headingPattern: /personal (particulars|details)/i,
      anchorField: 'TODO:discover',
      sectionIds: ['personal_particulars'],
      nextSelector: 'TODO:discover',
      isFinalReview: false,
    },
    PASSPORT_DETAILS: {
      headingPattern: /passport (details|information)/i,
      anchorField: 'TODO:discover',
      sectionIds: ['passport_details'],
      nextSelector: 'TODO:discover',
      isFinalReview: false,
    },
    ADDRESS: {
      headingPattern: /address (details)?|contact/i,
      anchorField: 'TODO:discover',
      sectionIds: ['address'],
      nextSelector: 'TODO:discover',
      isFinalReview: false,
    },
    FAMILY: {
      headingPattern: /family (details)?/i,
      anchorField: 'TODO:discover',
      sectionIds: ['family'],
      nextSelector: 'TODO:discover',
      isFinalReview: false,
    },
    OCCUPATION: {
      headingPattern: /occupation|profession|present (occupation|employer)/i,
      anchorField: 'TODO:discover',
      sectionIds: ['occupation'],
      nextSelector: 'TODO:discover',
      isFinalReview: false,
    },
    VISA_DETAILS: {
      headingPattern: /visa (details)?|details of visa sought/i,
      anchorField: 'TODO:discover',
      sectionIds: ['visa_details', 'previous_visits'],
      nextSelector: 'TODO:discover',
      isFinalReview: false,
    },
    REFERENCES: {
      headingPattern: /references?/i,
      anchorField: 'TODO:discover',
      sectionIds: ['references'],
      nextSelector: 'TODO:discover',
      isFinalReview: false,
    },
    DOCUMENTS: {
      headingPattern: /upload (documents|files)?|documents? upload/i,
      anchorField: 'TODO:discover',
      sectionIds: [],
      nextSelector: 'TODO:discover',
      isFinalReview: false,
    },
    REVIEW: {
      headingPattern: /review (your )?(application|details)/i,
      anchorField: null,
      sectionIds: [],
      nextSelector: 'TODO:discover',
      isFinalReview: false,
    },
    FINAL_REVIEW: {
      headingPattern: /final (review|submission)|verify (and )?submit/i,
      anchorField: null,
      sectionIds: [],
      nextSelector: null,
      isFinalReview: true,
    },
  },
  fields: {
    // Every canonical appliesTo path an India adapter must eventually fill.
    // selector: 'TODO:discover', selectorConfidence: 'fragile' until a discovery run.
    'identity.surname': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'identity.givenNames': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'identity.sex': {
      selector: 'TODO:discover',
      control: 'native_select',
      selectorConfidence: 'fragile',
      optionMatch: 'label',
    },
    'identity.dateOfBirth': { selector: 'TODO:discover', control: 'date', selectorConfidence: 'fragile' },
    'identity.placeOfBirth': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'identity.nationality': {
      selector: 'TODO:discover',
      control: 'native_select',
      selectorConfidence: 'fragile',
      optionMatch: 'label',
    },
    'passport.number': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'passport.issueDate': { selector: 'TODO:discover', control: 'date', selectorConfidence: 'fragile' },
    'passport.expiryDate': { selector: 'TODO:discover', control: 'date', selectorConfidence: 'fragile' },
    'passport.placeOfIssue': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'address.line1': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'address.city': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'address.country': {
      selector: 'TODO:discover',
      control: 'native_select',
      selectorConfidence: 'fragile',
      optionMatch: 'label',
    },
    'family.fatherName': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'family.motherName': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'family.maritalStatus': {
      selector: 'TODO:discover',
      control: 'native_select',
      selectorConfidence: 'fragile',
      optionMatch: 'label',
    },
    'family.spouseName': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'occupation.occupation': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'occupation.employerName': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'application.purpose': {
      selector: 'TODO:discover',
      control: 'native_select',
      selectorConfidence: 'fragile',
      optionMatch: 'label',
    },
    'application.portOfArrival': {
      selector: 'TODO:discover',
      control: 'native_select',
      selectorConfidence: 'fragile',
      optionMatch: 'label',
    },
    'application.intendedArrivalDate': {
      selector: 'TODO:discover',
      control: 'date',
      selectorConfidence: 'fragile',
    },
    'application.visitedIndiaBefore': {
      selector: 'TODO:discover',
      control: 'radio',
      selectorConfidence: 'fragile',
    },
    'application.indiaCompanyName': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
    'application.indiaCompanyAddress': {
      selector: 'TODO:discover',
      control: 'textarea',
      selectorConfidence: 'fragile',
    },
    'application.natureOfBusiness': { selector: 'TODO:discover', control: 'text', selectorConfidence: 'fragile' },
  },
  uploadStates: ['DOCUMENTS'],
  checkpointHints: {
    otpLabelPatterns: [/enter (the )?otp/i, /one[-\s]?time password/i],
    captchaSelectors: ['.g-recaptcha', '#captcha', 'iframe[src*="recaptcha"]'],
    mfaPatterns: [/two[-\s]?factor|multi[-\s]?factor/i],
  },
  submitSelector: null,
};
