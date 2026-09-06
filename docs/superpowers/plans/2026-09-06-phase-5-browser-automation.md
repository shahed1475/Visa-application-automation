# Phase 5 — India Visa Browser Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side browser-automation assistant that takes a Phase-4-ready `visa_application`, drives the configured portal through its form flow filling and verifying each field, pauses for human OTP/CAPTCHA checkpoints, and stops safely at the final review — never submitting.

**Architecture:** A portal-agnostic engine (`src/shared/automation/` pure state machine + field mapping + event vocabulary; `src/server/automation/` Playwright execution) that talks to portals only through a `PortalAdapter` interface. India-specific selectors live only in `src/server/automation/adapters/india/` and ship as documented placeholders. Correctness is proven against a local multi-page fixture portal; the live India portal is never a CI dependency and is never driven autonomously in this phase.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Node 24, Fastify 5, `node:sqlite` (`DatabaseSync`), Playwright 1.47 (`chromium`), React 18 + Vite 5, Vitest 3, Zod 3.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-06-phase-5-browser-automation-design.md` — every task's requirements implicitly include it.
- **Purity:** `src/shared/automation/**` imports nothing from `node:*`, `playwright`, `fastify`, `react`, or `../server`. Enforced by a guard test (Task 16).
- **Engine ⇄ adapter:** `src/server/automation/engine/automationEngine.ts` imports **no concrete adapter** — only `PortalAdapter` from `baseAdapter.ts`. The concrete adapter is always passed in.
- **India knowledge isolation:** no portal-URL literal and no India CSS/selector literal anywhere except under `src/server/automation/adapters/india/**`. Enforced by a guard test (Task 16).
- **Terminal state is `review_ready`.** The `run.status` CHECK constraint has no `completed`/`submitted` value. The engine loop `return`s at `adapter.isFinalReview(state)` before any further action.
- **No-auto-submit — all four:** (1) structural — `clickNext` targets only the inter-page control, loop returns at `isFinalReview`, `PortalAdapter.submitSelector` is typed `null`; (2) guard grep (Task 16); (3) fixture E2E asserts `fixturePortal.submitCount === 0` (Task 15/16); (4) `indiaPortalMap` carries no submit selector (Task 20).
- **OTP / CAPTCHA / MFA:** detect-only → persist `waiting_for_user` + reason → `page.bringToFront()` → emit event → suspend. No solver, no retrieval, no interception, no third-party service, no evasion. `POST /resume` re-runs the detector and refuses (`409 checkpoint_still_present`) while the challenge is present.
- **PII:** the engine never places a field value, OTP, CAPTCHA text, or password into any object it logs or persists. `automation_events.message` is drawn only from the closed `EVENT_MESSAGES` map (no string interpolation). `automation_events` columns carry only `field_path` (canonical `appliesTo`) and `portal_state` — both non-sensitive. Mismatch values reach the UI only via the in-memory `GET /automation-runs/:id/live`, never the DB or logs. `logger.ts` `REDACT_PATHS` gains `expected`, `actual`, `otp`, `otpCode`, `captcha`, `*.expected`, `*.actual`.
- **Screenshots:** `AUTOMATION_EVIDENCE` env defaults to `'off'`. When `'screenshots'`, images write under `AUTOMATION_DIR` (default `<DATA_DIR>/automation`, already gitignored via `data/`); `automation_events.evidence_path` stores a **relative** path only.
- **File upload:** verify-and-pause. The engine confirms each required document is `uploaded` in the plan; it does not drive any portal file input. Missing required doc → `status = failed`, `error_code = missing_document`.
- **India selectors:** never guessed. `indiaPortalMap` selectors are the literal string `'TODO:discover'` with `selectorConfidence: 'fragile'` until a user-driven discovery session fills them.
- **CI independence:** no test may open a network connection to the live India portal. All browser tests use the local fixture portal or inline `data:`/`http://127.0.0.1` fixtures.
- **Reuse, don't duplicate:** consume `getApplication` / `plan` / `plan.readyForAutomation` / `getActivePortal` / `listDocuments`. Introduce no second model for applicant, application, document, field-meta, or visa requirements.
- **Commit trailer on every commit:**
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UrSHh47cEKWbFeqX88LCjd
  ```
- **Gate (run before every task's final commit and at phase end):** `npm run typecheck && npm run lint && npm test && npm run build`. Baseline at branch point: 783 tests green.
- **Branch:** `phase-5-browser-automation` (already created off `phase-0-portal-settings` at `f13ab3a`). The spec is committed at `3648ffd`.

---

## File structure

```
src/shared/automation/
  types.ts        RunStatus, WaitingReason, PortalState, ControlKind, EventType, EventStatus,
                  PageIdentity, SignalMatch, PortalFieldMap, PortalFieldSpec, MappedField,
                  VerificationResult, RunSummary, AutomationRunRow, AutomationEventRow
  states.ts       RUN_STATES, TERMINAL_STATES, LEGAL_TRANSITIONS, assertTransition()
  events.ts       EVENT_TYPES, EVENT_MESSAGES (closed, no interpolation), isEventType()
  fieldMapping.ts mapFields(sections, fieldMap, activeSectionIds) -> MappedField[]
  index.ts        barrel

src/server/automation/
  engine/
    browserManager.ts    MODIFY — context opts, bringToFront, AUTOMATION_HEADLESS
    pageActions.ts        readControl, fillText, selectNative, selectCustom, setRadio,
                          setCheckbox, setDate, typeAutocomplete, waitForPageSettled
    fieldActions.ts       applyField(page, mapped) -> VerificationResult ; verifyControl(...)
    pageDetector.ts       detectPage(page, adapter, inspection) -> PageIdentity
    checkpointDetector.ts detectCheckpoint(inspection, page) -> Checkpoint | null
    pageInspector.ts      (existing — untouched)
    automationEngine.ts   runLoop(ctx) — the state machine
  adapters/
    baseAdapter.ts        MODIFY — expand PortalAdapter
    genericAdapter.ts     MODIFY — getPageIdentity -> UNKNOWN
    registry.ts           MODIFY — register india
    india/
      indiaPortalMap.ts   typed config, placeholder selectors, submitSelector: null
      indiaAdapter.ts     implements PortalAdapter over indiaPortalMap
  checkpoints/
    checkpointManager.ts  CheckpointManager — awaitResume(), signalResume(), isStillBlocked()
  state/
    automationRunStore.ts DB CRUD for automation_runs + automation_events
  automationService.ts    AutomationService (decorated app.automation) + AutomationRunner
  discovery/
    testConnection.ts     (existing — untouched)
    portalDiscovery.ts    read-only field/signal capture for a user-navigated Page

src/server/db/migrations.ts   MODIFY — add version 5
src/server/env.ts             MODIFY — AUTOMATION_HEADLESS, AUTOMATION_EVIDENCE, AUTOMATION_DIR
src/server/logger.ts          MODIFY — REDACT_PATHS additions
src/server/app.ts             MODIFY — decorate app.automation, register automation routes
src/server/routes/automation.ts   Create
src/server/fastify.d.ts       MODIFY — FastifyInstance.automation type

src/web/src/api/client.ts               MODIFY — automation methods
src/web/src/pages/Applications/ReadyForAutomationSection.tsx   MODIFY — wire the button
src/web/src/pages/Automation/AutomationRunPage.tsx             Create
src/web/src/pages/Automation/runChrome.tsx                     Create — StatusBadge, ProgressBar, ActionRequiredPanel, SafeStopBanner, EventLog
src/web/src/main.tsx                     MODIFY — route
src/web/src/styles.css                   MODIFY — additive

test/helpers/fixturePortal.ts            Create
test/fixtures/india-portal/*.html        Create (11 pages)
test/automation/support/fixtureIndiaAdapter.ts   Create
test/automation/*.test.ts                Create (many)
test/web/AutomationRunPage.test.tsx      Create

docs/portals/india.md                    Create
docs/PHASE-5-REPORT.md                   Create
docs/ARCHITECTURE.md                     MODIFY — §3 Phase 5 paragraph
.gitignore                               MODIFY — data/automation/ comment
```

---

### Task 1: Shared automation types, state machine, and event vocabulary

**Files:**
- Create: `src/shared/automation/types.ts`
- Create: `src/shared/automation/states.ts`
- Create: `src/shared/automation/events.ts`
- Create: `src/shared/automation/index.ts`
- Test: `test/automation/states.test.ts`, `test/automation/events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `types.ts`:
    ```ts
    export type RunStatus = 'pending' | 'running' | 'waiting_for_user' | 'paused' | 'review_ready' | 'failed' | 'aborted';
    export type WaitingReason = 'otp' | 'captcha' | 'mfa' | 'anti_bot' | 'unknown_page' | 'missing_field_mapping' | 'value_mismatch' | 'document_upload_required' | 'session_expired' | 'validation_error' | 'user_paused';
    export type PortalState = string; // adapter-defined; 'UNKNOWN' is reserved
    export const UNKNOWN_STATE = 'UNKNOWN';
    export type ControlKind = 'text' | 'textarea' | 'native_select' | 'custom_select' | 'radio' | 'checkbox' | 'date' | 'number' | 'autocomplete' | 'searchable_select';
    export type SelectorConfidence = 'stable' | 'moderate' | 'fragile';
    export interface PortalFieldSpec {
      selector: string;
      fallbackSelector?: string;
      control: ControlKind;
      selectorConfidence: SelectorConfidence;
      transform?: (canonical: string) => string;
      optionMatch?: 'exact' | 'label' | 'value';
    }
    export type PortalFieldMap = Record<string, PortalFieldSpec>; // key = FieldPlan.appliesTo
    export interface SignalMatch { kind: 'url' | 'title' | 'heading' | 'label' | 'field' | 'marker'; matched: boolean; detail: string }
    export interface PageIdentity { state: PortalState; confidence: number; signals: SignalMatch[] }
    export interface MappedField {
      fieldPath: string;            // FieldPlan.appliesTo (non-null)
      label: string;
      sectionId: string;
      required: boolean;            // effectiveRequirement === 'required'
      present: boolean;
      verified: boolean;
      spec: PortalFieldSpec | null; // null => unmapped
      expected: string | null;     // spec.transform applied; null when !present
    }
    export type VerificationOutcome = 'verified' | 'mismatch' | 'unreadable' | 'skipped_no_value';
    export interface VerificationResult { fieldPath: string; outcome: VerificationOutcome }
    export interface RunSummary { fieldsTotal: number; fieldsVerified: number; documentsTotal: number; documentsReady: number; unverifiedFields: string[]; unmappedFields: string[] }
    export interface AutomationRunRow {
      id: string; application_id: string; portal_id: string | null; portal_url_snapshot: string;
      adapter_id: string; status: RunStatus; waiting_reason: WaitingReason | null;
      current_portal_state: string | null; current_section_id: string | null;
      fields_total: number; fields_verified: number; documents_total: number; documents_ready: number;
      error_code: string | null; error_message: string | null;
      started_at: string; updated_at: string; ended_at: string | null;
    }
    export interface AutomationEventRow {
      id: string; run_id: string; seq: number; created_at: string;
      type: string; portal_state: string | null; field_path: string | null;
      status: string | null; message: string; evidence_path: string | null;
    }
    ```
  - `states.ts`:
    ```ts
    export const RUN_STATES: readonly RunStatus[];
    export const TERMINAL_STATES: readonly RunStatus[]; // ['review_ready','failed','aborted']
    export const LEGAL_TRANSITIONS: Record<RunStatus, readonly RunStatus[]>;
    export function isTerminal(s: RunStatus): boolean;
    export function assertTransition(from: RunStatus, to: RunStatus): void; // throws Error on illegal
    ```
  - `events.ts`:
    ```ts
    export const EVENT_TYPES: readonly string[];
    export type EventType = (typeof EVENT_TYPES)[number];
    export const EVENT_MESSAGES: Record<EventType, string>;
    export function isEventType(x: string): x is EventType;
    ```
  - `index.ts` re-exports all three.

- [ ] **Step 1: Write the failing tests**

`test/automation/states.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { LEGAL_TRANSITIONS, RUN_STATES, TERMINAL_STATES, assertTransition, isTerminal } from '../../src/shared/automation/states.js';

describe('run state machine', () => {
  it('has no completed / submitted state', () => {
    expect(RUN_STATES).not.toContain('completed');
    expect(RUN_STATES).not.toContain('submitted');
    expect(RUN_STATES).toContain('review_ready');
  });
  it('review_ready, failed, aborted are terminal with no outgoing transitions', () => {
    for (const s of TERMINAL_STATES) {
      expect(isTerminal(s)).toBe(true);
      expect(LEGAL_TRANSITIONS[s]).toEqual([]);
    }
  });
  it('allows running -> waiting_for_user -> running (resume)', () => {
    expect(() => assertTransition('running', 'waiting_for_user')).not.toThrow();
    expect(() => assertTransition('waiting_for_user', 'running')).not.toThrow();
  });
  it('rejects waiting_for_user -> review_ready (must go through running)', () => {
    expect(() => assertTransition('waiting_for_user', 'review_ready')).toThrow(/illegal/i);
  });
  it('rejects any transition out of review_ready', () => {
    expect(() => assertTransition('review_ready', 'running')).toThrow(/illegal/i);
  });
});
```

`test/automation/events.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { EVENT_MESSAGES, EVENT_TYPES, isEventType } from '../../src/shared/automation/events.js';

describe('event vocabulary', () => {
  it('every event type has a message', () => {
    for (const t of EVENT_TYPES) expect(typeof EVENT_MESSAGES[t]).toBe('string');
    expect(Object.keys(EVENT_MESSAGES).sort()).toEqual([...EVENT_TYPES].sort());
  });
  it('no message contains an interpolation placeholder or a value slot', () => {
    for (const [t, m] of Object.entries(EVENT_MESSAGES)) {
      expect(m, t).not.toMatch(/\$\{|%s|\{\{|\bvalue\b:/i);
    }
  });
  it('includes the safety-critical event types and no submit type', () => {
    for (const t of ['OTP_REQUIRED', 'CAPTCHA_REQUIRED', 'REVIEW_READY', 'BLOCKED_MISSING_DOCUMENT', 'CHECKPOINT_STILL_PRESENT']) {
      expect(EVENT_TYPES).toContain(t);
    }
    expect(EVENT_TYPES.some((t) => /submit|confirm|lodge|pay/i.test(t))).toBe(false);
    expect(isEventType('NOT_A_REAL_EVENT')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/automation/states.test.ts test/automation/events.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `types.ts`** exactly as the Produces block above (types only, no runtime code except `export const UNKNOWN_STATE = 'UNKNOWN'`).

- [ ] **Step 4: Implement `states.ts`**

```ts
import type { RunStatus } from './types.js';

export const RUN_STATES = ['pending', 'running', 'waiting_for_user', 'paused', 'review_ready', 'failed', 'aborted'] as const;
export const TERMINAL_STATES = ['review_ready', 'failed', 'aborted'] as const satisfies readonly RunStatus[];

export const LEGAL_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  pending: ['running', 'aborted', 'failed'],
  running: ['waiting_for_user', 'paused', 'review_ready', 'failed', 'aborted'],
  waiting_for_user: ['running', 'paused', 'aborted', 'failed'],
  paused: ['running', 'aborted', 'failed'],
  review_ready: [],
  failed: [],
  aborted: [],
};

export function isTerminal(s: RunStatus): boolean {
  return (TERMINAL_STATES as readonly RunStatus[]).includes(s);
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!LEGAL_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`illegal automation run transition: ${from} -> ${to}`);
  }
}
```

- [ ] **Step 5: Implement `events.ts`** — `EVENT_TYPES` = the closed list from spec §11 (copy verbatim: `RUN_STARTED, PAGE_DETECTED, UNKNOWN_PORTAL_STATE, CHECKPOINT_DETECTED, OTP_REQUIRED, CAPTCHA_REQUIRED, MFA_REQUIRED, ANTI_BOT_DETECTED, CHECKPOINT_STILL_PRESENT, USER_ACTION_REQUIRED, RUN_RESUMED, FIELD_MAP_RESOLVED, FIELD_UNMAPPED, FIELD_ALREADY_SET, FIELD_FILL_STARTED, FIELD_FILLED, FIELD_FILLED_UNVERIFIED, FIELD_VERIFIED, FIELD_MISMATCH, FIELD_UNVERIFIABLE, FIELD_NOT_FOUND, SELECTOR_STALE, DROPDOWN_OPTION_MISSING, VALIDATION_ERROR, NAVIGATION_STARTED, NAVIGATION_COMPLETED, NAVIGATION_STALLED, NAVIGATION_FAILED, DOCUMENT_READY, BLOCKED_MISSING_DOCUMENT, SESSION_EXPIRED, PORTAL_UNAVAILABLE, REVIEW_READY, RUN_PAUSED, RUN_ABORTED, RUN_FAILED`). `EVENT_MESSAGES` — one fixed sentence each, e.g. `OTP_REQUIRED: 'An OTP challenge is on the page. Complete it in the browser, then resume.'`, `REVIEW_READY: 'The portal reached the final review page. Preparation is complete; submission is yours.'`, `FIELD_MISMATCH: 'A filled field did not read back as expected. The run paused for your review.'` — no `${}`.

- [ ] **Step 6: Implement `index.ts`** — `export * from './types.js'; export * from './states.js'; export * from './events.js';`

- [ ] **Step 7: Run the tests — expect PASS.** Then `npx vitest run test/automation/` to confirm nothing else broke.

- [ ] **Step 8: Gate + commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add src/shared/automation test/automation/states.test.ts test/automation/events.test.ts
git commit -m "feat(automation): shared types, run state machine, closed event vocabulary <trailer>"
```

**Verification:** `npx vitest run test/automation/states.test.ts test/automation/events.test.ts` — all pass; full gate green.
**Acceptance:** No `completed`/`submitted` state; terminal states have empty transition lists; every `EventType` has a placeholder-free message; no submit-like event type.
**Commit boundary:** one commit.

---

### Task 2: Pure field mapper

**Files:**
- Create: `src/shared/automation/fieldMapping.ts`
- Modify: `src/shared/automation/index.ts` (add `export * from './fieldMapping.js'`)
- Test: `test/automation/fieldMapping.test.ts`

**Interfaces:**
- Consumes: `MappedField`, `PortalFieldMap`, `PortalFieldSpec` (Task 1); `SectionPlan`, `FieldPlan` from `src/shared/application/types.js`.
- Produces:
  ```ts
  export function mapFields(
    sections: readonly SectionPlan[],
    fieldMap: PortalFieldMap,
    activeSectionIds: readonly string[],
  ): MappedField[];
  ```
  Rules: include a section only if `section.applicable && activeSectionIds.includes(section.id)`. For each `field` where `field.effectiveRequirement !== 'not_applicable'` **and** `field.appliesTo !== null`: look up `fieldMap[field.appliesTo]`; if absent → `spec: null`, `expected: null`; else `spec` set and `expected = field.present ? (spec.transform ? spec.transform(field.value ?? '') : (field.value ?? '')) : null`. `required = field.effectiveRequirement === 'required'`. Fields with `appliesTo === null` are skipped entirely.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mapFields } from '../../src/shared/automation/fieldMapping.js';
import type { SectionPlan } from '../../src/shared/application/types.js';
import type { PortalFieldMap } from '../../src/shared/automation/types.js';

const src = { officialUrl: 'https://x.test/', retrievedAt: '2026-01-01', confidence: 'secondary_guidance' } as const;
function field(over: Partial<import('../../src/shared/application/types.js').FieldPlan>) {
  return { id: 'f', label: 'F', sectionId: 's1', requirement: 'required', condition: null, conditionMet: null,
    effectiveRequirement: 'required', appliesTo: 'identity.surname', value: 'RANA', present: true, verified: false, source: src, ...over } as any;
}
const sections: SectionPlan[] = [
  { id: 's1', label: 'S1', applicable: true, source: src as any, fields: [
    field({ appliesTo: 'identity.surname', value: 'RANA' }),
    field({ id: 'g', appliesTo: 'identity.givenNames', value: 'MITHU', effectiveRequirement: 'optional' }),
    field({ id: 'na', appliesTo: 'identity.religion', effectiveRequirement: 'not_applicable' }),
    field({ id: 'syn', appliesTo: null }),
    field({ id: 'nomap', appliesTo: 'application.purpose', value: 'business' }),
  ] },
  { id: 's2', label: 'S2', applicable: true, source: src as any, fields: [ field({ id: 'x', sectionId: 's2' }) ] },
  { id: 's3', label: 'S3', applicable: false, source: src as any, fields: [ field({ id: 'y', sectionId: 's3' }) ] },
];
const fieldMap: PortalFieldMap = {
  'identity.surname': { selector: '#surname', control: 'text', selectorConfidence: 'stable' },
  'identity.givenNames': { selector: '#given', control: 'text', selectorConfidence: 'stable' },
  'identity.religion': { selector: '#rel', control: 'text', selectorConfidence: 'stable' },
  'application.purpose': undefined as any, // deliberately absent below
};
delete (fieldMap as any)['application.purpose'];

describe('mapFields', () => {
  it('maps present fields in active applicable sections, applying transform', () => {
    const withTransform: PortalFieldMap = { ...fieldMap, 'identity.surname': { selector: '#s', control: 'text', selectorConfidence: 'stable', transform: (v) => v.toLowerCase() } };
    const out = mapFields(sections, withTransform, ['s1']);
    const surname = out.find((m) => m.fieldPath === 'identity.surname')!;
    expect(surname.expected).toBe('rana');
    expect(surname.required).toBe(true);
    expect(surname.spec?.selector).toBe('#s');
  });
  it('excludes not_applicable fields and appliesTo:null synthetic rows', () => {
    const out = mapFields(sections, fieldMap, ['s1']);
    expect(out.map((m) => m.fieldPath)).not.toContain('identity.religion');
    expect(out.some((m) => m.fieldPath === null as any)).toBe(false);
  });
  it('includes an unmapped required field with spec:null, expected:null', () => {
    const out = mapFields(sections, fieldMap, ['s1']);
    const p = out.find((m) => m.fieldPath === 'application.purpose')!;
    expect(p.spec).toBeNull();
    expect(p.expected).toBeNull();
    expect(p.required).toBe(true);
  });
  it('excludes sections not in activeSectionIds and non-applicable sections', () => {
    const out = mapFields(sections, fieldMap, ['s1']);
    expect(out.every((m) => m.sectionId === 's1')).toBe(true);
  });
  it('expected is null for a mapped-but-absent field', () => {
    const out = mapFields([{ ...sections[0]!, fields: [ field({ present: false, value: null }) ] }], fieldMap, ['s1']);
    expect(out[0]!.expected).toBeNull();
    expect(out[0]!.present).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`mapFields` not defined).
- [ ] **Step 3: Implement `fieldMapping.ts`** per the Produces rules. Pure, no imports beyond the two type modules.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(automation): pure FieldPlan -> portal-control mapper <trailer>"`

**Verification:** `npx vitest run test/automation/fieldMapping.test.ts`.
**Acceptance:** transform applied to `expected`; `not_applicable` / `appliesTo:null` excluded; unmapped required field surfaced with `spec:null`; section scoping correct.
**Commit boundary:** one commit.

---

### Task 3: Migration 5 + automation run store

**Files:**
- Modify: `src/server/db/migrations.ts` (append `{ version: 5, up: ... }`)
- Create: `src/server/automation/state/automationRunStore.ts`
- Test: `test/automation/automationMigrations.test.ts`, `test/automation/automationRunStore.test.ts`

**Interfaces:**
- Consumes: `openDatabase` (`src/server/db/connection.js`), `runMigrations` (`src/server/db/migrations.js`), Task 1 types.
- Produces (`automationRunStore.ts`, all functions take `db: DatabaseSync` first):
  ```ts
  export function createRun(db, input: { id: string; applicationId: string; portalId: string | null; portalUrlSnapshot: string; adapterId: string; now: string }): AutomationRunRow;
  export function getRun(db, id: string): AutomationRunRow | null;
  export function listRunsForApplication(db, applicationId: string): AutomationRunRow[];
  export function findActiveRun(db, opts?: { applicationId?: string }): AutomationRunRow | null; // status NOT IN terminal
  export function updateRun(db, id: string, patch: Partial<Pick<AutomationRunRow, 'status'|'waiting_reason'|'current_portal_state'|'current_section_id'|'fields_total'|'fields_verified'|'documents_total'|'documents_ready'|'error_code'|'error_message'|'ended_at'>>, now: string): AutomationRunRow;
  export function appendEvent(db, input: { id: string; runId: string; type: string; portalState?: string | null; fieldPath?: string | null; status?: string | null; message: string; evidencePath?: string | null; now: string }): AutomationEventRow; // seq = max(seq)+1 for the run
  export function listEvents(db, runId: string, afterSeq?: number): AutomationEventRow[];
  ```

- [ ] **Step 1: Write the failing migration test** `test/automation/automationMigrations.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection.js';
import { LATEST_SCHEMA_VERSION, runMigrations } from '../../src/server/db/migrations.js';
import { tempDbPath } from '../helpers/tempDb.js';

describe('migration 5', () => {
  it('LATEST_SCHEMA_VERSION is 5', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(5);
  });
  it('a fresh DB has automation_runs + automation_events', () => {
    const db = openDatabase(tempDbPath());
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['automation_runs', 'automation_events']));
    db.close();
  });
  it('v4 -> v5 upgrade: stop at 4, seed a run-worthy row, then migrate', () => {
    const path = tempDbPath();
    const db = openDatabase(path); // openDatabase runs migrations; so:
    db.close();
    // Re-open with a raw handle stopped at v4 is not possible post-openDatabase; instead assert the upTo path:
    const db2 = openDatabase(tempDbPath());
    runMigrations(db2, 4); // no-op (already 5) — so this test asserts runMigrations(db,4) on a v0 DB stops at 4
  });
});
```
Refine step 1: the real v4→v5 test must construct a v0 DB and call `runMigrations(rawDb, 4)`. `openDatabase` runs all migrations, so the test needs the lower-level `DatabaseSync` + `runMigrations`. Use:
```ts
import { DatabaseSync } from 'node:sqlite';
it('v4 -> v5 upgrade preserves and extends', () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, 4);
  expect((db.prepare('PRAGMA user_version').get() as any).user_version).toBe(4);
  // seed an applicant + application row so a run FK resolves
  // (use the minimal column sets from migrations 2 & 4)
  db.exec("INSERT INTO applicants (id, display_name, created_at, updated_at) VALUES ('a1','A','t','t')");
  db.exec("INSERT INTO applicant_identity (applicant_id) VALUES ('a1')");
  db.exec("INSERT INTO visa_applications (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at) VALUES ('app1','a1','IND','regular','regular.tourist','draft','2026-09-06','t','t')");
  runMigrations(db); // -> 5
  expect((db.prepare('PRAGMA user_version').get() as any).user_version).toBe(5);
  db.exec("INSERT INTO automation_runs (id, application_id, portal_id, portal_url_snapshot, adapter_id, status, fields_total, fields_verified, documents_total, documents_ready, started_at, updated_at) VALUES ('r1','app1',NULL,'https://x','generic','pending',0,0,0,0,'t','t')");
  expect((db.prepare('SELECT count(*) c FROM automation_runs').get() as any).c).toBe(1);
});
it('rejects an illegal status via CHECK', () => {
  const db = new DatabaseSync(':memory:'); runMigrations(db);
  db.exec("INSERT INTO applicants (id, display_name, created_at, updated_at) VALUES ('a1','A','t','t')");
  db.exec("INSERT INTO visa_applications (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at) VALUES ('app1','a1','IND','regular','regular.tourist','draft','2026-09-06','t','t')");
  expect(() => db.exec("INSERT INTO automation_runs (id, application_id, portal_url_snapshot, adapter_id, status, started_at, updated_at) VALUES ('r','app1','u','generic','completed','t','t')")).toThrow();
});
```

- [ ] **Step 2: Run — expect FAIL** (`LATEST_SCHEMA_VERSION` is 4; tables absent).
- [ ] **Step 3: Add migration 5** to `migrations.ts` — the exact DDL from spec §9 (both `CREATE TABLE`s + both `CREATE INDEX`es). `application_id ... ON DELETE CASCADE`, `portal_id ... ON DELETE SET NULL`. Status CHECK list = the 7 `RUN_STATES`. `waiting_reason` CHECK = the 11 reasons OR NULL. `automation_events` with `UNIQUE (run_id, seq)`.
- [ ] **Step 4: Run migration test — expect PASS.**
- [ ] **Step 5: Write the failing store test** `test/automation/automationRunStore.test.ts` — cover: `createRun` returns a row with `status: 'pending'`; `getRun` round-trips; `appendEvent` assigns `seq` 1,2,3 and a 2nd event with a manually-forced duplicate seq throws; `listEvents(runId, 1)` returns only `seq > 1`; `findActiveRun` ignores terminal-status rows; `updateRun` sets `updated_at`; deleting the parent `visa_applications` row cascades both tables. Use `openDatabase(tempDbPath())` + insert an applicant/application first (helper: reuse `test/helpers/applicationFixtures` patterns or raw SQL as above).
- [ ] **Step 6: Run — expect FAIL.**
- [ ] **Step 7: Implement `automationRunStore.ts`** — plain prepared statements, `rowToRun` mapper, `appendEvent` computes `seq` via `SELECT COALESCE(MAX(seq),0)+1`. No HTTP types, no engine logic.
- [ ] **Step 8: Run — expect PASS.** Then full `npx vitest run test/automation/`.
- [ ] **Step 9: Gate + commit** — `git commit -m "feat(automation): migration 5 (automation_runs + events) + run store <trailer>"`

**Verification:** `npx vitest run test/automation/automationMigrations.test.ts test/automation/automationRunStore.test.ts`.
**Acceptance:** `LATEST_SCHEMA_VERSION === 5`; fresh + real v4→v5 both succeed; status CHECK rejects `completed`; `seq` monotonic + unique; cascade delete works.
**Commit boundary:** one commit.

---

### Task 4: `env` + `.gitignore` + logger redaction + `browserManager` extensions

**Files:**
- Modify: `src/server/env.ts`
- Modify: `.gitignore`
- Modify: `src/server/logger.ts`
- Modify: `src/server/automation/engine/browserManager.ts`
- Test: `test/automation/env.test.ts`, `test/server/loggerRedaction.test.ts` (extend), `test/automation/browserManager.test.ts`

**Interfaces:**
- Produces:
  - `env` gains: `AUTOMATION_HEADLESS: boolean` (from `'true'|'false'`, default `'false'`), `AUTOMATION_EVIDENCE: 'off' | 'screenshots'` (default `'off'`), derived `AUTOMATION_DIR: string` = `path.join(dataDir, 'automation')`.
  - `BrowserManager` gains:
    ```ts
    async launch(opts?: { headless?: boolean }): Promise<Browser>;   // default from env.AUTOMATION_HEADLESS
    async newPage(): Promise<{ page: Page; context: BrowserContext }>; // fresh context
    async bringToFront(page: Page): Promise<void>;                    // page.bringToFront().catch(()=>{})
    ```
    Keep the existing `close()`. Existing `testConnection.ts` still calls `manager.launch()` with no args — must keep working (it currently passes `{ headless: env.PW_HEADLESS }` internally? no — it calls `manager.launch()`; `browserManager` currently reads `env.PW_HEADLESS`). Change: `launch(opts)` uses `opts?.headless ?? env.PW_HEADLESS` when called from testConnection path? Simpler: add a second manager concept is overkill. Decision: `launch(opts?: {headless?: boolean})` → `headless = opts?.headless ?? env.PW_HEADLESS`. The automation service passes `{ headless: env.AUTOMATION_HEADLESS }` explicitly. testConnection unchanged.

- [ ] **Step 1: Failing env test** — set `process.env.AUTOMATION_HEADLESS`/`AUTOMATION_EVIDENCE`, re-import `env` in isolation (vitest `vi.resetModules()`), assert parsed values + that `AUTOMATION_DIR` ends with `automation` and is absolute; assert defaults when unset.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Extend `env.ts`** Zod schema + derived object.
- [ ] **Step 4: `.gitignore`** — under the existing `data/` line add a comment line: `# data/automation/ (Phase 5 screenshot evidence) is covered by data/ above`.
- [ ] **Step 5: Extend `REDACT_PATHS`** in `logger.ts` — append a `// Phase 5 — automation` block: `'expected', 'actual', 'otp', 'otpCode', 'otp_code', 'captcha', 'captchaText', '*.expected', '*.actual', '*.otp', '*.otpCode', '*.captcha'`.
- [ ] **Step 6: Extend `test/server/loggerRedaction.test.ts`** — add these keys to whatever `PHASE_*_MUST_INCLUDE` / assertion pattern the file uses (mirror the Phase 4 addition style); assert `expected`/`actual`/`otp`/`captcha` (+ `*.` variants) are all in `REDACT_PATHS`.
- [ ] **Step 7: Failing `browserManager` test** — `launch({ headless: true })` returns a connected browser; `newPage()` returns a page whose `context()` differs across two calls; `bringToFront` on a page does not throw; `close()` disconnects. (Real chromium, headless.)
- [ ] **Step 8: Run — FAIL.**
- [ ] **Step 9: Implement `browserManager` changes.**
- [ ] **Step 10: Run all three tests + `npx vitest run test/automation test/server/loggerRedaction.test.ts` — PASS.**
- [ ] **Step 11: Gate + commit** — `git commit -m "feat(automation): env + gitignore + redaction + browserManager context/foreground <trailer>"`

**Verification:** the three tests above + existing `testConnection.test.ts` still green.
**Acceptance:** new env vars parse with correct defaults; `AUTOMATION_DIR` derived & gitignore-covered; `expected/actual/otp/captcha` redacted; `browserManager` supports fresh contexts + `bringToFront`; `testConnection` unaffected.
**Commit boundary:** one commit.

---

### Task 5: Expanded `PortalAdapter` interface + `genericAdapter` + registry

**Files:**
- Modify: `src/server/automation/adapters/baseAdapter.ts`
- Modify: `src/server/automation/adapters/genericAdapter.ts`
- Modify: `src/server/automation/adapters/registry.ts`
- Test: `test/automation/genericAdapter.test.ts`, `test/automation/pageInspector.test.ts` (should still pass — do not change `pageInspector`)

**Interfaces:**
- Consumes: Task 1 types (`PageIdentity`, `PortalState`, `PortalFieldMap`, `UNKNOWN_STATE`), existing `PageInspection`.
- Produces (`baseAdapter.ts`):
  ```ts
  export interface CheckpointHints { otpLabelPatterns?: RegExp[]; captchaSelectors?: string[]; mfaPatterns?: RegExp[] }
  export interface PortalStateConfig {
    signals: (page: Page, inspection: PageInspection) => Promise<SignalMatch[]>;
    sectionIds: string[];
    nextSelector: string | null;   // null on the final review state
    isFinalReview?: boolean;
  }
  export interface PortalAdapter {
    readonly id: string;
    matches(url: string): boolean;
    entryUrl(portalUrl: string): string;
    getPageIdentity(page: Page, inspection: PageInspection): Promise<PageIdentity>;
    sectionIdsForState(state: PortalState): string[];
    getFieldMap(): PortalFieldMap;
    canContinue(page: Page): Promise<{ ok: boolean; reason?: string }>;
    clickNext(page: Page): Promise<void>;
    isFinalReview(state: PortalState): boolean;
    checkpointHints?: CheckpointHints;
    readonly submitSelector: null;
  }
  ```
  `genericAdapter`: `id: 'generic'`, `matches: () => true` (fallback), `entryUrl: (u) => u`, `getPageIdentity: async () => ({ state: UNKNOWN_STATE, confidence: 0, signals: [] })`, `sectionIdsForState: () => []`, `getFieldMap: () => ({})`, `canContinue: async () => ({ ok: false, reason: 'unknown portal' })`, `clickNext: async () => { throw new Error('generic adapter cannot navigate'); }`, `isFinalReview: () => false`, `submitSelector: null`.
  `registry.ts`: keep `resolveAdapter(url)`; the concrete india adapter is registered in Task 20 — for now the array holds nothing and `resolveAdapter` returns `genericAdapter` for any url. Export the array-append as a function `registerAdapter(a: PortalAdapter)` so Task 20 adds india without editing the array literal, OR just add india in Task 20 by editing the array. Decision: keep the module-level `adapters: PortalAdapter[]` array; Task 20 pushes `indiaAdapter` into it.

- [ ] **Step 1: Failing test** `test/automation/genericAdapter.test.ts` — `genericAdapter.getPageIdentity(fakePage, fakeInspection)` resolves to `{ state: 'UNKNOWN', confidence: 0 }`; `submitSelector` is `null`; `clickNext` throws; `resolveAdapter('https://anything')` returns an adapter with `id === 'generic'`. Use a minimal fake `Page` (`{} as unknown as Page`) since generic never touches it.
- [ ] **Step 2: Run — FAIL** (interface members missing on genericAdapter).
- [ ] **Step 3: Rewrite `baseAdapter.ts`** with the expanded interface (keep `PortalAdapter` name; the old `inspect` member is removed — `pageInspector.inspectPage` is called by the engine directly, not via the adapter).
- [ ] **Step 4: Rewrite `genericAdapter.ts`** to satisfy it.
- [ ] **Step 5: Update `registry.ts`** — `import type` fix only; `resolveAdapter` unchanged behaviour.
- [ ] **Step 6: Check callers** — `testConnection.ts` calls `resolveAdapter(url).inspect(page)`. That member no longer exists. **Fix `testConnection.ts`:** replace `const inspection = await adapter.inspect(page)` with `const inspection = await inspectPage(page)` (import from `../engine/pageInspector.js`), and drop the now-unused `resolveAdapter` import there. Update `test/automation/testConnection.test.ts` if it asserts adapter interaction (it likely just asserts the result shape — keep).
- [ ] **Step 7: Run `npx vitest run test/automation` — PASS** (genericAdapter + testConnection + pageInspector).
- [ ] **Step 8: Gate + commit** — `git commit -m "feat(automation): expand PortalAdapter; generic adapter stops on unknown portal <trailer>"`

**Verification:** `npx vitest run test/automation`; `testConnection.test.ts` still green.
**Acceptance:** `PortalAdapter` has the full member set; `genericAdapter` forces `UNKNOWN`/no-continue; `submitSelector` typed `null`; `testConnection` migrated off the removed `inspect` member with no behaviour change.
**Commit boundary:** one commit.

---

### Task 6: `pageActions` — low-level Playwright control primitives

**Files:**
- Create: `src/server/automation/engine/pageActions.ts`
- Test: `test/automation/pageActions.test.ts`

**Interfaces:**
- Consumes: `playwright` `Page`, `ControlKind` (Task 1).
- Produces (all take `page: Page`):
  ```ts
  export async function waitForPageSettled(page: Page, anchorSelector?: string, timeoutMs?: number): Promise<void>;
  export async function readControl(page: Page, selector: string, control: ControlKind): Promise<string | null>;
  //  text/textarea/number/date/autocomplete -> input.value ; native_select -> selected option label ;
  //  custom_select/searchable_select -> the widget's visible selected text ; radio -> checked value in the group ;
  //  checkbox -> 'true' | 'false'
  export async function fillText(page: Page, selector: string, value: string): Promise<void>;   // clear then type
  export async function selectNative(page: Page, selector: string, value: string, match: 'exact'|'label'|'value'): Promise<void>;
  export async function selectCustom(page: Page, triggerSelector: string, optionText: string): Promise<void>; // click trigger, wait for listbox, click matching option
  export async function setRadio(page: Page, groupSelector: string, value: string): Promise<void>;
  export async function setCheckbox(page: Page, selector: string, checked: boolean): Promise<void>;
  export async function setDate(page: Page, selector: string, value: string): Promise<void>;
  export async function typeAutocomplete(page: Page, selector: string, value: string): Promise<void>; // type, wait for suggestions, pick exact
  ```
  All waits are condition-based: `page.waitForLoadState('domcontentloaded')` + `page.locator(anchor).waitFor({ state: 'visible' })` when an anchor is given; `page.waitForSelector` with an explicit `timeout` (default 10_000) elsewhere. **No bare `setTimeout`/`waitForTimeout`.** Missing selector → throw a typed `SelectorNotFoundError { selector }`. Dropdown option missing → throw `OptionNotFoundError { selector, optionText }`.

- [ ] **Step 1: Failing test** — spin a one-off HTML page via `startFixtureServer` (existing helper) whose body has: `<input id="t">`, `<textarea id="ta">`, `<select id="ns"><option value="a">Alpha</option><option value="b">Bravo</option></select>`, a JS custom dropdown (`<div id="cd" role="combobox">` + a togglable `<ul role="listbox">`), `<input type="radio" name="r" value="x">`/`value="y"`, `<input type="checkbox" id="cb">`, `<input type="date" id="d">`, and an autocomplete (`<input id="ac">` + a script that shows a `<ul id="aclist">` of matches). Launch chromium headless, `page.goto(fixture.url)`. Assert each primitive: `fillText`+`readControl` round-trips 'hello'; `selectNative('#ns','Bravo','label')` then `readControl` → 'Bravo'; `selectCustom` picks an option and `readControl` reflects it; `setRadio` → `readControl` returns the value; `setCheckbox(true/false)` → 'true'/'false'; `setDate('#d','2027-01-15')` → '2027-01-15'; `typeAutocomplete` picks the exact suggestion; a bad selector throws `SelectorNotFoundError`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `pageActions.ts`** — one small function per primitive, each ≤ ~15 lines. Export the two error classes.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(automation): condition-based Playwright control primitives <trailer>"`

**Verification:** `npx vitest run test/automation/pageActions.test.ts`.
**Acceptance:** every `ControlKind` read/write round-trips against a real chromium page; no `waitForTimeout`; missing selector/option → typed errors.
**Commit boundary:** one commit.

---

### Task 7: `fieldActions` — apply + verify a mapped field

**Files:**
- Create: `src/server/automation/engine/fieldActions.ts`
- Test: `test/automation/fieldActions.test.ts`

**Interfaces:**
- Consumes: `pageActions` (Task 6), `MappedField`, `VerificationResult`, `VerificationOutcome` (Task 1).
- Produces:
  ```ts
  export async function verifyControl(page: Page, spec: PortalFieldSpec, expected: string): Promise<VerificationOutcome>;
  //  read the control, normalise both sides (trim; for selects compare per spec.optionMatch), return
  //  'verified' | 'mismatch' | 'unreadable'
  export async function applyField(page: Page, m: MappedField): Promise<{ filled: boolean; outcome: VerificationOutcome; alreadySet: boolean }>;
  //  precondition: m.spec !== null && m.present && m.expected !== null (caller guarantees)
  //  read current; if equals expected -> { filled:false, outcome:'verified', alreadySet:true }
  //  else dispatch on m.spec.control to the right pageActions writer; then verifyControl; one retry on mismatch
  ```
  Values live only in local variables. `applyField` returns an **outcome enum**, never the raw values.

- [ ] **Step 1: Failing test** — reuse the Task 6 fixture page (or a trimmed variant). Cases:
  - text field, `expected='RANA'`, blank control → `applyField` → `{ filled:true, outcome:'verified', alreadySet:false }`.
  - text field already containing 'RANA' → `{ filled:false, alreadySet:true, outcome:'verified' }`.
  - a fixture input with an on-`blur` handler that appends `'X'` → after fill the read-back differs → one retry → still differs → `outcome:'mismatch'`.
  - native select, `optionMatch:'label'`, `expected='Bravo'` → `verified`.
  - a selector that doesn't exist → `applyField` propagates `SelectorNotFoundError` (caller handles).
  - `verifyControl` alone on a pre-set control returns `'verified'`; on a mismatched one `'mismatch'`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `fieldActions.ts`.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(automation): field apply + read-back verification <trailer>"`

**Verification:** `npx vitest run test/automation/fieldActions.test.ts`.
**Acceptance:** fill→verify happy path; `alreadySet` short-circuit; one retry then `mismatch`; select label matching; outcomes are enums, values never returned.
**Commit boundary:** one commit.

---

### Task 8: `pageDetector`

**Files:**
- Create: `src/server/automation/engine/pageDetector.ts`
- Test: `test/automation/pageDetector.test.ts`

**Interfaces:**
- Consumes: `PortalAdapter` (Task 5), `PageInspection`, `PageIdentity`, `UNKNOWN_STATE` (Task 1).
- Produces:
  ```ts
  export const DETECT_CONFIDENCE_THRESHOLD = 0.6;
  export async function detectPage(page: Page, adapter: PortalAdapter, inspection: PageInspection): Promise<PageIdentity>;
  //  calls adapter.getPageIdentity(page, inspection); if result.state === UNKNOWN_STATE OR
  //  result.confidence < DETECT_CONFIDENCE_THRESHOLD -> return { state: UNKNOWN_STATE, confidence: result.confidence, signals: result.signals }
  ```

- [ ] **Step 1: Failing test** — fake adapters:
  - one returning `{ state:'PASSPORT_DETAILS', confidence:0.9, signals:[...] }` → `detectPage` passes it through.
  - one returning `{ state:'PASSPORT_DETAILS', confidence:0.4 }` → `detectPage` → `state:'UNKNOWN'`.
  - one returning `{ state:'UNKNOWN', confidence:0 }` → stays `UNKNOWN`.
  Use `{} as Page`, `{} as PageInspection` (fake adapter ignores them).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(automation): page detection with a confidence floor <trailer>"`

**Verification:** `npx vitest run test/automation/pageDetector.test.ts`.
**Acceptance:** below-threshold and `UNKNOWN` both resolve to `UNKNOWN`; high-confidence passes through with signals.
**Commit boundary:** one commit.

---

### Task 9: `checkpointDetector`

**Files:**
- Create: `src/server/automation/engine/checkpointDetector.ts`
- Test: `test/automation/checkpointDetector.test.ts`

**Interfaces:**
- Consumes: `PageInspection` (has `securityChallengeFlags`), `CheckpointHints` (Task 5), `playwright` `Page`.
- Produces:
  ```ts
  export type CheckpointKind = 'otp' | 'captcha' | 'mfa' | 'anti_bot';
  export interface Checkpoint { kind: CheckpointKind; signals: string[] }
  export async function detectCheckpoint(inspection: PageInspection, page: Page, hints?: CheckpointHints): Promise<Checkpoint | null>;
  //  captcha: securityChallengeFlags.recaptcha|hcaptcha|turnstile OR any hints.captchaSelectors present
  //  anti_bot: securityChallengeFlags.cloudflareInterstitial
  //  otp: securityChallengeFlags.mentionsOtp OR a visible input whose label/placeholder matches an OTP pattern
  //        OR hints.otpLabelPatterns
  //  mfa: securityChallengeFlags.mentionsMfa OR hints.mfaPatterns
  //  precedence: captcha > anti_bot > mfa > otp ; null when none
  ```
  It **detects only** — no interaction. A doc-comment forbids adding any solve/fill path.

- [ ] **Step 1: Failing test** — construct `PageInspection` fixtures with each flag set; assert the right `kind`; a clean inspection + fake page → `null`; precedence (recaptcha + otp both → `captcha`). For the "visible OTP input" branch, use `startFixtureServer` with `<label for="o">Enter OTP</label><input id="o">` and a real page.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(automation): detect-only OTP/CAPTCHA/MFA/anti-bot checkpoints <trailer>"`

**Verification:** `npx vitest run test/automation/checkpointDetector.test.ts`.
**Acceptance:** each challenge kind detected from `securityChallengeFlags` and from hints; precedence correct; clean page → `null`; module contains no fill/click/solve call.
**Commit boundary:** one commit.

---

### Task 10: `checkpointManager` (pause / resume signalling)

**Files:**
- Create: `src/server/automation/checkpoints/checkpointManager.ts`
- Test: `test/automation/checkpointManager.test.ts`

**Interfaces:**
- Consumes: `detectCheckpoint` (Task 9), `Checkpoint`.
- Produces:
  ```ts
  export class CheckpointManager {
    /** Returns a promise that resolves when signalResume(runId) is called for this run. */
    awaitResume(runId: string): Promise<void>;
    /** Resolve a pending awaitResume for runId. No-op if none pending. Returns whether one was pending. */
    signalResume(runId: string): boolean;
    /** True while a checkpoint is still on the page (re-runs detectCheckpoint). */
    async stillBlocked(page: Page, inspection: PageInspection, hints?: CheckpointHints): Promise<Checkpoint | null>;
    hasPending(runId: string): boolean;
  }
  ```
  Internally a `Map<string, () => void>`.

- [ ] **Step 1: Failing test** — `awaitResume('r')` yields a pending promise; `hasPending('r')` true; `signalResume('r')` resolves it and returns `true`; a second `signalResume('r')` returns `false`; `signalResume('other')` returns `false`; `stillBlocked` delegates to `detectCheckpoint` (pass a fake inspection with recaptcha → returns a `captcha` Checkpoint).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(automation): checkpoint pause/resume signalling <trailer>"`

