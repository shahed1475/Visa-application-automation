# Phase 8 — Real-Portal Readiness: timing, observability, mapping ergonomics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining gap between the Phase 5–7 controlled-autofill engine and a *genuinely usable* local Indian-visa agent — realistic configurable browser timing, a deterministic sub-2-minute performance guarantee, run observability (elapsed / ETA / section / milestone timeline), a safe document pause, and lower-friction discovery→mapping promotion — without rebuilding any existing subsystem.

**Architecture:** A **delta on Phases 5–7**. No new subsystem, **no DB migration** (`LATEST_SCHEMA_VERSION` stays 6), no change to `RunStatus`, `EVENT_TYPES`, `WaitingReason`, or the no-submit rails. New: one pure timing module, one pure progress-estimate module, a fixture-deterministic benchmark, UI additions to the existing run page, and promotion-output ergonomics. Real-portal field mappings stay **source-edited** in `indiaPortalMap.ts` (git-reviewed); this phase only makes the promote output complete and adds a "copy all" + auto-rendered doc tables.

**Tech Stack:** Node ≥ 24, Fastify 5, Zod, React 18 + Vite 5, Playwright chromium, Vitest 3 (`pool: 'forks'`), `@testing-library/react` + jsdom. **No new runtime dependency.**

## Context & design decisions (this replaces a separate spec)

Audit at `phase-7-portal-validation-autofill` HEAD `ea50294`:

* **Baseline gate:** typecheck 0 · lint 0 · build 0 (bundle 460.13 kB) · **1206 / 1207 tests** — `test/web/ApplicationDashboardPage.test.tsx` "an application-scoped field input calls setApplicationFieldValue" is **flaky** (passes in isolation, fails under full-suite parallel load; pre-existing, not a Phase 7 regression). Task 1 fixes it so the baseline is a true 1207/1207.
* **Already built — do NOT touch behaviourally:** read-only `DiscoveryController` (single `page.goto`, zero mutating calls), discovery routes + `DiscoverySessionPage` (capture → candidates → `/promote` → `/validate-adapter`), the full mapping lifecycle (`classifyMapping` / `isProductionUsable`, provenance fields on `IndiaFieldMapping`, production gate `status === 'validated' && validatedAgainstRevision === indiaPortalMap.mappingRevision`, stale auto-detection), the run engine `runLoop` with every safe stop (`stale_mapping`, `missing_field_mapping`, `option_unavailable`, `value_conflict`, `value_mismatch`, `unknown_page`, `session_expired`, `validation_error`, `document_upload_required`, nav-stall), exact dropdown match, deterministic date transforms, configured-fallback-only `resolveSelector` → `SELECTOR_STALE`, `AutomationService.startRun` (readiness gate + ToS gate + browser launch + entry-url goto + loop + status mapping), resume / abort / crash-recovery, route `POST /api/applications/:id/automation-runs`, and the run UI (provenance line, stale-mapping alert, "Prepared — NOT submitted" banner, conflict panel). `ReadyForAutomationSection` **already calls `api.startAutomationRun`** and navigates to the run page.
* **Decision 1 (user-approved):** keep the **source-edit mapping model** + add promotion smoothing (Task 10/11). No DB mapping table.
* **Decision 2 (user-approved):** the 3-minute figure is the *whole* human portal process incl. payment/submit. Our autofill stops at `review_ready` **before** payment, so its target is **modeled ≤ 120 s** under the `normal` timing profile, proven by a **fixture-deterministic** benchmark. A real-portal timing check is a documented `INDIA_LIVE=1` manual smoke, never in CI.
* **Genuine remaining delta** → the 14 tasks below.
* **Branch:** Phase 7 (`phase-7-portal-validation-autofill` @ `ea50294`) is complete but **not merged** (gh not authed). Before Task 1, cut `phase-8-real-portal-readiness` from `ea50294`. Phase 7's `finishing-a-development-branch` folds into Task 14 (both branches are reviewed together over `74fc162..HEAD`).

## Global Constraints

Every task's requirements implicitly include this section. Values are verbatim from the directive.

* Terminal automation state remains **`review_ready`**. There must be **no** `submitted` / `payment_completed` / `appointment_booked` as a `RunStatus`, `EVENT_TYPES` member, or `WaitingReason` — and no code path that submits, pays, books an appointment, registers an account, or solves / retrieves / bypasses CAPTCHA / OTP / MFA / anti-bot.
* A production mapping is usable **only** when `status === 'validated'` **and** `validatedAgainstRevision === indiaPortalMap.mappingRevision`. Anything else (placeholder / discovered / stale / missing stamp) is rejected by the engine.
* **No DB migration this phase.** `LATEST_SCHEMA_VERSION === 6`. No new column on `automation_runs`, `automation_events`, or any `portal_discovery_*` table.
* Never guess a selector. Never fuzzy-match a dropdown — **exact string equality only**. Date formats are explicit transforms (`DateFormatError` on anything unexpected).
* Timing exists for **reliability and realistic interaction**, never for anti-bot evasion. No stealth plugin, fingerprint spoofing, or protection-defeating mechanism. If the site blocks automation → STOP and tell the user.
* **Real Indian portal Track B validation must NOT be performed automatically** during implementation. No test hits a real portal URL. `resolveAdapter` never receives a real India URL in any automated test.
* PII (names, passport numbers, emails, phones, addresses, dates of birth, field values) must never reach persistent logs, `automation_events`, `automation_runs`, or `portal_discovery_*`. Tests use synthetic markers only.
* Do not modify unrelated Phase 0–7 behaviour. Prefer existing project utilities over new dependencies — **no new runtime dependency**.
* TDD per task: write the failing test first, watch it fail, minimal implementation, focused test green, then `npm run typecheck` + `npm run lint` + (full `npm test` where the change is cross-cutting) + `npm run build`, review the diff, **commit separately**, report, stop for approval.
* Timing profile default is **`normal`**; selectable via `AUTOMATION_TIMING_PROFILE` = `fast` | `normal` | `careful`.

## File structure

**Create:**

* `src/server/automation/engine/timing.ts` — pure. `TimingProfileName`, `TimingProfile`, `TIMING_PROFILES`, `resolveTimingProfile`, `BENCHMARK_TIMING`.
* `src/shared/automation/progress.ts` — pure. `estimateRemainingMs`, `elapsedMs`, `formatDuration`.
* `src/server/automation/adapters/india/fieldTablesMarkdown.ts` — pure. Renders the three india.md field-support tables from persisted discovery + the live map.
* `test/automation/phase8Timing.test.ts` — timing profile + engine-consumes-profile coverage.
* `test/automation/phase8Benchmark.test.ts` — deterministic fixture benchmark + modeled-real-duration assertion.
* `test/shared/automation/progress.test.ts` — progress math.
* `docs/portals/india-validation-report-TEMPLATE.md` — Track B per-field validation report template.
* `docs/superpowers/reports/PHASE-8-REPORT.md` — end-of-phase report.

