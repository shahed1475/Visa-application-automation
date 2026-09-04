# India Visa Knowledge Base (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned, local-first India visa knowledge base — a `src/shared/visa-kb/` module (Zod schema + loader + pure query/validation API) over git-tracked JSON rule data for Bangladesh→India, plus a read-only React reference page.

**Architecture:** Rule data is versioned JSON under `src/shared/visa-kb/data/india/`, split into e-Visa vs Regular category files plus an explicit Bangladesh eligibility file and a `meta.json` version stamp. A loader imports the JSON, validates it with Zod, runs referential cross-checks, freezes and caches it. Pure query functions answer category lookup, mode filtering, nationality eligibility (never inferred), document requirements, and invalid-combination validation. The React `/visa-rules` page imports the shared module directly — no HTTP API.

**Tech Stack:** TypeScript (ESM, NodeNext server / Bundler web), Node 24, Zod 3 (already a dependency — no new dependency in this phase), React 18 + React Router 6, Vitest 3, ESLint 9. `resolveJsonModule` is already enabled in `tsconfig.json`.

## Global Constraints

- **No new dependency.** Zod, React, React Router, Vitest are already present. A new dependency needs written justification.
- **Local-first.** No network calls at runtime. The KB is static data updated by maintainers via pull request. No browser automation, no CAPTCHA/OTP/MFA code, no portal inspection — none is added in any task.
- **Rules are data, not code.** No visa rule value may be hard-coded in a React component, a service, or a route. `VisaRulesPage` only *reads* the shared module.
- **Eligibility is explicit, never inferred.** `checkEligibility` returns `{ status: 'unknown' }` when no record exists for a `(nationality, applicationMode, categoryId)` tuple — never a silent "eligible". Every seeded visa category gets its own Bangladesh eligibility record.
- **e-Visa and Regular/Paper are separate.** Separate JSON files; every entry carries an `applicationMode` of `'evisa'` or `'regular'`.
- **Provenance on every entry.** Every category and every eligibility record carries `source` (`officialUrl` + ISO `retrievedAt`, optional `documentDate`) and an ISO `lastVerified` date. Every value in the seed data comes from an official Indian government source recorded in `src/shared/visa-kb/data/india/SOURCES.md`.
- **Country codes are ISO 3166-1 alpha-3.** `BGD`, `IND`.
- **`src/shared/visa-kb/` imports only** `zod`, the existing `src/shared/url.ts` guard, and its own JSON. Nothing in `src/server/**` or elsewhere in `src/shared/**` imports it this phase.
- **TS strict.** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all green at end of phase.
- All relative imports in `src/server/**` and `src/shared/**` use an explicit `.js` extension. `src/web/**` omits extensions (Bundler resolution).
- **TDD.** Write the failing test first, watch it fail, implement minimally, watch it pass, commit. Conventional Commit messages. Append both trailers used in this repo's recent commits:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa
  ```
- Every task ends with a commit.

---

## File structure

```
src/shared/visa-kb/
  index.ts        # barrel: re-exports schema types, loader, and every query function
  schema.ts       # Zod schemas for the whole KB + inferred TS types + the enum tuples
  loader.ts       # parseKnowledgeBase(raw) + loadKnowledgeBase() (cached) + reload() + KnowledgeBaseError
  queries.ts      # getVersion / listCategories / getCategory / getCategoriesForMode /
                  #   checkEligibility / listEligibleCategories / getDocumentRequirements / validateCombination
  data/india/
    meta.json                # { schemaVersion, kbVersion, destination, revisionDate, notes? }
    evisa-categories.json     # VisaCategory[] — applicationMode "evisa"
    regular-categories.json   # VisaCategory[] — applicationMode "regular"
    eligibility.bgd.json      # EligibilityRecord[] — nationality "BGD"
    SOURCES.md                # every official URL + retrieval date + what it sourced + "how to update a rule"

src/web/src/pages/VisaRules/
  VisaRulesPage.tsx  # read-only browser of the KB; imports src/shared/visa-kb directly

test/shared/visaKb/
  schema.test.ts     # Task 2
  loader.test.ts     # Task 3
  queries.test.ts    # Tasks 4-6
  data.test.ts       # Task 9 — data-integrity + versioned-rules guard over the REAL shipped KB

test/web/
  VisaRulesPage.test.tsx  # Task 10

tsconfig.test.json   # Task 1 — so test/** is type-checked by the gate
docs/PHASE-1-REPORT.md   # Task 11
```

---

## Task 1: Type-check the test directories (`tsconfig.test.json`)

**Files:**
- Create: `tsconfig.test.json`
- Modify: `package.json` (the `typecheck` script)
- Modify: existing `test/**/*.ts` / `*.tsx` files only as needed to clear type errors

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run typecheck` now also runs `tsc -p tsconfig.test.json`, covering `test/**`.

**Context:** `tsconfig.server.json` includes `src/server/**` + `src/shared/**`; `tsconfig.web.json` includes `src/web/**` + `src/shared/**` + `test/web/**`. Nothing type-checks `test/server/**` or `test/shared/**`. Phase 1 adds a large `test/shared/visaKb/**` suite that must be type-checked to be trustworthy.

- [ ] **Step 1: Create `tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.web.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/shared/**/*", "src/server/**/*", "src/web/**/*", "test/**/*"]
}
```

(Extending `tsconfig.web.json` gives Bundler resolution + DOM libs + `jsx` + `node`/`vite` types + `verbatimModuleSyntax: false`, which is the permissive combination that covers server, shared, and web test files together. `.js`-suffixed imports in `test/server/**` resolve under Bundler.)

- [ ] **Step 2: Wire it into the gate**

In `package.json`, change the `typecheck` script from
`"tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.web.json"`
to
`"tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.web.json && tsc -p tsconfig.test.json"`

- [ ] **Step 3: Run typecheck, see what breaks**

Run: `npm run typecheck`
Expected: `tsconfig.test.json` reports errors in existing `test/**` files (the Phase 2 whole-branch review estimated ~13 — mostly `noUncheckedIndexedAccess` array/record indexing, and one `SQLOutputValue` mismatch in `test/server/migrations.test.ts`).

- [ ] **Step 4: Fix the errors — mechanically**

For each error:
- `noUncheckedIndexedAccess` on an array/record access the test knows is present → add a non-null assertion (`arr[0]!`) or an explicit guard, matching how `test/server/applicantService.test.ts` already does it.
- The `migrations.test.ts` `SQLOutputValue` mismatch → cast the row shape the way `test/server/applicantService.test.ts` casts `.get()` results (`as { n: number }` etc.).
- Do **not** change test behaviour or assertions — only satisfy the type checker.

**Timebox / fallback:** if more than ~15 errors surface, or any fix needs a judgment call about test intent, narrow the `include` to
`["src/shared/**/*", "src/server/**/*", "src/web/**/*", "test/shared/**/*", "test/web/**/*"]`
(drops `test/server/**` and `test/automation/**`), commit that, and note the remaining directories as a follow-up in the Phase 1 report. Phase 1's new `test/shared/visaKb/**` suite is type-checked either way.

- [ ] **Step 5: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass. (`npm run build` is unaffected — `tsconfig.test.json` has `noEmit`.)

- [ ] **Step 6: Commit**