**Verification:** `npx vitest run test/automation/checkpointManager.test.ts`.
**Acceptance:** resume promise resolves exactly once per signal; `stillBlocked` re-detects; no auto-resume path.
**Commit boundary:** one commit.

---

### Task 11: `automationEngine` — the run loop

**Files:**
- Create: `src/server/automation/engine/automationEngine.ts`
- Test: `test/automation/automationEngine.test.ts`

**Interfaces:**
- Consumes: `detectPage` (8), `detectCheckpoint` (9), `CheckpointManager` (10), `mapFields` (2), `applyField`/`verifyControl` (7), `waitForPageSettled` (6), `inspectPage` (existing), `PortalAdapter` (5), `EVENT_MESSAGES`/`assertTransition` (1), `ApplicationPlan` type.
- Produces:
  ```ts
  export interface EngineContext {
    page: Page;
    adapter: PortalAdapter;
    plan: ApplicationPlan;
    checkpoints: CheckpointManager;
    runId: string;
    /** persist a status/field change; the engine calls this, the service wires it to the store */
    onProgress: (patch: Partial<AutomationRunRow>) => void | Promise<void>;
    /** append one event; message MUST come from EVENT_MESSAGES */
    emit: (e: { type: EventType; portalState?: string | null; fieldPath?: string | null; status?: string | null }) => void | Promise<void>;
    /** live (in-memory) mismatch surface for GET /live */
    recordMismatch: (m: { fieldPath: string; expected: string; actual: string }) => void;
    now: () => string;
  }
  export type EngineStop =
    | { kind: 'review_ready' }
    | { kind: 'waiting'; reason: WaitingReason }
    | { kind: 'failed'; errorCode: string };
  export async function runLoop(ctx: EngineContext): Promise<EngineStop>;
  ```
  Loop = spec §5 exactly. Never calls `adapter.submitSelector`, has no submit/confirm click. `recordMismatch` gets raw values (in-memory only); `emit` never does. Each page iteration calls `onProgress` before any suspension.

