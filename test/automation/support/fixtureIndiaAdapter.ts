import type { PortalAdapter } from '../../../src/server/automation/adapters/baseAdapter.js';
import {
  UNKNOWN_STATE,
  type PageIdentity,
  type PortalFieldMap,
  type PortalState,
} from '../../../src/shared/automation/types.js';

/**
 * A full, real `PortalAdapter` implementation targeting the local fixture portal
 * (`test/helpers/fixturePortal.ts` + `test/fixtures/india-portal/*.html`). Used by
 * the Task 15 integration suite to drive the real engine against deterministic
 * pages instead of the live India portal.
 */

const PATH_TO_STATE: Record<string, PortalState> = {
  '/personal': 'PERSONAL_DETAILS',
  '/passport': 'PASSPORT_DETAILS',
  '/address': 'ADDRESS',
  '/family': 'FAMILY',
  '/occupation': 'OCCUPATION',
  '/visa-details': 'VISA_DETAILS',
  '/references': 'REFERENCES',
  '/documents': 'DOCUMENTS',
  '/challenge': 'CHALLENGE',
  '/review': 'REVIEW',
  '/final-review': 'FINAL_REVIEW',
};

const SECTION_IDS: Record<string, string[]> = {
  PERSONAL_DETAILS: ['personal_particulars'],
  PASSPORT_DETAILS: ['passport_details'],
  ADDRESS: ['address'],
  FAMILY: ['family'],
  OCCUPATION: ['occupation'],
  VISA_DETAILS: ['visa_details', 'previous_visits'],
  REFERENCES: ['references'],
};

const FIELD_MAP: PortalFieldMap = {
  'identity.surname': { selector: '#surname', control: 'text', selectorConfidence: 'stable' },
  'identity.givenNames': { selector: '#given-names', control: 'text', selectorConfidence: 'stable' },
  'identity.sex': {
    selector: '#sex',
    control: 'native_select',
    selectorConfidence: 'stable',
    optionMatch: 'value',
  },
  'passport.number': {
    selector: '#passport-number',
    control: 'text',
    selectorConfidence: 'stable',
  },
  'passport.expiryDate': {
    selector: '#passport-expiry',
    control: 'date',
    selectorConfidence: 'stable',
  },
  'address.line1': { selector: '#address-line1', control: 'text', selectorConfidence: 'stable' },
  'address.city': { selector: '#address-city', control: 'text', selectorConfidence: 'stable' },
  'family.maritalStatus': {
    selector: 'input[name="marital-status"]',
    control: 'radio',
    selectorConfidence: 'stable',
  },
  'family.spouseName': { selector: '#spouse-name', control: 'text', selectorConfidence: 'stable' },
  'occupation.occupation': {
    selector: '#occupation',
    control: 'text',
    selectorConfidence: 'stable',
  },
  'application.purpose': {
    selector: '#purpose',
    control: 'native_select',
    selectorConfidence: 'stable',
    optionMatch: 'value',
  },
  'application.intendedArrivalDate': {
    selector: '#arrival-date',
    control: 'date',
    selectorConfidence: 'stable',
  },
  'application.visitedIndiaBefore': {
    selector: 'input[name="visited-before"]',
    control: 'radio',
    selectorConfidence: 'stable',
  },
};

const DEFAULT_DOCUMENT_IDS: Record<string, string[]> = {
  DOCUMENTS: ['invitation_letter_indian_company'],
};

export function makeFixtureIndiaAdapter(
  baseUrl: string,
  opts?: { documentIds?: Record<string, string[]> },
): PortalAdapter {
  const documentIds = opts?.documentIds ?? DEFAULT_DOCUMENT_IDS;

  return {
    id: 'fixture-india',
    submitSelector: null,
    checkpointHints: {
      otpLabelPatterns: [/enter the otp/i],
      captchaSelectors: ['.g-recaptcha'],
    },

    matches: (url) => url.startsWith(baseUrl),

    entryUrl: (portalUrl) => `${portalUrl.replace(/\/$/, '')}/personal`,

    getPageIdentity: async (page): Promise<PageIdentity> => {
      const pathname = new URL(page.url()).pathname;
      const state = PATH_TO_STATE[pathname];
      if (state === undefined) {
        return {
          state: UNKNOWN_STATE,
          confidence: 0,
          signals: [{ kind: 'url', matched: false, detail: pathname }],
        };
      }
      return {
        state,
        confidence: 0.95,
        signals: [{ kind: 'url', matched: true, detail: pathname }],
      };
    },

    sectionIdsForState: (state) => SECTION_IDS[state] ?? [],

    documentIdsForState: (state) => documentIds[state] ?? [],

    getFieldMap: () => FIELD_MAP,

    canContinue: async (page) => {
      const err = await page.locator('.validation-error:visible').count();
      return err > 0
        ? { ok: false, reason: 'the page shows a validation error' }
        : { ok: true };
    },

    clickNext: async (page) => {
      await page.locator('a.next, button.next').first().click();
    },

    isFinalReview: (state) => state === 'FINAL_REVIEW',
  };
}
