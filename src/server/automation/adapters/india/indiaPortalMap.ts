// Selectors are placeholders. Populate from a user-driven discovery session against the authenticated portal per docs/visa-form-analysis.md §1 and record findings in docs/portals/india.md. Never guess.
//
// Mapping lifecycle (spec §7.1 / §13.10): every real portal selector starts life as
// `'TODO:discover'` with `status: 'placeholder'`. A user-driven discovery session
// (Task 16) transcribes the live selectors and promotes each mapping to
// `'discovered'` (selector seen once) and later `'validated'` (selector exercised
// end-to-end), always recording `discoverySessionRef` provenance. The guard test
// `test/automation/indiaMappingProvenance.test.ts` makes a bare, un-sourced real
// selector a build failure — you cannot ship one without provenance.

import type { PortalFieldSpec } from '../../../../shared/automation/types.js';
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

/** Where a single selector mapping sits in its discovery lifecycle. */
export type MappingStatus = 'placeholder' | 'discovered' | 'validated';

/**
 * A field mapping with discovery provenance layered over the engine's
 * {@link PortalFieldSpec}. `status`/`discoverySessionRef`/`discoveredAt`/
 * `validatedAt` are enforced by the provenance guard test: a `selector` other
 * than `'TODO:discover'` MUST carry a non-placeholder `status` and a
 * `discoverySessionRef`.
 */
export interface IndiaFieldMapping extends PortalFieldSpec {
  status: MappingStatus;
  discoveredAt?: string;
  validatedAt?: string;
  discoverySessionRef?: string;
  notes?: string;
}

export interface IndiaPortalStateConfig {
  headingPattern: RegExp;
  /**
   * Best-guess regex on the URL PATH (not a selector) used as one identity
   * signal. Guessing the path is allowed; guessing a selector is not.
   */
  urlPattern?: RegExp;
  anchorField: string | null;
  sectionIds: string[];
  nextSelector: string | null;
  nextSelectorStatus: MappingStatus;
  /**
   * Discovery provenance for a promoted `nextSelector`, mirroring the field
   * mapping rules: a non-`'TODO:discover'` `nextSelector` MUST carry a
   * `nextSelectorDiscoverySessionRef`, and a `'validated'` one MUST also carry a
   * `nextSelectorValidatedAt`. Enforced by `indiaMappingProvenance.test.ts`.
   */
  nextSelectorDiscoverySessionRef?: string;
  nextSelectorValidatedAt?: string;
  isFinalReview: boolean;
}

export interface IndiaPortalMap {
  /** Adapter contract version — bumped when the map SHAPE changes. */
  adapterVersion: string;
  /** ISO date of the last hand-edit to the mapping contents. */
  mappingRevision: string;
  /** ISO timestamp of the last discovery session that touched a mapping; `null` until Task 16. */
  lastDiscoveryAt: string | null;
  matchesUrl: RegExp;
  states: Record<IndiaPortalState, IndiaPortalStateConfig>;
  fields: Record<string, IndiaFieldMapping>;
  uploadStates: readonly IndiaPortalState[];
  checkpointHints: CheckpointHints;
  readonly submitSelector: null;
}

/** Placeholder field spec factory — keeps `selector: 'TODO:discover'` + `status: 'placeholder'` in one place. */
function placeholderField(
  control: PortalFieldSpec['control'],
  extra: Partial<Pick<PortalFieldSpec, 'optionMatch'>> = {},
): IndiaFieldMapping {
  return {
    selector: 'TODO:discover',
    control,
    selectorConfidence: 'fragile',
    status: 'placeholder',
    ...extra,
  };
}