- [ ] **Step 1: Failing test** — a `FakeAdapter` implementing `PortalAdapter` over an in-memory page model, and a `FakePage` (or a tiny 3-page `startFixtureServer` flow). Prefer a **fake `Page`** with just the methods the loop calls (`url()`, `title()`, `locator`, `waitForLoadState`, `bringToFront`) plus a scriptable state, to keep this unit-level; the real-browser path is covered by the integration suite (Task 15). Scenarios:
  1. 2 field pages + a review page → loop fills both pages, all `FIELD_VERIFIED`, `clickNext` advances, `isFinalReview` on page 3 → returns `{ kind:'review_ready' }`; assert the emitted event sequence and that no event type matches `/submit/i`.
  2. adapter `getPageIdentity` → UNKNOWN on page 1 → returns `{ kind:'waiting', reason:'unknown_page' }`; no `applyField` called.
  3. `detectCheckpoint` → `otp` on page 2 → `{ kind:'waiting', reason:'otp' }`, `bringToFront` invoked, `OTP_REQUIRED` emitted.
  4. a required field with `spec:null` (unmapped) on the current page → `{ kind:'waiting', reason:'missing_field_mapping' }`, `FIELD_UNMAPPED` emitted.
  5. `applyField` yields `mismatch` for a required field → `recordMismatch` called with the values → `{ kind:'waiting', reason:'value_mismatch' }`; the `emit` calls carry no values.
  6. `adapter.canContinue` → `{ ok:false }` → `{ kind:'waiting', reason:'validation_error' }`.
  7. a required `plan.documents[]` entry with `uploaded:false` whose id the adapter assigns to the current state → `{ kind:'failed', errorCode:'missing_document' }`, `BLOCKED_MISSING_DOCUMENT` emitted.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `runLoop`** — a `while (true)` over pages with explicit `return` at each stop condition. Recompute progress counters from `plan` + verified set after each page.
