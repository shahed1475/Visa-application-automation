import type { PortalAdapter } from '../../../src/server/automation/adapters/baseAdapter.js';
import {
  indiaPortalMap,
  type IndiaFieldMapping,
  type IndiaPortalMap,
  type IndiaPortalState,
  type IndiaPortalStateConfig,
  type MappingStatus,
} from '../../../src/server/automation/adapters/india/indiaPortalMap.js';
import {
  SESSION_EXPIRED_STATE,
  UNKNOWN_STATE,
  type ControlKind,
  type PageIdentity,
  type PortalFieldMap,
  type PortalFieldSpec,
  type PortalState,
} from '../../../src/shared/automation/types.js';
import {
  classifyMapping,
  isProductionUsable,
} from '../../../src/server/automation/adapters/india/mappingLifecycle.js';
import { parseIso } from '../../../src/server/automation/adapters/india/transforms.js';

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
  // v2 (Task 12): extra sections + a WebForms-style page, all path-identified.
  '/previous-visits': 'PREVIOUS_VISITS',
  '/additional-information': 'ADDITIONAL_INFORMATION',
  '/webforms-personal': 'WEBFORMS_PERSONAL',
  // Phase 7: the /dates page (native + text date inputs) is treated as the
  // visa-details step so the `visa_details` section is active for the
  // date-transform tests.
  '/dates': 'VISA_DETAILS',
};

