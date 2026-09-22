# Phase 7 — Real Indian Visa Portal Validation + Controlled Autofill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the India adapter production-controlled — the automation engine autofills a portal
field only when its mapping is `validated` against the current `mappingRevision`; stale, discovered,
and placeholder mappings can never reach the engine; dropdowns, dates, and selector fallbacks all
fail safe with precise pause reasons.

**Architecture:** A delta on Phases 5 + 6. New India-only logic under
`src/server/automation/adapters/india/`; two small optional generic additions
(`PortalAdapter.mappingReadiness?`, `PortalFieldSpec.readBackParse?`) and two new `WaitingReason`s
(`option_unavailable`, `stale_mapping`). **No DB migration** — migration 6 already dropped the
`automation_runs.waiting_reason` CHECK, and the stale-mapping stamp lives in `indiaPortalMap.ts`
source. The Phase 5 `runLoop` / `AutomationService` / routes / `AutomationRunPage` are reused; the
engine gains two new safe-stop branches and one informational event.

**Tech Stack:** TypeScript (strict, NodeNext), Node 24, `node:sqlite` `DatabaseSync`, Fastify 5,
Playwright (chromium), React 18 + Vite 5, Vitest 3 (`pool: 'forks'`).

## Global Constraints

- **Stack (verbatim from the project mandate):** TypeScript, Node.js 24, Fastify 5, SQLite via
  **`node:sqlite` `DatabaseSync`** (better-sqlite3 blocked by WDAC), React 18 + Vite 5, Playwright.
  One `npm run dev`. NOT n8n, NOT Electron, NOT a CLI.
- **NON-NEGOTIABLE safety boundaries.** Phase 7 never automates: CAPTCHA solving/bypass · OTP
  retrieval/bypass · anti-bot / stealth / fingerprint evasion · account registration · payment ·
  appointment booking · **application submission** · declaration/attestation submission.
- **Terminal success state stays `review_ready`.** Do NOT add a `submitted` / `payment_completed` /
  `appointment_booked` `RunStatus`, `EVENT_TYPES` member, `waiting_reason`, or code path.
  `RunStatus` and `LEGAL_TRANSITIONS` (`src/shared/automation/states.ts`) are **unchanged**.
- **`PortalAdapter.submitSelector` stays `readonly null`.** `noAutoSubmit.test.ts` must stay green
  and non-vacuous over every new module.
- **Never guess a portal selector.** No fuzzy matching, no "closest option", no random fallback.
  A fallback selector is only ever an explicitly configured `PortalFieldSpec.fallbackSelector`.
- **Production-usable mapping** = `status === 'validated'` **AND**
  `validatedAgainstRevision === indiaPortalMap.mappingRevision`. Nothing else reaches
  `getFieldMap()`.
- **`indiaPortalMap.ts` real mappings stay `'TODO:discover'` / `status: 'placeholder'`** — Phase 7
  adds no real portal selector and no real date `transform`. (Guard: `indiaMappingProvenance.test.ts`.)
- **PII never in persistent logs or the DB.** No field value, conflict value, or rendered control
  value in `console`/`logger`/`automation_events`/`automation_runs`/`portal_discovery_*`/screenshots.
  Screenshots stay `off` by default (`AUTOMATION_EVIDENCE` unset → `'off'`), under gitignored `data/`.
- **Closed event vocabulary.** New events go in `EVENT_TYPES` + `EVENT_MESSAGES`; the purity test
  (`events.test.ts` — no `${` / `%s` / `{{` / `\bvalue\b:`) must stay green.
- **Discovery stays read-only.** No page-mutating call under `src/server/automation/discovery/`
  (`discoveryReadOnly.test.ts` recursively walks that dir).
- **Commit trailer on every commit:**
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01L1yfyUXmEEjq4buE967LG7
  ```
- **Gate before every commit:** `npm run typecheck && npm run lint && npm test && npm run build` all
  green. Baseline entering Phase 7: **1120 tests / 108 files** at `74fc162`.
- **Branch:** `phase-7-portal-validation-autofill` (already cut from `74fc162`).

---

## Consistency check vs. `phase-7-portal-validation-autofill` @ `74fc162`

Verified against the live repository before writing this plan:

| Assumption | Reality | Consequence |
|---|---|---|
| `IndiaFieldMapping` shape | `indiaPortalMap.ts` — `extends PortalFieldSpec` + `status`, `discoveredAt?`, `validatedAt?`, `discoverySessionRef?`, `notes?`; Phase 6 whole-branch added `nextSelectorDiscoverySessionRef?` / `nextSelectorValidatedAt?` to `IndiaPortalStateConfig` | Task 1 adds `validatedAgainstRevision?` + `nextSelectorValidatedAgainstRevision?` |
| `toPortalFieldMap()` | `indiaAdapter.ts` — zero-arg, projects **all 26** fields incl. placeholders | Task 2 makes it take `currentRevision` and filter |
| engine fill `catch` | `automationEngine.ts` ~L242 — catches `SelectorNotFoundError` only; `OptionNotFoundError` escapes → `runLoop` throws → `RUN_FAILED` | Task 4 adds the `OptionNotFoundError` branch |
| `spec: null` required field | `automationEngine.ts` ~L205 — `FIELD_UNMAPPED` + `{ waiting, reason: 'missing_field_mapping' }` | Task 3 inserts a `mappingReadiness` check first |
| `DROPDOWN_OPTION_MISSING`, `SELECTOR_STALE` | declared in `EVENT_TYPES` + `EVENT_MESSAGES`, **never emitted** anywhere (grep-verified) | Tasks 4 / 5 wire them |
| `WaitingReason` | `types.ts` L2 — 12 members, no CHECK in DB (dropped migration 6) | Tasks 3/4 add 2 members, TS-only |
| `verifyControl` | `fieldActions.ts` — `native_select` + `optionMatch:'value'` reads `inputValue()`; else trim-equality on the label | Task 6 adds `date` normalisation via `readBackParse` |
| `pageActions` selector resolution | `requireSelector(page, selector)` waits on one selector; `fallbackSelector` in `PortalFieldSpec` is **never used** | Task 5 adds `resolveSelector` |
| fixture portal | `test/helpers/fixturePortal.ts` — `node:http`, `?challenge=` / `?prefill=` query flags, 15 static pages incl. `nowhere.html` (unknown), `challenge.html` | Task 7 adds `?selector=` / `?field=` / `?option=` / `?session=` / `?nav=` + a date page |
| fixture adapter | `test/automation/support/fixtureIndiaAdapter.ts` — `makeFixtureIndiaAdapter(baseUrl, opts?)`, plain `FIELD_MAP`, `FIXTURE_INDIA_PORTAL_MAP_V2` (all `validated`, no revision stamp) | Task 8 adds `FIXTURE_INDIA_PORTAL_MAP_V3` + a lifecycle-aware `getFieldMap` option |
| diagnostics | `diagnostics.ts` `getIndiaDiagnostics` + `indiaMappingRegistry.ts` `getIndiaMappingStatus` (`MappingStatusCounts`) | Task 9 adds `stale` / `productionUsable` |
| `SafeStopBanner` | `runChrome.tsx` L211 — generic copy, no "NOT submitted" | Task 10 tightens the copy |
| migration count | `LATEST_SCHEMA_VERSION === 6`; canaries in `applicant/applicationMigrations.test.ts`, `automationMigrations.test.ts` | **no migration 7** — do not touch these |

No architecture conflict. One open risk: `verifyControl`'s `date` branch must not break the existing
`fixtureIndiaAdapter` v2 date fields (no `readBackParse`) — Task 6 keeps the raw-compare default.

---

## File Structure

**New (server):**
| File | Responsibility |
|---|---|
| `src/server/automation/adapters/india/mappingLifecycle.ts` | pure: `classifyMapping`, `isProductionUsable`, `isNextSelectorProductionUsable`, `MappingLifecycle` type |
| `src/server/automation/adapters/india/transforms.ts` | pure: `isoToDMY/MDY/YMD/DdMonYyyy`, `parseDMY/MDY/YMD/DdMonYyyy`, `DateFormatError` |

**New (test):**
| File | Responsibility |
|---|---|
| `test/automation/mappingLifecycle.test.ts` | unit tests for the lifecycle module |
| `test/automation/indiaDateTransforms.test.ts` | unit tests for the date library (round-trips + throws) |
| `test/automation/fixturePortalV3.test.ts` | self-tests that each v3 fixture scenario renders deterministically |
| `test/automation/phase7Matrix.test.ts` | the §11 grid (real engine + chromium + fixture v3) |
| `test/automation/phase7Safety.test.ts` | the re-verification pass (fresh synthetic PII markers) |
| `test/web/AutomationRunProvenance.test.tsx` | provenance line + stale-mapping warning + banner copy |

**Modified (server):**
| File | Change |
|---|---|
| `src/shared/automation/types.ts` | `WaitingReason` += `'option_unavailable'`, `'stale_mapping'`; `PortalFieldSpec.readBackParse?` |
| `src/shared/automation/events.ts` | `EVENT_TYPES` += `'MAPPING_NOT_PRODUCTION_READY'`; `EVENT_MESSAGES` entries; wire `SELECTOR_STALE` message wording |
| `src/server/automation/adapters/baseAdapter.ts` | `PortalAdapter.mappingReadiness?(fieldPath): 'production'\|'stale'\|'unvalidated'\|'unmapped'` |
| `src/server/automation/adapters/india/indiaPortalMap.ts` | `IndiaFieldMapping.validatedAgainstRevision?`; `IndiaPortalStateConfig.nextSelectorValidatedAgainstRevision?` |
| `src/server/automation/adapters/india/indiaAdapter.ts` | `toPortalFieldMap(currentRevision)` filters; `mappingReadiness()` impl; `clickNext` refuses a non-production `nextSelector` |
| `src/server/automation/adapters/india/indiaMappingRegistry.ts` | `MappingStatusCounts` += `stale`, `productionUsable`; `getIndiaMappingStatus` computes them |
| `src/server/automation/adapters/india/diagnostics.ts` | `IndiaDiagnostics` += `staleMappings`, `productionUsableMappings`, `selectorStaleEvents` |
| `src/server/automation/engine/pageActions.ts` | `resolveSelector(page, spec) → { selector, usedFallback }`; `assertNativeOptionAvailable` |
| `src/server/automation/engine/fieldActions.ts` | pre-fill option-availability check; `date` read-back normalisation via `spec.readBackParse`; return `usedFallback` |
| `src/server/automation/engine/automationEngine.ts` | `stale_mapping` branch; `option_unavailable` branch; `SELECTOR_STALE` emit |

**Modified (web):**
| File | Change |
|---|---|
| `src/web/src/pages/Automation/AutomationRunPage.tsx` | provenance line + stale-mapping warning wiring |
| `src/web/src/pages/Automation/runChrome.tsx` | `AdapterProvenance` + `StaleMappingWarning` components; `SafeStopBanner` copy |
| `src/web/src/api/client.ts` | `getAdapterDiagnostics(portalId)` if not already present |

**Modified (test infra):**
| File | Change |
|---|---|
| `test/helpers/fixturePortal.ts` | `?selector=` / `?field=` / `?option=` / `?session=` / `?nav=` scenarios; a date page |
| `test/fixtures/india-portal/*.html` | scenario markup (`personal.html`, a new `dates.html`, `address.html`) |
| `test/automation/support/fixtureIndiaAdapter.ts` | `FIXTURE_INDIA_PORTAL_MAP_V3` + lifecycle-aware `getFieldMap` / `mappingReadiness` option |
| `test/automation/indiaMappingProvenance.test.ts` | `validatedAgainstRevision` guard |
| `test/automation/noAutoSubmit.test.ts` | assert the grep set covers the new modules (non-vacuous) |
| `test/web/AutomationRunPage.test.tsx` | extend the "no submit affordance" assertion to the new banner/warning |

**Modified (docs):**
| File | Change |
|---|---|
| `docs/portals/india.md` | real-portal discovery + field-validation + mapping-promotion + stale/selector/dropdown recovery + OTP/CAPTCHA procedure + troubleshooting table + 3 field tables |
| `docs/superpowers/reports/PHASE-7-REPORT.md` | new (end-of-phase; filled during Task 13/14) |
| `docs/PHASE-7-REPORT.md` | one-line pointer to the above |
| `docs/ARCHITECTURE.md` | §3 Phase 7 paragraph |

---

## Task 1: Mapping lifecycle model + revision-stamp types + provenance guard

**Objective:** A pure module that classifies a mapping as `placeholder | discovered | validated | stale`
and answers "is this production-usable?", plus the two new revision-stamp fields and the extended
provenance guard.

**Files:**
- Create: `src/server/automation/adapters/india/mappingLifecycle.ts`
- Create: `test/automation/mappingLifecycle.test.ts`
- Modify: `src/server/automation/adapters/india/indiaPortalMap.ts` (2 optional fields)
- Modify: `test/automation/indiaMappingProvenance.test.ts`

**Interfaces:**
- Consumes: `IndiaFieldMapping`, `IndiaPortalStateConfig`, `MappingStatus` from `indiaPortalMap.ts`.
- Produces:
  ```ts
  export type MappingLifecycle = 'placeholder' | 'discovered' | 'validated' | 'stale';
  export function classifyMapping(m: IndiaFieldMapping, currentRevision: string): MappingLifecycle;
  export function isProductionUsable(m: IndiaFieldMapping, currentRevision: string): boolean;
  export function isNextSelectorProductionUsable(
    cfg: Pick<IndiaPortalStateConfig, 'nextSelector' | 'nextSelectorStatus' | 'nextSelectorValidatedAgainstRevision'>,
    currentRevision: string,
  ): boolean;
  ```

- [ ] **Step 1: Add the two optional type fields.** In `indiaPortalMap.ts`:
  - In `interface IndiaFieldMapping`, after `validatedAt?: string;`:
    ```ts
      /** The `mappingRevision` this mapping was validated against. A validated
       *  mapping whose stamp != the current revision is STALE and not
       *  production-usable. Enforced by `indiaMappingProvenance.test.ts`. */
      validatedAgainstRevision?: string;
    ```
  - In `interface IndiaPortalStateConfig`, after `nextSelectorValidatedAt?: string;`:
    ```ts
      /** Revision parity for a promoted `nextSelector` — same rule as
       *  `IndiaFieldMapping.validatedAgainstRevision`. */
      nextSelectorValidatedAgainstRevision?: string;
    ```

- [ ] **Step 2: Write the failing test** (`test/automation/mappingLifecycle.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import {
  classifyMapping,
  isProductionUsable,
  isNextSelectorProductionUsable,
} from '../../src/server/automation/adapters/india/mappingLifecycle.js';
import type { IndiaFieldMapping } from '../../src/server/automation/adapters/india/indiaPortalMap.js';