- [ ] **Step 4: Run — PASS.** Add an assertion in scenario 1's test body: grep the engine source at test time is Task 16's job — here just assert no emitted `type` is submit-like.
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(automation): the run loop — detect, fill, verify, navigate, stop at review <trailer>"`

**Verification:** `npx vitest run test/automation/automationEngine.test.ts`.
**Acceptance:** all 7 scenarios; loop terminates at `review_ready` with no submit action; every emitted message is value-free; mismatch values only via `recordMismatch`.
**Commit boundary:** one commit.

---

### Task 12: `AutomationService` + `AutomationRunner` + app decoration

**Files:**
- Create: `src/server/automation/automationService.ts`
- Modify: `src/server/app.ts` (decorate `app.automation`, dispose on close)
- Modify: `src/server/fastify.d.ts` (add `automation: AutomationService`)
- Test: `test/automation/automationService.test.ts`

**Interfaces:**
- Consumes: `automationRunStore` (3), `runLoop`/`EngineContext` (11), `CheckpointManager` (10), `BrowserManager` (4), `resolveAdapter` (5), `getApplication` (`applicationService`), `getActivePortal` (`portalService`), `inspectPage`, Task 1 types + `assertTransition`.
- Produces:
  ```ts
  export class AutomationService {
    constructor(deps?: { browserManager?: BrowserManager });
    async startRun(db: DatabaseSync, applicationId: string): Promise<AutomationRunRow>;
      // throws NotReadyError { blockers } | RunInProgressError { runId } | AnotherRunActiveError { runId } | ApplicationNotFoundError
    getRun(db: DatabaseSync, id: string): { run: AutomationRunRow; events: AutomationEventRow[] } | null;
    listEvents(db: DatabaseSync, id: string, afterSeq?: number): AutomationEventRow[];
    getLive(id: string): { mismatches: { fieldPath: string; expected: string; actual: string }[] } | null; // in-memory; null if run not loaded
    async resumeRun(db: DatabaseSync, id: string): Promise<AutomationRunRow>;
      // throws NotWaitingError | CheckpointStillPresentError
    async abortRun(db: DatabaseSync, id: string): Promise<AutomationRunRow>;
    async dispose(): Promise<void>; // abort active runner, close browser
  }
  ```
  Holds `activeRunner: AutomationRunner | null` (one process-wide). `AutomationRunner` owns a `page`+`context`, an in-memory `mismatches[]`, and a `run()` async method that: launches browser (`{ headless: env.AUTOMATION_HEADLESS }`), `goto(adapter.entryUrl(portalUrl))`, builds `EngineContext` (wiring `emit`→`appendEvent`, `onProgress`→`updateRun`, `recordMismatch`→in-memory), calls `runLoop`, then on the returned `EngineStop` persists the final status (`review_ready` / `waiting_for_user`+reason / `failed`+code) via `assertTransition`-checked `updateRun`. On `waiting` it `await checkpoints.awaitResume(runId)` then re-detects and calls `runLoop` again from the observed page (resume path).
  `startRun`: reads `getApplication`; `!plan.readyForAutomation.ready` → `NotReadyError`. `findActiveRun({applicationId})` → `RunInProgressError`. `findActiveRun()` (any app) → `AnotherRunActiveError`. `getActivePortal(db)` → snapshot `.url`; `resolveAdapter(url)` → `adapter_id`. `createRun` (status `pending`), spawn the runner (do not await its completion — it runs in the background; `startRun` returns the `pending`/`running` row), return.
  `resumeRun`: load run; status not in `waiting_for_user|paused` → `NotWaitingError`. If `waiting_reason ∈ otp|captcha|mfa|anti_bot`: `checkpoints.stillBlocked(page, ...)` → non-null → append `CHECKPOINT_STILL_PRESENT`, throw `CheckpointStillPresentError`. Else `assertTransition(status,'running')`, `updateRun` and `checkpoints.signalResume(id)`.