```bash
git add tsconfig.test.json package.json test/
git commit -m "build: type-check the test directories via tsconfig.test.json

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

---

## Task 2: `src/shared/visa-kb/schema.ts` — Zod schema + types

**Files:**
- Create: `src/shared/visa-kb/schema.ts`
- Create: `src/shared/visa-kb/data/india/meta.json` (only `meta.json` in this task — used to prove the JSON-import mechanism)
- Modify: `tsconfig.server.json` (exclude the module from the server emit)
- Test: `test/shared/visaKb/schema.test.ts`

**Interfaces:**
- Consumes: `isHttpUrl` from `src/shared/url.ts`.
- Produces:
  ```ts
  // tuples
  export const APPLICATION_MODES: readonly ['evisa', 'regular'];
  export const VISA_CATEGORIES: readonly string[];   // see Step 3
  export const PURPOSE_TAGS: readonly string[];
  export const ENTRY_TYPES: readonly ['single', 'double', 'multiple'];
  export const ELIGIBILITY_STATUSES: readonly ['eligible', 'conditional', 'ineligible', 'not_offered'];
  export const KNOWN_SCHEMA_VERSIONS: readonly [1];
  // schemas
  export const sourceSchema, docSchema, validitySchema, stayLimitationsSchema,
    applicationTimingSchema, travelRequirementsSchema, visaCategorySchema,
    conditionSchema, eligibilityRecordSchema, metaSchema, knowledgeBaseSchema;
  // types
  export type Source, VisaDocument, VisaValidity, StayLimitations, ApplicationTiming,
    TravelRequirements, VisaCategory, EligibilityCondition, EligibilityRecord,
    KnowledgeBaseMeta, KnowledgeBase, ApplicationMode, VisaCategoryName, PurposeTag;
  ```

**Context:** This is static-data validation — use `.strict()` on every object so a typo'd field name in a JSON file fails the load. No `blankToNull` / partial-patch machinery (that is for user input, not config).

- [ ] **Step 1: Exclude the module from the server emit**

In `tsconfig.server.json` add, alongside `include`:
```json
"exclude": ["src/shared/visa-kb/**"]
```
Rationale (put it in the commit message): the server does not import `visa-kb` in Phase 1, and its `.json` data files are not copied to `dist/` by `tsc`, so emitting the loader with unresolved JSON imports would leave broken dead files in `dist/`. The module is still fully type-checked by `tsconfig.web.json` (includes `src/shared/**`) and `tsconfig.test.json`. A later phase that makes the server import it re-includes it with a JSON-copy build step.

- [ ] **Step 2: Create `src/shared/visa-kb/data/india/meta.json`**

```json
{
  "schemaVersion": 1,
  "kbVersion": "2026-09-02",
  "destination": "IND",
  "revisionDate": "2026-09-02",
  "notes": "Initial India visa knowledge base for Bangladesh nationals."
}
```

- [ ] **Step 3: Write the failing test `test/shared/visaKb/schema.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  metaSchema, sourceSchema, visaCategorySchema, eligibilityRecordSchema,
  conditionSchema, knowledgeBaseSchema, APPLICATION_MODES, ENTRY_TYPES,
} from '../../../src/shared/visa-kb/schema.js';
import metaJson from '../../../src/shared/visa-kb/data/india/meta.json' with { type: 'json' };

const validSource = { officialUrl: 'https://indianvisaonline.gov.in/evisa/', retrievedAt: '2026-09-02' };

const validCategory = {
  id: 'evisa.tourist.30d',
  applicationMode: 'evisa',
  category: 'tourist',
  subCategory: 'e-Tourist (30 days)',
  officialCode: 'e-T1V',
  displayName: 'e-Tourist Visa — 30 days',
  purpose: ['recreation', 'sightseeing'],
  validity: { amount: 30, unit: 'days', from: 'first_arrival' },
  entries: 'multiple',
  stayLimitations: { notes: 'Single continuous stay; no aggregate cap on the 30-day variant.' },
  extendable: false,
  convertible: false,
  applicationTiming: { minLeadDays: 4, maxLeadDays: 120 },
  travelRequirements: { passportValidityMonthsMin: 6, passportBlankPagesMin: 2, onwardOrReturnTicket: true },
  requiredDocuments: [{ id: 'passport_bio_page', label: 'Passport bio-data page scan' }],
  optionalDocuments: [],
  specialConditions: ['Biometrics captured on arrival'],
  restrictions: ['No employment', 'Cannot be extended or converted'],
  source: validSource,
  lastVerified: '2026-09-02',
};

const validEligibility = {
  nationality: 'BGD',
  applicationMode: 'evisa',
  categoryId: 'evisa.tourist.30d',
  status: 'eligible',
  conditions: [
    { type: 'passport_type_not_in', value: ['diplomatic', 'official'] },
    { type: 'no_prohibited_background', value: ['defence', 'military', 'police'] },
    { type: 'purpose_in', value: ['recreation', 'sightseeing', 'casual_visit'] },
  ],
  basis: 'Bangladesh is on India’s e-Visa eligible-nationalities list.',
  source: validSource,
  lastVerified: '2026-09-02',
};

describe('meta', () => {
  it('parses the shipped meta.json', () => {
    expect(metaSchema.parse(metaJson)).toMatchObject({ destination: 'IND', schemaVersion: 1 });
  });
  it('rejects a non-alpha-3 destination', () => {
    expect(metaSchema.safeParse({ ...metaJson, destination: 'India' }).success).toBe(false);
  });
  it('rejects a malformed revisionDate', () => {
    expect(metaSchema.safeParse({ ...metaJson, revisionDate: '2026-13-40' }).success).toBe(false);
  });
});

describe('source', () => {
  it('requires an http(s) officialUrl and an ISO retrievedAt', () => {
    expect(sourceSchema.safeParse(validSource).success).toBe(true);
    expect(sourceSchema.safeParse({ ...validSource, officialUrl: 'not-a-url' }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...validSource, retrievedAt: '09/02/2026' }).success).toBe(false);
  });
  it('rejects unknown keys (strict)', () => {
    expect(sourceSchema.safeParse({ ...validSource, extra: 1 }).success).toBe(false);
  });
});

describe('visaCategory', () => {
  it('parses a valid category', () => {
    expect(visaCategorySchema.parse(validCategory).id).toBe('evisa.tourist.30d');
  });
  it('rejects an unknown applicationMode', () => {
    expect(visaCategorySchema.safeParse({ ...validCategory, applicationMode: 'walk_in' }).success).toBe(false);
  });
  it('rejects an unknown category enum', () => {
    expect(visaCategorySchema.safeParse({ ...validCategory, category: 'holiday' }).success).toBe(false);
  });
  it('rejects an id without a dot segment', () => {
    expect(visaCategorySchema.safeParse({ ...validCategory, id: 'tourist' }).success).toBe(false);
  });
  it('rejects a category missing its source', () => {
    const { source, ...noSource } = validCategory;
    expect(visaCategorySchema.safeParse(noSource).success).toBe(false);
  });
});

describe('condition', () => {
  it('accepts each known condition type', () => {
    expect(conditionSchema.safeParse({ type: 'not_endorsed_on_relative_passport' }).success).toBe(true);
    expect(conditionSchema.safeParse({ type: 'min_age', value: 18 }).success).toBe(true);
    expect(conditionSchema.safeParse({ type: 'custom', text: 'FRRO registration within 14 days' }).success).toBe(true);
  });
  it('rejects an unknown condition type', () => {
    expect(conditionSchema.safeParse({ type: 'must_be_left_handed' }).success).toBe(false);
  });
});

describe('eligibilityRecord', () => {
  it('parses a valid record', () => {
    expect(eligibilityRecordSchema.parse(validEligibility).status).toBe('eligible');
  });
  it('requires an alpha-3 nationality', () => {
    expect(eligibilityRecordSchema.safeParse({ ...validEligibility, nationality: 'Bangladesh' }).success).toBe(false);
  });
});

describe('knowledgeBase', () => {
  it('parses a minimal KB', () => {
    const kb = knowledgeBaseSchema.parse({ meta: metaJson, categories: [validCategory], eligibility: [validEligibility] });
    expect(kb.categories).toHaveLength(1);
  });
});

it('APPLICATION_MODES and ENTRY_TYPES are the expected tuples', () => {
  expect([...APPLICATION_MODES]).toEqual(['evisa', 'regular']);
  expect([...ENTRY_TYPES]).toEqual(['single', 'double', 'multiple']);
});
```

- [ ] **Step 4: Run — verify it fails**

Run: `npm test -- visaKb/schema`
Expected: FAIL — `src/shared/visa-kb/schema.js` does not exist.

- [ ] **Step 5: Implement `src/shared/visa-kb/schema.ts`**

```ts
import { z } from 'zod';
import { isHttpUrl } from '../url.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects `2026-02-31`, `2026-13-01`, etc. — `Date.parse` alone rolls these over. */
export function isRealCalendarDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const isoDate = z
  .string()
  .regex(ISO_DATE_RE, 'must be YYYY-MM-DD')
  .refine(isRealCalendarDate, 'not a real calendar date');

const alpha3 = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 3166-1 alpha-3 code');

export const APPLICATION_MODES = ['evisa', 'regular'] as const;
export const VISA_CATEGORIES = [
  'tourist', 'business', 'medical', 'medical_attendant', 'conference', 'student',
  'employment', 'transit', 'entry_x', 'journalist', 'research', 'other',
] as const;
export const PURPOSE_TAGS = [
  'recreation', 'sightseeing', 'casual_visit', 'business', 'medical_treatment',
  'medical_attendant', 'conference', 'study', 'employment', 'transit',
  'family_visit', 'yoga_short_course', 'voluntary_work_short', 'other',
] as const;
export const ENTRY_TYPES = ['single', 'double', 'multiple'] as const;
export const ELIGIBILITY_STATUSES = ['eligible', 'conditional', 'ineligible', 'not_offered'] as const;
export const PASSPORT_TYPES = ['ordinary', 'diplomatic', 'official', 'service'] as const;
export const KNOWN_SCHEMA_VERSIONS = [1] as const;