**Modify:**

* `src/server/env.ts` — add `AUTOMATION_TIMING_PROFILE` enum.
* `src/server/automation/engine/pageActions.ts` — `waitForPageSettled` / `resolveSelector` take an optional timing arg; add `scrollIntoViewAndSettle`.
* `src/server/automation/engine/fieldActions.ts` — pre-write scroll + `fieldInteractionDelayMs`; `postFillVerifyDelayMs` before read-back; inject `delay`.
* `src/server/automation/engine/automationEngine.ts` — `EngineContext.timing` + `EngineContext.delay`; use nav / verify / scroll delays; document branch becomes a **pause** not a fail.
* `src/server/automation/automationService.ts` — resolve the profile from env, inject `timing` + `delay` into `EngineContext`.
* `src/server/automation/adapters/india/indiaMappingRegistry.ts` — `promoteCandidate` literal gains `validatedAt` / `validatedAgainstRevision` TODO stamps + checklist header; new `renderPromotedBundle`.
* `src/server/routes/discovery.ts` — `POST /api/discovery-sessions/:id/promote-bundle`, `GET /api/discovery-sessions/:id/field-tables`.
* `src/web/src/api/client.ts` — `promoteBundle`, `getFieldTables`.
* `src/web/src/pages/Automation/AutomationRunPage.tsx` — elapsed timer, ETA, section, `<ProgressTimeline>`.
* `src/web/src/pages/Automation/runChrome.tsx` — `ProgressTimeline`, `RunTiming` components; `document_upload_required` copy check.
* `src/web/src/pages/Applications/ReadyForAutomationSection.tsx` — copy fix.
* `src/web/src/pages/Discovery/DiscoverySessionPage.tsx` + `discoveryChrome.tsx` — "Copy all promoted" + "Copy field tables" buttons.
* `docs/portals/india.md` — numbered Track B execution checklist; field-tables section note.
* `docs/superpowers/reports/PHASE-7-REPORT.md` — fill §§17–20.
* `docs/ARCHITECTURE.md` — §3 Phase 8 paragraph.
* Test files: `ApplicationDashboardPage.test.tsx`, `automationEngine.test.ts`, `fieldActions.test.ts`, `pageActions.test.ts`, `automationService.test.ts`, `ReadyForAutomationSection.test.tsx`, `AutomationRunPage.test.tsx`, `indiaMappingRegistry.test.ts`, `discoveryRoutes.test.ts`, `env.test.ts`, `noAutoSubmit.test.ts`.

---

### Task 1: Stabilise the flaky dashboard test

**Files:**
- Modify: `test/web/ApplicationDashboardPage.test.tsx` (the `an application-scoped field input calls setApplicationFieldValue` case, ~L240–260)

**Interfaces:** none — test-only.

- [ ] **Step 1: Reproduce**