const REV = '2026-09-07';
const base: IndiaFieldMapping = {
  selector: '#x',
  control: 'text',
  selectorConfidence: 'stable',
  status: 'validated',
  discoverySessionRef: 's1',
  validatedAt: '2026-09-07T00:00:00Z',
  validatedAgainstRevision: REV,
};

describe('classifyMapping', () => {
  it('placeholder / discovered pass through', () => {
    expect(classifyMapping({ ...base, selector: 'TODO:discover', status: 'placeholder' }, REV)).toBe('placeholder');
    expect(classifyMapping({ ...base, status: 'discovered', validatedAt: undefined, validatedAgainstRevision: undefined }, REV)).toBe('discovered');
  });
  it('validated + current revision => validated', () => {
    expect(classifyMapping(base, REV)).toBe('validated');
  });
  it('validated + old revision => stale', () => {
    expect(classifyMapping({ ...base, validatedAgainstRevision: '2026-01-01' }, REV)).toBe('stale');
  });
  it('validated + missing stamp => stale (never silently trusted)', () => {
    expect(classifyMapping({ ...base, validatedAgainstRevision: undefined }, REV)).toBe('stale');
  });
});

describe('isProductionUsable', () => {
  it('true only for validated + current revision', () => {
    expect(isProductionUsable(base, REV)).toBe(true);
    expect(isProductionUsable({ ...base, validatedAgainstRevision: 'old' }, REV)).toBe(false);
    expect(isProductionUsable({ ...base, status: 'discovered' }, REV)).toBe(false);
    expect(isProductionUsable({ ...base, selector: 'TODO:discover', status: 'placeholder' }, REV)).toBe(false);
  });
});