export const sourceSchema = z
  .object({
    officialUrl: z.string().refine(isHttpUrl, 'must be an http(s) URL'),
    retrievedAt: isoDate,
    documentDate: isoDate.optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const docSchema = z
  .object({ id: z.string().min(1), label: z.string().min(1), notes: z.string().min(1).optional() })
  .strict();

export const validitySchema = z
  .object({
    amount: z.number().int().positive(),
    unit: z.enum(['days', 'months', 'years']),
    from: z.enum(['issue', 'first_arrival', 'eta_grant']),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const stayLimitationsSchema = z
  .object({
    perVisitDays: z.number().int().positive().optional(),
    perCalendarYearDays: z.number().int().positive().optional(),
    aggregateDays: z.number().int().positive().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const applicationTimingSchema = z
  .object({
    minLeadDays: z.number().int().nonnegative().optional(),
    maxLeadDays: z.number().int().positive().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const travelRequirementsSchema = z
  .object({
    passportValidityMonthsMin: z.number().int().nonnegative().optional(),
    passportBlankPagesMin: z.number().int().nonnegative().optional(),
    onwardOrReturnTicket: z.boolean().optional(),
    portsOfEntry: z.array(z.string().min(1)).nullable().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const visaCategorySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)+$/, 'id must be dot-separated lowercase slugs'),
    applicationMode: z.enum(APPLICATION_MODES),
    category: z.enum(VISA_CATEGORIES),
    subCategory: z.string().min(1).nullable(),
    officialCode: z.string().min(1).nullable(),
    displayName: z.string().min(1),
    purpose: z.array(z.enum(PURPOSE_TAGS)).min(1),
    validity: validitySchema,
    entries: z.enum(ENTRY_TYPES),
    stayLimitations: stayLimitationsSchema,
    extendable: z.boolean(),
    convertible: z.boolean(),
    applicationTiming: applicationTimingSchema,
    travelRequirements: travelRequirementsSchema,
    requiredDocuments: z.array(docSchema),
    optionalDocuments: z.array(docSchema),
    specialConditions: z.array(z.string().min(1)),
    restrictions: z.array(z.string().min(1)),
    source: sourceSchema,
    lastVerified: isoDate,
  })
  .strict();

export const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('passport_type_in'), value: z.array(z.enum(PASSPORT_TYPES)).min(1) }).strict(),
  z.object({ type: z.literal('passport_type_not_in'), value: z.array(z.enum(PASSPORT_TYPES)).min(1) }).strict(),
  z.object({ type: z.literal('no_prohibited_background'), value: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ type: z.literal('purpose_in'), value: z.array(z.enum(PURPOSE_TAGS)).min(1) }).strict(),
  z.object({ type: z.literal('purpose_not_in'), value: z.array(z.enum(PURPOSE_TAGS)).min(1) }).strict(),
  z.object({ type: z.literal('not_endorsed_on_relative_passport') }).strict(),
  z.object({ type: z.literal('min_age'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('max_age'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('passport_validity_months_min'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('requires_supporting_institution_letter') }).strict(),
  z.object({ type: z.literal('salary_min_inr_per_annum'), value: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('custom'), text: z.string().min(1) }).strict(),
]);

export const eligibilityRecordSchema = z
  .object({
    nationality: alpha3,
    applicationMode: z.enum(APPLICATION_MODES),
    categoryId: z.string().min(1),
    status: z.enum(ELIGIBILITY_STATUSES),
    conditions: z.array(conditionSchema),
    basis: z.string().min(1),
    source: sourceSchema,
    lastVerified: isoDate,
  })
  .strict();

export const metaSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    kbVersion: z.string().min(1),
    destination: alpha3,
    revisionDate: isoDate,
    notes: z.string().min(1).optional(),
  })
  .strict();

export const knowledgeBaseSchema = z
  .object({
    meta: metaSchema,
    categories: z.array(visaCategorySchema),
    eligibility: z.array(eligibilityRecordSchema),
  })
  .strict();

export type Source = z.infer<typeof sourceSchema>;
export type VisaDocument = z.infer<typeof docSchema>;
export type VisaValidity = z.infer<typeof validitySchema>;
export type StayLimitations = z.infer<typeof stayLimitationsSchema>;
export type ApplicationTiming = z.infer<typeof applicationTimingSchema>;
export type TravelRequirements = z.infer<typeof travelRequirementsSchema>;
export type VisaCategory = z.infer<typeof visaCategorySchema>;
export type EligibilityCondition = z.infer<typeof conditionSchema>;
export type EligibilityRecord = z.infer<typeof eligibilityRecordSchema>;
export type KnowledgeBaseMeta = z.infer<typeof metaSchema>;
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;
export type ApplicationMode = (typeof APPLICATION_MODES)[number];
export type VisaCategoryName = (typeof VISA_CATEGORIES)[number];
export type PurposeTag = (typeof PURPOSE_TAGS)[number];
```

- [ ] **Step 6: Run — verify it passes**

Run: `npm test -- visaKb/schema`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. If `tsc -p tsconfig.server.json` complains that `src/shared/visa-kb/**` is now unreferenced, that is fine (it is excluded). If the JSON `with { type: 'json' }` import in the test fails to resolve under `tsconfig.test.json` (Bundler), fall back to importing via a tiny `test/shared/visaKb/fixtures.ts` that re-exports `metaJson` with a plain `import metaJson from '...json'` (no attribute) — Bundler resolves plain JSON imports with `resolveJsonModule`. Note which form worked in the task report.

- [ ] **Step 8: Commit**

```bash
git add src/shared/visa-kb/schema.ts src/shared/visa-kb/data/india/meta.json tsconfig.server.json test/shared/visaKb/schema.test.ts
git commit -m "feat: visa-kb Zod schema for the India knowledge base

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

---

## Task 3: `src/shared/visa-kb/loader.ts` — parse, cross-check, freeze, cache

**Files:**
- Create: `src/shared/visa-kb/loader.ts`
- Create: `src/shared/visa-kb/data/india/{evisa-categories,regular-categories,eligibility.bgd}.json` — as **empty arrays** `[]` for now (real data lands in Tasks 7–9)
- Test: `test/shared/visaKb/loader.test.ts`

**Interfaces:**
- Consumes: `knowledgeBaseSchema`, `KNOWN_SCHEMA_VERSIONS`, `type KnowledgeBase` from `./schema.js`.
- Produces:
  ```ts
  export class KnowledgeBaseError extends Error {}
  export function parseKnowledgeBase(raw: unknown): KnowledgeBase;   // schema + cross-checks + deep-freeze; NOT cached
  export function loadKnowledgeBase(): KnowledgeBase;                // parseKnowledgeBase(bundled data), cached
  export function reload(): void;                                    // clears the cache (tests)
  ```

**Cross-checks `parseKnowledgeBase` runs after the schema passes (each throws `KnowledgeBaseError` with a precise message):**
1. Category `id` values are unique.
2. Every `eligibility[].categoryId` resolves to a category.
3. Every `eligibility[].applicationMode` equals the referenced category's `applicationMode`.
4. No two eligibility records share `(nationality, applicationMode, categoryId)`.
5. `meta.destination === 'IND'`.

- [ ] **Step 1: Create the three empty data files**

`src/shared/visa-kb/data/india/evisa-categories.json` → `[]`
`src/shared/visa-kb/data/india/regular-categories.json` → `[]`
`src/shared/visa-kb/data/india/eligibility.bgd.json` → `[]`

- [ ] **Step 2: Write the failing test `test/shared/visaKb/loader.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { parseKnowledgeBase, loadKnowledgeBase, reload, KnowledgeBaseError } from '../../../src/shared/visa-kb/loader.js';

const meta = { schemaVersion: 1, kbVersion: '2026-09-02', destination: 'IND', revisionDate: '2026-09-02' };
const src = { officialUrl: 'https://indianvisaonline.gov.in/evisa/', retrievedAt: '2026-09-02' };

function cat(over: Record<string, unknown> = {}) {
  return {
    id: 'evisa.tourist.30d', applicationMode: 'evisa', category: 'tourist',
    subCategory: null, officialCode: 'e-T1V', displayName: 'e-Tourist 30d',
    purpose: ['recreation'], validity: { amount: 30, unit: 'days', from: 'first_arrival' },
    entries: 'multiple', stayLimitations: {}, extendable: false, convertible: false,
    applicationTiming: {}, travelRequirements: {}, requiredDocuments: [], optionalDocuments: [],
    specialConditions: [], restrictions: [], source: src, lastVerified: '2026-09-02', ...over,
  };
}
function elig(over: Record<string, unknown> = {}) {
  return {
    nationality: 'BGD', applicationMode: 'evisa', categoryId: 'evisa.tourist.30d',
    status: 'eligible', conditions: [], basis: 'listed', source: src, lastVerified: '2026-09-02', ...over,
  };
}

afterEach(() => reload());

describe('parseKnowledgeBase', () => {
  it('accepts a valid KB and deep-freezes it', () => {
    const kb = parseKnowledgeBase({ meta, categories: [cat()], eligibility: [elig()] });
    expect(kb.categories[0]!.id).toBe('evisa.tourist.30d');
    expect(Object.isFrozen(kb)).toBe(true);
    expect(Object.isFrozen(kb.categories[0])).toBe(true);
    expect(() => { (kb.categories as unknown[]).push({}); }).toThrow();
  });

  it('throws KnowledgeBaseError on a schema violation, naming the field', () => {
    expect(() => parseKnowledgeBase({ meta, categories: [cat({ entries: 'triple' })], eligibility: [] }))
      .toThrow(KnowledgeBaseError);
  });

  it('rejects an unknown schemaVersion', () => {
    expect(() => parseKnowledgeBase({ meta: { ...meta, schemaVersion: 99 }, categories: [], eligibility: [] }))
      .toThrow(/schemaVersion/i);
  });

  it('rejects duplicate category ids', () => {
    expect(() => parseKnowledgeBase({ meta, categories: [cat(), cat()], eligibility: [] }))
      .toThrow(/duplicate .*id/i);
  });

  it('rejects an eligibility record pointing at a missing category', () => {
    expect(() => parseKnowledgeBase({ meta, categories: [cat()], eligibility: [elig({ categoryId: 'evisa.ghost' })] }))
      .toThrow(/evisa\.ghost/);
  });

  it('rejects an eligibility record whose mode differs from its category', () => {
    expect(() => parseKnowledgeBase({ meta, categories: [cat()], eligibility: [elig({ applicationMode: 'regular' })] }))
      .toThrow(/mode/i);
  });

  it('rejects duplicate (nationality, mode, categoryId) eligibility tuples', () => {
    expect(() => parseKnowledgeBase({ meta, categories: [cat()], eligibility: [elig(), elig()] }))
      .toThrow(/duplicate .*eligibility/i);
  });

  it('rejects a non-IND destination', () => {
    expect(() => parseKnowledgeBase({ meta: { ...meta, destination: 'BGD' }, categories: [], eligibility: [] }))
      .toThrow(/destination/i);
  });
});

describe('loadKnowledgeBase', () => {
  it('loads the shipped data (empty categories/eligibility for now) and caches', () => {
    const a = loadKnowledgeBase();
    const b = loadKnowledgeBase();
    expect(a).toBe(b);                 // same frozen instance (cached)
    expect(a.meta.destination).toBe('IND');
    expect(Array.isArray(a.categories)).toBe(true);
  });

  it('reload() clears the cache', () => {
    const a = loadKnowledgeBase();
    reload();
    expect(loadKnowledgeBase()).not.toBe(a);
  });
});
```

- [ ] **Step 3: Run — verify it fails**

Run: `npm test -- visaKb/loader`
Expected: FAIL — `loader.js` does not exist.

- [ ] **Step 4: Implement `src/shared/visa-kb/loader.ts`**

```ts
import evisaCategories from './data/india/evisa-categories.json' with { type: 'json' };
import regularCategories from './data/india/regular-categories.json' with { type: 'json' };
import eligibilityBgd from './data/india/eligibility.bgd.json' with { type: 'json' };
import meta from './data/india/meta.json' with { type: 'json' };
import { knowledgeBaseSchema, KNOWN_SCHEMA_VERSIONS, type KnowledgeBase } from './schema.js';

export class KnowledgeBaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeBaseError';
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export function parseKnowledgeBase(raw: unknown): KnowledgeBase {
  const parsed = knowledgeBaseSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new KnowledgeBaseError(`visa-kb: schema validation failed — ${detail}`);
  }
  const kb = parsed.data;

  if (!(KNOWN_SCHEMA_VERSIONS as readonly number[]).includes(kb.meta.schemaVersion)) {
    throw new KnowledgeBaseError(
      `visa-kb: unknown schemaVersion ${kb.meta.schemaVersion} (known: ${KNOWN_SCHEMA_VERSIONS.join(', ')})`,
    );
  }
  if (kb.meta.destination !== 'IND') {
    throw new KnowledgeBaseError(`visa-kb: meta.destination must be "IND", got "${kb.meta.destination}"`);
  }

  const ids = new Set<string>();
  for (const c of kb.categories) {
    if (ids.has(c.id)) throw new KnowledgeBaseError(`visa-kb: duplicate category id "${c.id}"`);
    ids.add(c.id);
  }

  const byId = new Map(kb.categories.map((c) => [c.id, c]));
  const seenTuples = new Set<string>();
  for (const e of kb.eligibility) {
    const target = byId.get(e.categoryId);
    if (!target) {
      throw new KnowledgeBaseError(`visa-kb: eligibility record points at missing category "${e.categoryId}"`);
    }
    if (target.applicationMode !== e.applicationMode) {
      throw new KnowledgeBaseError(
        `visa-kb: eligibility for "${e.categoryId}" has mode "${e.applicationMode}" but the category is "${target.applicationMode}"`,
      );
    }
    const tuple = `${e.nationality}|${e.applicationMode}|${e.categoryId}`;
    if (seenTuples.has(tuple)) {
      throw new KnowledgeBaseError(`visa-kb: duplicate eligibility record for (${tuple.replace(/\|/g, ', ')})`);
    }
    seenTuples.add(tuple);
  }

  return deepFreeze(kb);
}

let cached: KnowledgeBase | null = null;

export function loadKnowledgeBase(): KnowledgeBase {
  if (!cached) {
    cached = parseKnowledgeBase({
      meta,
      categories: [...evisaCategories, ...regularCategories],
      eligibility: eligibilityBgd,
    });
  }
  return cached;
}

export function reload(): void {
  cached = null;
}
```

- [ ] **Step 5: Run — verify it passes**

Run: `npm test -- visaKb/loader`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. If the JSON import attribute form fails under one toolchain, apply the same fallback noted in Task 2 Step 7 (plain `import x from './x.json'` without the attribute — Bundler and NodeNext both resolve it with `resolveJsonModule: true`; drop the `with { type: 'json' }` everywhere for consistency) and note it.

- [ ] **Step 7: Commit**

```bash
git add src/shared/visa-kb/loader.ts src/shared/visa-kb/data/india/ test/shared/visaKb/loader.test.ts
git commit -m "feat: visa-kb loader — validate, cross-check, freeze, cache

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

---

## Task 4: `queries.ts` — version, category lookup, mode filtering

**Files:**
- Create: `src/shared/visa-kb/queries.ts`
- Test: `test/shared/visaKb/queries.test.ts`

**Interfaces:**
- Consumes: `loadKnowledgeBase` from `./loader.js`; `type KnowledgeBase, VisaCategory, ApplicationMode, VisaCategoryName` from `./schema.js`.
- Produces:
  ```ts
  export function getVersion(kb?: KnowledgeBase): { schemaVersion: number; kbVersion: string; revisionDate: string; destination: string };
  export function listCategories(opts?: { applicationMode?: ApplicationMode; category?: VisaCategoryName }, kb?: KnowledgeBase): VisaCategory[];
  export function getCategory(id: string, kb?: KnowledgeBase): VisaCategory | null;
  export function getCategoriesForMode(mode: ApplicationMode, kb?: KnowledgeBase): VisaCategory[];
  ```
  Every function that takes `kb?` defaults it to `loadKnowledgeBase()`.

- [ ] **Step 1: Write the failing test** — append to `test/shared/visaKb/queries.test.ts`

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { parseKnowledgeBase, reload } from '../../../src/shared/visa-kb/loader.js';
import { getVersion, listCategories, getCategory, getCategoriesForMode } from '../../../src/shared/visa-kb/queries.js';

const src = { officialUrl: 'https://indianvisaonline.gov.in/evisa/', retrievedAt: '2026-09-02' };
const base = {
  subCategory: null, officialCode: null, purpose: ['recreation'],
  validity: { amount: 1, unit: 'years', from: 'eta_grant' }, entries: 'multiple',
  stayLimitations: {}, extendable: false, convertible: false, applicationTiming: {},
  travelRequirements: {}, requiredDocuments: [], optionalDocuments: [],
  specialConditions: [], restrictions: [], source: src, lastVerified: '2026-09-02',
};
const KB = parseKnowledgeBase({
  meta: { schemaVersion: 1, kbVersion: '2026-09-02', destination: 'IND', revisionDate: '2026-09-02' },
  categories: [
    { ...base, id: 'evisa.tourist.30d', applicationMode: 'evisa', category: 'tourist', displayName: 'e-Tourist 30d' },
    { ...base, id: 'evisa.business', applicationMode: 'evisa', category: 'business', displayName: 'e-Business' },
    { ...base, id: 'regular.tourist', applicationMode: 'regular', category: 'tourist', displayName: 'Tourist (paper)' },
  ],
  eligibility: [],
});

afterEach(() => reload());

describe('getVersion', () => {
  it('returns the meta version fields', () => {
    expect(getVersion(KB)).toEqual({
      schemaVersion: 1, kbVersion: '2026-09-02', revisionDate: '2026-09-02', destination: 'IND',
    });
  });
});

describe('category lookup', () => {
  it('getCategory returns the entry or null', () => {
    expect(getCategory('evisa.business', KB)?.displayName).toBe('e-Business');
    expect(getCategory('evisa.nope', KB)).toBeNull();
  });
  it('listCategories with no filter returns every entry', () => {
    expect(listCategories({}, KB).map((c) => c.id).sort())
      .toEqual(['evisa.business', 'evisa.tourist.30d', 'regular.tourist']);
  });
  it('listCategories filters by category name', () => {
    expect(listCategories({ category: 'tourist' }, KB).map((c) => c.id).sort())
      .toEqual(['evisa.tourist.30d', 'regular.tourist']);
  });
});

describe('application-mode filtering', () => {
  it('getCategoriesForMode returns only that mode', () => {
    const evisa = getCategoriesForMode('evisa', KB);
    expect(evisa.map((c) => c.id).sort()).toEqual(['evisa.business', 'evisa.tourist.30d']);
    expect(evisa.every((c) => c.applicationMode === 'evisa')).toBe(true);
  });
  it('never leaks the other mode', () => {
    expect(getCategoriesForMode('regular', KB).some((c) => c.applicationMode === 'evisa')).toBe(false);
  });
  it('listCategories({ applicationMode }) agrees with getCategoriesForMode', () => {
    expect(listCategories({ applicationMode: 'evisa' }, KB).map((c) => c.id).sort())
      .toEqual(getCategoriesForMode('evisa', KB).map((c) => c.id).sort());
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- visaKb/queries`
Expected: FAIL — `queries.js` does not exist.

- [ ] **Step 3: Implement `src/shared/visa-kb/queries.ts` (this task's portion)**

```ts
import { loadKnowledgeBase } from './loader.js';
import type { ApplicationMode, KnowledgeBase, VisaCategory, VisaCategoryName } from './schema.js';

export function getVersion(kb: KnowledgeBase = loadKnowledgeBase()): {
  schemaVersion: number;
  kbVersion: string;
  revisionDate: string;
  destination: string;
} {
  const { schemaVersion, kbVersion, revisionDate, destination } = kb.meta;
  return { schemaVersion, kbVersion, revisionDate, destination };
}

export function listCategories(
  opts: { applicationMode?: ApplicationMode; category?: VisaCategoryName } = {},
  kb: KnowledgeBase = loadKnowledgeBase(),
): VisaCategory[] {
  return kb.categories.filter(
    (c) =>
      (opts.applicationMode === undefined || c.applicationMode === opts.applicationMode) &&
      (opts.category === undefined || c.category === opts.category),
  );
}

export function getCategory(id: string, kb: KnowledgeBase = loadKnowledgeBase()): VisaCategory | null {
  return kb.categories.find((c) => c.id === id) ?? null;
}

export function getCategoriesForMode(
  mode: ApplicationMode,
  kb: KnowledgeBase = loadKnowledgeBase(),
): VisaCategory[] {
  return kb.categories.filter((c) => c.applicationMode === mode);
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npm test -- visaKb/queries`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/visa-kb/queries.ts test/shared/visaKb/queries.test.ts
git commit -m "feat: visa-kb queries — version, category lookup, mode filtering

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

---

## Task 5: `queries.ts` — eligibility + document requirements

**Files:**
- Modify: `src/shared/visa-kb/queries.ts`
- Test: `test/shared/visaKb/queries.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: everything from Task 4; `type EligibilityCondition, EligibilityRecord, Source, VisaDocument` from `./schema.js`.
- Produces:
  ```ts
  export type EligibilityResult =
    | { status: 'eligible' | 'conditional' | 'ineligible' | 'not_offered';
        conditions: EligibilityCondition[]; basis: string; source: Source; lastVerified: string }
    | { status: 'unknown'; reason: string };

  export function checkEligibility(nationality: string, mode: ApplicationMode, categoryId: string, kb?: KnowledgeBase): EligibilityResult;
  export function listEligibleCategories(nationality: string, mode: ApplicationMode, kb?: KnowledgeBase): { category: VisaCategory; eligibility: EligibilityRecord }[];
  export function getDocumentRequirements(categoryId: string, kb?: KnowledgeBase): { required: VisaDocument[]; optional: VisaDocument[] } | null;
  ```

- [ ] **Step 1: Write the failing test** — add to `test/shared/visaKb/queries.test.ts`

```ts
import { checkEligibility, listEligibleCategories, getDocumentRequirements } from '../../../src/shared/visa-kb/queries.js';

const KB2 = parseKnowledgeBase({
  meta: { schemaVersion: 1, kbVersion: '2026-09-02', destination: 'IND', revisionDate: '2026-09-02' },
  categories: [
    { ...base, id: 'evisa.tourist.30d', applicationMode: 'evisa', category: 'tourist', displayName: 'e-Tourist 30d',
      requiredDocuments: [{ id: 'passport_bio_page', label: 'Passport bio page' }, { id: 'photo', label: 'Photo' }],
      optionalDocuments: [{ id: 'itinerary', label: 'Travel itinerary' }] },
    { ...base, id: 'evisa.journalist', applicationMode: 'evisa', category: 'journalist', displayName: 'e-Journalist' },
    { ...base, id: 'regular.employment', applicationMode: 'regular', category: 'employment', displayName: 'Employment' },
  ],
  eligibility: [
    { nationality: 'BGD', applicationMode: 'evisa', categoryId: 'evisa.tourist.30d', status: 'eligible',
      conditions: [{ type: 'purpose_in', value: ['recreation'] }], basis: 'listed', source: src, lastVerified: '2026-09-02' },
    { nationality: 'BGD', applicationMode: 'evisa', categoryId: 'evisa.journalist', status: 'not_offered',
      conditions: [], basis: 'e-Visa is not allowed for journalism', source: src, lastVerified: '2026-09-02' },
    { nationality: 'BGD', applicationMode: 'regular', categoryId: 'regular.employment', status: 'conditional',
      conditions: [{ type: 'salary_min_inr_per_annum', value: 1625000 }], basis: 'salary floor', source: src, lastVerified: '2026-09-02' },
  ],
});

describe('nationality eligibility', () => {
  it('returns the explicit record for a known tuple', () => {
    const r = checkEligibility('BGD', 'evisa', 'evisa.tourist.30d', KB2);
    expect(r.status).toBe('eligible');
    if (r.status !== 'unknown') expect(r.conditions).toEqual([{ type: 'purpose_in', value: ['recreation'] }]);
  });
  it('returns unknown — never inferred — when no record exists', () => {
    const r = checkEligibility('BGD', 'regular', 'regular.employment', KB2); // exists
    expect(r.status).toBe('conditional');
    const missing = checkEligibility('BGD', 'evisa', 'evisa.tourist.30d', parseKnowledgeBase({
      meta: { schemaVersion: 1, kbVersion: 'x', destination: 'IND', revisionDate: '2026-09-02' },
      categories: [{ ...base, id: 'evisa.tourist.30d', applicationMode: 'evisa', category: 'tourist', displayName: 'x' }],
      eligibility: [],
    }));
    expect(missing.status).toBe('unknown');
    if (missing.status === 'unknown') expect(missing.reason).toMatch(/no eligibility rule/i);
  });
  it('surfaces an explicit not_offered / ineligible rather than hiding it', () => {
    expect(checkEligibility('BGD', 'evisa', 'evisa.journalist', KB2).status).toBe('not_offered');
  });
  it('listEligibleCategories returns only eligible/conditional, with the joined category', () => {
    const list = listEligibleCategories('BGD', 'evisa', KB2);
    expect(list.map((x) => x.category.id)).toEqual(['evisa.tourist.30d']); // journalist is not_offered
  });
});

describe('document requirements', () => {
  it('returns required + optional for a known category', () => {
    expect(getDocumentRequirements('evisa.tourist.30d', KB2)).toEqual({
      required: [{ id: 'passport_bio_page', label: 'Passport bio page' }, { id: 'photo', label: 'Photo' }],
      optional: [{ id: 'itinerary', label: 'Travel itinerary' }],
    });
  });
  it('returns { required, optional: [] } for a category with no optional docs', () => {
    expect(getDocumentRequirements('evisa.journalist', KB2)).toEqual({ required: [], optional: [] });
  });
  it('returns null for an unknown category', () => {
    expect(getDocumentRequirements('evisa.nope', KB2)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- visaKb/queries`
Expected: FAIL — `checkEligibility` is not exported.

- [ ] **Step 3: Add to `src/shared/visa-kb/queries.ts`**

```ts
import type {
  ApplicationMode, EligibilityCondition, EligibilityRecord, KnowledgeBase, Source, VisaCategory, VisaDocument, VisaCategoryName,
} from './schema.js';
// (merge with the Task 4 import line)

export type EligibilityResult =
  | {
      status: 'eligible' | 'conditional' | 'ineligible' | 'not_offered';
      conditions: EligibilityCondition[];
      basis: string;
      source: Source;
      lastVerified: string;
    }
  | { status: 'unknown'; reason: string };

function findEligibility(
  kb: KnowledgeBase,
  nationality: string,
  mode: ApplicationMode,
  categoryId: string,
): EligibilityRecord | undefined {
  return kb.eligibility.find(
    (e) => e.nationality === nationality && e.applicationMode === mode && e.categoryId === categoryId,
  );
}

export function checkEligibility(
  nationality: string,
  mode: ApplicationMode,
  categoryId: string,
  kb: KnowledgeBase = loadKnowledgeBase(),
): EligibilityResult {
  const rec = findEligibility(kb, nationality, mode, categoryId);
  if (!rec) {
    return {
      status: 'unknown',
      reason: `no eligibility rule recorded for ${nationality} × ${mode} × ${categoryId}`,
    };
  }
  return {
    status: rec.status,
    conditions: rec.conditions,
    basis: rec.basis,
    source: rec.source,
    lastVerified: rec.lastVerified,
  };
}

export function listEligibleCategories(
  nationality: string,
  mode: ApplicationMode,
  kb: KnowledgeBase = loadKnowledgeBase(),
): { category: VisaCategory; eligibility: EligibilityRecord }[] {
  const out: { category: VisaCategory; eligibility: EligibilityRecord }[] = [];
  for (const e of kb.eligibility) {
    if (e.nationality !== nationality || e.applicationMode !== mode) continue;
    if (e.status !== 'eligible' && e.status !== 'conditional') continue;
    const category = getCategory(e.categoryId, kb);
    if (category) out.push({ category, eligibility: e });
  }
  return out;
}

export function getDocumentRequirements(
  categoryId: string,
  kb: KnowledgeBase = loadKnowledgeBase(),
): { required: VisaDocument[]; optional: VisaDocument[] } | null {
  const c = getCategory(categoryId, kb);
  if (!c) return null;
  return { required: [...c.requiredDocuments], optional: [...c.optionalDocuments] };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npm test -- visaKb/queries`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/visa-kb/queries.ts test/shared/visaKb/queries.test.ts
git commit -m "feat: visa-kb queries — nationality eligibility (never inferred) + document requirements

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

---

## Task 6: `queries.ts` — `validateCombination` + `index.ts` barrel

**Files:**
- Modify: `src/shared/visa-kb/queries.ts`
- Create: `src/shared/visa-kb/index.ts`
- Test: `test/shared/visaKb/queries.test.ts` (add a `describe` block)

**Interfaces:**
- Produces:
  ```ts
  export type ValidationResult =
    | { valid: true; categoryId: string }
    | { valid: false;
        code: 'UNKNOWN_MODE' | 'UNKNOWN_CATEGORY' | 'MODE_MISMATCH' | 'NO_ELIGIBILITY_RULE' | 'INELIGIBLE' | 'NOT_OFFERED';
        message: string };

  export function validateCombination(
    input: { nationality?: string; applicationMode: string; categoryId: string },
    kb?: KnowledgeBase,
  ): ValidationResult;
  ```
- `src/shared/visa-kb/index.ts`: `export * from './schema.js'; export * from './loader.js'; export * from './queries.js';`

**Check order** (return the first failure): `UNKNOWN_MODE` → `UNKNOWN_CATEGORY` → `MODE_MISMATCH` → (only if `nationality` given) `NO_ELIGIBILITY_RULE` → `INELIGIBLE` → `NOT_OFFERED` → `{ valid: true }`.

- [ ] **Step 1: Write the failing test** — add to `test/shared/visaKb/queries.test.ts`

```ts
import { validateCombination } from '../../../src/shared/visa-kb/queries.js';

describe('invalid category combinations', () => {
  it('UNKNOWN_MODE for a bad mode', () => {
    const r = validateCombination({ applicationMode: 'walk_in', categoryId: 'evisa.tourist.30d' }, KB2);
    expect(r).toMatchObject({ valid: false, code: 'UNKNOWN_MODE' });
  });
  it('UNKNOWN_CATEGORY for a missing id', () => {
    expect(validateCombination({ applicationMode: 'evisa', categoryId: 'evisa.ghost' }, KB2))
      .toMatchObject({ valid: false, code: 'UNKNOWN_CATEGORY' });
  });
  it('MODE_MISMATCH when the id belongs to the other mode', () => {
    expect(validateCombination({ applicationMode: 'regular', categoryId: 'evisa.tourist.30d' }, KB2))
      .toMatchObject({ valid: false, code: 'MODE_MISMATCH' });
  });
  it('NO_ELIGIBILITY_RULE when a nationality is given but no record exists', () => {
    const kbNoElig = parseKnowledgeBase({
      meta: { schemaVersion: 1, kbVersion: 'x', destination: 'IND', revisionDate: '2026-09-02' },
      categories: [{ ...base, id: 'evisa.tourist.30d', applicationMode: 'evisa', category: 'tourist', displayName: 'x' }],
      eligibility: [],
    });
    expect(validateCombination({ nationality: 'BGD', applicationMode: 'evisa', categoryId: 'evisa.tourist.30d' }, kbNoElig))
      .toMatchObject({ valid: false, code: 'NO_ELIGIBILITY_RULE' });
  });
  it('NOT_OFFERED / INELIGIBLE surface the explicit status', () => {
    expect(validateCombination({ nationality: 'BGD', applicationMode: 'evisa', categoryId: 'evisa.journalist' }, KB2))
      .toMatchObject({ valid: false, code: 'NOT_OFFERED' });
  });
  it('valid combo → { valid: true, categoryId }', () => {
    expect(validateCombination({ nationality: 'BGD', applicationMode: 'evisa', categoryId: 'evisa.tourist.30d' }, KB2))
      .toEqual({ valid: true, categoryId: 'evisa.tourist.30d' });
  });
  it('valid without a nationality skips the eligibility checks', () => {
    expect(validateCombination({ applicationMode: 'evisa', categoryId: 'evisa.journalist' }, KB2))
      .toEqual({ valid: true, categoryId: 'evisa.journalist' });
  });
});

it('index.ts re-exports the public API', async () => {
  const kb = await import('../../../src/shared/visa-kb/index.js');
  expect(typeof kb.loadKnowledgeBase).toBe('function');
  expect(typeof kb.validateCombination).toBe('function');
  expect(typeof kb.knowledgeBaseSchema).toBe('object');
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- visaKb/queries`
Expected: FAIL — `validateCombination` / `index.js` missing.

- [ ] **Step 3: Add `validateCombination` to `queries.ts`**

```ts
export type ValidationResult =
  | { valid: true; categoryId: string }
  | {
      valid: false;
      code: 'UNKNOWN_MODE' | 'UNKNOWN_CATEGORY' | 'MODE_MISMATCH' | 'NO_ELIGIBILITY_RULE' | 'INELIGIBLE' | 'NOT_OFFERED';
      message: string;
    };

export function validateCombination(
  input: { nationality?: string; applicationMode: string; categoryId: string },
  kb: KnowledgeBase = loadKnowledgeBase(),
): ValidationResult {
  const { nationality, applicationMode, categoryId } = input;

  if (applicationMode !== 'evisa' && applicationMode !== 'regular') {
    return { valid: false, code: 'UNKNOWN_MODE', message: `unknown application mode "${applicationMode}"` };
  }

  const cat = kb.categories.find((c) => c.id === categoryId);
  if (!cat) {
    return { valid: false, code: 'UNKNOWN_CATEGORY', message: `no visa category "${categoryId}"` };
  }
  if (cat.applicationMode !== applicationMode) {
    return {
      valid: false,
      code: 'MODE_MISMATCH',
      message: `category "${categoryId}" is a ${cat.applicationMode} visa, not ${applicationMode}`,
    };
  }

  if (nationality !== undefined) {
    const elig = checkEligibility(nationality, applicationMode, categoryId, kb);
    if (elig.status === 'unknown') {
      return { valid: false, code: 'NO_ELIGIBILITY_RULE', message: elig.reason };
    }
    if (elig.status === 'ineligible') {
      return { valid: false, code: 'INELIGIBLE', message: `${nationality} is not eligible for "${categoryId}"` };
    }
    if (elig.status === 'not_offered') {
      return { valid: false, code: 'NOT_OFFERED', message: `"${categoryId}" is not offered to ${nationality}` };
    }
  }

  return { valid: true, categoryId };
}
```

- [ ] **Step 4: Create `src/shared/visa-kb/index.ts`**

```ts
export * from './schema.js';
export * from './loader.js';
export * from './queries.js';
```

- [ ] **Step 5: Run — verify it passes**

Run: `npm test -- visaKb/queries`
Expected: PASS.

- [ ] **Step 6: Full gate for the module**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/visa-kb/queries.ts src/shared/visa-kb/index.ts test/shared/visaKb/queries.test.ts
git commit -m "feat: visa-kb validateCombination + public API barrel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

---

## Task 7: Seed data — e-Visa categories

**Files:**
- Replace: `src/shared/visa-kb/data/india/evisa-categories.json` (was `[]`)
- Create: `src/shared/visa-kb/data/india/SOURCES.md`
- Test: `test/shared/visaKb/data.test.ts` (partial — e-Visa coverage)

**This task requires web research.** Use official Indian government sources only. Record every URL + the date you retrieved it in `SOURCES.md`.

**Primary sources:**
- `https://indianvisaonline.gov.in/evisa/` and the pages it links (Instructions, "e-Visa" duration/validity tables).
- `https://www.mha.gov.in/` visa annexes (Annex III — e-Visa details).
- `https://boi.gov.in/` (Bureau of Immigration — visa-on-arrival / e-Visa).

**Reference structure captured on 2026-09-02 from `indianvisaonline.gov.in/evisa/`** (verify each value against the live page; the page carried a "last updated 2019" stamp, so cross-check with MHA annexes and flag anything that looks stale in `source.notes`):

| id | officialCode | validity | entries | stay | timing | notes |
|---|---|---|---|---|---|---|
| `evisa.tourist.30d` | e-T1V | 30 days from first arrival | multiple | single continuous, no aggregate cap | min 4 / max 120 lead days | |
| `evisa.tourist.1y` | e-T1V | 365 days from ETA grant | multiple | 180 days per calendar year | min 4 / max 120 | |
| `evisa.tourist.5y` | e-T1V | 5 years from ETA grant | multiple | 180 days per calendar year | min 4 / max 120 | |
| `evisa.business` | e-B1V | 365 days from ETA grant | multiple | ≤180 days per visit; >180 needs FRRO registration | min 4 / max 120 | |
| `evisa.medical` | e-M1V | 365 days from first arrival | multiple (triple within validity per some sources — verify) | per-visit limit — verify | min 4 / max 120 | |
| `evisa.medical_attendant` | e-M2V | 365 days from first arrival | multiple | max **two** attendant visas per e-Medical visa | min 4 / max 120 | |
| `evisa.conference` | e-B5V | 30 days from arrival | multiple | — | organiser uploads to `conference.mha.gov.in` | `category: 'conference'` |
| `evisa.student` | e-SV | 365 days from ETA grant | multiple | — | verify availability | |
| `evisa.transit` | e-TRV | 30 days from first arrival | multiple | short transit only | | `category: 'transit'` |
| `evisa.entry_x` | e-X1V | 3 months from first entry | multiple | — | family/misc | `category: 'entry_x'` |

- [ ] **Step 1: Write the failing test — start `test/shared/visaKb/data.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import evisa from '../../../src/shared/visa-kb/data/india/evisa-categories.json' with { type: 'json' };
import { visaCategorySchema } from '../../../src/shared/visa-kb/schema.js';

describe('e-Visa seed data', () => {
  it('is a non-empty array of schema-valid categories, all applicationMode "evisa"', () => {
    expect(Array.isArray(evisa)).toBe(true);
    expect(evisa.length).toBeGreaterThanOrEqual(8);
    for (const entry of evisa) {
      const parsed = visaCategorySchema.safeParse(entry);
      expect(parsed.success, JSON.stringify(entry) + '\n' + JSON.stringify(parsed.error?.issues)).toBe(true);
      expect((entry as { applicationMode: string }).applicationMode).toBe('evisa');
    }
  });
  it('every entry has a real official source URL and a retrieval date', () => {
    for (const e of evisa as { source: { officialUrl: string; retrievedAt: string } }[]) {
      expect(e.source.officialUrl).toMatch(/^https?:\/\/(www\.)?(indianvisaonline\.gov\.in|mha\.gov\.in|boi\.gov\.in)/);
      expect(e.source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it('covers the e-Tourist 30d / 1y / 5y split and e-Business / e-Medical', () => {
    const ids = new Set((evisa as { id: string }[]).map((e) => e.id));
    for (const id of ['evisa.tourist.30d', 'evisa.tourist.1y', 'evisa.tourist.5y', 'evisa.business', 'evisa.medical']) {
      expect(ids.has(id), `missing ${id}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- visaKb/data`
Expected: FAIL — the file is `[]`.

- [ ] **Step 3: Research and author `evisa-categories.json`**

For each id in the table: open the official source, read the current validity / entries / stay / timing / documents / conditions / restrictions, and write the entry. One fully-worked example (adapt the rest — do NOT copy blindly, verify each):

```json
{
  "id": "evisa.tourist.30d",
  "applicationMode": "evisa",
  "category": "tourist",
  "subCategory": "e-Tourist (30 days)",
  "officialCode": "e-T1V",
  "displayName": "e-Tourist Visa — 30 days",
  "purpose": ["recreation", "sightseeing", "casual_visit"],
  "validity": { "amount": 30, "unit": "days", "from": "first_arrival", "notes": "Non-extendable, non-convertible." },
  "entries": "multiple",
  "stayLimitations": { "notes": "Continuous stay within the 30-day window; no per-calendar-year cap on this variant." },
  "extendable": false,
  "convertible": false,
  "applicationTiming": { "minLeadDays": 4, "maxLeadDays": 120, "notes": "Apply at least 4 days before arrival, up to 120 days ahead." },
  "travelRequirements": {
    "passportValidityMonthsMin": 6,
    "passportBlankPagesMin": 2,
    "onwardOrReturnTicket": true,
    "portsOfEntry": null,
    "notes": "Entry only at designated e-Visa airports and seaports; exit from any authorised Immigration Check Post."
  },
  "requiredDocuments": [
    { "id": "passport_bio_page", "label": "Scan of the passport bio-data / photo page" },
    { "id": "photo", "label": "Recent colour photograph (square, plain light background)" }
  ],
  "optionalDocuments": [
    { "id": "return_ticket", "label": "Confirmed return or onward ticket" }
  ],
  "specialConditions": [
    "Biometrics captured on arrival in India.",
    "e-Visa fee is non-refundable once the application is submitted."
  ],
  "restrictions": [
    "Not valid for employment, journalism, NGO work, research, missionary work, or Protected/Restricted Area visits.",
    "Cannot be extended or converted to another visa category."
  ],
  "source": {
    "officialUrl": "https://indianvisaonline.gov.in/evisa/tvoa.html",
    "retrievedAt": "2026-09-02",
    "documentDate": "2019-05-16",
    "notes": "Page's own 'last updated' stamp is 2019; validity/stay cross-checked against MHA Annex III."
  },
  "lastVerified": "2026-09-02"
}
```

If a rule you find does not fit the schema (a field the schema lacks), STOP: amend `schema.ts` (add the optional field), bump `meta.schemaVersion` to `2` and add it to `KNOWN_SCHEMA_VERSIONS`, update the schema test, and note it in the task report before continuing.

- [ ] **Step 4: Write `SOURCES.md`**

Sections: **Sources used** (a table: URL · retrieved · what it sourced) and **How to update a rule** (edit the JSON entry; set its `lastVerified` and `source.retrievedAt`; bump `meta.kbVersion` + `meta.revisionDate`; run `npm test` — the data-integrity test in `test/shared/visaKb/data.test.ts` catches dangling refs and missing provenance).

- [ ] **Step 5: Run — verify it passes**

Run: `npm test -- visaKb`
Expected: PASS (schema, loader, queries, and the new e-Visa data test).

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/visa-kb/data/india/evisa-categories.json src/shared/visa-kb/data/india/SOURCES.md test/shared/visaKb/data.test.ts
git commit -m "feat: visa-kb e-Visa category seed data (India, sourced)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

---

## Task 8: Seed data — Regular/Paper categories

**Files:**
- Replace: `src/shared/visa-kb/data/india/regular-categories.json` (was `[]`)
- Modify: `src/shared/visa-kb/data/india/SOURCES.md` (add the sources used here)
- Test: `test/shared/visaKb/data.test.ts` (add a `describe` block)

**This task requires web research.** Official sources:
- `https://hcidhaka.gov.in/` — High Commission of India, Dhaka: category-wise visa document lists for Bangladesh nationals (the `Documents_required_for_visa.pdf` and the visa-services pages).
- `https://www.ivacbd.com/` — Indian Visa Application Centre, Bangladesh (operational category list; cross-check against HCI Dhaka).
- `https://indianvisaonline.gov.in/visa/visa-category.html` — the general regular-visa category list.
- `https://www.mha.gov.in/` Annex IV — "Visa for Bangladesh Nationals" (bilateral provisions, e.g. the multi-entry tourist visa arrangement).
- India–Bangladesh Revised Travel Arrangement (RTA) — for the bilateral tourist-visa terms.

**Categories to seed** (id · category enum):

| id | category | notes |
|---|---|---|
| `regular.tourist` | `tourist` | single-entry 30–90 days from issue; capture the India–Bangladesh bilateral multi-entry provision in `specialConditions` (and/or a second entry `regular.tourist.multi` if the terms differ enough — planner decides once the terms are read) |
| `regular.business` | `business` | |
| `regular.medical` | `medical` | |
| `regular.medical_attendant` | `medical_attendant` | |
| `regular.employment` | `employment` | includes the spouse-of-Indian-national salary-floor note |
| `regular.student` | `student` | |
| `regular.conference` | `conference` | |
| `regular.transit` | `transit` | |
| `regular.entry_x` | `entry_x` | "Entry (X)" visa — spouse/dependant of Indian national / PIO |

Note the June 2026 reopening of Bangladesh tourist-visa processing (after the Aug 2024 suspension) in `source.notes` / `specialConditions` where relevant — with the official notice URL if one is found.

- [ ] **Step 1: Write the failing test — add to `test/shared/visaKb/data.test.ts`**

```ts
import regular from '../../../src/shared/visa-kb/data/india/regular-categories.json' with { type: 'json' };

describe('Regular/Paper seed data', () => {
  it('is a non-empty array of schema-valid categories, all applicationMode "regular"', () => {
    expect(regular.length).toBeGreaterThanOrEqual(7);
    for (const entry of regular) {
      expect(visaCategorySchema.safeParse(entry).success, JSON.stringify(entry)).toBe(true);
      expect((entry as { applicationMode: string }).applicationMode).toBe('regular');
    }
  });
  it('covers tourist / business / medical / employment / student', () => {
    const ids = new Set((regular as { id: string }[]).map((e) => e.id));
    for (const id of ['regular.tourist', 'regular.business', 'regular.medical', 'regular.employment', 'regular.student']) {
      expect(ids.has(id), `missing ${id}`).toBe(true);
    }
  });
  it('the tourist entry records the India–Bangladesh bilateral provision', () => {
    const t = (regular as { id: string; specialConditions: string[] }[]).find((e) => e.id === 'regular.tourist');
    expect(t && t.specialConditions.join(' ')).toMatch(/bilateral|multiple[- ]entry|travel arrangement/i);
  });
  it('every entry has an official source URL (HCI Dhaka / indianvisaonline / MHA / IVAC BD)', () => {
    for (const e of regular as { source: { officialUrl: string } }[]) {
      expect(e.source.officialUrl).toMatch(/hcidhaka\.gov\.in|indianvisaonline\.gov\.in|mha\.gov\.in|ivacbd\.com|boi\.gov\.in/);
    }
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- visaKb/data`
Expected: FAIL — the file is `[]`.

- [ ] **Step 3: Research and author `regular-categories.json`**

Same discipline as Task 7. One example:

```json
{
  "id": "regular.medical",
  "applicationMode": "regular",
  "category": "medical",
  "subCategory": null,
  "officialCode": "MED",
  "displayName": "Medical Visa",
  "purpose": ["medical_treatment"],
  "validity": { "amount": 6, "unit": "months", "from": "issue", "notes": "Or the treatment duration, whichever is shorter; longer terms possible on hospital recommendation." },
  "entries": "multiple",
  "stayLimitations": { "notes": "Aligned to the treatment schedule; FRRO/FRRO registration if the stay exceeds 180 days." },
  "extendable": true,
  "convertible": false,
  "applicationTiming": { "notes": "Apply once the appointment / hospital letter is available." },
  "travelRequirements": { "passportValidityMonthsMin": 6, "passportBlankPagesMin": 2 },
  "requiredDocuments": [
    { "id": "passport_bio_page", "label": "Passport bio-data page (original + copy)" },
    { "id": "hospital_letter_india", "label": "Letter from the treating hospital / institution in India" },
    { "id": "local_doctor_referral", "label": "Referral / diagnosis letter from a registered doctor in Bangladesh" },
    { "id": "financial_proof", "label": "Proof of funds for treatment and stay" }
  ],
  "optionalDocuments": [
    { "id": "prior_medical_records", "label": "Prior medical reports / test results" }
  ],
  "specialConditions": [
    "Up to two Medical Attendant visas may be issued to accompanying family members.",
    "Registration with the FRRO/FRO within 14 days of arrival if the stay exceeds 180 days."
  ],
  "restrictions": [
    "For recognised, specialised treatment only — not for routine consultation.",
    "No employment."
  ],
  "source": {
    "officialUrl": "https://hcidhaka.gov.in/visa?id=medical",
    "retrievedAt": "2026-09-02",
    "notes": "Cross-checked against indianvisaonline.gov.in visa-category page."
  },
  "lastVerified": "2026-09-02"
}
```

- [ ] **Step 4: Update `SOURCES.md`** — add the Regular-visa sources to the table.

- [ ] **Step 5: Run — verify it passes**

Run: `npm test -- visaKb`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/visa-kb/data/india/regular-categories.json src/shared/visa-kb/data/india/SOURCES.md test/shared/visaKb/data.test.ts
git commit -m "feat: visa-kb Regular/Paper category seed data (India for Bangladesh nationals, sourced)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

---

## Task 9: Seed data — Bangladesh eligibility + full data-integrity guard

**Files:**
- Replace: `src/shared/visa-kb/data/india/eligibility.bgd.json` (was `[]`)
- Modify: `src/shared/visa-kb/data/india/SOURCES.md`
- Test: `test/shared/visaKb/data.test.ts` (add the full-KB integrity + versioned-rules block)

**This task requires web research** for the Bangladesh-specific eligibility facts:
- Bangladesh is on the India e-Visa eligible-nationalities list (`indianvisaonline.gov.in/evisa/` country list).
- e-Visa universal exclusions (diplomatic/official passport; defence/military/police/security background; employment / NGO / journalism purpose; endorsed on a relative's passport; non-passport travel document) — encode as `conditions` on **every** e-Visa eligibility record.
- Any e-Visa sub-type **not** offered to Bangladesh, or offered only conditionally → an explicit record with `status: "not_offered"` / `"conditional"` and a `basis`. Do not infer.
- Regular-visa eligibility for Bangladesh nationals (all categories generally available; capture the bilateral tourist provision and the spouse-of-Indian salary floor as `conditional`).

**Rule: one eligibility record per seeded category.** Every id in `evisa-categories.json` and `regular-categories.json` gets exactly one `BGD` record.

- [ ] **Step 1: Write the failing test — add the integrity block to `test/shared/visaKb/data.test.ts`**

```ts
import { loadKnowledgeBase, reload } from '../../../src/shared/visa-kb/loader.js';
import { getVersion } from '../../../src/shared/visa-kb/queries.js';
import { afterEach } from 'vitest';

afterEach(() => reload());

describe('the shipped India KB — integrity & versioning', () => {
  it('loads without error (all cross-checks pass)', () => {
    expect(() => loadKnowledgeBase()).not.toThrow();
  });

  it('every category has exactly one Bangladesh eligibility record', () => {
    const kb = loadKnowledgeBase();
    const bgd = kb.eligibility.filter((e) => e.nationality === 'BGD');
    const covered = new Map<string, number>();
    for (const e of bgd) covered.set(e.categoryId, (covered.get(e.categoryId) ?? 0) + 1);
    for (const c of kb.categories) {
      expect(covered.get(c.id), `no BGD eligibility record for ${c.id}`).toBe(1);
    }
    expect(bgd.length).toBe(kb.categories.length);
  });

  it('every e-Visa eligibility record encodes the universal exclusions', () => {
    const kb = loadKnowledgeBase();
    for (const e of kb.eligibility.filter((x) => x.applicationMode === 'evisa')) {
      const types = e.conditions.map((c) => c.type);
      expect(types, e.categoryId).toContain('passport_type_not_in');
      expect(types, e.categoryId).toContain('no_prohibited_background');
    }
  });

  it('getVersion reports the meta version, and every entry carries provenance', () => {
    const kb = loadKnowledgeBase();
    const v = getVersion(kb);
    expect(v.kbVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.schemaVersion).toBeGreaterThanOrEqual(1);
    for (const entry of [...kb.categories, ...kb.eligibility]) {
      expect(entry.source.officialUrl).toMatch(/^https?:\/\//);
      expect(entry.source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('no eligibility record silently implies eligibility for a category that has none', () => {
    // sanity: there is no category without a record (covered above); this asserts the guarantee explicitly
    const kb = loadKnowledgeBase();
    const recorded = new Set(kb.eligibility.map((e) => `${e.nationality}|${e.applicationMode}|${e.categoryId}`));
    for (const c of kb.categories) {
      expect(recorded.has(`BGD|${c.applicationMode}|${c.id}`)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- visaKb/data`
Expected: FAIL — `eligibility.bgd.json` is `[]`, so the "one record per category" test fails.

- [ ] **Step 3: Research and author `eligibility.bgd.json`**

One record per category. Examples:

```json
[
  {
    "nationality": "BGD",
    "applicationMode": "evisa",
    "categoryId": "evisa.tourist.30d",
    "status": "eligible",
    "conditions": [
      { "type": "passport_type_not_in", "value": ["diplomatic", "official", "service"] },
      { "type": "no_prohibited_background", "value": ["defence", "military", "police", "security"] },
      { "type": "not_endorsed_on_relative_passport" },
      { "type": "passport_validity_months_min", "value": 6 },
      { "type": "purpose_in", "value": ["recreation", "sightseeing", "casual_visit"] }
    ],
    "basis": "Bangladesh is listed on India's e-Visa eligible-nationalities page; the e-Tourist sub-category is offered to eligible nationals subject to the standard e-Visa exclusions.",
    "source": { "officialUrl": "https://indianvisaonline.gov.in/evisa/", "retrievedAt": "2026-09-02" },
    "lastVerified": "2026-09-02"
  },
  {
    "nationality": "BGD",
    "applicationMode": "evisa",
    "categoryId": "evisa.journalist",
    "status": "not_offered",
    "conditions": [],
    "basis": "The e-Visa scheme explicitly excludes journalism as a purpose for all nationalities; a Regular Journalist visa is required instead.",
    "source": { "officialUrl": "https://indianvisaonline.gov.in/evisa/", "retrievedAt": "2026-09-02" },
    "lastVerified": "2026-09-02"
  }
]
```
(If Task 7 did not seed `evisa.journalist`, do not add an eligibility record for it — records exist only for seeded categories.)

- [ ] **Step 4: Update `SOURCES.md`** — add the eligibility sources.

- [ ] **Step 5: Run — verify it passes**

Run: `npm test -- visaKb`
Expected: PASS (all visa-kb tests, including the full integrity guard).

- [ ] **Step 6: Full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/visa-kb/data/india/eligibility.bgd.json src/shared/visa-kb/data/india/SOURCES.md test/shared/visaKb/data.test.ts
git commit -m "feat: visa-kb explicit Bangladesh eligibility records + full data-integrity guard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

---

## Task 10: React reference page — `/visa-rules`

**Files:**
- Create: `src/web/src/pages/VisaRules/VisaRulesPage.tsx`
- Modify: `src/web/src/main.tsx` (route), `src/web/src/App.tsx` (nav link), `src/web/src/styles.css` (page styles)
- Test: `test/web/VisaRulesPage.test.tsx`

**Interfaces:**
- Consumes: `getVersion`, `getCategoriesForMode`, `getCategory`, `getDocumentRequirements`, `checkEligibility`, `type VisaCategory, ApplicationMode` from `../../../../shared/visa-kb/index` (extensionless — web/Bundler; **four** `../` from `src/web/src/pages/VisaRules/`, matching how `pages/Applicants/ApplicantsPage.tsx` imports `../../../../shared/applicant/types`).
- Produces: `export function VisaRulesPage()` (named export, no default).

- [ ] **Step 1: Write the failing test `test/web/VisaRulesPage.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VisaRulesPage } from '../../src/web/src/pages/VisaRules/VisaRulesPage';

vi.mock('../../src/shared/visa-kb/index', () => {
  const src = { officialUrl: 'https://indianvisaonline.gov.in/evisa/', retrievedAt: '2026-09-02' };
  const mk = (id: string, applicationMode: string, category: string, displayName: string) => ({
    id, applicationMode, category, displayName, subCategory: null, officialCode: null,
    purpose: ['recreation'], validity: { amount: 30, unit: 'days', from: 'first_arrival' },
    entries: 'multiple', stayLimitations: {}, extendable: false, convertible: false,
    applicationTiming: {}, travelRequirements: {},
    requiredDocuments: [{ id: 'passport_bio_page', label: 'Passport bio page' }],
    optionalDocuments: [], specialConditions: [], restrictions: [], source: src, lastVerified: '2026-09-02',
  });
  const evisa = [mk('evisa.tourist.30d', 'evisa', 'tourist', 'e-Tourist 30d')];
  const regular = [mk('regular.tourist', 'regular', 'tourist', 'Tourist (paper)')];
  const all = [...evisa, ...regular];
  return {
    getVersion: () => ({ schemaVersion: 1, kbVersion: '2026-09-02', revisionDate: '2026-09-02', destination: 'IND' }),
    getCategoriesForMode: (m: string) => (m === 'evisa' ? evisa : regular),
    getCategory: (id: string) => all.find((c) => c.id === id) ?? null,
    getDocumentRequirements: (id: string) => {
      const c = all.find((x) => x.id === id);
      return c ? { required: c.requiredDocuments, optional: c.optionalDocuments } : null;
    },
    checkEligibility: (_n: string, m: string, id: string) =>
      id === 'evisa.tourist.30d'
        ? { status: 'eligible', conditions: [], basis: 'listed', source: src, lastVerified: '2026-09-02' }
        : { status: 'unknown', reason: 'no eligibility rule recorded' },
  };
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('renders the KB version and the e-Visa category list by default', async () => {
  render(<MemoryRouter><VisaRulesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/KB version 2026-09-02/i)).toBeTruthy());
  expect(screen.getByText('e-Tourist 30d')).toBeTruthy();
});

it('the mode toggle switches to the Regular list', async () => {
  render(<MemoryRouter><VisaRulesPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /regular \/ paper/i }));
  await waitFor(() => expect(screen.getByText('Tourist (paper)')).toBeTruthy());
  expect(screen.queryByText('e-Tourist 30d')).toBeNull();
});

it('selecting a category shows its documents, eligibility, and an external source link', async () => {
  render(<MemoryRouter><VisaRulesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByText('e-Tourist 30d'));
  await waitFor(() => expect(screen.getByText('Passport bio page')).toBeTruthy());
  expect(screen.getByText(/eligible/i)).toBeTruthy();
  const link = screen.getByRole('link', { name: /official source/i }) as HTMLAnchorElement;
  expect(link.href).toContain('indianvisaonline.gov.in');
});

it('a category with no eligibility rule shows the "no rule recorded" message, never "eligible"', async () => {
  render(<MemoryRouter><VisaRulesPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /regular \/ paper/i }));
  fireEvent.click(await screen.findByText('Tourist (paper)'));
  await waitFor(() => expect(screen.getByText(/no Bangladesh eligibility rule recorded/i)).toBeTruthy());
  expect(screen.queryByText(/^eligible$/i)).toBeNull();
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- VisaRulesPage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/web/src/pages/VisaRules/VisaRulesPage.tsx`**

```tsx
import { useMemo, useState } from 'react';
import {
  checkEligibility, getCategoriesForMode, getDocumentRequirements, getVersion,
  type ApplicationMode, type EligibilityCondition, type VisaCategory,
} from '../../../../shared/visa-kb/index';

const NATIONALITY = 'BGD';

function formatCondition(c: EligibilityCondition): string {
  switch (c.type) {
    case 'custom': return c.text;
    case 'not_endorsed_on_relative_passport': return 'Applicant holds their own passport (not endorsed on a relative’s).';
    case 'requires_supporting_institution_letter': return 'A supporting letter from the sponsoring institution is required.';
    case 'passport_type_in': return `Passport type is one of: ${c.value.join(', ')}.`;
    case 'passport_type_not_in': return `Passport type must not be: ${c.value.join(', ')}.`;
    case 'no_prohibited_background': return `No background in: ${c.value.join(', ')}.`;
    case 'purpose_in': return `Trip purpose is one of: ${c.value.join(', ')}.`;
    case 'purpose_not_in': return `Trip purpose must not be: ${c.value.join(', ')}.`;
    case 'min_age': return `Minimum age ${c.value}.`;
    case 'max_age': return `Maximum age ${c.value}.`;
    case 'passport_validity_months_min': return `Passport valid for at least ${c.value} months.`;
    case 'salary_min_inr_per_annum': return `Minimum annual salary ₹${c.value.toLocaleString('en-IN')}.`;
    default: { const _exhaustive: never = c; return _exhaustive; }
  }
}

export function VisaRulesPage() {
  const version = useMemo(() => getVersion(), []);
  const [mode, setMode] = useState<ApplicationMode>('evisa');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const categories = useMemo(() => getCategoriesForMode(mode), [mode]);
  const selected = useMemo<VisaCategory | null>(
    () => categories.find((c) => c.id === selectedId) ?? null,
    [categories, selectedId],
  );

  function switchMode(next: ApplicationMode) {
    setMode(next);
    setSelectedId(null);
  }

  return (
    <section className="visa-rules">
      <div className="section-head">
        <h2>India visa rules</h2>
        <span className="muted">
          KB version {version.kbVersion} · revised {version.revisionDate}
        </span>
      </div>

      <div className="visa-rules__modes" role="group" aria-label="Application mode">
        <button
          className={mode === 'evisa' ? 'active' : ''}
          aria-pressed={mode === 'evisa'}
          onClick={() => switchMode('evisa')}
        >
          e-Visa
        </button>
        <button
          className={mode === 'regular' ? 'active' : ''}
          aria-pressed={mode === 'regular'}
          onClick={() => switchMode('regular')}
        >
          Regular / Paper
        </button>
      </div>

      <div className="visa-rules__body">
        <ul className="visa-rules__list">
          {categories.map((c) => (
            <li key={c.id}>
              <button
                className={selectedId === c.id ? 'active' : ''}
                onClick={() => setSelectedId(c.id)}
              >
                <strong>{c.displayName}</strong>
                <span className="muted">
                  {c.validity.amount} {c.validity.unit} · {c.entries} entry · {c.officialCode ?? '—'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected && <VisaCategoryDetail category={selected} mode={mode} />}
      </div>
    </section>
  );
}

function VisaCategoryDetail({ category, mode }: { category: VisaCategory; mode: ApplicationMode }) {
  const docs = getDocumentRequirements(category.id);
  const eligibility = checkEligibility(NATIONALITY, mode, category.id);

  return (
    <div className="visa-rules__detail">
      <h3>{category.displayName}</h3>

      <dl>
        <dt>Purpose</dt><dd>{category.purpose.join(', ')}</dd>
        <dt>Validity</dt>
        <dd>{category.validity.amount} {category.validity.unit} from {category.validity.from.replace(/_/g, ' ')}
          {category.validity.notes ? ` — ${category.validity.notes}` : ''}</dd>
        <dt>Entries</dt><dd>{category.entries}</dd>
        <dt>Stay</dt>
        <dd>
          {[
            category.stayLimitations.perVisitDays && `${category.stayLimitations.perVisitDays} days per visit`,
            category.stayLimitations.perCalendarYearDays && `${category.stayLimitations.perCalendarYearDays} days per calendar year`,
            category.stayLimitations.aggregateDays && `${category.stayLimitations.aggregateDays} days aggregate`,
            category.stayLimitations.notes,
          ].filter(Boolean).join(' · ') || '—'}
        </dd>
        <dt>Application timing</dt>
        <dd>
          {[
            category.applicationTiming.minLeadDays != null && `at least ${category.applicationTiming.minLeadDays} days before travel`,
            category.applicationTiming.maxLeadDays != null && `up to ${category.applicationTiming.maxLeadDays} days ahead`,
            category.applicationTiming.notes,
          ].filter(Boolean).join(' · ') || '—'}
        </dd>
        <dt>Extendable / convertible</dt>
        <dd>{category.extendable ? 'Extendable' : 'Not extendable'} · {category.convertible ? 'Convertible' : 'Not convertible'}</dd>
      </dl>

      <h4>Required documents</h4>
      <ul>{(docs?.required ?? []).map((d) => <li key={d.id}>{d.label}{d.notes ? ` — ${d.notes}` : ''}</li>)}</ul>
      {docs && docs.optional.length > 0 && (
        <>
          <h4>Optional / conditional documents</h4>
          <ul>{docs.optional.map((d) => <li key={d.id}>{d.label}</li>)}</ul>
        </>
      )}

      {category.specialConditions.length > 0 && (
        <>
          <h4>Special conditions</h4>
          <ul>{category.specialConditions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {category.restrictions.length > 0 && (
        <>
          <h4>Restrictions</h4>
          <ul>{category.restrictions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}

      <h4>Bangladesh eligibility</h4>
      {eligibility.status === 'unknown' ? (
        <p className="warning">No Bangladesh eligibility rule recorded for this category.</p>
      ) : (
        <>
          <p><span className={`badge badge--${eligibility.status === 'eligible' ? 'verified' : 'partial'}`}>{eligibility.status}</span> {eligibility.basis}</p>
          {eligibility.conditions.length > 0 && (
            <ul>
              {eligibility.conditions.map((c, i) => <li key={i}>{formatCondition(c)}</li>)}
            </ul>
          )}
        </>
      )}

      <p className="muted">
        <a href={category.source.officialUrl} target="_blank" rel="noreferrer">Official source</a>
        {' · '}retrieved {category.source.retrievedAt}
        {category.source.notes ? ` · ${category.source.notes}` : ''}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route and nav**

`src/web/src/main.tsx` — add the import and a child route:
```tsx
import { VisaRulesPage } from './pages/VisaRules/VisaRulesPage';
```
```tsx
      { path: 'visa-rules', element: <VisaRulesPage /> },
```

`src/web/src/App.tsx` — add a `NavLink` after "Applicants":
```tsx
          <NavLink to="/visa-rules">Visa Rules</NavLink>
```

- [ ] **Step 5: Add page styles to `src/web/src/styles.css`**

Append ~30 lines, reusing existing tokens and the `.badge` / `.muted` / `.warning` / `.section-head` classes already in the file:
```css
.visa-rules__modes { display: flex; gap: 0.5rem; margin: 0.75rem 0; }
.visa-rules__modes button { padding: 0.35rem 0.9rem; }
.visa-rules__modes button.active { border-color: var(--accent); font-weight: 600; }
.visa-rules__body { display: grid; grid-template-columns: minmax(220px, 320px) 1fr; gap: 1.25rem; align-items: start; }
.visa-rules__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
.visa-rules__list button { display: flex; flex-direction: column; align-items: flex-start; width: 100%; text-align: left; padding: 0.5rem 0.7rem; }
.visa-rules__list button.active { border-color: var(--accent); }
.visa-rules__detail { border: 1px solid var(--border); border-radius: 6px; padding: 1rem 1.15rem; }
.visa-rules__detail dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 0.9rem; margin: 0.5rem 0 1rem; }
.visa-rules__detail dt { font-weight: 600; }
.visa-rules__detail dd { margin: 0; }
@media (max-width: 720px) { .visa-rules__body { grid-template-columns: 1fr; } }
```
(If a token like `--accent` is not defined in `styles.css`, use the literal the file already uses for the equivalent — match, don't invent.)

- [ ] **Step 6: Run — verify it passes**

Run: `npm test -- VisaRulesPage`
Expected: PASS (4 tests).

- [ ] **Step 7: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS. The web build bundles the visa-kb JSON into the SPA — confirm `npm run build` succeeds and `dist/web/assets/*.js` grew.

- [ ] **Step 8: Commit**

```bash
git add src/web/src/pages/VisaRules src/web/src/main.tsx src/web/src/App.tsx src/web/src/styles.css test/web/VisaRulesPage.test.tsx
git commit -m "feat: India visa rules reference page (/visa-rules), reads the shared KB directly

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

---

## Task 11: Docs, full gate, and PHASE-1-REPORT

**Files:**
- Create: `docs/PHASE-1-REPORT.md`
- Modify: `docs/ARCHITECTURE.md` (one paragraph noting the new module)

- [ ] **Step 1: Update `docs/ARCHITECTURE.md`**

In the source-layout section, add a short paragraph after the Phase 2 note:
> **Phase 1 (visa knowledge base):** `src/shared/visa-kb/` is a pure, dependency-light module — a Zod schema, a loader that validates and freezes versioned JSON rule data (`data/india/`), and query functions (category lookup, application-mode filtering, explicit-never-inferred nationality eligibility, document requirements, invalid-combination validation). e-Visa and Regular/Paper categories are separate JSON files; Bangladesh eligibility is a set of explicit per-category records. The React `/visa-rules` page imports the module directly; there is no HTTP API. Rule changes are a JSON edit plus a `meta.kbVersion` bump. See `docs/PHASE-1-REPORT.md`.

- [ ] **Step 2: Run the full gate and capture output**

```
npm run typecheck
npm run lint
npm test
npm run build
```
All must pass. Record the exact test count.

- [ ] **Step 3: Write `docs/PHASE-1-REPORT.md`**

Sections (the Phase 1 prompt's deliverables):
1. **Data model** — the schema (link `schema.ts` and spec §4); the 17 represented fields with a one-line note each on where they live.
2. **Files created / changed** — from `git diff --stat <phase-1-first-commit>^..HEAD`.
3. **Official sources used** — reproduce the `SOURCES.md` table (URL · retrieved · what it sourced), plus a note on any entry flagged stale/ambiguous.
4. **Tests** — every test file + count; the six required areas mapped to specific test names; the data-integrity guard.
5. **Typecheck / Lint / Build** — the Step 2 output.
6. **Commit hash** — the final commit on the branch.
7. **Acceptance checklist** — spec §10, every box ticked with evidence.
8. **Known limitations** — seed data is a 2026-09-02 point-in-time snapshot; some official pages are stale-dated; `tsconfig.test.json` coverage (full `test/**` or narrowed — whichever Task 1 landed); conditions are descriptive data with no evaluator yet.
9. **Recommended next** — Phase 2's document system (upload / metadata / storage), which was deferred.

- [ ] **Step 4: Commit**

```bash
git add docs/PHASE-1-REPORT.md docs/ARCHITECTURE.md
git commit -m "docs: Phase 1 report — India visa knowledge base

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F6ySxKk5V7fSstM6uHgRTa"
```

- [ ] **Step 5: Present the report and STOP**

Present the acceptance checklist with evidence, the gate results, the sources used, files changed, and the final commit hash. Do not start Phase 2's document system.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §3 architecture / placement / layering | T2 (module + server-exclude), T4–T6 (queries), T10 (page) |
| §3 JSON import mechanism verified in both toolchains | T2 Step 7, T3 Step 6 |
| §4.1 `meta.json` single version | T2 (file), T3 (schemaVersion check), T4 (`getVersion`) |
| §4.2 visa category — all 17 fields | T2 (`visaCategorySchema`), T7/T8 (populated) |
| §4.3 eligibility record + `status` semantics + condition vocab | T2 (`eligibilityRecordSchema`, `conditionSchema`), T9 (populated) |
| §4.4 loader cross-checks (5) | T3 |
| §5 query API (8 functions) | T4 (4), T5 (3), T6 (1 + barrel) |
| §5 `EligibilityResult` unknown-never-inferred | T5 |
| §5 `validateCombination` — 6 codes, ordered | T6 |
| §6 React `/visa-rules` page | T10 |
| §7 seed data — e-Visa sub-types | T7 |
| §7 seed data — Regular categories incl. bilateral tourist | T8 |
| §7 seed data — explicit BGD eligibility per category | T9 |
| §7 `SOURCES.md` + "how to update a rule" | T7 (start), T8/T9 (extend) |
| §8 versioning — one active version + per-entry provenance | T2, T3, T9 (versioned-rules test) |
| §9 test areas 1–8 | T2 (schema), T3 (loader), T4 (lookup/mode), T5 (eligibility/docs), T6 (invalid combos), T9 (integrity + versioned), T10 (page) |
| §10 acceptance checklist | T11 |
| §11 `tsconfig.test.json` | T1 |
| §12 file inventory | all tasks; T11 lists final |
| §13 risks | mitigations built into T2 Step 7 (import), T1 timebox (tsconfig), T7 Step 3 (schema-amend path), T9 (integrity guard) |

No gaps.

**2. Placeholder scan**

- T7/T8/T9 "research and author" steps contain a full worked example plus the exact source URLs and the id/field table — the implementer fills real values from named sources, which is the nature of a sourced-data task, not a placeholder. Each ends with a schema-validated test.
- T8 "a second entry `regular.tourist.multi` if the terms differ enough — planner decides once the terms are read" — bounded delegation with a concrete trigger (do the terms differ), not an open TODO.
- No "TBD", no "add error handling", no "similar to Task N", no undefined types.

**3. Type consistency**

- `loadKnowledgeBase` / `parseKnowledgeBase` / `reload` / `KnowledgeBaseError` — same names in T3 (defined), T4–T6 (consumed), T9 (consumed).
- `VisaCategory`, `EligibilityRecord`, `EligibilityCondition`, `Source`, `VisaDocument`, `KnowledgeBase`, `ApplicationMode`, `VisaCategoryName` — defined in T2's `schema.ts`, consumed unchanged in T4–T6, T10.
- `EligibilityResult` (T5), `ValidationResult` + codes (T6) — the six codes in the type match the six the T6 implementation returns and the T6 tests assert.
- `getVersion` return shape — identical in T4 (impl), T9 (test), T10 (page), T11 (report).
- Query function signatures with the trailing `kb?: KnowledgeBase` default — consistent across T4/T5/T6 and used positionally in every test.
- `getCategoriesForMode` (not `getCategoriesByMode`), `getDocumentRequirements` (not `getRequiredDocuments`), `checkEligibility` (not `getEligibility`), `validateCombination` (not `validateCategoryCombination`) — one name each, used identically in tests, the page, and the report.