Run: `npx vitest run test/web/ApplicationDashboardPage.test.tsx -t "application-scoped field input" --repeat 20`
Expected: at least one failure with `value: null` instead of the typed string (the `fireEvent.click(save)` fires before React commits the controlled input's `onChange`).

- [ ] **Step 2: Fix the interaction, not the assertion**

Replace the `fireEvent.change` + immediate `fireEvent.click` with `@testing-library/user-event` and an awaited settle:

```tsx
const user = userEvent.setup();
const input = screen.getByLabelText(/name of company\/firm\/institution in india/i);
await user.clear(input);
await user.type(input, 'Acme India Pvt Ltd');
await user.click(screen.getByRole('button', { name: /save field/i }));
await waitFor(() =>
  expect(api.setApplicationFieldValue).toHaveBeenCalledWith('app1', {
    fieldPath: 'application.indiaCompanyName',
    value: 'Acme India Pvt Ltd',
  }),
);
```

Do not change any production file. If `userEvent` is already imported elsewhere in the file, reuse the pattern there.

- [ ] **Step 3: Verify determinism**

Run: `npx vitest run test/web/ApplicationDashboardPage.test.tsx --repeat 30`
Expected: 30/30 pass.

- [ ] **Step 4: Full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: **1207 / 1207**, all four exit 0. Record the count — this is the true Phase 8 baseline.

- [ ] **Step 5: Commit**

```bash
git add test/web/ApplicationDashboardPage.test.tsx
git commit -m "test(phase-8): stabilise flaky application-scoped field input test"
```

---

### Task 2: Timing profile core (pure module + env)

**Files:**
- Create: `src/server/automation/engine/timing.ts`
- Create: `test/automation/phase8Timing.test.ts`
- Modify: `src/server/env.ts`, `test/automation/env.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TimingProfileName = 'fast' | 'normal' | 'careful';
  export interface TimingProfile {
    readonly name: TimingProfileName | 'benchmark';
    readonly navigationWaitMs: number;      // pause after clickNext, before settle checks
    readonly pageStabilizeTimeoutMs: number; // max wait for an anchor/element to appear
    readonly fieldInteractionDelayMs: number; // pause after focus/scroll, before writing
    readonly scrollDelayMs: number;          // pause after scrollIntoViewIfNeeded
    readonly postFillVerifyDelayMs: number;  // pause after write, before read-back
    readonly retryDelayMs: number;           // pause before the single verify retry
    readonly resolveProbeMs: number;         // primary-vs-fallback probe window
  }
  export const TIMING_PROFILES: Record<TimingProfileName, TimingProfile>;
  export const BENCHMARK_TIMING: TimingProfile; // all delay knobs 0, timeouts small — CI only
  export function resolveTimingProfile(name: string | undefined): TimingProfile; // default 'normal'
  ```
- Consumed by Tasks 3, 4, 5.

- [ ] **Step 1: Write the failing test** (`test/automation/phase8Timing.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { TIMING_PROFILES, resolveTimingProfile, BENCHMARK_TIMING } from '../../src/server/automation/engine/timing.js';

const KNOBS = ['navigationWaitMs','fieldInteractionDelayMs','scrollDelayMs','postFillVerifyDelayMs','retryDelayMs'] as const;

describe('timing profiles', () => {
  it('delay knobs are monotonic fast <= normal <= careful', () => {
    for (const k of KNOBS) {
      expect(TIMING_PROFILES.fast[k]).toBeLessThanOrEqual(TIMING_PROFILES.normal[k]);
      expect(TIMING_PROFILES.normal[k]).toBeLessThanOrEqual(TIMING_PROFILES.careful[k]);
    }
  });
  it('normal is the default for unknown / undefined', () => {
    expect(resolveTimingProfile(undefined)).toBe(TIMING_PROFILES.normal);
    expect(resolveTimingProfile('bogus')).toBe(TIMING_PROFILES.normal);
    expect(resolveTimingProfile('careful')).toBe(TIMING_PROFILES.careful);
  });
  it('normal profile models a sub-2-minute run for a typical prepared application', () => {
    // 7 pages, 36 required fields — representative India e-visa shape.
    const p = TIMING_PROFILES.normal;
    const perField = p.scrollDelayMs + p.fieldInteractionDelayMs + p.postFillVerifyDelayMs;
    const modeled = 5_000 /* browser open */
      + 36 * perField
      + 7 * (p.navigationWaitMs + p.pageStabilizeTimeoutMs * 0.15 /* typical settle */)
      + 36 * 550 /* observed fill+readback compute, from the benchmark */;
    expect(modeled).toBeLessThan(120_000);
  });
  it('benchmark timing zeroes every delay knob', () => {
    for (const k of KNOBS) expect(BENCHMARK_TIMING[k]).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect fail** (`Cannot find module '.../timing.js'`).

- [ ] **Step 3: Implement `timing.ts`**

```ts
export type TimingProfileName = 'fast' | 'normal' | 'careful';
export interface TimingProfile { /* as in Interfaces block */ }

export const TIMING_PROFILES: Record<TimingProfileName, TimingProfile> = {
  fast:    { name: 'fast',    navigationWaitMs: 300,  pageStabilizeTimeoutMs: 8_000,  fieldInteractionDelayMs: 80,  scrollDelayMs: 50,  postFillVerifyDelayMs: 120, retryDelayMs: 200,  resolveProbeMs: 1_500 },
  normal:  { name: 'normal',  navigationWaitMs: 800,  pageStabilizeTimeoutMs: 10_000, fieldInteractionDelayMs: 250, scrollDelayMs: 150, postFillVerifyDelayMs: 300, retryDelayMs: 500,  resolveProbeMs: 2_000 },
  careful: { name: 'careful', navigationWaitMs: 1_500, pageStabilizeTimeoutMs: 15_000, fieldInteractionDelayMs: 600, scrollDelayMs: 400, postFillVerifyDelayMs: 900, retryDelayMs: 1_200, resolveProbeMs: 3_000 },
};
export const BENCHMARK_TIMING: TimingProfile = {
  name: 'benchmark', navigationWaitMs: 0, pageStabilizeTimeoutMs: 2_000, fieldInteractionDelayMs: 0,
  scrollDelayMs: 0, postFillVerifyDelayMs: 0, retryDelayMs: 0, resolveProbeMs: 500,
};
export function resolveTimingProfile(name: string | undefined): TimingProfile {
  return name === 'fast' || name === 'careful' ? TIMING_PROFILES[name] : TIMING_PROFILES.normal;
}
```

- [ ] **Step 4: Add the env knob** (`src/server/env.ts`, in the `schema` object)

```ts
AUTOMATION_TIMING_PROFILE: z.enum(['fast', 'normal', 'careful']).default('normal'),
```

Add a case to `test/automation/env.test.ts` mirroring the existing enum-default assertions.

- [ ] **Step 5: Run tests to verify pass** — `npx vitest run test/automation/phase8Timing.test.ts test/automation/env.test.ts` → PASS.

- [ ] **Step 6: Typecheck + lint + build; commit**

```bash
git add src/server/automation/engine/timing.ts src/server/env.ts test/automation/phase8Timing.test.ts test/automation/env.test.ts
git commit -m "feat(phase-8): AUTOMATION_TIMING_PROFILE + fast/normal/careful timing profiles"
```

---

### Task 3: Thread timing + realistic scroll into pageActions / fieldActions

**Files:**
- Modify: `src/server/automation/engine/pageActions.ts`, `src/server/automation/engine/fieldActions.ts`
- Modify: `test/automation/pageActions.test.ts`, `test/automation/fieldActions.test.ts`

**Interfaces:**
- Consumes: `TimingProfile` (Task 2).
- Produces:
  ```ts
  // pageActions.ts
  export async function scrollIntoViewAndSettle(
    page: Page, selector: string, timing: TimingProfile, delay?: Delay,
  ): Promise<void>;
  export type Delay = (ms: number) => Promise<void>;
  // resolveSelector gains an optional 3rd arg: (page, spec, probeMs?: number)
  // waitForPageSettled gains an optional 3rd arg already exists (timeoutMs) — no change
  // fieldActions.ts
  export interface FieldActionOptions { timing?: TimingProfile; delay?: Delay }
  export async function applyField(page: Page, m: MappedField, opts?: FieldActionOptions): Promise<{
    filled: boolean; outcome: VerificationOutcome; alreadySet: boolean; usedFallback: boolean; selector: string;
  }>;
  // classifyPreFill unchanged signature (adds an internal probeMs default)
  ```
- The default when `opts`/`timing` is omitted is `TIMING_PROFILES.normal` — existing callers and tests keep working unchanged.

- [ ] **Step 1: Failing test — scroll + delay are applied** (`test/automation/fieldActions.test.ts`, new case)

```ts
it('applyField scrolls the target into view and waits the configured interaction + verify delays', async () => {
  const spy: number[] = [];
  const delay = async (ms: number) => { spy.push(ms); };
  const timing = { ...TIMING_PROFILES.careful };
  await page.locator('#t').evaluate((el) => { (el as HTMLElement).style.marginTop = '3000px'; });
  const r = await applyField(page, mf('#t', 'text', 'RANA'), { timing, delay });
  expect(r.outcome).toBe('verified');
  expect(spy).toContain(timing.scrollDelayMs);
  expect(spy).toContain(timing.fieldInteractionDelayMs);
  expect(spy).toContain(timing.postFillVerifyDelayMs);
  // the element was actually brought into the viewport before the fill
  expect(await page.locator('#t').isVisible()).toBe(true);
});
```

- [ ] **Step 2: Run — expect fail** (`applyField` ignores `opts`; `spy` stays empty).

- [ ] **Step 3: Implement**

`pageActions.ts`:
```ts
export type Delay = (ms: number) => Promise<void>;
const noWait: Delay = async () => {};

export async function scrollIntoViewAndSettle(page: Page, selector: string, timing: TimingProfile, delay: Delay = noWait): Promise<void> {
  await requireSelector(page, selector);
  await page.locator(selector).first().scrollIntoViewIfNeeded({ timeout: timing.pageStabilizeTimeoutMs });
  await delay(timing.scrollDelayMs);
}
```
Change `resolveSelector` to accept `probeMs = RESOLVE_PROBE_MS` and use it in the two `waitFor` calls (keep the module constant as the default).

`fieldActions.ts` — in `applyField` (and its `writeControl` helper): resolve `const timing = opts?.timing ?? TIMING_PROFILES.normal; const delay = opts?.delay ?? ((ms) => page.waitForTimeout(ms));`. Before the write: `await scrollIntoViewAndSettle(page, selector, timing, delay); await delay(timing.fieldInteractionDelayMs);`. After the write, before the read-back verify: `await delay(timing.postFillVerifyDelayMs);`. Before the single retry: `await delay(timing.retryDelayMs);`. Pass `timing.resolveProbeMs` into `resolveSelector`.

- [ ] **Step 4: Run the full fieldActions + pageActions suites** — `npx vitest run test/automation/fieldActions.test.ts test/automation/pageActions.test.ts` → all green (existing cases use the `normal` default; the `#tblur` self-mutating case still yields `mismatch`).

- [ ] **Step 5: Typecheck + lint + build; commit**

```bash
git commit -am "feat(phase-8): realistic scroll + profile-driven interaction/verify delays in field actions"
```

---

### Task 4: Engine consumes the timing profile

**Files:**
- Modify: `src/server/automation/engine/automationEngine.ts`, `src/server/automation/automationService.ts`
- Modify: `test/automation/automationEngine.test.ts`, `test/automation/automationService.test.ts`, `test/automation/phase8Timing.test.ts`

**Interfaces:**
- Consumes: `TimingProfile`, `Delay`, `resolveTimingProfile` (Tasks 2–3).
- Produces (`EngineContext` additions):
  ```ts
  timing: TimingProfile;
  delay: (ms: number) => Promise<void>;
  ```
  `EngineContext.applyField` signature becomes `(page, m, opts?) => …` (opts forwarded by the loop).

- [ ] **Step 1: Failing test — the loop waits `navigationWaitMs` between pages and forwards `timing` to `applyField`** (`automationEngine.test.ts`, extend the existing fake-driven full-run test)

```ts
it('waits the profile navigation delay after each clickNext and passes timing to applyField', async () => {
  const waits: number[] = [];
  const ctx = makeCtx({ /* existing 2-page fake adapter */
    timing: TIMING_PROFILES.careful,
    delay: async (ms: number) => { waits.push(ms); },
    applyField: vi.fn(async (_p, _m, opts) => {
      expect(opts?.timing?.name).toBe('careful');
      return { filled: true, outcome: 'verified', alreadySet: false, usedFallback: false, selector: '#x' };
    }),
  });
  const stop = await runLoop(ctx);
  expect(stop.kind).toBe('review_ready');
  expect(waits).toContain(TIMING_PROFILES.careful.navigationWaitMs);
});
```

- [ ] **Step 2: Run — expect fail** (`ctx.timing` undefined; `applyField` called with 2 args).

- [ ] **Step 3: Implement**

`automationEngine.ts`: add `timing` + `delay` to `EngineContext`; after `await ctx.adapter.clickNext(ctx.page)` add `await ctx.delay(ctx.timing.navigationWaitMs)` **before** `await ctx.settle(ctx.page)`; call `ctx.applyField(ctx.page, m, { timing: ctx.timing, delay: ctx.delay })`. No other timing in the loop (per-field delays live in `fieldActions`).

`automationService.ts`: `import { resolveTimingProfile } from './engine/timing.js'`; in the constructor `this.timing = deps.timing ?? resolveTimingProfile(env.AUTOMATION_TIMING_PROFILE)`; in `buildContext` set `timing: this.svc.timing`, `delay: (ms) => page.waitForTimeout(ms)`; forward `opts` in the `applyField` wrapper. Add `timing?: TimingProfile` to `AutomationServiceDeps`.

- [ ] **Step 4: Run — `npx vitest run test/automation/automationEngine.test.ts test/automation/automationService.test.ts test/automation/phase8Timing.test.ts` → green. Then full `npm test`** (cross-cutting change) → **1207 / 1207**.

- [ ] **Step 5: Typecheck + lint + build; commit**

```bash
git commit -am "feat(phase-8): run engine + service consume the timing profile"
```

---

### Task 5: Progress-estimate module (pure)

**Files:**
- Create: `src/shared/automation/progress.ts`, `test/shared/automation/progress.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function elapsedMs(startedAtIso: string, nowMs?: number): number;
  export function estimateRemainingMs(a: {
    fieldsVerified: number; fieldsTotal: number; elapsedMs: number;
  }): number | null; // null when it cannot be estimated yet (0 verified, or total 0)
  export function formatDuration(ms: number): string; // "01:42", "00:07", ">59:59" clamp
  ```
- Consumed by Task 7. No server or DB change — computed from the `automation_runs` row the API already returns.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { estimateRemainingMs, formatDuration } from '../../../src/shared/automation/progress.js';

describe('estimateRemainingMs', () => {
  it('is null before any field is verified', () => {
    expect(estimateRemainingMs({ fieldsVerified: 0, fieldsTotal: 30, elapsedMs: 4000 })).toBeNull();
  });
  it('linear-extrapolates from the observed per-field rate', () => {
    // 10/30 in 40s -> 4s per field -> ~80s left
    expect(estimateRemainingMs({ fieldsVerified: 10, fieldsTotal: 30, elapsedMs: 40_000 })).toBe(80_000);
  });
  it('is 0 once every field is verified', () => {
    expect(estimateRemainingMs({ fieldsVerified: 30, fieldsTotal: 30, elapsedMs: 90_000 })).toBe(0);
  });
});
describe('formatDuration', () => {
  it('renders mm:ss zero-padded', () => {
    expect(formatDuration(102_000)).toBe('01:42');
    expect(formatDuration(7_000)).toBe('00:07');
  });
});
```

- [ ] **Step 2: Run — expect fail. Step 3: implement the three functions (guard divide-by-zero, `Math.round`, clamp negatives to 0).**

- [ ] **Step 4: `npx vitest run test/shared/automation/progress.test.ts` → PASS. Typecheck + lint + build.**

- [ ] **Step 5: Commit**

```bash
git add src/shared/automation/progress.ts test/shared/automation/progress.test.ts
git commit -m "feat(phase-8): pure run-progress elapsed/ETA/format helpers"
```

---

### Task 6: Deterministic performance benchmark (≤ 2 min modeled)

**Files:**
- Create: `test/automation/phase8Benchmark.test.ts`
- Modify: `test/automation/support/fixtureIndiaAdapter.ts` (add a fully-validated lifecycle-map helper only if one is not already derivable)

**Interfaces:**
- Consumes: `BENCHMARK_TIMING`, `TIMING_PROFILES.normal` (Task 2), the fixture portal v3 + `makeFixtureIndiaAdapter` (Phase 7), `AutomationService` with injected deps.

- [ ] **Step 1: Write the benchmark test**

```ts
// Runs the real runLoop against the local fixture portal v3 with BENCHMARK_TIMING
// (all human delays 0) so it is fast + deterministic in CI. It counts the real
// interactions, then MODELS the wall-clock a `normal`-profile run would take and
// asserts that model is < 120s. Never touches a real portal.
import { describe, expect, it } from 'vitest';
import { TIMING_PROFILES, BENCHMARK_TIMING } from '../../src/server/automation/engine/timing.js';
// ... fixture server + fully-validated fixture adapter + a representative prepared plan

describe('phase 8 — performance', () => {
  it('a representative prepared application reaches review_ready and models under 2 minutes', async () => {
    const t0 = performance.now();
    const { runId, events, run } = await runFixtureToReviewReady({ timing: BENCHMARK_TIMING });
    const fixtureMs = performance.now() - t0;

    expect(run.status).toBe('review_ready');
    expect(run.fields_verified).toBe(run.fields_total);
    // no submit-shaped event, submitCount stays 0
    expect(events.some((e) => /SUBMIT|CONFIRM|LODGE|PAY/i.test(e.type))).toBe(false);

    const fills = events.filter((e) => e.type === 'FIELD_FILL_STARTED').length;
    const navs  = events.filter((e) => e.type === 'NAVIGATION_STARTED').length;
    const p = TIMING_PROFILES.normal;
    const perField = p.scrollDelayMs + p.fieldInteractionDelayMs + p.postFillVerifyDelayMs;
    const modeledRealMs =
      5_000                                   // browser open + entry goto (measured separately, fixed budget)
      + fills * perField
      + navs * (p.navigationWaitMs + 1_500)   // 1.5s typical settle per page
      + fixtureMs;                            // real compute: detection, fills, read-backs, DOM

    // eslint-disable-next-line no-console
    console.log(`[bench] fixtureMs=${fixtureMs|0} fills=${fills} navs=${navs} modeledRealMs=${modeledRealMs|0}`);
    expect(modeledRealMs).toBeLessThan(120_000);
    expect(fixtureMs).toBeLessThan(90_000); // loose CI ceiling — never the point of the test
  });
});
```

- [ ] **Step 2: Run — expect fail** (helper `runFixtureToReviewReady` / fully-validated fixture map not present).

- [ ] **Step 3: Implement the harness**

Add `makeFixtureIndiaAdapter({ lifecycleMap: allValidated })` where every field is `status:'validated', validatedAgainstRevision: <current fixture revision>`; a `representativePreparedPlan()` fixture with ~30+ required fields populated with **synthetic** values across the fixture's pages; `runFixtureToReviewReady()` wiring `AutomationService` to the fixture host with `timing: BENCHMARK_TIMING`. Reuse Phase 7 fixture infra — do not fork the fixture portal.

- [ ] **Step 4: Run — `npx vitest run test/automation/phase8Benchmark.test.ts` → PASS, prints the `[bench]` line. Full `npm test` → 1208 / 1208.**

- [ ] **Step 5: Commit**

```bash
git add test/automation/phase8Benchmark.test.ts test/automation/support/fixtureIndiaAdapter.ts
git commit -m "test(phase-8): deterministic fixture benchmark — models a sub-2-minute normal run"
```

---

### Task 7: Run-page observability — elapsed / ETA / section / milestone timeline

**Files:**
- Modify: `src/web/src/pages/Automation/AutomationRunPage.tsx`, `src/web/src/pages/Automation/runChrome.tsx`
- Modify: `test/web/AutomationRunPage.test.tsx`

**Interfaces:**
- Consumes: `estimateRemainingMs`, `elapsedMs`, `formatDuration` (Task 5); the `AutomationRunRow` fields `started_at`, `current_section_id`, `fields_verified`, `fields_total`, `documents_ready`, `documents_total` (all already returned); the existing `events` array.
- Produces:
  ```tsx
  // runChrome.tsx
  export function RunTiming(props: { run: AutomationRunRow }): JSX.Element;   // "Elapsed 01:42 · Est. remaining ~01:18"
  export function ProgressTimeline(props: { events: AutomationEventRow[] }): JSX.Element; // value-free milestones
  ```

- [ ] **Step 1: Failing tests** (`AutomationRunPage.test.tsx`)

```tsx
it('shows an elapsed timer and hides the ETA until a field is verified', async () => {
  mockRun({ status: 'running', started_at: iso(Date.now() - 42_000), fields_verified: 0, fields_total: 30 });
  render(<AutomationRunPage />);
  expect(await screen.findByText(/elapsed 00:4[0-5]/i)).toBeInTheDocument();
  expect(screen.queryByText(/est\. remaining/i)).not.toBeInTheDocument();
});
it('shows an ETA once progress exists', async () => {
  mockRun({ status: 'running', started_at: iso(Date.now() - 40_000), fields_verified: 10, fields_total: 30 });
  render(<AutomationRunPage />);
  expect(await screen.findByText(/est\. remaining ~01:2\d/i)).toBeInTheDocument();
});
it('renders a value-free milestone timeline from the event stream', async () => {
  mockRun({ status: 'waiting_for_user', waiting_reason: 'otp' });
  mockEvents([{ type: 'RUN_STARTED' }, { type: 'PAGE_DETECTED', portal_state: 'PASSPORT' }, { type: 'OTP_REQUIRED' }]);
  render(<AutomationRunPage />);
  const tl = await screen.findByRole('list', { name: /progress timeline/i });
  expect(within(tl).getByText(/portal opened/i)).toBeInTheDocument();
  expect(within(tl).getByText(/waiting for you/i)).toBeInTheDocument();
  // no portal value anywhere in the timeline
  expect(tl.textContent).not.toMatch(/PASSPORT-|@|\d{7}/);
});
```

- [ ] **Step 2: Run — expect fail. Step 3: implement.**

`RunTiming`: a `useEffect` `setInterval(1000)` tick while `!isTerminal(run.status)`; render `Elapsed {formatDuration(elapsedMs(run.started_at))}`; when `estimateRemainingMs(...) !== null` append ` · Est. remaining ~{formatDuration(est)}`. Freeze at the terminal `ended_at - started_at` once terminal.

`ProgressTimeline`: `role="list" aria-label="Progress timeline"`; map a fixed event-type → milestone-label table (`RUN_STARTED`→"Portal opened", `PAGE_DETECTED`→"Page detected", `NAVIGATION_COMPLETED`→"Moved to the next page", `OTP_REQUIRED`/`CAPTCHA_REQUIRED`/`MFA_REQUIRED`/`ANTI_BOT_DETECTED`→"Human action required", `USER_ACTION_REQUIRED`→"Waiting for you", `RUN_RESUMED`→"Resumed", `REVIEW_READY`→"Review page reached — nothing submitted"); dedupe consecutive identical labels; **render label + relative time only, never `portalState`/`fieldPath`**. Section line in the header: show `run.current_section_id ?? run.current_portal_state ?? '—'`.

- [ ] **Step 4: `npx vitest run test/web/AutomationRunPage.test.tsx` → green. Typecheck + lint + build.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(phase-8): run page — elapsed timer, ETA, section, value-free milestone timeline"
```

---

### Task 8: "Start automation" copy fix

**Files:**
- Modify: `src/web/src/pages/Applications/ReadyForAutomationSection.tsx`
- Modify: `test/web/ReadyForAutomationSection.test.tsx`
- Check: grep `src/web` for other `Phase 5` / `Phase 6` user-facing strings

- [ ] **Step 1: Failing test**

```tsx
it('labels the button "Start automation" even when blocked, with an accurate hint', () => {
  render(<ReadyForAutomationSection readyForAutomation={{ ready: false, blockers: [] }} applicationId="a1" />);
  const btn = screen.getByRole('button', { name: 'Start automation' });
  expect(btn).toBeDisabled();
  expect(screen.queryByText(/phase 5/i)).not.toBeInTheDocument();
  expect(screen.getByText(/never submits, pays, or books an appointment/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — expect fail** (`Start automation (Phase 5)` label; `PHASE_5_HELPER` text).

- [ ] **Step 3: Implement** — button text is always `starting ? 'Starting…' : 'Start automation'`; replace `PHASE_5_HELPER` with `'This fills the portal form under your control. It never submits, pays, or books an appointment — you review every field in the portal and submit it yourself.'`. Grep result: fix any other stale `Phase N` copy found in `src/web` (report each).

- [ ] **Step 4: `npx vitest run test/web/ReadyForAutomationSection.test.tsx` → green. Typecheck + lint + build.**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(phase-8): accurate Start-automation button + hint copy"
```

---

### Task 9: A locally-missing required document → safe pause, not hard fail

**Files:**
- Modify: `src/server/automation/engine/automationEngine.ts` (§5.4 doc block, ~L358–379)
- Modify: `src/web/src/pages/Automation/runChrome.tsx` (`WAITING_REASON_TEXT` / `REASON_INSTRUCTION` — confirm `document_upload_required` copy names the manual-upload step)
- Modify: `test/automation/automationEngine.test.ts`, add a `phase8` scenario

**Interfaces:**
- No signature change. `EngineStop` for the missing-doc case changes from `{ kind: 'failed', errorCode: 'missing_document' }` to `{ kind: 'waiting', reason: 'document_upload_required' }`. `WaitingReason` already contains `document_upload_required` — no vocab addition.

- [ ] **Step 1: Failing test**

```ts
it('pauses document_upload_required (not failed) when a page needs a document the profile has not uploaded', async () => {
  const ctx = makeCtx({ /* fake adapter: one page, documentIdsForState -> ['passport-bio'] */
    plan: planWith({ documents: [{ id: 'passport-bio', effectiveRequirement: 'required', uploaded: false }] }),
  });
  const stop = await runLoop(ctx);
  expect(stop).toEqual({ kind: 'waiting', reason: 'document_upload_required' });
  expect(emitted(ctx)).toContain('BLOCKED_MISSING_DOCUMENT'); // still tells the operator which doc
});
```

- [ ] **Step 2: Run — expect fail** (`stop.kind === 'failed'`).

- [ ] **Step 3: Implement** — in the `notUploaded.length > 0` branch, keep the per-doc `BLOCKED_MISSING_DOCUMENT` emit, then `return { kind: 'waiting', reason: 'document_upload_required' }`. Delete the now-unreachable `errorCode: 'missing_document'` path (grep for `missing_document` — update `NOTABLE_EVENTS` comment only if it mentions it; leave the `error_code` column alone). The existing "doc IS uploaded locally but portal upload unsupported" pause is unchanged. Verify `runChrome.tsx` copy for `document_upload_required` says something like *"Upload the required document(s) to this applicant, then upload them in the portal yourself and click Resume."*

- [ ] **Step 4: Full `npm test`** (an existing test may assert the old `failed/missing_document` — update it to the pause). → 1209 / 1209. Typecheck + lint + build.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(phase-8): missing document is a resumable pause, not a terminal failure"
```

---

### Task 10: Complete promotion output + "copy all promoted" bundle

**Files:**
- Modify: `src/server/automation/adapters/india/indiaMappingRegistry.ts`
- Modify: `src/server/routes/discovery.ts`, `src/web/src/api/client.ts`
- Modify: `src/web/src/pages/Discovery/DiscoverySessionPage.tsx`, `discoveryChrome.tsx`
- Modify: `test/automation/indiaMappingRegistry.test.ts`, `test/automation/discoveryRoutes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // indiaMappingRegistry.ts
  export function renderPromotedBundle(
    db: DatabaseSync, sessionId: string,
    picks: { pageSeq: number; candidateIndex: number; canonicalFieldPath: string }[],
  ): { literal: string; warnings: string[] };
  // route
  POST /api/discovery-sessions/:id/promote-bundle  body: { picks: [...] }  -> { bundle: { literal, warnings } }
  // api client
  promoteBundle(sessionId, picks) -> Promise<{ bundle: { literal: string; warnings: string[] } }>
  ```

- [ ] **Step 1: Failing tests**

```ts
it('promoteCandidate literal carries the validation TODO stamps and the checklist pointer', () => {
  const { literal } = promoteCandidate(db, sessionId, { pageSeq: 1, candidateIndex: 0, canonicalFieldPath: 'identity.surname' });
  expect(literal).toContain("status: 'discovered'");
  expect(literal).toMatch(/\/\/ TODO: after read-back validation set status: 'validated'/);
  expect(literal).toMatch(/\/\/ TODO: validatedAgainstRevision: '.*' \(current mappingRevision\)/);
  expect(literal).toMatch(/\/\/ TODO: validatedAt: <ISO>/);
});
it('renderPromotedBundle concatenates every pick under one paste block', () => {
  const { literal } = renderPromotedBundle(db, sessionId, [
    { pageSeq: 1, candidateIndex: 0, canonicalFieldPath: 'identity.surname' },
    { pageSeq: 1, candidateIndex: 1, canonicalFieldPath: 'identity.givenName' },
  ]);
  expect(literal).toContain("'identity.surname': {");
  expect(literal).toContain("'identity.givenName': {");
});
```
Plus a `discoveryRoutes.test.ts` case: `POST /promote-bundle` with two picks → 200, `bundle.literal` contains both paths; unknown candidate → 404.

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement** — append to the `promoteCandidate` `body` array three comment lines (current `indiaPortalMap.mappingRevision` interpolated into the revision TODO). `renderPromotedBundle` loops `picks`, calls the existing single-candidate builder, joins with `\n`, dedupes warnings. Add the Zod body schema + route (`z.object({ picks: z.array(promoteBodySchema).min(1) })`). Add `api.promoteBundle`. `DiscoverySessionPage`: a "Copy all promoted (N)" button enabled when `Object.keys(promoted).length > 0` that calls `promoteBundle` with the promoted keys and writes `bundle.literal` to `navigator.clipboard` (fallback: show in a `<textarea readonly>`).

- [ ] **Step 4: `npx vitest run test/automation/indiaMappingRegistry.test.ts test/automation/discoveryRoutes.test.ts` + web build. Typecheck + lint.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(phase-8): promotion output carries validation TODO stamps + copy-all bundle"
```

---

### Task 11: Auto-render the india.md field-support tables from persisted discovery

**Files:**
- Create: `src/server/automation/adapters/india/fieldTablesMarkdown.ts`, `test/automation/indiaFieldTables.test.ts`
- Modify: `src/server/routes/discovery.ts`, `src/web/src/api/client.ts`, `DiscoverySessionPage.tsx` + `discoveryChrome.tsx`
- Modify: `docs/portals/india.md` (§"Field support tables" — replace the three empty tables with a "generated — paste from **Copy field tables**" note + a stable anchor)

**Interfaces:**
- Produces:
  ```ts
  export function renderFieldTablesMarkdown(input: {
    mappings: MappingView[];               // getIndiaMappings()
    mappingRevision: string;               // indiaPortalMap.mappingRevision
    discoveryPages: { state_guess: string | null; candidates_json: string }[];
  }): string; // three markdown tables: Validated / Discovered (not yet validated) / Placeholder
  // route: GET /api/discovery-sessions/:id/field-tables -> { markdown: string }
  // api: getFieldTables(sessionId) -> Promise<{ markdown: string }>
  ```
- Pure formatter; value-free (uses canonical field paths + control kinds + counts only, never a candidate's example value).

- [ ] **Step 1: Failing test** — feed a synthetic `mappings` list (one validated@currentRev, one discovered, one placeholder) + one discovery page; assert three `##`/table headers, the validated row shows `✓` + the revision, the placeholder row shows `TODO`, and **no** example value / option label leaks (`expect(md).not.toMatch(/example|e\.g\.|@/i)`).

- [ ] **Step 2: Run — expect fail. Step 3: implement** the formatter + route (`getDiscoverySession` 404 guard, reuse `listDiscoveryPages`) + `api.getFieldTables` + a "Copy field tables" button next to "Copy all promoted".

- [ ] **Step 4: `npx vitest run test/automation/indiaFieldTables.test.ts test/automation/discoveryRoutes.test.ts`. Typecheck + lint + build.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(phase-8): generate india.md field-support tables from persisted discovery"
```

---

### Task 12: Resume re-validates page identity AND mapping readiness (proof)

**Files:**
- Modify: `test/automation/automationService.test.ts` (or a new `test/automation/phase8Resume.test.ts`)
- Modify: `src/server/automation/automationService.ts` **only if** a gap is found

**Interfaces:** none new — this task asserts existing behaviour and only patches if a real gap surfaces.

- [ ] **Step 1: Write the tests**

```ts
it('a resume re-detects the current page before re-entering the loop (never assumes the old page)', async () => {
  // start -> pause at OTP on PASSPORT; operator "navigates" the fake page to ADDRESS;
  // resume -> the next runLoop iteration detects ADDRESS, not PASSPORT.
});
it('a run paused on stale_mapping resumes past the field once the map is production-usable', async () => {
  // adapter.mappingReadiness returns 'stale' first -> pause stale_mapping;
  // swap to an adapter whose field is validated@currentRev; resume -> reaches review_ready.
});
it('a resume re-runs the checkpoint check and 409s while the challenge is still present', async () => {
  // already covered by phase7Safety c2 — assert here against the service directly for regression lock.
});
```

- [ ] **Step 2: Run.** If all pass first try (expected — the loop re-detects and re-checks readiness every iteration): that is the proof; note it in the task report and skip Step 3. If a test fails: **that is a real gap** — fix it minimally in `resumeRun` / the loop (e.g. force a `settle` + fresh `inspect` before the first post-resume iteration), keeping the change surgical.

- [ ] **Step 3 (only if a gap was found): implement the minimal fix.**

- [ ] **Step 4: Full `npm test`. Typecheck + lint + build.**

- [ ] **Step 5: Commit**

```bash
git commit -am "test(phase-8): lock resume page + mapping revalidation behaviour"
```

---

### Task 13: Track B execution checklist + validation-report template

**Files:**
- Create: `docs/portals/india-validation-report-TEMPLATE.md`
- Modify: `docs/portals/india.md` (add "### Track B execution checklist (numbered)" under the runbook heading)

**Interfaces:** none — documentation.

- [ ] **Step 1: Write `india-validation-report-TEMPLATE.md`** — front-matter (portal id, portal URL snapshot, discovery `sessionId`, date, operator, adapter version, mappingRevision) + a per-field table: `canonical path | portal selector | control kind | options observed (count only) | date transform | read-back OK? | status stamped | validatedAt | commit sha` + totals (validated / discovered / placeholder / production-usable) + a checkpoints-encountered list + an operator sign-off line + a "no submission attempted / `submitCount` 0" attestation.

- [ ] **Step 2: Add the numbered checklist to `india.md`** — 18 steps mapping 1:1 to directive §14 (start discovery → operator auth → OTP → CAPTCHA → observe → candidates shown → confirm each → store as discovered → validate → stamp current revision → test autofill one safe field → read back → validate → continue field-by-field → record the session → update field tables (via **Copy field tables**) → generate the validation report → never auto-promote observed→validated). Cross-link Tests A–G and the promotion checklist already in the file.

- [ ] **Step 3: `npm run lint`** (markdown is not linted, but run the gate to be safe) — no code changed.

- [ ] **Step 4: Commit**

```bash
git add docs/portals/india-validation-report-TEMPLATE.md docs/portals/india.md
git commit -m "docs(phase-8): Track B numbered checklist + per-field validation report template"
```

---

### Task 14: Security review, reports, whole-branch review, finish the branch

**Files:**
- Modify: `docs/superpowers/reports/PHASE-7-REPORT.md` (§§17–20), `docs/ARCHITECTURE.md` (§3)
- Create: `docs/superpowers/reports/PHASE-8-REPORT.md`

**Interfaces:** none.

- [ ] **Step 1: Fresh security review** — run the `security-review` skill over `74fc162..HEAD` (Phase 7 + Phase 8 delta). Manually re-verify the directive §13 checklist: no PII in logs / `automation_events` / `automation_runs` / `portal_discovery_*`; screenshots off by default; no submit selector / submit / payment / appointment / registration / OTP-CAPTCHA handling / anti-bot bypass; no selector guessing; no fuzzy dropdown match; stale mappings can't reach production; unknown pages stop; conflicts stop; resume re-validates. Record findings + any fixes.

- [ ] **Step 2: Whole-branch code review** — dispatch a `general-purpose` reviewer subagent (per `superpowers:requesting-code-review`) over `74fc162..HEAD` against the Global Constraints + the Phase 5 no-submit rails + the Phase 7/8 additions. Fix Critical + Important before proceeding; note Minor.

- [ ] **Step 3: Fill `PHASE-7-REPORT.md` §17 (security outcome), §18 (whole-branch review: verdict + counts), §19 (final gate: typecheck / lint / test N / build), §20 (bundle sizes).** Write `PHASE-8-REPORT.md`: executive summary, baseline vs final gate, the 14 tasks + commits, the benchmark numbers (`fixtureMs`, modeled `normal` ms), the timing-profile table, what is still manual (Track B), acceptance-criteria checklist (directive §21) with each box ticked or explicitly deferred with reason. Add the `docs/ARCHITECTURE.md` §3 Phase 8 paragraph.

- [ ] **Step 4: Final gate** — `npm run typecheck && npm run lint && npm test && npm run build`, all exit 0, record the test count.

- [ ] **Step 5: Commit the docs**

```bash
git add docs/
git commit -m "docs(phase-8): security + whole-branch review outcomes, Phase 7 report §§17-20, Phase 8 report"
```

- [ ] **Step 6: `superpowers:finishing-a-development-branch`** — the skill decides squash/merge/PR; push and merge-to-master are the **user's call** (gh is not authed — expect a manual PR step). Do not merge without explicit approval.

---

## Self-review

**Spec coverage (directive §§1–21):**

| Directive section | Task(s) |
|---|---|
| §1 audit + baseline | done pre-plan (recorded in Context) |
| §2 human-present discovery | already built (Phase 6) + Tasks 10, 11, 13 smooth it |
| §3 production field mapping + diagnostics | already built (Phase 7); Task 10 completes the stamps |
| §4 controlled autofill flow | already built (Phases 5–7); Task 9 refines the doc branch |
| §5 value safety (exact dropdown, date transform, conflict, verify) | already built (Phase 7) — Global Constraints lock it |
| §6 documents | Task 9 |
| §7 3-minute target + timing profiles | Tasks 2, 3, 4, 6 |
| §8 realistic browser behaviour, no evasion | Tasks 3, 4 + Global Constraints |
| §9 application-plan as source of truth | already built (Phase 4/5) — unchanged |
| §10 page detection, unknown → stop | already built; real-portal detection is Track B (Task 13 doc) |
| §11 idempotent resume + revalidation | Task 12 |
| §12 no appointment/payment | Global Constraints — nothing added |
| §13 security review | Task 14 |
| §14 Track B procedure | Task 13 |
| §15 tests A–G | A–F already covered (Phase 7 matrix/safety); G (perf) = Task 6 |
| §16 value-free progress timeline | Task 7 |
| §17 automation UI (adapter, revision, mappings, page, section, progress, elapsed, ETA, status, checkpoint copy, "Prepared — NOT submitted", no submit button) | Tasks 7, 8 (provenance/stale/banner already built) |
| §18 failure handling — STOP + explain | already built; Task 9 converts the last hard-fail to a pause |
| §19 TDD process | every task |
| §20 skills | subagent-driven-development / TDD / requesting-code-review / security-review / finishing-a-development-branch (Task 14) |
| §21 acceptance criteria | verified in Task 14 §3 |

**Placeholder scan:** every code step has real code or a precise diff location. Doc tasks (13) and review tasks (14) name exact files + section anchors. No "TBD" / "handle edge cases" / "similar to Task N".

**Type consistency:** `TimingProfile` (Task 2) is consumed with the same field names in Tasks 3/4/6. `Delay = (ms: number) => Promise<void>` identical in pageActions + fieldActions + EngineContext. `estimateRemainingMs` / `formatDuration` signatures identical in Task 5 def and Task 7 use. `renderPromotedBundle` / `promote-bundle` picks shape identical in Task 10 def, route, and client. `EngineStop` document case is `{ kind: 'waiting'; reason: 'document_upload_required' }` in Task 9 — a value already in `WaitingReason`.

**Scope:** one plan, one working deliverable per task, no subsystem rebuild, no migration. Benchmark is deterministic and cannot fail on real-network slowness (it never touches a network). Real Track B stays a documented manual procedure.

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-09-08-phase-8-real-portal-readiness.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration; keeps the driver context lean (matches "use less token").

**2. Inline Execution** — tasks run in this session via `superpowers:executing-plans`, checkpoint after each.

Which approach — and do you approve starting Task 1?