- [ ] **Step 1: Failing test** — use `openDatabase(tempDbPath())` + seed an applicant/application whose plan is ready (reuse `test/helpers/applicationFixtures` + `applicationService.createApplication` + `setApplicationFieldValue` to reach `ready`, mirroring `readinessScenarios.test.ts`; or insert `application_field_values` rows directly). Inject a **fake `BrowserManager`** returning a scriptable fake page and a **fake adapter via `resolveAdapter` monkeypatch** is hard — instead: `AutomationService` constructor takes `deps.browserManager` and `deps.resolveAdapter`. Add `deps.resolveAdapter?: (url: string) => PortalAdapter` to the constructor for test injection; production defaults to the real `resolveAdapter`.
  Cases: `startRun` on a not-ready application → `NotReadyError` with `blockers.length > 0`, no run row created; `startRun` twice → 2nd throws `RunInProgressError`; a happy fake adapter+page drives to `review_ready` (poll `getRun` until terminal); `resumeRun` on a non-waiting run → `NotWaitingError`; a run parked at an `otp` wait with a still-blocked fake page → `resumeRun` throws `CheckpointStillPresentError`; `dispose()` while a runner is active resolves without throwing.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `automationService.ts`** + the runner. Export the typed error classes.
- [ ] **Step 4: Decorate in `app.ts`** — `const automation = new AutomationService(); app.decorate('automation', automation); app.addHook('onClose', async () => { await automation.dispose().catch(() => undefined); });` after `registerApplicationRoutes`. Add the type to `fastify.d.ts`.
- [ ] **Step 5: Run test + `npx vitest run test/server test/automation` — PASS.**
- [ ] **Step 6: Gate + commit** — `git commit -m "feat(automation): AutomationService + background runner + app wiring <trailer>"`