describe('isNextSelectorProductionUsable', () => {
  it('mirrors the field rule', () => {
    expect(isNextSelectorProductionUsable(
      { nextSelector: 'a.next', nextSelectorStatus: 'validated', nextSelectorValidatedAgainstRevision: REV }, REV)).toBe(true);
    expect(isNextSelectorProductionUsable(
      { nextSelector: 'a.next', nextSelectorStatus: 'validated', nextSelectorValidatedAgainstRevision: 'old' }, REV)).toBe(false);
    expect(isNextSelectorProductionUsable(
      { nextSelector: 'TODO:discover', nextSelectorStatus: 'placeholder' }, REV)).toBe(false);
    expect(isNextSelectorProductionUsable(
      { nextSelector: null, nextSelectorStatus: 'placeholder' }, REV)).toBe(false);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (`mappingLifecycle.js` missing).
  Run: `npx vitest run test/automation/mappingLifecycle.test.ts`

- [ ] **Step 4: Implement `mappingLifecycle.ts`:**

```ts
// Pure lifecycle classification for India portal mappings (spec §6).
// placeholder -> discovered -> validated -> (stale on a revision bump).
// A mapping is production-usable ONLY when it is validated against the CURRENT
// mappingRevision — a validated mapping with a missing or old stamp is stale and
// must not drive autofill. No I/O, no browser, no DB.

import type { IndiaFieldMapping, IndiaPortalStateConfig, MappingStatus } from './indiaPortalMap.js';

export type MappingLifecycle = 'placeholder' | 'discovered' | 'validated' | 'stale';

export function classifyMapping(m: IndiaFieldMapping, currentRevision: string): MappingLifecycle {
  if (m.status !== 'validated') return m.status;
  return m.validatedAgainstRevision === currentRevision ? 'validated' : 'stale';
}

export function isProductionUsable(m: IndiaFieldMapping, currentRevision: string): boolean {
  return classifyMapping(m, currentRevision) === 'validated';
}

type NextSelectorView = Pick<
  IndiaPortalStateConfig,
  'nextSelector' | 'nextSelectorStatus' | 'nextSelectorValidatedAgainstRevision'
>;

export function isNextSelectorProductionUsable(cfg: NextSelectorView, currentRevision: string): boolean {
  if (!cfg.nextSelector || cfg.nextSelector === 'TODO:discover') return false;
  const status: MappingStatus = cfg.nextSelectorStatus;
  return status === 'validated' && cfg.nextSelectorValidatedAgainstRevision === currentRevision;
}
```

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Extend the provenance guard** (`test/automation/indiaMappingProvenance.test.ts`).
  In the `'a non-placeholder selector is impossible without discovery provenance'` test, after the
  existing `discoverySessionRef` assertion, add:
  ```ts
        if (m.status === 'validated') {
          expect(m.validatedAt, k).toBeTruthy();
          expect(
            m.validatedAgainstRevision,
            `${k} is validated but has no validatedAgainstRevision`,
          ).toBeTruthy();
        }
  ```
  In the `'the same rule holds for every state nextSelector'` test, after the
  `nextSelectorDiscoverySessionRef` assertion, add:
  ```ts
        if (cfg.nextSelectorStatus === 'validated') {
          expect(
            cfg.nextSelectorValidatedAgainstRevision,
            `${s} nextSelector is validated but has no nextSelectorValidatedAgainstRevision`,
          ).toBeTruthy();
        }
  ```
  Add a new non-vacuous case:
  ```ts
  it('classifyMapping flags a stale validated mapping (guard is non-vacuous)', async () => {
    const { classifyMapping } = await import(
      '../../src/server/automation/adapters/india/mappingLifecycle.js'
    );
    const stale = {
      selector: '#x', control: 'text', selectorConfidence: 'stable',
      status: 'validated', discoverySessionRef: 's', validatedAt: 't',
      validatedAgainstRevision: 'an-old-revision',
    } as const;
    expect(classifyMapping(stale, indiaPortalMap.mappingRevision)).toBe('stale');
  });
  ```

- [ ] **Step 7: Run the full gate.** `npm run typecheck && npm run lint && npm test && npm run build`.

- [ ] **Step 8: Commit** — `git add src/server/automation/adapters/india/mappingLifecycle.ts src/server/automation/adapters/india/indiaPortalMap.ts test/automation/mappingLifecycle.test.ts test/automation/indiaMappingProvenance.test.ts` →
  `feat(phase-7): mapping lifecycle model + validatedAgainstRevision stamp + provenance guard`.

**Dependencies:** none.
**Verification:** `npx vitest run test/automation/mappingLifecycle.test.ts test/automation/indiaMappingProvenance.test.ts` green; full gate.
**Acceptance:** spec §6, §17.3.

---

## Task 2: Production-only `getFieldMap()` + `mappingReadiness` hook + `clickNext` refusal

**Objective:** The engine only ever receives `validated` + current-revision mappings; a generic
optional hook lets the engine learn *why* a field is absent; `clickNext` refuses a non-production
`nextSelector`.

**Files:**
- Modify: `src/server/automation/adapters/baseAdapter.ts` (1 optional member)
- Modify: `src/server/automation/adapters/india/indiaAdapter.ts`
- Modify: `test/automation/indiaAdapter.test.ts`

**Interfaces:**
- Consumes: `isProductionUsable`, `isNextSelectorProductionUsable`, `classifyMapping` (Task 1).
- Produces:
  ```ts
  // baseAdapter.ts — PortalAdapter
  mappingReadiness?(fieldPath: string): 'production' | 'stale' | 'unvalidated' | 'unmapped';
  ```

- [ ] **Step 1: Add the optional interface member.** In `baseAdapter.ts`, in `interface PortalAdapter`,
  after `getFieldMap(): PortalFieldMap;`:
  ```ts
    /**
     * OPTIONAL. Why a plan field is NOT in `getFieldMap()`:
     * - 'production'  — it IS in the map (caller should not have asked)
     * - 'stale'       — a validated mapping exists but was stamped against an old revision
     * - 'unvalidated' — a mapping exists at 'placeholder'/'discovered'
     * - 'unmapped'    — no mapping entry at all
     * A generic adapter omits this; the engine then treats every gap as 'unmapped'.
     */
    mappingReadiness?(fieldPath: string): 'production' | 'stale' | 'unvalidated' | 'unmapped';
  ```

- [ ] **Step 2: Write the failing tests** (`test/automation/indiaAdapter.test.ts`, new `describe`):

```ts
import { indiaAdapter } from '../../src/server/automation/adapters/india/indiaAdapter.js';
import { indiaPortalMap } from '../../src/server/automation/adapters/india/indiaPortalMap.js';

describe('india adapter — production field map (Phase 7)', () => {
  it('getFieldMap() is empty today (every real mapping is a placeholder)', () => {
    expect(Object.keys(indiaAdapter.getFieldMap())).toHaveLength(0);
  });

  it('mappingReadiness reports unvalidated for a known placeholder path, unmapped for a nonsense path', () => {
    expect(indiaAdapter.mappingReadiness!('identity.surname')).toBe('unvalidated');
    expect(indiaAdapter.mappingReadiness!('not.a.real.path')).toBe('unmapped');
  });

  it('getFieldMap() would expose a mapping ONLY when it is validated against the current revision', () => {
    // Prove the filter with a temporary in-memory patch, then restore.
    const path = 'identity.surname';
    const original = indiaPortalMap.fields[path];
    indiaPortalMap.fields[path] = {
      selector: '#surname', control: 'text', selectorConfidence: 'stable',
      status: 'validated', discoverySessionRef: 's', validatedAt: 't',
      validatedAgainstRevision: indiaPortalMap.mappingRevision,
    };
    try {
      expect(indiaAdapter.getFieldMap()[path]?.selector).toBe('#surname');
      expect(indiaAdapter.mappingReadiness!(path)).toBe('production');
      // now make it stale
      indiaPortalMap.fields[path] = { ...indiaPortalMap.fields[path]!, validatedAgainstRevision: 'old' };
      expect(indiaAdapter.getFieldMap()[path]).toBeUndefined();
      expect(indiaAdapter.mappingReadiness!(path)).toBe('stale');
    } finally {
      indiaPortalMap.fields[path] = original!;
    }
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (`mappingReadiness` undefined; `getFieldMap` returns 26 entries).
  Run: `npx vitest run test/automation/indiaAdapter.test.ts`

- [ ] **Step 4: Implement in `indiaAdapter.ts`.** Import the lifecycle helpers:
  ```ts
  import { classifyMapping, isProductionUsable, isNextSelectorProductionUsable } from './mappingLifecycle.js';
  ```
  Replace `toPortalFieldMap()` with a revision-filtered version:
  ```ts
  function toPortalFieldMap(currentRevision: string): PortalFieldMap {
    return Object.fromEntries(
      Object.entries(indiaPortalMap.fields)
        .filter(([, v]) => isProductionUsable(v, currentRevision))
        .map(([k, v]) => [
          k,
          {
            selector: v.selector,
            control: v.control,
            selectorConfidence: v.selectorConfidence,
            ...(v.fallbackSelector ? { fallbackSelector: v.fallbackSelector } : {}),
            ...(v.transform ? { transform: v.transform } : {}),
            ...(v.readBackParse ? { readBackParse: v.readBackParse } : {}),
            ...(v.optionMatch ? { optionMatch: v.optionMatch } : {}),
          },
        ]),
    );
  }
  ```
  In the adapter object:
  ```ts
  getFieldMap: () => toPortalFieldMap(indiaPortalMap.mappingRevision),

  mappingReadiness: (fieldPath: string) => {
    const m = indiaPortalMap.fields[fieldPath];
    if (!m) return 'unmapped';
    const life = classifyMapping(m, indiaPortalMap.mappingRevision);
    if (life === 'validated') return 'production';
    if (life === 'stale') return 'stale';
    return 'unvalidated'; // placeholder | discovered
  },
  ```
  In `clickNext`, replace the `'TODO:discover'` check:
  ```ts
  clickNext: async (page) => {
    const id = await getIndiaPageIdentity(page);
    const cfg = indiaPortalMap.states[id.state as IndiaPortalState];
    if (!cfg || !isNextSelectorProductionUsable(cfg, indiaPortalMap.mappingRevision)) {
      throw new Error(`india adapter: next-page selector not production-ready for ${id.state}`);
    }
    await page.locator(cfg.nextSelector as string).first().click();
  },
  ```
  `IndiaFieldMapping` needs `readBackParse?` — it `extends PortalFieldSpec`, so add `readBackParse?`
  to `PortalFieldSpec` now (Task 6 uses it in `verifyControl`; declaring it here is harmless):
  in `src/shared/automation/types.ts`, `interface PortalFieldSpec`, after `optionMatch?`:
  ```ts
    /** Portal->ISO normaliser for read-back comparison (spec §8). Set by the
     *  adapter alongside `transform` for date fields; undefined = compare raw. */
    readBackParse?: (portalValue: string) => string;
  ```

- [ ] **Step 5: Run — expect PASS.** Then full gate. **Watch for:** `phase6Integration.test.ts`,
  `security.test.ts`, `automationRoutes.test.ts` — they use `makeFixtureIndiaAdapter` (its own
  `getFieldMap`, unaffected) and never call the real `indiaAdapter.getFieldMap()` for a run, so they
  should be green. `indiaAdapter.test.ts` scoring tests unaffected. If any Phase 6 test asserted
  `getFieldMap()` returns 26 entries, update it to expect production-only (it should not — grep
  `getFieldMap` in `test/` first).

- [ ] **Step 6: Commit** — `feat(phase-7): production-only getFieldMap + mappingReadiness hook + clickNext production gate`.

**Dependencies:** Task 1.
**Verification:** `npx vitest run test/automation/indiaAdapter.test.ts` green; full gate.
**Acceptance:** spec §5, §15, §17.2.

---

## Task 3: Engine `stale_mapping` safe-stop

**Objective:** A required field whose mapping is stale/unvalidated pauses the run with a precise
reason and event — never `missing_field_mapping`, never a fill attempt.

**Files:**
- Modify: `src/shared/automation/types.ts` (`WaitingReason`)
- Modify: `src/shared/automation/events.ts` (`MAPPING_NOT_PRODUCTION_READY`)
- Modify: `src/server/automation/engine/automationEngine.ts`
- Modify: `test/automation/automationEngine.test.ts`

**Interfaces:**
- Consumes: `PortalAdapter.mappingReadiness?` (Task 2).
- Produces: `WaitingReason` union member `'stale_mapping'`; `EventType` `'MAPPING_NOT_PRODUCTION_READY'`.

- [ ] **Step 1: Add vocabulary.**
  - `types.ts` L2: append `| 'stale_mapping'` to `WaitingReason`.
  - `events.ts`: add `'MAPPING_NOT_PRODUCTION_READY'` to `EVENT_TYPES` (near `FIELD_UNMAPPED`), and to
    `EVENT_MESSAGES`:
    ```ts
    MAPPING_NOT_PRODUCTION_READY:
      'A required portal mapping is not validated against the current mapping revision. The run paused — re-validate the mapping before continuing.',
    ```

- [ ] **Step 2: Write the failing test** (`test/automation/automationEngine.test.ts`). Find the
  existing `describe` and the helper that builds an `EngineContext` with a fake adapter. Add:

```ts
it('pauses stale_mapping when a required field has only a stale/unvalidated mapping', async () => {
  const ctx = makeCtx({
    // plan: one required, present field 'identity.surname' in an active section
    adapter: {
      ...fakeAdapter,
      getFieldMap: () => ({}), // filtered out
      mappingReadiness: (p: string) => (p === 'identity.surname' ? 'stale' : 'unmapped'),
      sectionIdsForState: () => ['personal_particulars'],
    },
  });
  const stop = await runLoop(ctx);
  expect(stop).toEqual({ kind: 'waiting', reason: 'stale_mapping' });
  expect(emitted.map((e) => e.type)).toContain('MAPPING_NOT_PRODUCTION_READY');
  expect(emitted.map((e) => e.type)).not.toContain('FIELD_FILL_STARTED');
});
```
  (Use the file's existing context-builder / plan-builder helpers; if the file builds plans inline,
  mirror the closest existing "required field" test and set `getFieldMap: () => ({})`.)

- [ ] **Step 3: Run — expect FAIL.**
  Run: `npx vitest run test/automation/automationEngine.test.ts -t stale_mapping`

- [ ] **Step 4: Implement in `automationEngine.ts`.** In the field loop, replace the current
  `if (m.spec === null) { … }` block's required branch:

```ts
      if (m.spec === null) {
        if (m.required && m.present) {
          const readiness = ctx.adapter.mappingReadiness?.(m.fieldPath) ?? 'unmapped';
          if (readiness === 'stale' || readiness === 'unvalidated') {
            await ctx.emit({
              type: 'MAPPING_NOT_PRODUCTION_READY',
              fieldPath: m.fieldPath,
              status: 'blocked',
            });
            return { kind: 'waiting', reason: 'stale_mapping' };
          }
          await ctx.emit({ type: 'FIELD_UNMAPPED', fieldPath: m.fieldPath, status: 'blocked' });
          return { kind: 'waiting', reason: 'missing_field_mapping' };
        }
        await ctx.emit({ type: 'FIELD_UNMAPPED', fieldPath: m.fieldPath, status: 'skipped' });
        continue;
      }
```

- [ ] **Step 5: Run — expect PASS.** Full gate. **Watch:** `automationService`'s `assertTransition`
  accepts `waiting_for_user` from `running` (unchanged); the route `mapAutomationError` is not
  involved (a `waiting` stop is not an error). No route change needed — `stale_mapping` flows through
  the same `waiting_reason` column as every other reason.

- [ ] **Step 6: Commit** — `feat(phase-7): engine stale_mapping safe-stop + MAPPING_NOT_PRODUCTION_READY`.

**Dependencies:** Task 2.
**Verification:** `npx vitest run test/automation/automationEngine.test.ts` green; full gate.
**Acceptance:** spec §5, §11 (stale/unvalidated mapping), §17.10.

---

## Task 4: Engine `option_unavailable` safe-stop + pre-fill option check

**Objective:** A dropdown whose target option is absent/disabled/removed pauses cleanly with
`DROPDOWN_OPTION_MISSING` + `option_unavailable` — before any DOM write, and without a hard
`RUN_FAILED`.

**Files:**
- Modify: `src/shared/automation/types.ts` (`WaitingReason`)
- Modify: `src/server/automation/engine/pageActions.ts` (`assertNativeOptionAvailable`)
- Modify: `src/server/automation/engine/fieldActions.ts` (call it before a select write)
- Modify: `src/server/automation/engine/automationEngine.ts` (`OptionNotFoundError` catch)
- Modify: `test/automation/pageActions.test.ts`, `test/automation/fieldActions.test.ts`, `test/automation/automationEngine.test.ts`

**Interfaces:**
- Consumes: `OptionNotFoundError` (`pageActions.ts`, existing).
- Produces: `WaitingReason` member `'option_unavailable'`; `pageActions.assertNativeOptionAvailable`.

- [ ] **Step 1: Add vocabulary.** `types.ts` L2: append `| 'option_unavailable'` to `WaitingReason`.
  (`DROPDOWN_OPTION_MISSING` already exists in `EVENT_TYPES` + `EVENT_MESSAGES`.)

- [ ] **Step 2: Write the failing `pageActions` test** (`test/automation/pageActions.test.ts`):

```ts
import { assertNativeOptionAvailable, OptionNotFoundError } from '../../src/server/automation/engine/pageActions.js';

it('assertNativeOptionAvailable throws OptionNotFoundError for an absent option and is silent for a present one', async () => {
  // fixtureServer HTML: <select id="s"><option value="a">A</option><option value="b">B</option></select>
  await page.goto(fixture.url);
  await expect(assertNativeOptionAvailable(page, '#s', 'a', 'value')).resolves.toBeUndefined();
  await expect(assertNativeOptionAvailable(page, '#s', 'A', 'label')).resolves.toBeUndefined();
  await expect(assertNativeOptionAvailable(page, '#s', 'zzz', 'value')).rejects.toBeInstanceOf(OptionNotFoundError);
});

it('assertNativeOptionAvailable treats a disabled option as unavailable', async () => {
  // HTML: <select id="d"><option value="x">X</option><option value="y" disabled>Y</option></select>
  await page.goto(fixture.url);
  await expect(assertNativeOptionAvailable(page, '#d', 'y', 'value')).rejects.toBeInstanceOf(OptionNotFoundError);
});
```
  (Extend the file's `FIXTURE_HTML` with `#s` and `#d` selects.)

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement `assertNativeOptionAvailable` in `pageActions.ts`:**

```ts
/**
 * Read-only pre-fill check: does `<select selector>` have an ENABLED option whose
 * label/value matches `value` under `match`? Throws `OptionNotFoundError` if not,
 * BEFORE any write. Exact equality only — never "closest".
 */
export async function assertNativeOptionAvailable(
  page: Page,
  selector: string,
  value: string,
  match: 'exact' | 'label' | 'value',
): Promise<void> {
  await requireSelector(page, selector);
  const opts = await page.locator(`${selector} option`).evaluateAll((els) =>
    els.map((el) => {
      const o = el as unknown as { label: string; textContent: string | null; value: string; disabled: boolean };
      return { label: (o.textContent ?? '').trim(), value: o.value, disabled: o.disabled };
    }),
  );
  const hit = opts.some((o) => {
    if (o.disabled) return false;
    if (match === 'label') return o.label === value;
    if (match === 'value') return o.value === value;
    return o.label === value || o.value === value;
  });
  if (!hit) throw new OptionNotFoundError(selector, value);
}
```

- [ ] **Step 5: Call it before a select write in `fieldActions.ts` `writeControl`:**

```ts
    case 'native_select':
      await assertNativeOptionAvailable(page, sel, expected, spec.optionMatch ?? 'label');
      await selectNative(page, sel, expected, spec.optionMatch ?? 'label');
      return;
```
  (Import `assertNativeOptionAvailable` from `./pageActions.js`.) `custom_select` / `searchable_select`
  keep their existing `OptionNotFoundError`-throwing behaviour — no pre-check (their option set is not
  enumerable read-only without opening the widget, which would be a mutation).

- [ ] **Step 6: Add a `fieldActions` test** proving `applyField` propagates `OptionNotFoundError`
  for an absent option and does NOT mutate the control:

```ts
it('applyField throws OptionNotFoundError for an absent select option without changing the control', async () => {
  // #ns has options a/b; ask for 'zzz'
  const before = await page.locator('#ns').inputValue();
  await expect(applyField(page, mf('#ns', 'native_select', 'zzz', 'value'))).rejects.toBeInstanceOf(OptionNotFoundError);
  expect(await page.locator('#ns').inputValue()).toBe(before);
});
```

- [ ] **Step 7: Add the engine catch** in `automationEngine.ts` (the field-loop `try/catch` around
  `ctx.applyField`), before the final `throw e;`:

```ts
        if (e instanceof OptionNotFoundError) {
          await ctx.emit({ type: 'DROPDOWN_OPTION_MISSING', fieldPath: m.fieldPath, status: 'blocked' });
          return { kind: 'waiting', reason: 'option_unavailable' };
        }
```
  Import `OptionNotFoundError` from `./pageActions.js` (alongside `SelectorNotFoundError`).

- [ ] **Step 8: Add an engine test:**

```ts
it('pauses option_unavailable when a mapped select is missing the required option', async () => {
  const ctx = makeCtx({
    applyField: async () => { throw new OptionNotFoundError('#purpose', 'BUSINESS'); },
    // plan: one required present select field mapped
  });
  const stop = await runLoop(ctx);
  expect(stop).toEqual({ kind: 'waiting', reason: 'option_unavailable' });
  expect(emitted.map((e) => e.type)).toContain('DROPDOWN_OPTION_MISSING');
});
```

- [ ] **Step 9: Run all four test files — expect PASS.** Full gate.

- [ ] **Step 10: Commit** — `feat(phase-7): dropdown option_unavailable safe-stop + pre-fill option check`.

**Dependencies:** none (independent of Tasks 1–3).
**Verification:** `npx vitest run test/automation/pageActions.test.ts test/automation/fieldActions.test.ts test/automation/automationEngine.test.ts` green; full gate.
**Acceptance:** spec §7, §11 (missing dropdown option), §17.4.

---

## Task 5: `SELECTOR_STALE` on fallback-selector use

**Objective:** When the primary selector misses but an explicitly configured `fallbackSelector`
resolves, the run continues on the fallback **and** emits `SELECTOR_STALE` (informational, no pause).
A total miss still pauses `FIELD_NOT_FOUND`.

**Files:**
- Modify: `src/server/automation/engine/pageActions.ts` (`resolveSelector`)
- Modify: `src/server/automation/engine/fieldActions.ts` (thread `usedFallback` out of `applyField`)
- Modify: `src/server/automation/engine/automationEngine.ts` (emit `SELECTOR_STALE`)
- Modify: `test/automation/pageActions.test.ts`, `test/automation/fieldActions.test.ts`, `test/automation/automationEngine.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // pageActions.ts
  export async function resolveSelector(
    page: Page, spec: Pick<PortalFieldSpec, 'selector' | 'fallbackSelector'>,
  ): Promise<{ selector: string; usedFallback: boolean }>;
  // fieldActions.ts — applyField return type gains:
  //   usedFallback: boolean
  ```

- [ ] **Step 1: Write the failing `resolveSelector` test** (`test/automation/pageActions.test.ts`):

```ts
import { resolveSelector, SelectorNotFoundError } from '../../src/server/automation/engine/pageActions.js';

it('resolveSelector returns the primary when it matches', async () => {
  await page.goto(fixture.url); // has #t
  expect(await resolveSelector(page, { selector: '#t' })).toEqual({ selector: '#t', usedFallback: false });
});
it('resolveSelector falls back to an explicit fallbackSelector and flags it', async () => {
  await page.goto(fixture.url); // #t exists, #missing does not
  expect(await resolveSelector(page, { selector: '#missing', fallbackSelector: '#t' }))
    .toEqual({ selector: '#t', usedFallback: true });
});
it('resolveSelector throws SelectorNotFoundError when neither matches', async () => {
  await page.goto(fixture.url);
  await expect(resolveSelector(page, { selector: '#a', fallbackSelector: '#b' }))
    .rejects.toBeInstanceOf(SelectorNotFoundError);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `resolveSelector` in `pageActions.ts`:**

```ts
/**
 * Resolve the selector to use for a spec: the primary if it is attached, else an
 * EXPLICITLY configured `fallbackSelector` if that is attached. `usedFallback`
 * lets the engine emit SELECTOR_STALE. Throws `SelectorNotFoundError` if neither
 * resolves. Never guesses — the fallback is only ever the configured one.
 */
export async function resolveSelector(
  page: Page,
  spec: { selector: string; fallbackSelector?: string },
): Promise<{ selector: string; usedFallback: boolean }> {
  const attached = async (s: string) => {
    try {
      await page.locator(s).first().waitFor({ state: 'attached', timeout: 2_000 });
      return true;
    } catch {
      return false;
    }
  };
  if (await attached(spec.selector)) return { selector: spec.selector, usedFallback: false };
  if (spec.fallbackSelector && (await attached(spec.fallbackSelector))) {
    return { selector: spec.fallbackSelector, usedFallback: true };
  }
  throw new SelectorNotFoundError(spec.selector);
}
```

- [ ] **Step 4: Thread it through `applyField`** (`fieldActions.ts`). At the top of `applyField`,
  after the precondition check:
  ```ts
  const { selector: sel, usedFallback } = await resolveSelector(page, spec);
  ```
  Use `sel` for the `readControl` / `writeControl` / `verifyControl` calls in `applyField` (pass a
  `{ ...spec, selector: sel }` view). Change the return type to
  `{ filled: boolean; outcome: VerificationOutcome; alreadySet: boolean; usedFallback: boolean }`
  and include `usedFallback` in every return. Update the two existing `applyField` return sites and
  the `MappedField` consumers in `automationEngine.ts`.

- [ ] **Step 5: Add a `fieldActions` test:**

```ts
it('applyField reports usedFallback when the primary selector is gone but the fallback resolves', async () => {
  // #t exists; point primary at #gone with fallback #t
  const r = await applyField(page, {
    ...mf('#gone', 'text', 'RANA'),
    spec: { selector: '#gone', fallbackSelector: '#t', control: 'text', selectorConfidence: 'stable' },
  });
  expect(r.usedFallback).toBe(true);
  expect(r.outcome).toBe('verified');
});
```

- [ ] **Step 6: Emit `SELECTOR_STALE` in the engine.** In `automationEngine.ts`, after the
  `r = await ctx.applyField(...)` call succeeds:
  ```ts
      if (r.usedFallback) {
        await ctx.emit({ type: 'SELECTOR_STALE', fieldPath: m.fieldPath });
      }
  ```
  Update `EVENT_MESSAGES.SELECTOR_STALE` wording to: `'A portal selector no longer matched the page;
  the configured fallback selector was used. The run continued.'`

- [ ] **Step 7: Add an engine test:**

```ts
it('emits SELECTOR_STALE (informational, no pause) when applyField used the fallback', async () => {
  const ctx = makeCtx({
    applyField: async () => ({ filled: true, outcome: 'verified', alreadySet: false, usedFallback: true }),
    // plan: one required present mapped field; adapter reaches review after
  });
  const stop = await runLoop(ctx);
  expect(emitted.map((e) => e.type)).toContain('SELECTOR_STALE');
  expect(stop.kind).not.toBe('waiting');
});
```

- [ ] **Step 8: Run all three files — expect PASS.** Full gate. **Watch:** every existing test that
  asserts `applyField(...)` deep-equals `{ filled, outcome, alreadySet }` must gain `usedFallback: false`
  (grep `toEqual({` in `fieldActions.test.ts` — 2–3 sites).

- [ ] **Step 9: Commit** — `feat(phase-7): SELECTOR_STALE on configured fallback-selector use`.

**Dependencies:** none.
**Verification:** `npx vitest run test/automation/pageActions.test.ts test/automation/fieldActions.test.ts test/automation/automationEngine.test.ts` green; full gate.
**Acceptance:** spec §9, §11 (selector change), §17.5.

---

## Task 6: India date-transform library + `date` read-back normalisation

**Objective:** A deterministic, typed, fully-tested date library; `verifyControl` normalises both
sides for `date` fields through the configured `readBackParse`; **no** real date field gets a transform.

**Files:**
- Create: `src/server/automation/adapters/india/transforms.ts`
- Create: `test/automation/indiaDateTransforms.test.ts`
- Modify: `src/server/automation/engine/fieldActions.ts` (`verifyControl` date branch)
- Modify: `test/automation/fieldActions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class DateFormatError extends Error {}
  export function isoToDMY(iso: string): string;         // '2026-10-15' -> '15/10/2026'
  export function isoToMDY(iso: string): string;         //             -> '10/15/2026'
  export function isoToYMD(iso: string): string;         //             -> '2026/10/15'
  export function isoToDdMonYyyy(iso: string): string;   //             -> '15 Oct 2026'
  export function parseDMY(s: string): string;           // '15/10/2026' -> '2026-10-15'
  export function parseMDY(s: string): string;
  export function parseYMD(s: string): string;
  export function parseDdMonYyyy(s: string): string;
  ```

- [ ] **Step 1: Write the failing test** (`test/automation/indiaDateTransforms.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import {
  DateFormatError, isoToDMY, isoToMDY, isoToYMD, isoToDdMonYyyy,
  parseDMY, parseMDY, parseYMD, parseDdMonYyyy,
} from '../../src/server/automation/adapters/india/transforms.js';

const ISO = '2026-10-15';

describe('forward transforms', () => {
  it('render the documented shapes', () => {
    expect(isoToDMY(ISO)).toBe('15/10/2026');
    expect(isoToMDY(ISO)).toBe('10/15/2026');
    expect(isoToYMD(ISO)).toBe('2026/10/15');
    expect(isoToDdMonYyyy(ISO)).toBe('15 Oct 2026');
  });
  it('reject non-ISO input', () => {
    expect(() => isoToDMY('15/10/2026')).toThrow(DateFormatError);
    expect(() => isoToDMY('2026-13-01')).toThrow(DateFormatError);
    expect(() => isoToDMY('')).toThrow(DateFormatError);
  });
});

describe('inverse parsers — strict, one shape each', () => {
  it('round-trip', () => {
    for (const [fwd, back] of [
      [isoToDMY, parseDMY], [isoToMDY, parseMDY], [isoToYMD, parseYMD], [isoToDdMonYyyy, parseDdMonYyyy],
    ] as const) {
      expect(back(fwd(ISO))).toBe(ISO);
    }
  });
  it('reject the wrong shape (no fuzzy parsing)', () => {
    expect(() => parseDMY('10/15/2026')).not.toThrow(); // 10th day, 15th month? -> must throw
  });
  it('parseDMY rejects an impossible day/month', () => {
    expect(() => parseDMY('32/01/2026')).toThrow(DateFormatError);
    expect(() => parseDMY('15-10-2026')).toThrow(DateFormatError);
    expect(() => parseDMY('2026-10-15')).toThrow(DateFormatError);
  });
  it('parseDdMonYyyy is case-insensitive on the month token but strict on shape', () => {
    expect(parseDdMonYyyy('15 oct 2026')).toBe(ISO);
    expect(() => parseDdMonYyyy('15 October 2026')).toThrow(DateFormatError);
    expect(() => parseDdMonYyyy('15/Oct/2026')).toThrow(DateFormatError);
  });
});
```
  (Fix the contradictory case above before implementing — see Step 3 note.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `transforms.ts`.** Note on `parseDMY('10/15/2026')`: `15` as a month is
  invalid ⇒ it MUST throw. Correct the test's `.not.toThrow()` to `.toThrow(DateFormatError)` before
  implementing.

```ts
// Deterministic India date transforms (spec §8). ONE shape per function. NO
// fuzzy parsing, NO locale guessing, NO runtime format detection. A validated
// portal mapping picks the exact pair that matches the discovered field.

export class DateFormatError extends Error {
  constructor(readonly input: string, readonly expected: string) {
    super(`date "${input}" is not in the expected format (${expected})`);
    this.name = 'DateFormatError';
  }
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;

function partsFromIso(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) throw new DateFormatError(iso, 'YYYY-MM-DD');
  const y = Number(match[1]); const m = Number(match[2]); const d = Number(match[3]);
  assertValid(y, m, d, iso, 'YYYY-MM-DD');
  return { y, m, d };
}

function assertValid(y: number, m: number, d: number, input: string, expected: string): void {
  if (m < 1 || m > 12 || d < 1 || d > 31) throw new DateFormatError(input, expected);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) throw new DateFormatError(input, expected);
}

const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;

export function isoToDMY(s: string): string { const { y, m, d } = partsFromIso(s); return `${p2(d)}/${p2(m)}/${y}`; }
export function isoToMDY(s: string): string { const { y, m, d } = partsFromIso(s); return `${p2(m)}/${p2(d)}/${y}`; }
export function isoToYMD(s: string): string { const { y, m, d } = partsFromIso(s); return `${y}/${p2(m)}/${p2(d)}`; }
export function isoToDdMonYyyy(s: string): string { const { y, m, d } = partsFromIso(s); return `${p2(d)} ${MONTHS[m - 1]} ${y}`; }

function parseNumeric(s: string, expected: string, order: 'dmy' | 'mdy' | 'ymd'): string {
  const parts = /^(\d{1,4})\/(\d{1,2})\/(\d{1,4})$/.exec(s.trim());
  if (!parts) throw new DateFormatError(s, expected);
  const [a, b, c] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const { y, m, d } =
    order === 'dmy' ? { d: a, m: b, y: c } :
    order === 'mdy' ? { m: a, d: b, y: c } :
    { y: a, m: b, d: c };
  if (String(y).length !== 4) throw new DateFormatError(s, expected);
  assertValid(y, m, d, s, expected);
  return iso(y, m, d);
}
export function parseDMY(s: string): string { return parseNumeric(s, 'DD/MM/YYYY', 'dmy'); }
export function parseMDY(s: string): string { return parseNumeric(s, 'MM/DD/YYYY', 'mdy'); }
export function parseYMD(s: string): string { return parseNumeric(s, 'YYYY/MM/DD', 'ymd'); }

export function parseDdMonYyyy(s: string): string {
  const parts = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(s.trim());
  if (!parts) throw new DateFormatError(s, 'DD Mon YYYY');
  const d = Number(parts[1]); const y = Number(parts[3]);
  const m = MONTHS.findIndex((mon) => mon.toLowerCase() === parts[2]!.toLowerCase()) + 1;
  if (m === 0) throw new DateFormatError(s, 'DD Mon YYYY');
  assertValid(y, m, d, s, 'DD Mon YYYY');
  return iso(y, m, d);
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: `verifyControl` date normalisation.** In `fieldActions.ts` `verifyControl`, add a
  branch before the final trim-equality return:

```ts
  if (spec.control === 'date' && spec.readBackParse) {
    let normalisedActual: string;
    try {
      normalisedActual = spec.readBackParse(actual);
    } catch {
      return 'unreadable';
    }
    // `expected` here is the ISO value pre-transform? No — mapFields already
    // applied spec.transform, so `expected` is the PORTAL string. Compare in ISO:
    let normalisedExpected: string;
    try {
      normalisedExpected = spec.readBackParse(expected);
    } catch {
      return 'mismatch';
    }
    return normalisedActual === normalisedExpected ? 'verified' : 'mismatch';
  }
```
  **Design note (put in the code):** `mapFields` applies `spec.transform` so `expected` is already
  the portal-format string; `readBackParse` maps *both* the read-back value and `expected` back to
  ISO for a format-independent comparison. When `readBackParse` is absent the existing raw
  trim-equality applies (unchanged for fixture v2 and every non-date field).

- [ ] **Step 6: Add a `fieldActions` test** using a fixture `<input type="date">` (or a text input)
  and an explicit transform/parse pair:

```ts
it('verifyControl normalises a date read-back through readBackParse', async () => {
  await page.locator('#d').fill('2026-10-15'); // native date input stores ISO
  const spec = {
    selector: '#d', control: 'date' as const, selectorConfidence: 'stable' as const,
    transform: (c: string) => c, readBackParse: (v: string) => v,
  };
  expect(await verifyControl(page, spec, '2026-10-15')).toBe('verified');
});
```
  (A fuller round-trip against `isoToDMY`/`parseDMY` lands in the Phase 7 matrix, Task 11.)

- [ ] **Step 7: Run — expect PASS.** Full gate.

- [ ] **Step 8: Commit** — `feat(phase-7): deterministic India date transforms + date read-back normalisation`.

**Dependencies:** Task 2 (declared `readBackParse` on `PortalFieldSpec`).
**Verification:** `npx vitest run test/automation/indiaDateTransforms.test.ts test/automation/fieldActions.test.ts` green; full gate.
**Acceptance:** spec §8, §17.6, §17.7.

---

## Task 7: Fixture portal v3 — failure scenarios

**Objective:** The fixture portal can deterministically produce every §10 failure mode via query
flags, so Tasks 11–12 can prove the safety controls.

**Files:**
- Modify: `test/helpers/fixturePortal.ts`
- Modify: `test/fixtures/india-portal/personal.html`, `address.html`, `visa-details.html`
- Create: `test/fixtures/india-portal/dates.html`
- Create: `test/automation/fixturePortalV3.test.ts`

**Interfaces:**
- Produces: query flags on `/personal`, `/address`, `/visa-details`, `/dates`:
  `?selector=changed|fallback` · `?field=missing` · `?option=placeholder|disabled|removed|duplicate`
  · `?session=expired` · `?nav=changed`. Existing `?challenge=` / `?prefill=` untouched.

- [ ] **Step 1: Write the failing self-test** (`test/automation/fixturePortalV3.test.ts`):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixturePortal, type FixturePortal } from '../helpers/fixturePortal.js';
import { chromium, type Browser } from 'playwright';

let portal: FixturePortal; let browser: Browser;
beforeAll(async () => { portal = await startFixturePortal(); browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); await portal.close(); });

async function html(path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${portal.url}${path}`);
  return { status: res.status, body: await res.text() };
}

describe('fixture portal v3 scenarios', () => {
  it('?selector=changed renames a known control id', async () => {
    expect((await html('/personal')).body).toContain('id="surname"');
    expect((await html('/personal?selector=changed')).body).not.toContain('id="surname"');
  });
  it('?selector=fallback keeps a stable [name] fallback', async () => {
    const b = (await html('/personal?selector=fallback')).body;
    expect(b).not.toContain('id="surname"');
    expect(b).toContain('name="surname"');
  });
  it('?field=missing removes a control entirely', async () => {
    expect((await html('/personal?field=missing')).body).not.toContain('given-names');
  });
  it('?option=placeholder / removed / disabled on the visa purpose select', async () => {
    expect((await html('/visa-details?option=placeholder')).body).toContain('value=""');
    expect((await html('/visa-details?option=removed')).body).not.toContain('BUSINESS');
    expect((await html('/visa-details?option=disabled')).body).toMatch(/BUSINESS[^<]*<\/option>/);
    expect((await html('/visa-details?option=disabled')).body).toContain('disabled');
  });
  it('?session=expired returns 401 + a login marker', async () => {
    const r = await html('/personal?session=expired');
    expect(r.status).toBe(401);
    expect(r.body).toMatch(/session expired|sign in/i);
  });
  it('?nav=changed relocates the next control', async () => {
    expect((await html('/personal?nav=changed')).body).not.toContain('class="next"');
  });
  it('/dates serves a date input', async () => {
    expect((await html('/dates')).body).toContain('type="date"');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the flags in `fixturePortal.ts`.** The server already parses
  `parsed.searchParams`. For each page handler, apply a post-processing pass on the served HTML
  string keyed by the flags (a small `applyScenario(html, params, pathname)` helper):
  - `selector=changed`: `html.replaceAll('id="surname"', 'id="surname-x"')` (per-page target table).
  - `selector=fallback`: `html.replace('id="surname"', 'name="surname"')` (drop the id, keep `name`).
    The fixture control must already carry both `id` and `name` — add `name="surname"` to
    `personal.html` if absent.
  - `field=missing`: delete the `<label…>…<input id="given-names"…>` line.
  - `option=placeholder`: prepend `<option value="">— Select —</option>` to `#purpose`.
  - `option=removed`: strip the `<option value="BUSINESS">…</option>` line.
  - `option=disabled`: add ` disabled` to that option's tag.
  - `option=duplicate`: append a second `<option value="BUSINESS2">Business</option>`.
  - `session=expired`: return `res.writeHead(401)` + `<!doctype html><h1>Session expired</h1><a href="/login">Sign in</a>`.
  - `nav=changed`: `html.replaceAll('class="next"', 'class="proceed"')`.
  Keep every transform a pure string op on the already-loaded fixture HTML; no new files except
  `dates.html`. Document the flag table in a comment block at the top of `fixturePortal.ts`.

- [ ] **Step 4: Create `test/fixtures/india-portal/dates.html`:**

```html
<!doctype html><html><head><meta charset="utf-8"><title>Travel dates</title></head><body>
<h1>Travel dates</h1>
<label for="arrival-date">Intended date of arrival</label>
<input id="arrival-date" name="arrival-date" type="date">
<label for="passport-expiry">Passport expiry date</label>
<input id="passport-expiry" name="passport-expiry" type="text" placeholder="DD/MM/YYYY">
<a class="next" href="/review">Save &amp; Continue</a>
</body></html>
```
  Register `/dates` in the fixture server's page table.

- [ ] **Step 5: Run the self-test — expect PASS.** Full gate. **Watch:** existing Phase 5/6 fixture
  tests must be unaffected — the scenario pass is a no-op when no flag is present (assert this in the
  self-test: `/personal` with no query still contains `id="surname"` and `class="next"`).

- [ ] **Step 6: Commit** — `test(phase-7): fixture portal v3 — selector/field/option/session/nav scenarios + dates page`.

**Dependencies:** none.
**Verification:** `npx vitest run test/automation/fixturePortalV3.test.ts` green; full gate (Phase 5/6 fixture tests unchanged).
**Acceptance:** spec §10, §17.8.

---

## Task 8: Fixture India adapter v3 — lifecycle-aware, production-usable, one stale entry

**Objective:** `FIXTURE_INDIA_PORTAL_MAP_V3` + a `makeFixtureIndiaAdapter` mode that drives
`getFieldMap()` / `mappingReadiness()` from the lifecycle map — so Tasks 11–12 can exercise
production filtering, stale rejection, date transforms, and fallback selectors end-to-end.

**Files:**
- Modify: `test/automation/support/fixtureIndiaAdapter.ts`
- Modify: `test/automation/validateAdapter.test.ts` (v3 smoke)
- Create: `test/automation/fixtureIndiaAdapterV3.test.ts`

**Interfaces:**
- Consumes: `isProductionUsable`, `classifyMapping` (Task 1); `isoToDMY`, `parseDMY` (Task 6).
- Produces:
  ```ts
  export const FIXTURE_INDIA_PORTAL_MAP_V3: Pick<IndiaPortalMap, 'adapterVersion'|'mappingRevision'|'fields'|'states'>;
  // makeFixtureIndiaAdapter opts gains:
  //   lifecycleMap?: typeof FIXTURE_INDIA_PORTAL_MAP_V3   // when set, getFieldMap()/mappingReadiness() derive from it
  ```

- [ ] **Step 1: Write the failing test** (`test/automation/fixtureIndiaAdapterV3.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_INDIA_PORTAL_MAP_V3, makeFixtureIndiaAdapter,
} from './support/fixtureIndiaAdapter.js';

describe('fixture india adapter v3', () => {
  const rev = FIXTURE_INDIA_PORTAL_MAP_V3.mappingRevision;

  it('every non-stale field is validated against the current revision', () => {
    for (const [k, m] of Object.entries(FIXTURE_INDIA_PORTAL_MAP_V3.fields)) {
      if (m.notes === 'intentionally-stale') {
        expect(m.validatedAgainstRevision).not.toBe(rev);
      } else {
        expect(m.status, k).toBe('validated');
        expect(m.validatedAgainstRevision, k).toBe(rev);
      }
    }
  });

  it('getFieldMap() (lifecycle mode) excludes the stale entry', () => {
    const a = makeFixtureIndiaAdapter('http://x', { lifecycleMap: FIXTURE_INDIA_PORTAL_MAP_V3 });
    const map = a.getFieldMap();
    expect(map['identity.surname']).toBeDefined();
    expect(map['family.spouseName']).toBeUndefined(); // the stale one
    expect(a.mappingReadiness!('family.spouseName')).toBe('stale');
    expect(a.mappingReadiness!('identity.surname')).toBe('production');
  });

  it('date fields carry an explicit transform + readBackParse', () => {
    const d = FIXTURE_INDIA_PORTAL_MAP_V3.fields['application.intendedArrivalDate']!;
    expect(typeof d.transform).toBe('function');
    expect(typeof d.readBackParse).toBe('function');
    expect(d.transform!('2026-10-15')).toBe('15/10/2026');
    expect(d.readBackParse!('15/10/2026')).toBe('2026-10-15');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `FIXTURE_INDIA_PORTAL_MAP_V3`** in `fixtureIndiaAdapter.ts`. Start from
  `FIXTURE_INDIA_PORTAL_MAP_V2`'s `vField` factory; add `validatedAgainstRevision: MAPPING_REVISION`
  to every entry (define `const MAPPING_REVISION = FIXTURE_INDIA_PORTAL_MAP_V3.mappingRevision` —
  reuse `indiaPortalMap.mappingRevision`). Additions vs v2:
  - `'application.intendedArrivalDate'`: `{ selector: '#arrival-date', control: 'date', …, transform: isoToDMY, readBackParse: parseDMY }`.
  - `'passport.expiryDate'`: same date pair against `#passport-expiry`.
  - `'identity.surname'`: add `fallbackSelector: '[name="surname"]'`.
  - `'family.spouseName'`: mark **stale** — `status: 'validated'`, `validatedAgainstRevision: '2020-01-01'`, `notes: 'intentionally-stale'`.
  - states: reuse v2's `vState`, adding `nextSelectorValidatedAgainstRevision: MAPPING_REVISION`.
  Import `isoToDMY`, `parseDMY` from `../../../src/server/automation/adapters/india/transforms.js`.

- [ ] **Step 4: Add the `lifecycleMap` mode to `makeFixtureIndiaAdapter`.** In
  `FixtureIndiaAdapterOptions` add `lifecycleMap?: Pick<IndiaPortalMap, 'mappingRevision' | 'fields'>`.
  In the returned adapter:
  ```ts
  const lifecycleMap = opts?.lifecycleMap;
  // …
  getFieldMap: () => {
    if (!lifecycleMap) return fieldMap; // legacy path — unchanged
    return Object.fromEntries(
      Object.entries(lifecycleMap.fields)
        .filter(([, m]) => isProductionUsable(m, lifecycleMap.mappingRevision))
        .map(([k, m]) => [k, {
          selector: m.selector, control: m.control, selectorConfidence: m.selectorConfidence,
          ...(m.fallbackSelector ? { fallbackSelector: m.fallbackSelector } : {}),
          ...(m.transform ? { transform: m.transform } : {}),
          ...(m.readBackParse ? { readBackParse: m.readBackParse } : {}),
          ...(m.optionMatch ? { optionMatch: m.optionMatch } : {}),
        }]),
    );
  },
  mappingReadiness: lifecycleMap
    ? (fieldPath: string) => {
        const m = lifecycleMap.fields[fieldPath];
        if (!m) return 'unmapped';
        const life = classifyMapping(m, lifecycleMap.mappingRevision);
        return life === 'validated' ? 'production' : life === 'stale' ? 'stale' : 'unvalidated';
      }
    : undefined,
  ```
  Legacy callers (no `lifecycleMap`) get byte-identical behaviour.

- [ ] **Step 5: v3 smoke in `validateAdapter.test.ts`** — add a case validating
  `FIXTURE_INDIA_PORTAL_MAP_V3` against a fixture page reachable with those selectors; expect
  `report.fields.length > 5` and no value shapes (reuse the v2 smoke pattern).

- [ ] **Step 6: Run — expect PASS.** Full gate.

- [ ] **Step 7: Commit** — `test(phase-7): fixture india adapter v3 — lifecycle-aware map, stale entry, date transforms`.

**Dependencies:** Tasks 1, 2, 6.
**Verification:** `npx vitest run test/automation/fixtureIndiaAdapterV3.test.ts test/automation/validateAdapter.test.ts` green; full gate.
**Acceptance:** spec §10 (fixture adapter v3), §17.8.

---

## Task 9: Diagnostics + registry — stale / production-usable counts

**Objective:** `getIndiaMappingStatus` and `getIndiaDiagnostics` surface `stale` and `productionUsable`
counts (+ a `selectorStaleEvents` count) — value-free — so the UI can warn.

**Files:**
- Modify: `src/server/automation/adapters/india/indiaMappingRegistry.ts`
- Modify: `src/server/automation/adapters/india/diagnostics.ts`
- Modify: `test/automation/indiaMappingRegistry.test.ts`, `test/automation/indiaDiagnostics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // indiaMappingRegistry.ts — MappingStatusCounts gains:
  //   stale: number; productionUsable: number;
  // diagnostics.ts — IndiaDiagnostics gains:
  //   staleMappings: number; productionUsableMappings: number; selectorStaleEvents: number;
  ```

- [ ] **Step 1: Write failing tests.** `indiaMappingRegistry.test.ts`:
```ts
it('getIndiaMappingStatus counts stale and productionUsable (0 today — all placeholders)', () => {
  const s = getIndiaMappingStatus();
  expect(s.stale).toBe(0);
  expect(s.productionUsable).toBe(0);
  expect(s.placeholder).toBe(s.total);
});
```
  `indiaDiagnostics.test.ts`:
```ts
it('getIndiaDiagnostics reports stale/production/selectorStale counts', () => {
  const d = getIndiaDiagnostics(db, 'p1');
  expect(d.staleMappings).toBe(0);
  expect(d.productionUsableMappings).toBe(0);
  expect(d.selectorStaleEvents).toBe(0);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `indiaMappingRegistry.ts` — import `classifyMapping`; in
  `getIndiaMappingStatus`:
  ```ts
  const rev = indiaPortalMap.mappingRevision;
  const counts: MappingStatusCounts = { placeholder: 0, discovered: 0, validated: 0, stale: 0, productionUsable: 0, total: specs.length, requiredRemaining: 0 };
  for (const spec of specs) {
    counts[spec.status] += 1;
    const life = classifyMapping(spec, rev);
    if (life === 'stale') counts.stale += 1;
    if (life === 'validated') counts.productionUsable += 1;
    if (life !== 'validated') counts.requiredRemaining += 1;
  }
  ```
  (`MappingStatusCounts` interface gains `stale` + `productionUsable`.) `diagnostics.ts` — add the
  three fields; `selectorStaleEvents` = `count(*) FROM automation_events WHERE type = 'SELECTOR_STALE'`;
  `staleMappings` / `productionUsableMappings` from `getIndiaMappingStatus()`.

- [ ] **Step 4: Run — expect PASS.** Full gate. **Watch:** any test asserting the exact shape of
  `MappingStatusCounts` / `IndiaDiagnostics` (grep `getIndiaMappingStatus`, `getIndiaDiagnostics` in
  `test/` and `src/web/`) — extend those assertions.

- [ ] **Step 5: Commit** — `feat(phase-7): diagnostics + registry surface stale / production-usable mapping counts`.

**Dependencies:** Task 1.
**Verification:** `npx vitest run test/automation/indiaMappingRegistry.test.ts test/automation/indiaDiagnostics.test.ts` green; full gate.
**Acceptance:** spec §14 (`DiagnosticsPanel` rows), §17.11.

---

## Task 10: UI — provenance line, stale-mapping warning, SafeStopBanner copy

**Objective:** The run page shows a value-free `adapter · revision · N production-ready` line and a
clear stale-mapping warning; `review_ready` reads unmistakably as "NOT submitted"; no new
submit-shaped affordance.

**Files:**
- Modify: `src/web/src/pages/Automation/runChrome.tsx` (`AdapterProvenance`, `StaleMappingWarning`, `SafeStopBanner`)
- Modify: `src/web/src/pages/Automation/AutomationRunPage.tsx` (fetch diagnostics + render)
- Modify: `src/web/src/api/client.ts` (`getAdapterDiagnostics` if missing)
- Create: `test/web/AutomationRunProvenance.test.tsx`
- Modify: `test/web/AutomationRunPage.test.tsx` (extend "no submit affordance")

**Interfaces:**
- Consumes: `GET /api/portals/:id/adapter-diagnostics` → `{ diagnostics: IndiaDiagnostics }` (Phase 6 route, extended Task 9).
- Produces: `AdapterProvenance({ diagnostics })`, `StaleMappingWarning({ diagnostics })` React components.

- [ ] **Step 1: Write the failing test** (`test/web/AutomationRunProvenance.test.tsx`), jsdom, mocking
  `api.client` like `AutomationRunConflict.test.tsx`:

```ts
it('renders a value-free provenance line', async () => {
  api.getAdapterDiagnostics.mockResolvedValue({ diagnostics: {
    adapterId: 'india', adapterVersion: '6.0.0', mappingRevision: '2026-09-07',
    productionUsableMappings: 4, staleMappings: 0, mappings: { total: 26 }, /* … */
  }});
  renderPage();
  expect(await screen.findByText(/India adapter v6\.0\.0/)).toBeTruthy();
  expect(screen.getByText(/mapping rev 2026-09-07/)).toBeTruthy();
  expect(screen.getByText(/4\s*\/\s*26 production-ready/)).toBeTruthy();
});

it('shows the stale-mapping warning when staleMappings > 0', async () => {
  api.getAdapterDiagnostics.mockResolvedValue({ diagnostics: { /* … */ staleMappings: 3, productionUsableMappings: 1, mappings: { total: 26 } }});
  renderPage();
  expect(await screen.findByText(/stale or not yet validated/i)).toBeTruthy();
});

it('SafeStopBanner says NOT submitted at review_ready', async () => {
  api.getAutomationRun.mockResolvedValue({ run: makeRun({ status: 'review_ready', waiting_reason: null }), events: [] });
  renderPage();
  expect(await screen.findByText(/NOT submitted/)).toBeTruthy();
  expect(screen.getByText(/Submission is your responsibility/i)).toBeTruthy();
});

it('adds no submit-shaped control', async () => {
  const { container } = renderPage();
  await screen.findByText(/India adapter/);
  expect(container.querySelector('form')).toBeNull();
  expect(container.querySelector('button[type="submit"]')).toBeNull();
  expect(screen.queryByRole('button', { name: /submit|pay|book appointment|complete application/i })).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `runChrome.tsx`:
```tsx
export function AdapterProvenance({ diagnostics: d }: { diagnostics: IndiaDiagnostics | null }) {
  if (!d) return null;
  return (
    <p className="muted adapter-provenance" role="status">
      {`India adapter v${d.adapterVersion} · mapping rev ${d.mappingRevision} · `}
      {`${d.productionUsableMappings} / ${d.mappings.total} production-ready`}
    </p>
  );
}

export function StaleMappingWarning({ diagnostics: d }: { diagnostics: IndiaDiagnostics | null }) {
  if (!d || (d.staleMappings === 0 && d.productionUsableMappings === d.mappings.total)) return null;
  if (d.staleMappings === 0 && d.mappings.validated === d.mappings.total) return null;
  return (
    <p className="warning" role="alert">
      Some required portal mappings are stale or not yet validated. Automation cannot safely continue
      until they are re-validated.
    </p>
  );
}
```
  `SafeStopBanner`:
```tsx
export function SafeStopBanner() {
  return (
    <section className="safe-stop">
      <h2>Preparation complete</h2>
      <p><strong>Prepared — NOT submitted.</strong> Submission is your responsibility in the portal —
        review every field there, then submit yourself.</p>
    </section>
  );
}
```
  `AutomationRunPage.tsx`: add a `diagnostics` state, fetch it in the existing load effect when
  `run.adapter_id === 'india'` and `run.portal_id` is set (`api.getAdapterDiagnostics(run.portal_id)`),
  render `<AdapterProvenance>` under the header line and `<StaleMappingWarning>` above the panels.
  Add `getAdapterDiagnostics(portalId: string)` to `api/client.ts` if absent (mirror the existing
  diagnostics call from `IndiaPortalCard`).

- [ ] **Step 4: Extend `AutomationRunPage.test.tsx`** "no submit affordance" case to also mount with
  `staleMappings > 0` and assert the warning carries no button.

- [ ] **Step 5: Run — expect PASS.** Full gate (`npm run build` covers the web bundle).

- [ ] **Step 6: Commit** — `feat(phase-7): run-page adapter provenance + stale-mapping warning + NOT-submitted banner copy`.

**Dependencies:** Task 9.
**Verification:** `npx vitest run test/web/AutomationRunProvenance.test.tsx test/web/AutomationRunPage.test.tsx` green; full gate.
**Acceptance:** spec §14, §17.11.

---

## Task 11: Phase 7 test matrix (fixture v3, real engine + chromium)

**Objective:** One suite proving the §11/§33 grid end-to-end against fixture v3.

**Files:**
- Create: `test/automation/phase7Matrix.test.ts`

**Interfaces:**
- Consumes: `startFixturePortal`, `makeFixtureIndiaAdapter({ lifecycleMap: FIXTURE_INDIA_PORTAL_MAP_V3 })`,
  `AutomationService`, the Phase 6 integration harness pattern (`phase6Integration.test.ts`).

- [ ] **Step 1: Write the suite.** Mirror `phase6Integration.test.ts`'s harness (headless chromium,
  `AutomationService` with a real `runLoop`, a fixture-backed plan builder). Scenarios — each its own
  `it`, each asserting `portal.submitCount === 0` at the end:

  1. **known page** → `PAGE_DETECTED`, fields fill, `review_ready`.
  2. **unknown page** (`entryPath: '/nowhere'`) → `UNKNOWN_PORTAL_STATE`, no `FIELD_FILL_STARTED`, `unknown_page`.
  3. **stale mapping** (`family.spouseName` stale in v3) required+present → `MAPPING_NOT_PRODUCTION_READY`, `stale_mapping`, zero `FIELD_FILL_STARTED` for that path.
  4. **unvalidated mapping** — point the plan at a canonical path absent from v3 → `stale_mapping` (readiness `unmapped` → falls to `missing_field_mapping`; assert this distinction explicitly).
  5. **dropdown missing option** (`/visa-details?option=removed`) → `DROPDOWN_OPTION_MISSING`, `option_unavailable`, the select is unchanged (`inputValue` still the default).
  6. **dropdown disabled option** (`?option=disabled`) → same.
  7. **selector changed with fallback** (`/personal?selector=fallback`, `identity.surname` has `fallbackSelector`) → `SELECTOR_STALE` emitted, run continues, field verified.
  8. **selector changed no fallback** (`?selector=changed` on a field without one) → `FIELD_NOT_FOUND`, `missing_field_mapping`.
  9. **date field** (`/dates`, `application.intendedArrivalDate` → `isoToDMY`) → fill `15/10/2026`, read back, `parseDMY` normalises, `FIELD_VERIFIED`.
  10. **date read-back mismatch** — fixture date input pre-seeded to a different date → `FIELD_MISMATCH`, `value_mismatch` pause.
  11. **OTP checkpoint** (`/challenge?challenge=otp`) → `OTP_REQUIRED`, `otp`; resume while present → `CHECKPOINT_STILL_PRESENT` / 409; clear → resumes.
  12. **CAPTCHA checkpoint** (`?challenge=captcha`) → `CAPTCHA_REQUIRED`, `captcha`.
  13. **session expired** (`/personal?session=expired`) → adapter/engine detect → `SESSION_EXPIRED`, `session_expired`. (Adapter `getPageIdentity` maps the 401 login marker to `UNKNOWN`/a session state; if the fixture adapter needs a hint, add a `sessionExpiredMarker` check to `makeFixtureIndiaAdapter.canContinue` → returns `{ ok: false }` and the engine emits `SESSION_EXPIRED` via a new small branch — **only if** an existing path doesn't already cover it; prefer detecting `<h1>Session expired</h1>` in `getPageIdentity` → `UNKNOWN` → `unknown_page` and assert that instead, to avoid engine surface area).
  14. **resume idempotency** — run to a mid-plan pause, `dispose`, `resumeRun`, assert no field fills a second time (only `FIELD_ALREADY_SET` / re-verify events for already-done fields).
  15. **full E2E** — connect → detect → autofill (production mappings only) → verify → `canContinue` → `review_ready`; `submitCount === 0`; `fields_verified === fields_total`.

- [ ] **Step 2: Run — iterate to green.** Use `superpowers:systematic-debugging` for any failure —
  fix the source, not the test. Headed/headless: keep headless (`headlessBM()` pattern from
  `security.test.ts`).

- [ ] **Step 3: Full gate.**

- [ ] **Step 4: Commit** — `test(phase-7): phase 7 matrix — mapping/detection/field/verification/safety/recovery grid`.

**Dependencies:** Tasks 1–10.
**Verification:** `npx vitest run test/automation/phase7Matrix.test.ts` green; full gate.
**Acceptance:** spec §11, §17.9.

---

## Task 12: Phase 7 safety re-verification pass

**Objective:** Re-assert every shipped rail with fresh synthetic PII markers, in one Phase-7-labelled
file, so a reviewer sees Phase 7's safety posture in one place.

**Files:**
- Create: `test/automation/phase7Safety.test.ts`
- Modify: `test/automation/noAutoSubmit.test.ts` (assert the grep covers new modules — non-vacuous)

**Interfaces:**
- Consumes: the Phase 6 `security.test.ts` harness pattern; fixture v3.

- [ ] **Step 1: Write the suite.** `SECRETS = ['TEST-PASSPORT-123', 'TEST-NAME-ONLY', 'TEST-EMAIL@example.invalid', 'TEST-DOB-2000-01-01', 'TEST-ADDR-NOWHERE']`.
  Build a plan whose field values are those markers. Cases:
  1. **no-submit:** run every fixture-v3 scenario that reaches a form; assert `portal.submitCount === 0`
     and no `automation_events.type` matches `/submit|confirm|lodge|pay/i`.
  2. **PII absent:** after a full run + a discovery round-trip, none of `SECRETS` appears in the
     captured logs, `SELECT * FROM automation_events`, `SELECT * FROM automation_runs`,
     `portal_discovery_pages`, `portal_discovery_sessions`, or any file under the evidence dir.
  3. **screenshots off:** `AUTOMATION_EVIDENCE` unset → evidence dir empty after a pause.
  4. **OTP re-detect:** pause `otp` → `resumeRun` with the challenge still served → 409
     `CHECKPOINT_STILL_PRESENT`; switch fixture to `?challenge=ok` → `resumeRun` → resumes.
  5. **CAPTCHA:** same shape with `captcha`.
  6. **unknown page:** `/nowhere` → `unknown_page`, zero `FIELD_FILL_STARTED`.
  7. **stale mapping never fills:** v3 stale field → `stale_mapping`, zero `FIELD_FILL_STARTED` for it.
  8. **resume idempotency:** dispose mid-run → resume → each previously-verified field emits only
     `FIELD_ALREADY_SET` (no second `FIELD_FILLED`).
  9. **ToS gate both entry points:** real India host + no ack → `POST /automation-runs` → 409
     `TOS_NOT_ACKNOWLEDGED`, no run row; `POST /discovery-sessions` → 409 `TOS_NOT_ACKNOWLEDGED`.
  10. **conflict values not persisted:** seed a portal `?prefill=conflict`; the engine records the
      conflict in-memory; assert both the app value and the portal value are absent from every
      persisted row.

- [ ] **Step 2: `noAutoSubmit.test.ts`** — confirm its file walk covers `mappingLifecycle.ts`,
  `transforms.ts` (they're under `automation/**` already — assert the walked set `includes` them so
  the coverage is explicit and non-vacuous). Add a synthetic-violation check if the file doesn't have
  one already.

- [ ] **Step 3: Run — iterate to green.**

- [ ] **Step 4: Full gate.**

- [ ] **Step 5: Commit** — `test(phase-7): safety re-verification pass — no-submit, PII, checkpoints, resume, ToS`.

**Dependencies:** Tasks 1–11.
**Verification:** `npx vitest run test/automation/phase7Safety.test.ts test/automation/noAutoSubmit.test.ts` green; full gate.
**Acceptance:** spec §11, §12, §17.9, §17.10.

---

## Task 13: Documentation — india.md procedures + field tables + ARCHITECTURE §3 + report skeleton

**Objective:** Operator-facing procedures and the honest supported/unsupported picture.

**Files:**
- Modify: `docs/portals/india.md`
- Modify: `docs/ARCHITECTURE.md` (§3)
- Create: `docs/superpowers/reports/PHASE-7-REPORT.md`
- Create: `docs/PHASE-7-REPORT.md` (pointer)

- [ ] **Step 1: `docs/portals/india.md`** — add sections:
  - **Real-portal discovery procedure** — the Track B steps (spec §13), verbatim.
  - **Field-validation procedure** — promote (`POST /promote`) → review selector → `validate-adapter`
    → hand-edit `indiaPortalMap.ts` with `status: 'validated'`, `validatedAt`,
    `validatedAgainstRevision: <current mappingRevision>`, `discoverySessionRef`; for a date field
    assign the `transform` + `readBackParse` matching the observed format.
  - **Mapping-promotion procedure** — where the paste-ready literal comes from, what a human checks.
  - **Stale-mapping recovery** — "the run paused `stale_mapping`": bump caused it → re-run
    `validate-adapter` for each field → re-stamp `validatedAgainstRevision`.
  - **Selector-change recovery** — "`SELECTOR_STALE` in diagnostics": the fallback carried the run;
    re-discover the primary, update `selector`, re-stamp.
  - **Dropdown-mismatch recovery** — "run paused `option_unavailable`": the portal's option set
    changed; re-discover the option values, update `optionMatch` / the plan value.
  - **OTP / CAPTCHA pause–resume procedure** — pause → complete in the browser → Resume → the run
    re-detects and re-validates the page before continuing.
  - **Troubleshooting table** — symptom → likely cause → action (one row per pause reason + `SELECTOR_STALE`).
  - **Three field tables:** *Validated* (empty today — "none; every mapping is a placeholder"),
    *Discovered but not validated* (empty), *Not supported* (fields with no canonical model / KB
    backing — list them from `indiaPortalMap.fields` vs the Phase 4 model).
- [ ] **Step 2: `docs/ARCHITECTURE.md` §3** — one paragraph after the Phase 6 one: production-mapping
  filtering (validated + current revision only), the stale lifecycle, `mappingReadiness`, the two new
  safe-stops, the date-transform library, still no submit path. End "See `docs/superpowers/reports/PHASE-7-REPORT.md`."
- [ ] **Step 3: `docs/superpowers/reports/PHASE-7-REPORT.md`** — skeleton with the §40 headings, marked
  *filled at phase end*. `docs/PHASE-7-REPORT.md` — one line: "Phase 7 report lives at
  `docs/superpowers/reports/PHASE-7-REPORT.md`."
- [ ] **Step 4: Full gate** (docs-only; typecheck/lint/build unaffected, tests unchanged).
- [ ] **Step 5: Commit** — `docs(phase-7): india.md procedures + field tables + ARCHITECTURE §3 + report skeleton`.

**Dependencies:** Tasks 1–12 (so the procedures describe real behaviour).
**Verification:** `docs/portals/india.md` has all §17 procedures + 3 tables; full gate.
**Acceptance:** spec §16, §17.12.

---

## Task 14: Whole-branch review + fix wave + PHASE-7-REPORT

**Objective:** An opus whole-branch review over `74fc162..HEAD` against the safety boundaries; fix
Critical/Important findings; fill the end-of-phase report.

**Files:**
- Modify: `docs/superpowers/reports/PHASE-7-REPORT.md`
- Modify: whatever the fix wave touches.

- [ ] **Step 1: Assemble the diff** `74fc162..HEAD` and dispatch one opus whole-branch review
  (`superpowers:requesting-code-review`). Review specifically for the spec §13 list:
  accidental submission path · CAPTCHA/OTP bypass · PII leakage · guessed selectors · stale mapping
  reaching production · unsafe page detection · unsafe resume · conflict handling · read-back
  verification gaps · browser lifecycle leaks · incorrect state transitions · missing fixture
  coverage · real-portal assumptions leaking into the generic engine · undocumented portal behaviour.
- [ ] **Step 2: Triage.** Fix every Critical + Important (one focused commit per finding or one
  wave commit, `superpowers:receiving-code-review` for anything questionable). Record Minors as
  deferred follow-ups.
- [ ] **Step 3: Fill `PHASE-7-REPORT.md`** per spec §16 headings. **Separate** *Automated tests*
  from *Real-portal validation*; state plainly that **no real portal field was validated** (Track B
  not executed). Include: baseline, tasks + SHAs, the two new `WaitingReason`s, the new event, the
  generic type additions, the lifecycle/stale model, the date library, fixture v3, the acceptance
  table (spec §17, 14 items) with PASS/PARTIAL + evidence, and verbatim:
  ```
  Automatic final visa submission: NOT IMPLEMENTED
  OTP/CAPTCHA/anti-bot bypass: NOT IMPLEMENTED
  Real Indian portal fields validated: NONE (Track B not executed)
  ```
- [ ] **Step 4: Final gate** — `npm run typecheck && npm run lint && npm test && npm run build`;
  record exact counts.
- [ ] **Step 5: Commit** — `docs(phase-7): whole-branch review outcome + PHASE-7-REPORT`.
- [ ] **Step 6:** `superpowers:finishing-a-development-branch` — push / merge / PR is the user's call
  (Phase 6 precedent: pushed to origin, not merged).

**Dependencies:** Tasks 1–13.
**Verification:** review complete, Critical/Important fixed, gate green, report complete.
**Acceptance:** spec §17.13, §17.14.

---

## Self-review

**1. Spec coverage** — every spec section maps to a task:

| Spec § | Task(s) |
|---|---|
| §1 mission / §2 approach | plan structure; enforced across all |
| §3 reuse analysis | consistency check + "Watch" notes in Tasks 2, 5, 9 |
| §4 gap analysis (G1–G10) | G1→T2, G2→T1, G3→T4, G4→T3, G5→T5, G6→T6, G7→T7, G8→T10, G9→T13, G10→T11/T12 |
| §5 production filtering | T2, T3 |
| §6 stale model | T1 |
| §7 dropdown safety | T4 |
| §8 date handling | T6, T8 |
| §9 selector fallback | T5 |
| §10 fixture v3 | T7, T8 |
| §11 test matrix | T11, T12 |
| §12 safety boundaries | Global Constraints; re-guarded T12; every task's "Watch" |
| §13 Track B runbook | T13 (documented, not executed) |
| §14 UI | T10 |
| §15 generic type additions | T2 (`readBackParse`, `mappingReadiness`) |
| §16 India adapter surface | T2, T9 |
| §17 acceptance (14) | T14 assembles the table; each item traced to a task |
| §18 non-goals | Global Constraints + "no migration" in T-headers |

No gap.

**2. Placeholder scan** — every code step has real code or an exact edit instruction. Task 11/12
scenario lists name concrete fixtures + expected events, not "test the above". The only `'TODO'`
strings introduced are the spec-mandated `'TODO:discover'` placeholders that **already exist** and
are explicitly kept. Task 11 scenario 13 (session expired) carries an explicit "prefer X, only add
engine surface if Y" decision rather than "handle it".

**3. Type consistency** — `MappingLifecycle` / `classifyMapping` / `isProductionUsable`
(T1) consumed by T2, T8, T9. `mappingReadiness` return union `'production'|'stale'|'unvalidated'|'unmapped'`
identical in T2 (baseAdapter), T2 (indiaAdapter impl), T3 (engine consumer), T8 (fixture impl).
`WaitingReason` additions `'stale_mapping'` (T3) / `'option_unavailable'` (T4) — each added once,
consumed by the engine branch in the same task and asserted in T11/T12. `readBackParse` on
`PortalFieldSpec` declared in T2, used by `verifyControl` in T6, passed through `toPortalFieldMap`
in T2 and the fixture `getFieldMap` in T8. `applyField` return gains `usedFallback: boolean` in T5 —
every return site + consumer (`automationEngine.ts`) updated in T5; existing `toEqual` assertions
flagged in T5 Step 8. `MappingStatusCounts` gains `stale` + `productionUsable` in T9; `IndiaDiagnostics`
gains `staleMappings` / `productionUsableMappings` / `selectorStaleEvents` in T9, consumed by the UI
in T10. `DateFormatError` + the 8 transform functions (T6) consumed by T8. No name drift.

**4. Scope** — 14 tasks, one plan, each ends with an independently testable + committable deliverable.
Track B correctly excluded (documented only). No migration. Generic engine additions are minimal,
optional, and backward-compatible.