export const indiaPortalMap: IndiaPortalMap = {
  adapterVersion: '6.0.0',
  mappingRevision: '2026-09-07',
  lastDiscoveryAt: null,
  // Known India visa-portal hostnames — adapter knowledge, lives here (excluded from the
  // arch guard). Host-anchored: `(?:^|\.)` requires the token to start the hostname or
  // follow a dot, `$` pins it to the end. `indiaAdapter.matches` tests this against
  // `new URL(url).hostname` ONLY — never the path or query. So `www.indianvisaonline.gov.in`
  // matches; `myivac.com`, `ivac.example.org`, `…/ivac.aspx`, `?ref=ivac.gov.in` do not.
  matchesUrl: /(?:^|\.)(?:indianvisaonline\.gov\.in|ivacbd\.com)$/i,
  states: {
    REGISTRATION: {
      headingPattern: /register|create account/i,
      urlPattern: /\/(register|registration|sign[-\s]?up|create[-\s]?account)\b/i,
      anchorField: null,
      sectionIds: [],
      nextSelector: null,
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    OTP: {
      headingPattern: /otp|one[-\s]?time|verification code/i,
      urlPattern: /\/(otp|verify|verification)\b/i,
      anchorField: null,
      sectionIds: [],
      nextSelector: null,
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    PERSONAL_DETAILS: {
      headingPattern: /personal (particulars|details)/i,
      urlPattern: /\/personal(-details)?\b/i,
      anchorField: 'TODO:discover',
      sectionIds: ['personal_particulars'],
      nextSelector: 'TODO:discover',
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    PASSPORT_DETAILS: {
      headingPattern: /passport (details|information)/i,
      urlPattern: /\/passport(-details)?\b/i,
      anchorField: 'TODO:discover',
      sectionIds: ['passport_details'],
      nextSelector: 'TODO:discover',
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    ADDRESS: {
      headingPattern: /address (details)?|contact/i,
      urlPattern: /\/(address|contact)(-details)?\b/i,
      anchorField: 'TODO:discover',
      sectionIds: ['address'],
      nextSelector: 'TODO:discover',
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    FAMILY: {
      headingPattern: /family (details)?/i,
      urlPattern: /\/family(-details)?\b/i,
      anchorField: 'TODO:discover',
      sectionIds: ['family'],
      nextSelector: 'TODO:discover',
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    OCCUPATION: {
      headingPattern: /occupation|profession|present (occupation|employer)/i,
      urlPattern: /\/(occupation|profession|employment)\b/i,
      anchorField: 'TODO:discover',
      sectionIds: ['occupation'],
      nextSelector: 'TODO:discover',
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    VISA_DETAILS: {
      headingPattern: /visa (details)?|details of visa sought/i,
      urlPattern: /\/visa(-details|-sought)?\b/i,
      anchorField: 'TODO:discover',
      sectionIds: ['visa_details', 'previous_visits'],
      nextSelector: 'TODO:discover',
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    REFERENCES: {
      headingPattern: /references?/i,
      urlPattern: /\/references?\b/i,
      anchorField: 'TODO:discover',
      sectionIds: ['references'],
      nextSelector: 'TODO:discover',
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    DOCUMENTS: {
      headingPattern: /upload (documents|files)?|documents? upload/i,
      urlPattern: /\/(upload|documents?|attachments?)\b/i,
      anchorField: 'TODO:discover',
      sectionIds: [],
      nextSelector: 'TODO:discover',
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    REVIEW: {
      headingPattern: /review (your )?(application|details)/i,
      urlPattern: /\/review\b/i,
      anchorField: null,
      sectionIds: [],
      nextSelector: 'TODO:discover',
      nextSelectorStatus: 'placeholder',
      isFinalReview: false,
    },
    FINAL_REVIEW: {
      headingPattern: /final (review|submission)|verify (and )?submit/i,
      urlPattern: /\/(final[-\s]?review|final[-\s]?submission|verify[-\s]?submit|confirm)\b/i,
      anchorField: null,
      sectionIds: [],
      nextSelector: null,
      nextSelectorStatus: 'placeholder',
      isFinalReview: true,
    },
  },
  fields: {
    // Every canonical appliesTo path an India adapter must eventually fill.
    // selector: 'TODO:discover', status: 'placeholder', selectorConfidence: 'fragile'
    // until a discovery run (Task 16) transcribes the live selector + provenance.
    'identity.surname': placeholderField('text'),
    'identity.givenNames': placeholderField('text'),
    'identity.sex': placeholderField('native_select', { optionMatch: 'label' }),
    'identity.dateOfBirth': placeholderField('date'),
    'identity.placeOfBirth': placeholderField('text'),
    'identity.nationality': placeholderField('native_select', { optionMatch: 'label' }),
    'passport.number': placeholderField('text'),
    'passport.issueDate': placeholderField('date'),
    'passport.expiryDate': placeholderField('date'),
    'passport.placeOfIssue': placeholderField('text'),
    'address.line1': placeholderField('text'),
    'address.city': placeholderField('text'),
    'address.country': placeholderField('native_select', { optionMatch: 'label' }),
    'family.fatherName': placeholderField('text'),
    'family.motherName': placeholderField('text'),
    'family.maritalStatus': placeholderField('native_select', { optionMatch: 'label' }),
    'family.spouseName': placeholderField('text'),
    'occupation.occupation': placeholderField('text'),
    'occupation.employerName': placeholderField('text'),
    'application.purpose': placeholderField('native_select', { optionMatch: 'label' }),
    'application.portOfArrival': placeholderField('native_select', { optionMatch: 'label' }),
    'application.intendedArrivalDate': placeholderField('date'),
    'application.visitedIndiaBefore': placeholderField('radio'),
    'application.indiaCompanyName': placeholderField('text'),
    'application.indiaCompanyAddress': placeholderField('textarea'),
    'application.natureOfBusiness': placeholderField('text'),
  },
  uploadStates: ['DOCUMENTS'],
  checkpointHints: {
    otpLabelPatterns: [/enter (the )?otp/i, /one[-\s]?time password/i],
    captchaSelectors: ['.g-recaptcha', '#captcha', 'iframe[src*="recaptcha"]'],
    mfaPatterns: [/two[-\s]?factor|multi[-\s]?factor/i],
  },
  submitSelector: null,
};