**Verification:** `npx vitest run test/automation/automationService.test.ts`.
**Acceptance:** `!ready` refused with blockers and no row; concurrent run refused; happy path reaches `review_ready`; resume guards (`NotWaiting`, `CheckpointStillPresent`); `dispose` clean; one runner process-wide.
**Commit boundary:** one commit.

---

### Task 13: REST routes

**Files:**
- Create: `src/server/routes/automation.ts`
- Modify: `src/server/app.ts` (`await registerAutomationRoutes(app)` after application routes)
- Test: `test/automation/automationRoutes.test.ts`

**Interfaces:**
- Consumes: `AutomationService` via `app.automation`, `errors.ts` helpers, Zod.
- Produces: `export async function registerAutomationRoutes(app: FastifyInstance): Promise<void>` mounting the 7 endpoints of spec §14, each Zod-validating params, each mapping the service's typed errors via a local `mapAutomationError(e, reply)` (mirror `mapApplicationError`): `NotReadyError` → `409 errorBody('NOT_READY', msg)` + `{ blockers }` — note `errorBody` takes `(code, message)`; extend the response with blockers: `reply.code(409).send({ ...errorBody('NOT_READY', e.message), blockers: e.blockers })`. `RunInProgressError`/`AnotherRunActiveError` → `409`. `NotWaitingError` → `409`. `CheckpointStillPresentError` → `409 CHECKPOINT_STILL_PRESENT`. not-found → `404 notFoundError('automation run')`.

- [ ] **Step 1: Failing test** — `buildServer({ dbPath: tempDbPath() })`, seed a ready application (as Task 12). Cases: `POST /api/applications/:id/automation-runs` on a ready app → `201 { run }`; on a not-ready app → `409` body has `blockers`; `GET /api/automation-runs/:id` → `{ run, events }`; `GET .../events?after=0` → `{ events }`; `POST .../resume` on a non-waiting run → `409`; `POST .../abort` → `202`; unknown application id → `404`; unknown run id → `404`; **cross-app isolation:** create runs for app A and app B, `GET /api/applications/:B/automation-runs` does not include A's run; `GET /api/automation-runs/:runA` returns only the run row (no app-B data). Use a fake adapter/browser through the service — inject via a test-only `app.automation` swap: after `buildServer`, do `(app as any).automation = new AutomationService({ browserManager: fakeBM, resolveAdapter: () => fakeAdapter })` before the first request, OR expose a `buildServer` option `automation?: AutomationService`. Decision: add `automation?: AutomationService` to `BuildServerOptions` (test seam, like `ocr`).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Add the `automation?` build option** in `app.ts` (`const automation = opts.automation ?? new AutomationService();`).
- [ ] **Step 4: Implement `routes/automation.ts` + register it.**
- [ ] **Step 5: Run test + `npx vitest run test/automation test/server` — PASS.**
- [ ] **Step 6: Gate + commit** — `git commit -m "feat(automation): REST routes for runs, events, resume, abort, live <trailer>"`

**Verification:** `npx vitest run test/automation/automationRoutes.test.ts`.
**Acceptance:** all 7 endpoints; sanitized error envelopes incl. `NOT_READY` + blockers; 404s; cross-application isolation proven.
**Commit boundary:** one commit.

---

### Task 14: Fixture portal + fixture India adapter (test support)

**Files:**
- Create: `test/helpers/fixturePortal.ts`
- Create: `test/fixtures/india-portal/{personal,passport,address,family,occupation,visa-details,references,documents,challenge,review,final-review}.html`
- Create: `test/automation/support/fixtureIndiaAdapter.ts`
- Test: `test/automation/fixturePortal.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // fixturePortal.ts
  export interface FixturePortal { url: string; submitCount: number; requests: { method: string; url: string }[]; close(): Promise<void> }
  export async function startFixturePortal(): Promise<FixturePortal>;
  //  serves /personal, /passport, ... /final-review from the html files (read once at startup);
  //  /challenge honours ?challenge=captcha|ok (default = otp input);
  //  POST /__fixture/submit increments submitCount and returns 200 (must never be called by tests)
  // fixtureIndiaAdapter.ts
  export function makeFixtureIndiaAdapter(baseUrl: string): PortalAdapter;
  //  real PortalAdapter implementation whose selectors/states target the fixture pages;
  //  getFieldMap() maps the canonical appliesTo paths used by test applications to fixture selectors;
  //  isFinalReview('FINAL_REVIEW') === true ; nextSelector for FINAL_REVIEW is null ; submitSelector: null
  ```
  The 11 HTML pages: each a `<h1>`, labelled controls covering the `ControlKind` set at least once across the flow, and an `<a href="/next">Save & Continue</a>` (or a button doing `location='/next'`). `family.html` shows a spouse-name text input only when a "Married" radio is chosen (script). `documents.html` has checkboxes + one real `<input type="file">` (never driven). `challenge.html`: default renders `<label for="otp">Enter the OTP</label><input id="otp">`; `?challenge=captcha` renders `<div class="g-recaptcha"></div>`; `?challenge=ok` renders `<p>Verified</p>`. `final-review.html`: a read-only `<dl>` summary + `<form method="POST" action="/__fixture/submit"><button>Submit Application</button></form>`.

- [ ] **Step 1: Failing test** `test/automation/fixturePortal.test.ts` — `startFixturePortal()` → `GET url + '/personal'` returns HTML containing `<h1>`; `GET /challenge` contains an OTP input; `GET /challenge?challenge=captcha` contains `g-recaptcha`; `GET /challenge?challenge=ok` contains `Verified`; `POST /__fixture/submit` increments `submitCount`; `close()` resolves.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Write the 11 HTML files + `fixturePortal.ts`** (extend the `startFixtureServer` pattern to a route table using `node:http` + `node:fs` to read the files at startup; resolve paths via `new URL('../fixtures/india-portal/', import.meta.url)`).
- [ ] **Step 4: Write `fixtureIndiaAdapter.ts`** — implement every `PortalAdapter` member against the fixture. `getPageIdentity` uses `page.url()` suffix + a heading check to produce `{ state, confidence: 0.95, signals }`; an unrecognised path → `{ state: UNKNOWN_STATE, confidence: 0 }`.
- [ ] **Step 5: Run — PASS.**
- [ ] **Step 6: Gate + commit** — `git commit -m "test(automation): local fixture portal + fixture India adapter <trailer>"`

**Verification:** `npx vitest run test/automation/fixturePortal.test.ts`.
**Acceptance:** 11 pages serve; `challenge` variants; `/__fixture/submit` tracked; fixture adapter implements the full `PortalAdapter` incl. `submitSelector: null` and `isFinalReview`.
**Commit boundary:** one commit.

---

### Task 15: Integration suite (real engine + real browser + fixture portal)

**Files:**
- Create: `test/automation/integration.test.ts`

**Interfaces:**
- Consumes: `buildServer` (with the `automation` seam), `startFixturePortal` + `makeFixtureIndiaAdapter` (14), a ready test application (seeded).