const SECTION_IDS: Record<string, string[]> = {
  PERSONAL_DETAILS: ['personal_particulars'],
  PASSPORT_DETAILS: ['passport_details'],
  ADDRESS: ['address'],
  FAMILY: ['family'],
  OCCUPATION: ['occupation'],
  VISA_DETAILS: ['visa_details', 'previous_visits'],
  REFERENCES: ['references'],
  PREVIOUS_VISITS: ['previous_visits'],
  ADDITIONAL_INFORMATION: ['additional_information'],
  WEBFORMS_PERSONAL: ['personal_particulars'],
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

export interface FixtureIndiaAdapterOptions {
  /** Replaces the default `state -> documentId[]` table wholesale. */
  documentIds?: Record<string, string[]>;
  /**
   * Test hook (Task 15 scenario 3): `canContinue` returns `{ ok: false }` for
   * any state named here, simulating a portal that rejected the page after the
   * engine filled what it could. The real fixture only shows `.validation-error`
   * on `?invalid=1`, which the adapter's link-based navigation never sets.
   */
  failCanContinueOn?: string[];
  /**
   * Test hook (Task 15 scenario 5): override the entry path (default
   * `/personal`) so the engine lands on an unrecognised page.
   */
  entryPath?: string;
  /**
   * Test hook (Task 15 scenario 6): merge these specs over the field map so a
   * scenario can point a canonical field at a self-mutating fixture control.
   */
  fieldMapOverride?: Record<string, PortalFieldSpec>;
  /**
   * Phase 7: when set, `getFieldMap()` and `mappingReadiness()` derive from this
   * lifecycle map — only `validated` + current-revision mappings are exposed to
   * the engine, and `mappingReadiness` classifies the rest. Legacy callers omit
   * it and get the unchanged plain-FIELD_MAP behaviour + no `mappingReadiness`.
   */
  lifecycleMap?: Pick<IndiaPortalMap, 'mappingRevision' | 'fields'>;
}

export function makeFixtureIndiaAdapter(
  baseUrl: string,
  opts?: FixtureIndiaAdapterOptions,
): PortalAdapter {
  const documentIds = opts?.documentIds ?? DEFAULT_DOCUMENT_IDS;
  const failCanContinueOn = new Set(opts?.failCanContinueOn ?? []);
  const entryPath = opts?.entryPath ?? '/personal';
  const fieldMap: PortalFieldMap = { ...FIELD_MAP, ...(opts?.fieldMapOverride ?? {}) };
  const lifecycleMap = opts?.lifecycleMap;

  const productionFieldMap = (): PortalFieldMap => {
    if (!lifecycleMap) return fieldMap;
    return Object.fromEntries(
      Object.entries(lifecycleMap.fields)
        .filter(([, m]) => isProductionUsable(m, lifecycleMap.mappingRevision))
        .map(([k, m]) => [
          k,
          {
            selector: m.selector,
            control: m.control,
            selectorConfidence: m.selectorConfidence,
            ...(m.fallbackSelector ? { fallbackSelector: m.fallbackSelector } : {}),
            ...(m.transform ? { transform: m.transform } : {}),
            ...(m.readBackParse ? { readBackParse: m.readBackParse } : {}),
            ...(m.optionMatch ? { optionMatch: m.optionMatch } : {}),
          },
        ]),
    );
  };

  return {
    id: 'fixture-india',
    submitSelector: null,
    ...(lifecycleMap
      ? {
          mappingReadiness: (fieldPath: string) => {
            const m = lifecycleMap.fields[fieldPath];
            if (!m) return 'unmapped' as const;
            const life = classifyMapping(m, lifecycleMap.mappingRevision);
            if (life === 'validated') return 'production' as const;
            if (life === 'stale') return 'stale' as const;
            return 'unvalidated' as const;
          },
        }
      : {}),
    checkpointHints: {
      otpLabelPatterns: [/enter the otp/i],
      captchaSelectors: ['.g-recaptcha'],
    },

    matches: (url) => url.startsWith(baseUrl),

    entryUrl: (portalUrl) =>
      `${portalUrl.replace(/\/$/, '')}/${entryPath.replace(/^\//, '')}`,

    getPageIdentity: async (page): Promise<PageIdentity> => {
      // A session-expired / login-redirect page is never a form step, whatever
      // its URL — the engine must safe-stop on it (Phase 7 §session-expired).
      // Guard the read with a count check so a page WITHOUT an <h1> does not
      // block on the locator's default wait.
      const h1Count = await page
        .locator('h1')
        .count()
        .catch(() => 0);
      const heading =
        h1Count > 0
          ? await page
              .locator('h1')
              .first()
              .textContent()
              .catch(() => '')
          : '';
      if (/session expired/i.test(heading ?? '')) {
        return {
          state: SESSION_EXPIRED_STATE,
          confidence: 1,
          signals: [{ kind: 'heading', matched: true, detail: 'session expired' }],
        };
      }
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

    getFieldMap: () => productionFieldMap(),

    canContinue: async (page) => {
      const pathname = new URL(page.url()).pathname;
      const state = PATH_TO_STATE[pathname];
      if (state !== undefined && failCanContinueOn.has(state)) {
        return { ok: false, reason: 'the portal rejected the page (required field missing)' };
      }
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

// ---------------------------------------------------------------------------
// FIXTURE_INDIA_PORTAL_MAP_V2 — a fully-populated India portal map over the
// fixture-portal selectors, every mapping `status: 'validated'`. Feeds
// `validateAdapterAgainstPage` so the validator (Task 9) runs green in CI.
//
// Scope: mirrors ONLY the ~13 controls the fixture pages actually contain (see
// `FIELD_MAP` above), NOT all 26 canonical India keys. The two radio fields use
// the GROUP selector (`input[name="…"]`) exactly as `FIELD_MAP` / the engine's
// `setRadio` expect — the validator resolves a radio/checkbox mapping as a group
// (nodeCount >= 1, every node an <input> of the declared type).
// `#spouse-name` gets `type="text"` implicitly (no attribute).
// ---------------------------------------------------------------------------

const VALIDATED_AT = '2026-09-06T00:00:00.000Z';

function vField(
  selector: string,
  control: ControlKind,
  extra: Partial<Pick<IndiaFieldMapping, 'optionMatch' | 'fallbackSelector'>> = {},
): IndiaFieldMapping {
  return {
    selector,
    control,
    selectorConfidence: 'stable',
    status: 'validated',
    discoverySessionRef: 'fixture',
    validatedAt: VALIDATED_AT,
    ...extra,
  };
}

/** Form pages carry a single `.next` nav control; final review / pre-form states carry none. */
function vState(state: IndiaPortalState, nextSelector: string | null): IndiaPortalStateConfig {
  const base = indiaPortalMap.states[state];
  const nextSelectorStatus: MappingStatus = 'validated';
  return { ...base, nextSelector, nextSelectorStatus };
}

const FIXTURE_V2_FIELDS: Record<string, IndiaFieldMapping> = {
  'identity.surname': vField('#surname', 'text'),
  'identity.givenNames': vField('#given-names', 'text'),
  'identity.sex': vField('#sex', 'native_select', { optionMatch: 'value' }),
  'passport.number': vField('#passport-number', 'text'),
  'passport.expiryDate': vField('#passport-expiry', 'date'),
  'address.line1': vField('#address-line1', 'text'),
  'address.city': vField('#address-city', 'text'),
  'family.maritalStatus': vField('input[name="marital-status"]', 'radio'),
  'family.spouseName': vField('#spouse-name', 'text'),
  'occupation.occupation': vField('#occupation', 'text'),
  'application.purpose': vField('#purpose', 'native_select', { optionMatch: 'value' }),
  'application.intendedArrivalDate': vField('#arrival-date', 'date'),
  'application.visitedIndiaBefore': vField('input[name="visited-before"]', 'radio'),
};

const FIXTURE_V2_STATES: Record<IndiaPortalState, IndiaPortalStateConfig> = {
  REGISTRATION: vState('REGISTRATION', null),
  OTP: vState('OTP', null),
  PERSONAL_DETAILS: vState('PERSONAL_DETAILS', 'a.next'),
  PASSPORT_DETAILS: vState('PASSPORT_DETAILS', 'a.next'),
  ADDRESS: vState('ADDRESS', 'a.next'),
  FAMILY: vState('FAMILY', 'a.next'),
  OCCUPATION: vState('OCCUPATION', 'a.next'),
  VISA_DETAILS: vState('VISA_DETAILS', 'a.next'),
  REFERENCES: vState('REFERENCES', 'a.next'),
  DOCUMENTS: vState('DOCUMENTS', 'a.next'),
  REVIEW: vState('REVIEW', 'a.next'),
  FINAL_REVIEW: vState('FINAL_REVIEW', null),
};

export const FIXTURE_INDIA_PORTAL_MAP_V2: Pick<
  IndiaPortalMap,
  'adapterVersion' | 'mappingRevision' | 'fields' | 'states'
> = {
  adapterVersion: indiaPortalMap.adapterVersion,
  mappingRevision: indiaPortalMap.mappingRevision,
  fields: FIXTURE_V2_FIELDS,
  states: FIXTURE_V2_STATES,
};

// ---------------------------------------------------------------------------
// FIXTURE_INDIA_PORTAL_MAP_V3 (Phase 7) — v2 + per-mapping
// `validatedAgainstRevision` stamps, explicit date transforms, one
// `fallbackSelector`, and ONE deliberately stale entry (`family.spouseName`,
// validated against an old revision). Feeds `makeFixtureIndiaAdapter({
// lifecycleMap })` so the production filter / `mappingReadiness` / date
// round-trip / fallback-selector paths can be exercised end-to-end.
// ---------------------------------------------------------------------------

const V3_REVISION = indiaPortalMap.mappingRevision;

function v3Field(
  selector: string,
  control: ControlKind,
  extra: Partial<
    Pick<IndiaFieldMapping, 'optionMatch' | 'fallbackSelector' | 'transform' | 'readBackParse'>
  > = {},
): IndiaFieldMapping {
  return {
    selector,
    control,
    selectorConfidence: 'stable',
    status: 'validated',
    discoverySessionRef: 'fixture',
    validatedAt: VALIDATED_AT,
    validatedAgainstRevision: V3_REVISION,
    ...extra,
  };
}

function v3State(state: IndiaPortalState, nextSelector: string | null): IndiaPortalStateConfig {
  return {
    ...indiaPortalMap.states[state],
    nextSelector,
    nextSelectorStatus: 'validated',
    nextSelectorValidatedAgainstRevision: V3_REVISION,
  };
}

const FIXTURE_V3_FIELDS: Record<string, IndiaFieldMapping> = {
  'identity.surname': v3Field('#surname', 'text', { fallbackSelector: '[name="surname"]' }),
  'identity.givenNames': v3Field('#given-names', 'text'),
  'identity.sex': v3Field('#sex', 'native_select', { optionMatch: 'value' }),
  'passport.number': v3Field('#passport-number', 'text'),
  // A native <input type="date"> on /passport and /all — ISO in / ISO out.
  // (The DD/MM/YYYY round-trip is proven by a dedicated phase7Matrix scenario
  // with an inline map pointing at the /dates text input.)
  'passport.expiryDate': v3Field('#passport-expiry', 'date', {
    transform: parseIso,
    readBackParse: parseIso,
  }),
  'address.line1': v3Field('#address-line1', 'text'),
  'address.city': v3Field('#address-city', 'text'),
  'family.maritalStatus': v3Field('input[name="marital-status"]', 'radio'),
  // Deliberately STALE — validated, but against an old revision. Must be filtered
  // out of getFieldMap() and classify as 'stale' via mappingReadiness.
  'family.spouseName': {
    ...v3Field('#spouse-name', 'text'),
    validatedAgainstRevision: '2020-01-01',
    notes: 'intentionally-stale',
  },
  'occupation.occupation': v3Field('#occupation', 'text'),
  'application.purpose': v3Field('#purpose', 'native_select', { optionMatch: 'value' }),
  // #arrival-date is a native <input type="date"> — ISO in / ISO out.
  'application.intendedArrivalDate': v3Field('#arrival-date', 'date', {
    transform: parseIso,
    readBackParse: parseIso,
  }),
  'application.visitedIndiaBefore': v3Field('input[name="visited-before"]', 'radio'),
};

const FIXTURE_V3_STATES: Record<IndiaPortalState, IndiaPortalStateConfig> = {
  REGISTRATION: v3State('REGISTRATION', null),
  OTP: v3State('OTP', null),
  PERSONAL_DETAILS: v3State('PERSONAL_DETAILS', 'a.next'),
  PASSPORT_DETAILS: v3State('PASSPORT_DETAILS', 'a.next'),
  ADDRESS: v3State('ADDRESS', 'a.next'),
  FAMILY: v3State('FAMILY', 'a.next'),
  OCCUPATION: v3State('OCCUPATION', 'a.next'),
  VISA_DETAILS: v3State('VISA_DETAILS', 'a.next'),
  REFERENCES: v3State('REFERENCES', 'a.next'),
  DOCUMENTS: v3State('DOCUMENTS', 'a.next'),
  REVIEW: v3State('REVIEW', 'a.next'),
  FINAL_REVIEW: v3State('FINAL_REVIEW', null),
};

export const FIXTURE_INDIA_PORTAL_MAP_V3: Pick<
  IndiaPortalMap,
  'adapterVersion' | 'mappingRevision' | 'fields' | 'states'
> = {
  adapterVersion: indiaPortalMap.adapterVersion,
  mappingRevision: indiaPortalMap.mappingRevision,
  fields: FIXTURE_V3_FIELDS,
  states: FIXTURE_V3_STATES,
};

// ---------------------------------------------------------------------------
// FIXTURE_INDIA_PORTAL_MAP_ALL_VALIDATED (Phase 8 Task 6) — same shape as V3 but
// EVERY field is production-usable: `status: 'validated'` against the CURRENT
// mapping revision, with NO deliberately-stale entry (v3's `family.spouseName`
// is re-stamped fresh). Used only by the deterministic performance benchmark so
// it exercises the MAXIMUM number of fixture fields through the production
// filter. Not wired into the live adapter registry.
// ---------------------------------------------------------------------------

const FIXTURE_ALL_VALIDATED_FIELDS: Record<string, IndiaFieldMapping> = {
  ...FIXTURE_V3_FIELDS,
  // Re-stamp the one intentionally-stale v3 entry as validated-against-current.
  'family.spouseName': v3Field('#spouse-name', 'text'),
};

export const FIXTURE_INDIA_PORTAL_MAP_ALL_VALIDATED: Pick<
  IndiaPortalMap,
  'adapterVersion' | 'mappingRevision' | 'fields' | 'states'
> = {
  adapterVersion: indiaPortalMap.adapterVersion,
  mappingRevision: indiaPortalMap.mappingRevision,
  fields: FIXTURE_ALL_VALIDATED_FIELDS,
  states: FIXTURE_V3_STATES,
};