- [ ] **Step 1: Write the 8 scenario tests** from spec §17 "Integration". Shape: `beforeEach` starts the fixture portal, builds an `AutomationService({ browserManager: new BrowserManager(), resolveAdapter: () => makeFixtureIndiaAdapter(portal.url) })`, builds the server with that service, seeds a ready application. Each test drives via HTTP (`POST …/automation-runs`, poll `GET …/:id` until non-`running`, `POST …/resume`, re-poll). Force `AUTOMATION_HEADLESS=true` via env in the vitest setup file. Assertions per scenario exactly as §17 lists, plus every scenario asserts `portal.submitCount === 0` at the end.
- [ ] **Step 2: Run — FAIL** (or partially, if earlier tasks already satisfy some).
- [ ] **Step 3: Fix any genuine engine bug surfaced** — at the source (engine/adapter/store), never by weakening a test. Document each in the task report.
- [ ] **Step 4: Run — PASS.** Also run the whole `npx vitest run test/automation`.
- [ ] **Step 5: Gate + commit** — `git commit -m "test(automation): fixture-portal integration — happy path, checkpoints, resume, blocks, crash/resume <trailer>"`

**Verification:** `npx vitest run test/automation/integration.test.ts`.
**Acceptance:** all 8 scenarios green; `submitCount === 0` everywhere; crash/resume rebuilds the service and continues from the observed page.
**Commit boundary:** one commit (plus a separate commit per source fix, if any).

---

### Task 16: Guard tests — no-auto-submit, no-evasion, architecture isolation

**Files:**
- Create: `test/automation/noAutoSubmit.test.ts`
- Create: `test/automation/architectureGuard.test.ts`

**Interfaces:** source-grep tests (mirror `test/shared/application/architectureGuard.test.ts` and `test/server/documentsNoNetwork.test.ts`).

- [ ] **Step 1: Write `noAutoSubmit.test.ts`** — walk `src/server/automation/**/*.ts` + `src/shared/automation/**/*.ts` (comment-stripped). Assert **zero** matches for: `/\.click\([^)]*submit/i`, `/\.click\([^)]*confirm/i`, `/\.click\([^)]*lodge/i`, `/\.click\([^)]*\bpay\b/i`, `/form\s*=>\s*form\.submit\(\)/`, `/\.evaluate\([^)]*\.submit\(\)/`, `/page\.on\(\s*['"]dialog['"]/`, `/requestSubmit\(/`. Assert `src/server/automation/adapters/baseAdapter.ts` contains `submitSelector: null` (the interface literal type). Assert `EVENT_TYPES` (import) has no submit-like entry.
- [ ] **Step 2: Write `architectureGuard.test.ts`** —
  - `src/shared/automation/**` comment-stripped: no `from 'node:`, no `from 'playwright'`, no `from 'fastify'`, no `from 'react'`, no `../server`.
  - `src/server/automation/engine/automationEngine.ts` comment-stripped: no import from `../adapters/india/` and no import of `indiaAdapter`/`genericAdapter` by value (only `baseAdapter` types).
  - no portal-URL literal (`/https?:\/\/[^'"\s]*visa[^'"\s]*/i`) and no `/['"](evisa|regular)\.[a-z0-9_.]+['"]/` anywhere under `src/server/automation/**` **except** files under `adapters/india/`.
  - no CAPTCHA/OTP-solver dependency reference: grep the same tree for `/2captcha|anti-?captcha|deathbycaptcha|capsolver|solveRecaptcha|speakeasy|otplib|otpauth|imap-simple|node-imap/i` → zero.
- [ ] **Step 3: Run — expect PASS** (the code was written to satisfy these). If any fails, fix the offending source, not the test.
- [ ] **Step 4: Gate + commit** — `git commit -m "test(automation): guard no-auto-submit, no-evasion, engine/adapter isolation <trailer>"`

**Verification:** `npx vitest run test/automation/noAutoSubmit.test.ts test/automation/architectureGuard.test.ts`.
**Acceptance:** all greps zero; `submitSelector: null` present; engine imports no concrete adapter; India literals only under `adapters/india/`.
**Commit boundary:** one commit.

---

### Task 17: Behavioural security suite — redaction, isolation, evidence

**Files:**
- Create: `test/automation/security.test.ts`

- [ ] **Step 1: Write the tests** from spec §17 "Security" (behavioural half):
  - **Full-run redaction:** run integration scenario 1 with `buildServer({ loggerInstance: <capture stream> })` (reuse the Phase 3/4 capturing-pino pattern). After `review_ready`: assert the captured log text contains none of the fixture field values (surname, passport number, dates used), no `otp` string, and no `expected`/`actual` key carrying a value. Assert every `automation_events.message` in the DB is a value in `EVENT_MESSAGES`.
  - **Evidence gitignore + path shape:** set `AUTOMATION_EVIDENCE='screenshots'`, run scenario 1, assert screenshot files exist under `AUTOMATION_DIR/<runId>/`, assert `automation_events.evidence_path` values are all relative (no leading `/` or drive letter), assert `AUTOMATION_DIR` resolves under `DATA_DIR` (which `.gitignore` covers).
  - **Cross-applicant isolation (behavioural):** two ready applications; a run for A; `GET /api/automation-runs/:runA` while the only other data is B's — assert the response exposes no field from application B; `getLive(runA)` from a fresh service instance (run not in memory) → `409 not_active`.
  - **`!ready` refusal:** flip a required field to absent → `POST …/automation-runs` → `409` + blockers, `SELECT count(*) FROM automation_runs` unchanged.
- [ ] **Step 2: Run — FAIL / iterate.** Fix real leaks at the source.
- [ ] **Step 3: Run — PASS.**
- [ ] **Step 4: Gate + commit** — `git commit -m "test(automation): full-run redaction, evidence path safety, isolation, not-ready refusal <trailer>"`

**Verification:** `npx vitest run test/automation/security.test.ts`.
**Acceptance:** no field value / OTP / expected-actual value in logs; event messages closed-vocabulary; evidence gitignored + relative paths; isolation holds; not-ready creates no row.
**Commit boundary:** one commit.

---

### Task 18: API client + wire the "Start automation" button

**Files:**
- Modify: `src/web/src/api/client.ts`
- Modify: `src/web/src/pages/Applications/ReadyForAutomationSection.tsx`
- Modify: `src/web/src/main.tsx` (add the `/automation-runs/:id` route — component created in Task 19; for this task, a lazy import / placeholder is fine but prefer wiring the real route in Task 19 and here only add the client + button)
- Test: `test/web/ReadyForAutomationSection.test.tsx` (extend)

**Interfaces:**
- Produces (`client.ts`, matching the existing dual-import convention):
  ```ts
  startAutomationRun(applicationId: string): Promise<{ run: AutomationRunRow }>;
  getAutomationRun(runId: string): Promise<{ run: AutomationRunRow; events: AutomationEventRow[] }>;
  getAutomationEvents(runId: string, afterSeq: number): Promise<{ events: AutomationEventRow[] }>;
  getAutomationLive(runId: string): Promise<{ mismatches: { fieldPath: string; expected: string; actual: string }[] }>;
  resumeAutomationRun(runId: string): Promise<{ run: AutomationRunRow }>;
  abortAutomationRun(runId: string): Promise<{ run: AutomationRunRow }>;
  ```
- `ReadyForAutomationSection.tsx`: when `readyForAutomation.ready`, the `Start automation` button becomes `type="button"` **enabled**, `onClick` → `startAutomationRun(applicationId)` → `navigate('/automation-runs/' + run.id)`; on `409` show the returned message inline. When `!ready`, unchanged (disabled + blockers). The verbatim helper text stays. Component gains an `applicationId` prop (thread it from `ApplicationDashboardPage`).

- [ ] **Step 1: Failing web test** — mock `api`; render `ReadyForAutomationSection` with `readyForAutomation.ready = true` + `applicationId='app1'`; assert the button is **not** disabled; click → `api.startAutomationRun` called with `'app1'`; with `ready=false` assert still disabled and `startAutomationRun` not called. Assert the SAFE-STOP helper text is still present verbatim.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Add the client methods; update the component + its prop; thread `applicationId` from `ApplicationDashboardPage.tsx`.**
- [ ] **Step 4: Run `npx vitest run test/web` — PASS.**
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(web): automation API client + wire the Start-automation button <trailer>"`

**Verification:** `npx vitest run test/web/ReadyForAutomationSection.test.tsx`.
**Acceptance:** button enabled only when ready; click starts a run and navigates; `!ready` unchanged; helper text intact; no submit affordance added.
**Commit boundary:** one commit.

---

### Task 19: `AutomationRunPage`

**Files:**
- Create: `src/web/src/pages/Automation/AutomationRunPage.tsx`
- Create: `src/web/src/pages/Automation/runChrome.tsx` (StatusBadge, ProgressBar, EventLog, ActionRequiredPanel, SafeStopBanner)
- Modify: `src/web/src/main.tsx` (route `/automation-runs/:id` → `AutomationRunPage`)
- Modify: `src/web/src/styles.css` (additive)
- Test: `test/web/AutomationRunPage.test.tsx`

**Interfaces:**
- Consumes: the Task 18 client methods; `AutomationRunRow` / `AutomationEventRow` / `EVENT_MESSAGES`.
- Produces: a page that on mount fetches `getAutomationRun(id)`, then polls `getAutomationEvents(id, lastSeq)` + `getAutomationRun(id)` every 1500 ms until `run.status` is terminal. Renders: header (applicant/application/portal/`adapter_id` — from the run row + a `getApplication` call for names), `<StatusBadge status waiting_reason>`, `<ProgressBar value={fields_verified} max={fields_total}>` + a documents line + `current_portal_state`, `<EventLog events>` (each row: `EVENT_MESSAGES[type]` + `field_path` + `portal_state` — never a value), and:
  - `waiting_for_user` → `<ActionRequiredPanel reason onResume onAbort mismatches>` — reason in plain words; a **Resume automation** button (`resumeAutomationRun` then resume polling; on `409 checkpoint_still_present` show "The challenge is still on the page"); for `value_mismatch` it calls `getAutomationLive` and lists `expected` vs `actual` per field.
  - `review_ready` → `<SafeStopBanner>`: *"Automation completed the preparation. Final submission requires your review and action in the browser."* — no submit button anywhere.
  - any non-terminal status → an `Abort` button.

- [ ] **Step 1: Failing test** — mock `api`. (a) `getAutomationRun` → a `running` run + 2 events → the two `EVENT_MESSAGES` strings render; no raw value appears. (b) run `waiting_for_user` reason `otp` → "Complete the OTP" text + a **Resume automation** button; click → `api.resumeAutomationRun('r1')`. (c) reason `value_mismatch` + `getAutomationLive` → `{ mismatches:[{fieldPath:'identity.surname',expected:'RANA',actual:'RAN'}] }` → both values shown in the panel (this is the allowed live surface). (d) `review_ready` → the SAFE STOP banner verbatim; assert there is **no** button whose name matches `/submit/i`. (e) polling stops once status is terminal (advance timers, assert `getAutomationRun` call count plateaus).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `runChrome.tsx` then `AutomationRunPage.tsx`; add the route + styles.**
- [ ] **Step 4: Run `npx vitest run test/web` — PASS.**
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(web): automation run dashboard — status, progress, event log, action-required, safe-stop <trailer>"`

**Verification:** `npx vitest run test/web/AutomationRunPage.test.tsx`.
**Acceptance:** value-free event log; ACTION REQUIRED panel with Resume; live mismatch list for `value_mismatch`; SAFE STOP banner verbatim; no submit control in the DOM; polling halts at terminal status.
**Commit boundary:** one commit.

---

### Task 20: India adapter scaffold + `portalDiscovery` + `docs/portals/india.md`

**Files:**
- Create: `src/server/automation/adapters/india/indiaPortalMap.ts`
- Create: `src/server/automation/adapters/india/indiaAdapter.ts`
- Modify: `src/server/automation/adapters/registry.ts` (push `indiaAdapter`)
- Create: `src/server/automation/discovery/portalDiscovery.ts`
- Create: `docs/portals/india.md`
- Test: `test/automation/indiaAdapter.test.ts`, `test/automation/portalDiscovery.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // indiaPortalMap.ts
  export const INDIA_PORTAL_STATES = ['REGISTRATION','OTP','PERSONAL_DETAILS','PASSPORT_DETAILS','ADDRESS',
    'FAMILY','OCCUPATION','VISA_DETAILS','REFERENCES','DOCUMENTS','REVIEW','FINAL_REVIEW'] as const;
  export type IndiaPortalState = (typeof INDIA_PORTAL_STATES)[number];
  export interface IndiaPortalMap {
    matchesUrl: RegExp;                 // from the configured portal host pattern, NOT a hard URL
    states: Record<IndiaPortalState, { headingPattern: RegExp; anchorField: string | null; sectionIds: string[]; nextSelector: string | null; isFinalReview: boolean }>;
    fields: PortalFieldMap;             // every selector === 'TODO:discover', selectorConfidence: 'fragile'
    uploadStates: IndiaPortalState[];   // ['DOCUMENTS']
    checkpointHints: CheckpointHints;
    submitSelector: null;
  }
  export const indiaPortalMap: IndiaPortalMap;
  // indiaAdapter.ts
  export const indiaAdapter: PortalAdapter;   // implemented over indiaPortalMap
  // portalDiscovery.ts
  export interface DiscoveryFieldCandidate { label: string; primarySelector: string; fallbackSelector: string | null; selectorConfidence: SelectorConfidence; control: ControlKind | 'unknown' }
  export interface DiscoveryReport { url: string; pageTitle: string | null; fingerprint: Record<string, string | boolean>; candidates: DiscoveryFieldCandidate[]; signals: PageInspection['securityChallengeFlags'] }
  export async function captureDiscovery(page: Page): Promise<DiscoveryReport>;
  //  READ-ONLY. Uses page.$$eval to enumerate inputs/selects/textareas + their labels, ranks selectors
  //  per visa-form-analysis.md §8.1. NO fill/click/goto/type. A doc-comment forbids adding any.
  ```
  `indiaPortalMap` header comment: *"Selectors are placeholders. Populate from a user-driven discovery session against the authenticated portal per docs/visa-form-analysis.md §1 and record findings in docs/portals/india.md. Never guess."*
  `docs/portals/india.md` — from the `visa-form-analysis.md` per-portal appendix template: sections for Portal fingerprint, Page/state sequence, Field table (empty, with the mandated columns), Security checkpoints, **ToS / robots.txt position** (with the note that assisted automation stops if ToS prohibits it), Discovery log.

- [ ] **Step 1: Failing test** `indiaAdapter.test.ts` — `indiaAdapter.submitSelector === null`; `indiaAdapter.isFinalReview('FINAL_REVIEW') === true` and `=== false` for others; `indiaAdapter.getFieldMap()` values all have `selector === 'TODO:discover'`; `resolveAdapter(<a url matching indiaPortalMap.matchesUrl>)` returns `indiaAdapter`; `indiaAdapter.getPageIdentity` on a fake page whose title/heading matches nothing → `{ state: 'UNKNOWN', confidence: 0 }`. `portalDiscovery.test.ts` — `captureDiscovery` on a `startFixtureServer` page with two labelled inputs returns 2 `candidates` with ranked selectors and the page fingerprint; the module source (read + comment-strip) contains no `.fill(`/`.click(`/`.type(`/`.goto(`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement all four modules + the doc + register the adapter.**
- [ ] **Step 4: Run `npx vitest run test/automation` — PASS** (incl. the Task 16 architecture guard now that `adapters/india/` exists — verify its allowlist covers the new dir).
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(automation): India adapter scaffold (placeholder selectors) + read-only discovery tool + portal doc <trailer>"`

**Verification:** `npx vitest run test/automation/indiaAdapter.test.ts test/automation/portalDiscovery.test.ts test/automation/architectureGuard.test.ts`.
**Acceptance:** India adapter typed & registered; every selector is the literal placeholder; `submitSelector: null`; `isFinalReview` correct; `captureDiscovery` is read-only (grep) and produces the appendix-shaped report; `docs/portals/india.md` created with the ToS/robots section.
**Commit boundary:** one commit.

---

### Task 21: Phase 5 report + ARCHITECTURE paragraph + fixture smoke

**Files:**
- Create: `docs/PHASE-5-REPORT.md`
- Modify: `docs/ARCHITECTURE.md` (§3 — add a Phase 5 paragraph after the Phase 4 one)
- Modify: `.gitignore` if the smoke reveals an untracked evidence path outside `data/`
- Test: none new (this task runs the full gate + a manual smoke)

- [ ] **Step 1: Full gate** — `npm run typecheck && npm run lint && npm test && npm run build`. Record exact counts.
- [ ] **Step 2: Fixture smoke via the real server** — a short `scripts`-style node script (in the scratchpad, not committed): `npm run build`; start the real server on a temp `DATA_DIR` with `AUTOMATION_HEADLESS=false` is not possible headless-in-CI — instead run it headed locally is a user step; for the report, run the **headless** path: build a server whose `automation` uses `makeFixtureIndiaAdapter` + a real `BrowserManager`, seed a ready application over HTTP, `POST` a run, poll to `review_ready`, capture the event trace + `submitCount === 0`. Paste the trace into the report.
- [ ] **Step 3: Write `docs/PHASE-5-REPORT.md`** — spec §32 contents: architecture; tasks completed (commit SHAs); files changed; DB changes (migration 5); API changes; UI changes; the portal adapter model; browser behaviour; human checkpoints; tests (unit/integration/security counts); fixture verification (the smoke trace); **real portal verification: NOT PERFORMED — engine is fixture-proven; India selectors are placeholders; discovery is user-driven (docs/portals/india.md)**; security findings; PII audit (what is and isn't stored/logged; the redaction test); known limitations; deferred work (§20 of the spec); and verbatim:
  ```
  Automatic final visa submission: NOT IMPLEMENTED
  OTP/CAPTCHA bypass: NOT IMPLEMENTED
  ```
  Plus the §18 acceptance checklist (15 items) with PASS/PARTIAL + evidence.
- [ ] **Step 4: `docs/ARCHITECTURE.md` §3** — one paragraph mirroring the Phase 1/3/4 voice: `src/shared/automation/` is the pure engine core (state machine, field mapping, event vocabulary — a purity test asserts it); `src/server/automation/` holds Playwright execution; portals are reached only through `PortalAdapter`; India selectors live only in `adapters/india/` and ship as placeholders (a guard test asserts both); migration 5 adds `automation_runs` + `automation_events`; the engine stops at `review_ready` and has no submit path (four enforcement mechanisms); OTP/CAPTCHA are human checkpoints. End "See `docs/PHASE-5-REPORT.md`."
- [ ] **Step 5: Commit** — `git commit -m "docs: Phase 5 report — India visa browser automation <trailer>"`

**Verification:** full gate green; the smoke trace shows `review_ready` + `submitCount === 0`.
**Acceptance:** report has every §32 section + the two verbatim NOT-IMPLEMENTED lines + the §18 checklist; ARCHITECTURE paragraph added; gate green.
**Commit boundary:** one commit.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §2 consume Phases 0–4 | 3, 12, 13, 18 (+ guard 16) |
| §3 architecture / layering | 1, 5, 11, 12; guard 16 |
| §4 PortalAdapter interface | 5 (+ india impl 20) |
| §5 run loop | 11 |
| §6 no-auto-submit (4 mechanisms) | 5 (`submitSelector: null`), 11 (structural), 14/15 (`submitCount===0`), 16 (grep), 20 (india config) |
| §7 field mapping | 2 |
| §8 verification | 7 |
| §9 migration 5 | 3 |
| §10 execution & resume | 12 |
| §11 event vocabulary | 1 |
| §12 scope boundaries (upload verify-and-pause; india placeholders; discovery read-only) | 11 (doc pause), 20 |
| §13 PII / security mapping | 4 (redaction, env), 16 (grep), 17 (behavioural) |
| §14 REST API | 13 |
| §15 web UI | 18, 19 |
| §16 fixture portal | 14 |
| §17 testing (unit/integration/security/e2e) | 1–10 (unit), 15 (integration), 16+17 (security), 15 (e2e evidence) |
| §18 acceptance criteria | 21 (report checklist); each item traced to a task above |
| §19 execution / task list | this plan (21 tasks) |
| §20 open follow-ups | 21 (recorded in the report) |

No gap. §18 acceptance items map: 1→21 gate; 2→3; 3→16+12; 4→16; 5→12; 6→8+11; 7→7+11; 8→9+10+16; 9→11; 10→5/11/14/16/20; 11→12; 12→4/16/17; 13→18/19; 14→20; 15→21.

**2. Placeholder scan** — the only literal "TODO" strings are the **intentional** `'TODO:discover'` selector placeholders in Task 20's `indiaPortalMap` (a spec requirement, §12/§18.14). Task 3's step-1 test sketch is refined in the same step ("Refine step 1: …") with the real v0-DB construction — the executable version is the `DatabaseSync(':memory:')` block. No "handle edge cases" / "add validation" hand-waves — each task lists its concrete error paths.

**3. Type consistency** — `PortalAdapter` (Task 5) is consumed by `pageDetector` (8), `automationEngine` (11), `automationService` (12), `fixtureIndiaAdapter` (14), `indiaAdapter` (20) — same member set. `MappedField` (1) produced by `mapFields` (2), consumed by `applyField` (7) and `runLoop` (11). `AutomationRunRow`/`AutomationEventRow` (1) produced by `automationRunStore` (3), consumed by `automationService` (12), routes (13), client (18), UI (19). `EngineContext.emit` takes `{ type: EventType }` (1) everywhere. `VerificationOutcome` (1) is the return of `verifyControl`/`applyField` (7) and a branch key in `runLoop` (11). `startAutomationRun`/`resumeAutomationRun`/… names identical in client (18) and UI (19). `review_ready` is the single terminal-success string in `states.ts` (1), the migration CHECK (3), the service (12), and the UI banner condition (19).

**4. Independent verifiability** — every task ends with a runnable `npx vitest run …` on files it created, plus the full gate before its commit. Tasks 1–10 are pure/unit and need no browser beyond a local fixture; 11 uses a fake page; 12–13 use fakes via injected deps; 14–17 use the real fixture portal + headless chromium; 18–19 are jsdom web tests; 20–21 are unit + docs.
