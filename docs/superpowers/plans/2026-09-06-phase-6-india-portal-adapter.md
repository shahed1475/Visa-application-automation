# Phase 6 — Real India Portal Adapter + Live Discovery + Controlled Autofill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the portal-agnostic Phase 5 automation engine to the configured Indian visa portal through the India adapter, with persisted read-only live discovery, a provenance-tracked canonical→portal mapping lifecycle (placeholder → discovered → validated), controlled autofill with pre-existing-value conflict handling, and adapter diagnostics — stopping at `review_ready`, never submitting.

**Architecture:** All new logic is server-side under `src/server/automation/` (discovery/, adapters/india/) plus one generic engine addition (`value_conflict`) in `src/shared/automation/` + `engine/`. The Phase 5 `runLoop`, `AutomationService`, the seven `/api/automation-runs` routes, and `AutomationRunPage` are reused. `indiaPortalMap.ts` stays the mapping source of truth; every selector ships as `'TODO:discover'` / `status: 'placeholder'` and can only become `discovered`/`validated` with recorded provenance. Live portal work (Track B) is an operator runbook gated on a runtime ToS acknowledgement; CI is fixture-only.

**Tech Stack:** TypeScript (strict, NodeNext), Node 24, `node:sqlite` `DatabaseSync`, Fastify 5, Playwright (chromium), React 18 + Vite 5, Vitest 3 (`pool: 'forks'`).

## Global Constraints

- **Stack (verbatim from the project mandate):** TypeScript, Node.js 24, Fastify 5, SQLite via **`node:sqlite` `DatabaseSync`** (better-sqlite3 blocked by WDAC), React 18 + Vite 5, Playwright. One `npm run dev`. NOT n8n, NOT Electron, NOT a CLI.
- **`indiaPortalMap.ts` is the mapping source of truth.** Mapping lifecycle: `placeholder → discovered → validated`. Only `validated` mappings may be used by a real controlled autofill run; a `discovered` selector requires a non-empty `discoverySessionRef`; a `validated` selector requires `discoverySessionRef` **and** a `validatedAt` stamped by `validateIndiaAdapter`. **Never guess a real portal selector** — the provenance guard test makes a non-placeholder selector without a `discoverySessionRef` a build failure.
- **Portal URL is single source of truth from Settings** (`getActivePortal`) — no portal URL literal in the automation engine; the only India host literal is `indiaPortalMap.matchesUrl`, under `adapters/india/` (excluded from `noHardcodedUrl.test.ts`).
- **The ToS gate is a runtime gate**, not just documentation: `DiscoveryController.start()` and `AutomationService.startRun()` refuse (`409 TOS_NOT_ACKNOWLEDGED`) when the resolved adapter is `india`, the portal host matches a real India host, and no `portal_policy_ack` row exists for that portal id. The fixture host never triggers it.
- **OTP / CAPTCHA / MFA / anti-bot are human checkpoints** — detected only, run pauses, user acts in the browser, user resumes. No solver, no OTP retrieval, no CAPTCHA service, no stealth / fingerprint-evasion / randomised anti-detection.
- **Unknown portal state → safe stop** (`UNKNOWN_PORTAL_STATE` → pause `unknown_page`, no field interaction).
- **Pre-existing different portal value → pause** `value_conflict` for a human decision (Use Application Value / Keep Portal Value / Edit Application). Never blind-overwrite.
- **PII never in persistent logs or the DB.** Discovery records structure only (no input `.value` ever read). The `{expected, actual}` conflict pair lives only in the in-memory `/live` surface. `url_pattern` masks id/token/reference segments.
- **Screenshots disabled by default** (`AUTOMATION_EVIDENCE` unset → `'off'`).
- **Phase 4 `ApplicationPlan` is the sole source of visa requirements.** Phase 6 adds no requirement model. Phase 5 is the sole source of the generic engine / state machine.
- **No automatic final submission. No payment automation. No appointment booking.** No `submitted` / `completed` / `payment_completed` / `appointment_booked` run status or event type. `PortalAdapter.submitSelector` stays `readonly null`. The loop returns at `isFinalReview` before any action. The `noAutoSubmit` grep stays green and non-vacuous; `fixturePortal.submitCount === 0` in every scenario.
- **Real-portal testing is progressive** (Tests A–G, one small step at a time, behind `INDIA_LIVE=1`, never in CI). **CI uses the fixture portal.**
- **Commit trailer on every commit:**
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018269aYRrjgcVnZb1brcXPW
  ```
- **Gate before every commit:** `npm run typecheck && npm run lint && npm test && npm run build` all green. Baseline entering Phase 6: **971 tests / 91 files** at `d61468b`.

---

## Consistency check vs. `phase-6-india-portal-adapter` @ `d61468b` (= Phase 5 HEAD)

Verified against the live repository before writing this plan:

| Spec assumption | Reality | Plan consequence |
|---|---|---|
| `PortalAdapter` interface members | `baseAdapter.ts` — `id`, `matches`, `entryUrl`, `getPageIdentity(page, inspection)`, `sectionIdsForState`, `documentIdsForState`, `getFieldMap`, `canContinue`, `clickNext`, `isFinalReview`, `checkpointHints?`, `readonly submitSelector: null` | India adapter already implements it; **interface unchanged** by Phase 6 |
| Pre-fill conflict hook point | `runLoop` field loop calls `ctx.applyField` which itself reads-then-(alreadySet-skips-or-writes); there is no pre-write hook | add `classifyPreFill(page, spec, expected) → 'empty'|'match'|'conflict'` to `fieldActions.ts` + inject as `EngineContext.classifyPreFill`; engine calls it **before** `applyField` |
| `EngineStop` shape | `{kind:'review_ready'} | {kind:'waiting'; reason} | {kind:'failed'; errorCode}` | extend the `waiting` variant with optional `conflictFieldPath?: string` |
| `EngineContext` deps | `inspect`, `detectPage`, `applyField`, `readControl`, `settle`, `initialVerifiedCount?` | add `classifyPreFill` and `conflictDecisions: ReadonlyMap<string,'use_application'|'keep_portal'>` |
| `automation_runs.waiting_reason` | migration 5: `TEXT CHECK (waiting_reason IN (...11 values...) OR NULL)` — `value_conflict` would violate it | migration 6 **rebuilds `automation_runs`** dropping the CHECK (aligns with `automation_events.type` already un-CHECK'd); `PRAGMA legacy_alter_table` recipe, the v5→v6 test is the arbiter |
| `resumeRun` signature | `resumeRun(db, id): Promise<AutomationRunRow>` | becomes `resumeRun(db, id, decision?: 'use_application'|'keep_portal')`; update `routes/automation.ts` + every test caller |
| `EVENT_MESSAGES` purity test | `events.test.ts` forbids `/\$\{|%s|\{\{|\bvalue\b:/i` in any message | the 3 new messages avoid `value:` (they may contain the word "value") |
| `LATEST_SCHEMA_VERSION` canaries | asserted `=== 5` in `test/server/applicantMigrations.test.ts`, `applicationMigrations.test.ts`, `test/automation/automationMigrations.test.ts` | Task 2 updates all three to `6` |
| No-submit / solver grep scope | `noAutoSubmit.test.ts` walks `src/server/automation/**` + `src/shared/automation/**` | new `discovery/**` modules are **already** covered by that grep for free; the read-only guard is a **separate** new test |
| `BrowserManager` | `launch(opts?)` returns `Browser`; `newPage()` fresh context | add `launchPersistentDiscovery({userDataDir}): Promise<BrowserContext>` (headed only; `chromium.launchPersistentContext`) |
| `app` wiring | `app.ts` decorates `app.automation`, disposes on close; `fastify.d.ts` augments `FastifyInstance` with `db`/`ocr`/`automation` | add `app.discovery` + dispose + `fastify.d.ts` `discovery: DiscoveryController` |
| Web routes | `main.tsx` `createBrowserRouter` list; pages under `src/web/src/pages/<Area>/` | add `discovery/:sessionId`; new `pages/Discovery/` |
| Fixture portal | `test/helpers/fixturePortal.ts` (`node:http`, 11 static pages, `?challenge=`), `test/automation/support/fixtureIndiaAdapter.ts` (`id: 'fixture-india'`, `#surname` etc.) | Task 12 extends both (prefill flags, WebForms page, extra sections, unknown page) |
| `captureDiscovery` | `discovery/portalDiscovery.ts` — read-only `page.evaluate` DOM walk → `DiscoveryReport {url,pageTitle,fingerprint,candidates,signals}`; DESIGN NOTE + `portalDiscovery.test.ts` source guard | `observe.ts` re-exports + extends it (`captureDiscoveryV2`); do not fork the read-only guarantee |
| `pageDetector` | forces `UNKNOWN` when `state===UNKNOWN` **or** `confidence < 0.6` | India adapter just returns an honest confidence; the 0.6 floor stays upstream |

No architecture conflict found. One open implementation risk: whether `PRAGMA legacy_alter_table` is honoured inside a `BEGIN` transaction by `node:sqlite` (Task 2 resolves it empirically).

---

## File Structure

**New (server):**
| File | Responsibility |
|---|---|
| `src/server/automation/discovery/discoverySessionStore.ts` | prepared-statement CRUD over migration 6 tables; sanitized rows only |
| `src/server/automation/discovery/observe.ts` | `captureDiscoveryV2(page)` (extends `captureDiscovery`) + `sanitizeDiscovery` |
| `src/server/automation/discovery/discoveryController.ts` | session lifecycle (`start`/`capture`/`end`/`abort`); owns the headed browser context; read-only |
| `src/server/automation/discovery/policyGate.ts` | `requireToSAck(db, portal, adapterId)` + `portal_policy_ack` read/write; used by discovery **and** `startRun` |
| `src/server/automation/adapters/india/indiaMappingRegistry.ts` | `getIndiaMappings()`, `getIndiaMappingStatus()`, `promoteCandidate(...)` (renders a paste-ready map edit) |
| `src/server/automation/adapters/india/validateAdapter.ts` | `validateIndiaAdapter(page) → AdapterValidationReport` (sanitized) |
| `src/server/automation/adapters/india/diagnostics.ts` | `getIndiaDiagnostics(db, portalId)` — map versions + discovery counts + unknown-page count + last validation |
| `src/server/routes/discovery.ts` | discovery + diagnostics + mappings REST + `mapDiscoveryError` |

**New (web):**
| File | Responsibility |
|---|---|
| `src/web/src/pages/Settings/IndiaPortalCard.tsx` | status badge + Test Connection / Start Discovery / View Mappings / Validate Adapter |
| `src/web/src/pages/Discovery/DiscoverySessionPage.tsx` | live session: capture, page list, per-page candidate table, promote, end |
| `src/web/src/pages/Discovery/discoveryChrome.tsx` | small presentational sub-components (candidate table, status badge, diagnostics panel) |

**Modified:**
| File | Change |
|---|---|
| `src/server/db/migrations.ts` | migration 6 (2 discovery tables + `automation_runs` CHECK drop); `LATEST_SCHEMA_VERSION → 6` |
| `src/shared/automation/types.ts` | `WaitingReason` += `'value_conflict'` |
| `src/shared/automation/events.ts` | `EVENT_TYPES` += `VALUE_CONFLICT`, `FIELD_CONFLICT_KEPT`, `FIELD_CONFLICT_OVERWRITTEN`; `EVENT_MESSAGES` entries |
| `src/server/automation/engine/fieldActions.ts` | `classifyPreFill(page, spec, expected)` |
| `src/server/automation/engine/automationEngine.ts` | pre-fill conflict branch; `EngineContext.classifyPreFill` + `conflictDecisions`; `EngineStop.waiting.conflictFieldPath?` |
| `src/server/automation/automationService.ts` | `resumeRun(db,id,decision?)`; runner `conflictDecisions` map + `pausedConflictFieldPath`; ToS gate call in `startRun`; conservative crash default |
| `src/server/automation/engine/browserManager.ts` | `launchPersistentDiscovery({userDataDir})` |
| `src/server/automation/adapters/india/indiaPortalMap.ts` | v2 structure (`IndiaFieldMapping`, `urlPattern`, `nextSelectorStatus`, `adapterVersion`, `mappingRevision`, `lastDiscoveryAt`) |
| `src/server/automation/adapters/india/indiaAdapter.ts` | identity = URL + heading + anchor scoring; `adapterVersion` export |
| `src/server/routes/automation.ts` | `/resume` optional `{decision}` body |
| `src/server/app.ts` + `src/server/fastify.d.ts` | `app.discovery` decorate + dispose + type |
| `src/web/src/main.tsx` | `discovery/:sessionId` route |
| `src/web/src/api/client.ts` | discovery + diagnostics + mappings + `resume(decision)` methods |
| `src/web/src/pages/Automation/AutomationRunPage.tsx` + `runChrome.tsx` | `value_conflict` panel (3 actions) |
| `test/helpers/fixturePortal.ts` + `test/fixtures/india-portal/*.html` | prefill flags, WebForms page, `additional-information`/`previous-visits`, `nowhere` unknown page |
| `test/automation/support/fixtureIndiaAdapter.ts` | v2: `urlPattern`s, extra states, `status: 'validated'` everywhere, prefill-aware |
| `test/automation/noAutoSubmit.test.ts` | assert the grep set covers `discovery/**` (non-vacuous) |
| `test/server/applicantMigrations.test.ts`, `test/server/applicationMigrations.test.ts`, `test/automation/automationMigrations.test.ts` | `LATEST_SCHEMA_VERSION === 6` |
| `docs/portals/india.md` | ToS verdict + progressive-test runbook |
| `docs/ARCHITECTURE.md` | §3 Phase 6 paragraph |
| `docs/PHASE-6-REPORT.md` | new |

---

## Task 1: ToS / robots.txt assessment + runtime policy gate

**Objective:** Record a ToS/robots verdict for the India portals in `docs/portals/india.md`, and add a **runtime** acknowledgement gate that discovery and automation both call, refusing a real India portal until the operator has acknowledged the portal's Terms.

**Files:**
- Modify: `docs/portals/india.md` (the "ToS / robots.txt position" section)
- Create: `src/server/automation/discovery/policyGate.ts`
- Create: `test/automation/policyGate.test.ts`
- Modify: `src/server/db/migrations.ts` — **defer**: the `portal_policy_ack` table is created in Task 2's migration 6 (one migration). For Task 1, `policyGate` reads/writes an `app_settings` row (`portal_policy_ack:<portalId>` = ISO timestamp) — `app_settings` already exists (migration 1). (Simpler, no schema change here; Task 2 does not need to touch it.)

**Interfaces:**
- Produces:
  ```ts
  // policyGate.ts
  export interface PortalPolicyStatus { portalId: string; acknowledgedAt: string | null }
  export function getPolicyAck(db: DatabaseSync, portalId: string): PortalPolicyStatus;
  export function recordPolicyAck(db: DatabaseSync, portalId: string): PortalPolicyStatus;
  /** Real India hosts that require an ack before any live connection. Mirrors indiaPortalMap.matchesUrl. */
  export function isRealIndiaHost(url: string): boolean;
  export class ToSNotAcknowledgedError extends Error { constructor(readonly portalId: string) }
  /** Throws ToSNotAcknowledgedError when adapterId==='india' && isRealIndiaHost(portalUrl) && no ack. No-op otherwise. */
  export function assertPolicyAck(db: DatabaseSync, portalId: string, adapterId: string, portalUrl: string): void;
  ```

- [ ] **Step 1: Research + record the verdict.** Use `WebFetch` on `https://indianvisaonline.gov.in/robots.txt` and `https://www.ivacbd.com/robots.txt`; review each portal's published Terms of Service / disclaimer pages for any prohibition on automated or assisted access. In `docs/portals/india.md` replace the "Not yet assessed" paragraph with a dated verdict block: `VERDICT: PERMITTED (with constraints) | PROHIBITED | UNCLEAR`, the robots.txt `Disallow` lines relevant to the application paths, a one-paragraph rationale, and the sentence *"If PROHIBITED, Track B is not executed; the tool remains a manual-entry aid for this portal."*

- [ ] **Step 2: Write the failing test** (`test/automation/policyGate.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';
import {
  assertPolicyAck, getPolicyAck, recordPolicyAck, isRealIndiaHost, ToSNotAcknowledgedError,
} from '../../src/server/automation/discovery/policyGate.js';

describe('policyGate', () => {
  let db: DatabaseSync; let p: string;
  beforeEach(() => { p = makeTempDbPath(); db = openDatabase(p); runMigrations(db); });
  afterEach(() => { db.close(); cleanupTempDb(p); });

  it('isRealIndiaHost matches the known hosts and not the fixture', () => {
    expect(isRealIndiaHost('https://indianvisaonline.gov.in/visa/')).toBe(true);
    expect(isRealIndiaHost('https://www.ivacbd.com/apply')).toBe(true);
    expect(isRealIndiaHost('http://127.0.0.1:5599/personal')).toBe(false);
  });

  it('assertPolicyAck throws for a real india host with no ack, then passes after recordPolicyAck', () => {
    expect(getPolicyAck(db, 'portal-1').acknowledgedAt).toBeNull();
    expect(() => assertPolicyAck(db, 'portal-1', 'india', 'https://indianvisaonline.gov.in/visa/'))
      .toThrow(ToSNotAcknowledgedError);
    recordPolicyAck(db, 'portal-1');
    expect(getPolicyAck(db, 'portal-1').acknowledgedAt).not.toBeNull();
    expect(() => assertPolicyAck(db, 'portal-1', 'india', 'https://indianvisaonline.gov.in/visa/'))
      .not.toThrow();
  });

  it('assertPolicyAck is a no-op for the generic adapter and for a non-india host', () => {
    expect(() => assertPolicyAck(db, 'p', 'generic', 'https://example.gov/x')).not.toThrow();
    expect(() => assertPolicyAck(db, 'p', 'india', 'http://127.0.0.1:9/personal')).not.toThrow();
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`policyGate.js` missing).
  Run: `npx vitest run test/automation/policyGate.test.ts`

- [ ] **Step 4: Implement `policyGate.ts`.** `isRealIndiaHost` parses `new URL(url).hostname` and tests `/(?:^|\.)(?:indianvisaonline\.gov\.in|ivacbd\.com)$/i` (same regex as `indiaPortalMap.matchesUrl`, duplicated deliberately — this module must not import the adapter). `getPolicyAck`/`recordPolicyAck` use `app_settings` (`key = 'portal_policy_ack:' + portalId`). `assertPolicyAck` short-circuits unless `adapterId === 'india' && isRealIndiaHost(portalUrl)`.

- [ ] **Step 5: Run tests — expect PASS.** Then full gate.

- [ ] **Step 6: Commit** — `git add docs/portals/india.md src/server/automation/discovery/policyGate.ts test/automation/policyGate.test.ts` → `chore(phase-6): india portal ToS verdict + runtime policy-ack gate`.

**Dependencies:** none.
**Verification:** `npx vitest run test/automation/policyGate.test.ts` green; `docs/portals/india.md` has a dated verdict.
**Acceptance:** spec §4, §13.5; the gate is a runtime function, not a doc; verdict recorded.
**Commit boundary:** one commit.

---

## Task 2: Migration 6 — discovery tables + `automation_runs` CHECK drop + `discoverySessionStore`

**Objective:** Add `portal_discovery_sessions` + `portal_discovery_pages` (structure-only), rebuild `automation_runs` to drop the `waiting_reason` CHECK, bump `LATEST_SCHEMA_VERSION` to 6, and add a prepared-statement store.

**Files:**
- Modify: `src/server/db/migrations.ts`
- Create: `src/server/automation/discovery/discoverySessionStore.ts`
- Create: `test/automation/discoveryMigrations.test.ts`, `test/automation/discoverySessionStore.test.ts`
- Modify: `test/server/applicantMigrations.test.ts`, `test/server/applicationMigrations.test.ts`, `test/automation/automationMigrations.test.ts` (`LATEST_SCHEMA_VERSION === 6`)

**Interfaces:**
- Produces:
  ```ts
  export interface DiscoverySessionRow {
    id: string; portal_id: string | null; adapter_id: string;
    status: 'active' | 'ended' | 'aborted';
    started_at: string; ended_at: string | null; page_count: number;
    last_validation_json: string | null; notes: string | null;
  }
  export interface DiscoveryPageRow {
    id: string; session_id: string; seq: number; created_at: string;
    state_guess: string | null; url_pattern: string | null; page_title: string | null;
    headings_json: string; fingerprint_json: string; candidates_json: string; signals_json: string;
  }
  export function createDiscoverySession(db, i: { id; portalId: string|null; adapterId: string; now: string }): DiscoverySessionRow;
  export function getDiscoverySession(db, id: string): DiscoverySessionRow | null;
  export function listDiscoverySessions(db, opts: { portalId?: string; adapterId?: string }): DiscoverySessionRow[];
  export function findActiveDiscoverySession(db, adapterId: string): DiscoverySessionRow | null;
  export function appendDiscoveryPage(db, i: { id; sessionId; now; stateGuess; urlPattern; pageTitle; headingsJson; fingerprintJson; candidatesJson; signalsJson }): DiscoveryPageRow;
  export function listDiscoveryPages(db, sessionId: string): DiscoveryPageRow[];
  export function updateDiscoverySession(db, id: string, patch: Partial<Pick<DiscoverySessionRow,'status'|'ended_at'|'page_count'|'last_validation_json'|'notes'>>, now: string): DiscoverySessionRow;
  ```

- [ ] **Step 1: Write the failing migration test** (`test/automation/discoveryMigrations.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations, LATEST_SCHEMA_VERSION } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

const T = 't0';

describe('migration 6', () => {
  let db: DatabaseSync; let p: string;
  beforeEach(() => { p = makeTempDbPath(); db = openDatabase(p); });
  afterEach(() => { db.close(); cleanupTempDb(p); });

  it('LATEST_SCHEMA_VERSION is 6', () => { expect(LATEST_SCHEMA_VERSION).toBe(6); });

  it('fresh DB reaches v6 with both discovery tables + indexes', () => {
    runMigrations(db);
    expect((db.prepare('PRAGMA user_version').get() as any).user_version).toBe(6);
    for (const t of ['portal_discovery_sessions', 'portal_discovery_pages']) {
      expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t)).toBeTruthy();
    }
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_discovery_sessions_one_active'`).get()).toBeTruthy();
  });

  it('a genuine v5 -> v6 upgrade preserves automation_runs / automation_events and the cascade still fires', () => {
    runMigrations(db, 5);
    db.prepare(`INSERT INTO applicants (id, display_name, status, created_at, updated_at) VALUES ('a1','A','draft',?,?)`).run(T, T);
    db.prepare(`INSERT INTO applicant_identity (applicant_id) VALUES ('a1')`).run();
    db.prepare(`INSERT INTO visa_applications (id, applicant_id, destination, application_mode, category_id, status, kb_version, created_at, updated_at)
                VALUES ('app1','a1','IND','regular','regular.tourist','draft','2026-09-06',?,?)`).run(T, T);
    db.prepare(`INSERT INTO automation_runs (id, application_id, portal_url_snapshot, adapter_id, status, started_at, updated_at)
                VALUES ('r1','app1','http://x','india','waiting_for_user',?,?)`).run(T, T);
    db.prepare(`INSERT INTO automation_events (id, run_id, seq, created_at, type, message) VALUES ('e1','r1',1,?,'RUN_STARTED','x')`).run(T);

    runMigrations(db); // -> v6

    expect((db.prepare('PRAGMA user_version').get() as any).user_version).toBe(6);
    expect((db.prepare(`SELECT count(*) c FROM automation_runs`).get() as any).c).toBe(1);
    // the CHECK is gone: value_conflict is now storable
    db.prepare(`UPDATE automation_runs SET waiting_reason='value_conflict' WHERE id='r1'`).run();
    expect((db.prepare(`SELECT waiting_reason w FROM automation_runs WHERE id='r1'`).get() as any).w).toBe('value_conflict');
    // cascade intact
    db.prepare(`DELETE FROM visa_applications WHERE id='app1'`).run();
    expect((db.prepare(`SELECT count(*) c FROM automation_runs`).get() as any).c).toBe(0);
    expect((db.prepare(`SELECT count(*) c FROM automation_events`).get() as any).c).toBe(0);
  });

  it('discovery tables reject a bad status and cascade session -> pages on delete', () => {
    runMigrations(db);
    db.prepare(`INSERT INTO portal_discovery_sessions (id, adapter_id, status, started_at, page_count) VALUES ('s1','india','active',?,0)`).run(T);
    expect(() => db.prepare(`INSERT INTO portal_discovery_sessions (id, adapter_id, status, started_at, page_count) VALUES ('s2','india','bogus',?,0)`).run(T)).toThrow();
    db.prepare(`INSERT INTO portal_discovery_pages (id, session_id, seq, created_at, headings_json, fingerprint_json, candidates_json, signals_json)
                VALUES ('pg1','s1',1,?, '[]','{}','[]','{}')`).run(T);
    db.prepare(`DELETE FROM portal_discovery_sessions WHERE id='s1'`).run();
    expect((db.prepare(`SELECT count(*) c FROM portal_discovery_pages`).get() as any).c).toBe(0);
  });

  it('the partial unique index forbids a second active session for one adapter', () => {
    runMigrations(db);
    db.prepare(`INSERT INTO portal_discovery_sessions (id, adapter_id, status, started_at, page_count) VALUES ('s1','india','active',?,0)`).run(T);
    expect(() => db.prepare(`INSERT INTO portal_discovery_sessions (id, adapter_id, status, started_at, page_count) VALUES ('s2','india','active',?,0)`).run(T)).toThrow();
    db.prepare(`UPDATE portal_discovery_sessions SET status='ended' WHERE id='s1'`).run();
    expect(() => db.prepare(`INSERT INTO portal_discovery_sessions (id, adapter_id, status, started_at, page_count) VALUES ('s3','india','active',?,0)`).run(T)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`LATEST_SCHEMA_VERSION` is 5).
  Run: `npx vitest run test/automation/discoveryMigrations.test.ts`

- [ ] **Step 3: Add migration 6** to the `migrations` array in `migrations.ts`:

```ts
{
  version: 6,
  up: `
    CREATE TABLE portal_discovery_sessions (
      id                   TEXT PRIMARY KEY,
      portal_id            TEXT REFERENCES visa_portals(id) ON DELETE SET NULL,
      adapter_id           TEXT NOT NULL,
      status               TEXT NOT NULL CHECK (status IN ('active','ended','aborted')),
      started_at           TEXT NOT NULL,
      ended_at             TEXT,
      page_count           INTEGER NOT NULL DEFAULT 0,
      last_validation_json TEXT,
      notes                TEXT
    );
    CREATE UNIQUE INDEX idx_discovery_sessions_one_active
      ON portal_discovery_sessions(adapter_id) WHERE status = 'active';

    CREATE TABLE portal_discovery_pages (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL REFERENCES portal_discovery_sessions(id) ON DELETE CASCADE,
      seq              INTEGER NOT NULL,
      created_at       TEXT NOT NULL,
      state_guess      TEXT,
      url_pattern      TEXT,
      page_title       TEXT,
      headings_json    TEXT NOT NULL,
      fingerprint_json TEXT NOT NULL,
      candidates_json  TEXT NOT NULL,
      signals_json     TEXT NOT NULL,
      UNIQUE (session_id, seq)
    );
    CREATE INDEX idx_discovery_pages_session ON portal_discovery_pages(session_id);

    PRAGMA legacy_alter_table = ON;
    ALTER TABLE automation_runs RENAME TO _automation_runs_v5;
    CREATE TABLE automation_runs (
      id                    TEXT PRIMARY KEY,
      application_id        TEXT NOT NULL REFERENCES visa_applications(id) ON DELETE CASCADE,
      portal_id             TEXT REFERENCES visa_portals(id) ON DELETE SET NULL,
      portal_url_snapshot   TEXT NOT NULL,
      adapter_id            TEXT NOT NULL,
      status                TEXT NOT NULL CHECK (status IN ('pending','running','waiting_for_user','paused','review_ready','failed','aborted')),
      waiting_reason        TEXT,
      current_portal_state  TEXT,
      current_section_id    TEXT,
      fields_total          INTEGER NOT NULL DEFAULT 0,
      fields_verified       INTEGER NOT NULL DEFAULT 0,
      documents_total       INTEGER NOT NULL DEFAULT 0,
      documents_ready       INTEGER NOT NULL DEFAULT 0,
      error_code            TEXT,
      error_message         TEXT,
      started_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      ended_at              TEXT
    );
    INSERT INTO automation_runs SELECT * FROM _automation_runs_v5;
    DROP TABLE _automation_runs_v5;
    PRAGMA legacy_alter_table = OFF;
    CREATE INDEX idx_automation_runs_application ON automation_runs(application_id);
  `,
},
```

- [ ] **Step 4: Run the migration test.** If the v5→v6 upgrade test fails on `PRAGMA legacy_alter_table` inside the transaction (`node:sqlite` may ignore or reject it mid-BEGIN): fall back to running the two pragmas **outside** the wrapped statement — in `runMigrations`, special-case nothing; instead change the `up` to not need RENAME by using create-copy-drop with `PRAGMA foreign_keys=OFF` is **also** transaction-restricted, so the working fallback is: `runMigrations` executes `migration.up` split on a sentinel so the leading `PRAGMA legacy_alter_table=ON;` runs before `BEGIN`. Prefer the in-`up` version; only adopt a `runMigrations` tweak if the test proves it necessary, and keep that tweak to ≤ 5 lines with its own comment. **The v5→v6 test is the arbiter.**

- [ ] **Step 5: Write `discoverySessionStore.ts`** — 7 functions above, prepared statements, mirroring `automationRunStore.ts` (allow-listed `SET` builder for `updateDiscoverySession`, `page_count` bumped inside `appendDiscoveryPage` via `COALESCE(MAX(seq),0)+1` for `seq` and `UPDATE ... SET page_count = page_count + 1`).

- [ ] **Step 6: Write `discoverySessionStore.test.ts`** — create/get/list/findActive/appendPage(×2, seq monotonic)/listPages/update(status→ended, ended_at); a second `createDiscoverySession` while one is active throws (the partial index).

- [ ] **Step 7: Bump the three canaries** to `=== 6`.

- [ ] **Step 8: Run tests — expect PASS.** Full gate.

- [ ] **Step 9: Commit** — `feat(phase-6): migration 6 — discovery tables + drop automation_runs waiting_reason CHECK + discoverySessionStore`.

**Dependencies:** Task 1 (uses `app_settings`, unaffected).
**Verification:** `npx vitest run test/automation/discoveryMigrations.test.ts test/automation/discoverySessionStore.test.ts test/server/applicantMigrations.test.ts test/server/applicationMigrations.test.ts test/automation/automationMigrations.test.ts` green; full gate.
**Acceptance:** spec §5.1, §13.2.
**Commit boundary:** one commit.

---

## Task 3: `BrowserManager.launchPersistentDiscovery` (headed persistent context)

**Objective:** Add a headed, persistent-user-data-dir Chromium context for discovery so a login survives across sessions, without disturbing the Phase 5 `launch`/`newPage` path.

**Files:**
- Modify: `src/server/automation/engine/browserManager.ts`
- Modify: `src/server/env.ts` (derive `DISCOVERY_PROFILE_DIR = ${DATA_DIR}/discovery/profile`)
- Create: `test/automation/browserManagerDiscovery.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // browserManager.ts
  /** Headed, persistent context. NEVER headless — you cannot drive discovery headlessly.
   *  Returns the context directly (chromium.launchPersistentContext has no Browser handle). */
  async launchPersistentDiscovery(opts: { userDataDir: string }): Promise<BrowserContext>;
  async closeDiscovery(): Promise<void>; // closes the persistent context if open
  ```
- Consumes: `env.DISCOVERY_PROFILE_DIR` (Task-local; string).

- [ ] **Step 1: Write the failing test.** Use a real chromium (the suite already launches chromium in integration tests). Assert: `launchPersistentDiscovery({ userDataDir: <tmp> })` returns a context whose `browser()` is connected; `context.pages().length >= 1`; calling it twice returns the **same** context (idempotent while open); `closeDiscovery()` closes it; **headless is false** — assert via `context.browser()?.browserType().name() === 'chromium'` and that the launch options passed `headless: false` (spy on `chromium.launchPersistentContext` with `vi.spyOn`).

```ts
import { afterEach, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';

it('launchPersistentDiscovery opens ONE headed persistent context and closeDiscovery closes it', async () => {
  const spy = vi.spyOn(chromium, 'launchPersistentContext');
  const dir = mkdtempSync(path.join(tmpdir(), 'disco-'));
  const bm = new BrowserManager();
  try {
    const ctx = await bm.launchPersistentDiscovery({ userDataDir: dir });
    expect(ctx.pages().length).toBeGreaterThanOrEqual(1);
    expect(spy.mock.calls[0]![1]).toMatchObject({ headless: false });
    const again = await bm.launchPersistentDiscovery({ userDataDir: dir });
    expect(again).toBe(ctx);
    await bm.closeDiscovery();
  } finally {
    await bm.closeDiscovery().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    spy.mockRestore();
  }
}, 30_000);
```

- [ ] **Step 2: Run — expect FAIL** (method missing).
- [ ] **Step 3: Implement.** Hold a `private discoveryContext: BrowserContext | null`. `launchPersistentDiscovery` → if open & connected return it; else `chromium.launchPersistentContext(opts.userDataDir, { headless: false, viewport: null })`. `closeDiscovery` → `context.close()` + null. Do not touch `launch`/`newPage`/`close`.
- [ ] **Step 4: `env.ts`** — add `DISCOVERY_PROFILE_DIR` to the derived paths block next to `AUTOMATION_DIR` (`path.join(DATA_DIR, 'discovery', 'profile')`). No new env var. Confirm `.gitignore` `data/` covers it.
- [ ] **Step 5: Run tests — expect PASS.** Full gate.
- [ ] **Step 6: Commit** — `feat(phase-6): BrowserManager headed persistent discovery context`.

**Dependencies:** none.
**Verification:** `npx vitest run test/automation/browserManagerDiscovery.test.ts` green.
**Acceptance:** spec §5.2 (headed, persistent); Global Constraint (never headless for discovery).
**Commit boundary:** one commit.

---

## Task 4: `captureDiscoveryV2` + `sanitizeDiscovery`

**Objective:** Extend the read-only observer with headings, radio/checkbox groups, buttons (never clicked), nav-control candidates, required indicators, `<select>` option catalogues, and a hardened PII sanitizer that runs on every string before persistence.

**Files:**
- Create: `src/server/automation/discovery/observe.ts`
- Create: `test/automation/discoveryObserve.test.ts`, `test/automation/discoverySanitizer.test.ts`
- Create: `test/fixtures/discovery/prefilled-personal.html` (a static page with fake PII in values + labelled controls + a radio group + a Next button + a `<select>`)

**Interfaces:**
- Consumes: `captureDiscovery`, `DiscoveryReport`, `DiscoveryFieldCandidate` from `discovery/portalDiscovery.ts`; `inspectPage`.
- Produces:
  ```ts
  export const DISCOVERY_VERSION = '2026-09-06.1';
  export interface DiscoveryGroup { name: string; kind: 'radio' | 'checkbox'; options: string[] }
  export interface DiscoveryButton { text: string; type: string | null; isNavCandidate: boolean }
  export interface DiscoveryReportV2 extends DiscoveryReport {
    discoveryVersion: string;
    headings: string[];
    groups: DiscoveryGroup[];
    buttons: DiscoveryButton[];
    requiredIndicators: string[];
    selectCatalogue: { selector: string; optionLabels: string[] }[];
    stableAttributes: Record<string, number>;
  }
  export async function captureDiscoveryV2(page: Page): Promise<DiscoveryReportV2>;
  /** Value-shape scrubber applied to every persisted string. Idempotent. */
  export function sanitizeString(s: string): string;
  export function sanitizeUrlToPattern(url: string): string;
  export function sanitizeReport(r: DiscoveryReportV2): DiscoveryReportV2;
  ```

- [ ] **Step 1: Write `discoverySanitizer.test.ts`** first (pure, fast):

```ts
import { expect, it, describe } from 'vitest';
import { sanitizeString, sanitizeUrlToPattern } from '../../src/server/automation/discovery/observe.js';

describe('sanitizeString', () => {
  it('drops value shapes but keeps field labels', () => {
    expect(sanitizeString('Surname')).toBe('Surname');
    expect(sanitizeString('Passport Number')).toBe('Passport Number');
    expect(sanitizeString('Z1234567')).toBe('');          // passport-like
    expect(sanitizeString('1990-04-12')).toBe('');        // ISO date
    expect(sanitizeString('12/04/1990')).toBe('');        // dd/mm/yyyy
    expect(sanitizeString('john.doe@example.com')).toBe('');
    expect(sanitizeString('998877665544')).toBe('');      // long digit run
    expect(sanitizeString('Enter your 6 digit OTP')).toBe('Enter your 6 digit OTP'); // digits < 4 run
  });
  it('is idempotent', () => {
    expect(sanitizeString(sanitizeString('Z1234567'))).toBe('');
  });
});

describe('sanitizeUrlToPattern', () => {
  it('masks ids, tokens and query values', () => {
    expect(sanitizeUrlToPattern('https://x.gov.in/apply/step/personal?appId=AB1234567&tok=deadbeefcafe'))
      .toBe('x.gov.in/apply/step/personal?appId=*&tok=*');
    expect(sanitizeUrlToPattern('https://x.gov.in/app/9f8e7d6c5b4a3210/edit'))
      .toBe('x.gov.in/app/*/edit');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `sanitizeString`/`sanitizeUrlToPattern`.** `sanitizeString`: return `''` when the trimmed string matches any of — `/\d{4,}/`, `/\b\d{4}-\d{2}-\d{2}\b/`, `/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/`, `/[^\s@]+@[^\s@]+\.[^\s@]+/`, `/\b[A-Z]{1,2}\d{6,8}\b/`, or (length ≥ 40 and `< 40%` letters). Else return the trimmed input. `sanitizeUrlToPattern`: `new URL(url)` → `host + pathname` with `/[0-9a-f]{8,}/gi` and `/\d{5,}/g` path segments → `*`, and every query **value** → `*` (keys kept).
- [ ] **Step 4: Write `discoveryObserve.test.ts`** — serve `test/fixtures/discovery/prefilled-personal.html` via a tiny `node:http` server (reuse the pattern in `fixturePortal.ts`), `page.goto` it, `captureDiscoveryV2(page)`:
  - `report.headings` contains `'Personal Details'`;
  - `report.groups` has `{ name: 'sex', kind: 'radio', options: ['Male','Female'] }`;
  - `report.buttons` has `{ text: 'Save & Continue', isNavCandidate: true }` and the report has **no** click side effect (assert the page URL is unchanged and a hidden `#clicked` marker on the fixture stays `"no"`);
  - `report.selectCatalogue` has the nationality `<select>` option labels;
  - `report.candidates` includes a `Passport Number` labelled `text` control;
  - **`JSON.stringify(sanitizeReport(report))` contains none of** `'Z1234567'`, `'1990-04-12'`, `'john.doe@example.com'` (the fixture's prefilled values), asserted explicitly.
- [ ] **Step 5: Implement `captureDiscoveryV2`.** Call `captureDiscovery(page)` for the base; add a second read-only `page.evaluate` for headings/groups/buttons/requiredIndicators/selectCatalogue/stableAttributes; **never** read `input.value`; run `sanitizeReport` on the result before returning. Add the DESIGN NOTE comment block (copy `portalDiscovery.ts`'s).
- [ ] **Step 6: Run tests — expect PASS.** Full gate.
- [ ] **Step 7: Commit** — `feat(phase-6): captureDiscoveryV2 + PII sanitizer (read-only)`.

**Dependencies:** none (pure + fixture).
**Verification:** `npx vitest run test/automation/discoveryObserve.test.ts test/automation/discoverySanitizer.test.ts` green.
**Acceptance:** spec §5.3, §13.8, §13.9.
**Commit boundary:** one commit.

---

## Task 5: `DiscoveryController` + read-only source guard

**Objective:** Session lifecycle (`start` / `capture` / `end` / `abort`) that owns the headed context, opens the configured portal **once**, persists sanitized page rows, and is provably read-only.

**Files:**
- Create: `src/server/automation/discovery/discoveryController.ts`
- Create: `test/automation/discoveryController.test.ts`, `test/automation/discoveryReadOnly.test.ts`

**Interfaces:**
- Consumes: `discoverySessionStore` (Task 2), `BrowserManager.launchPersistentDiscovery`/`closeDiscovery` (Task 3), `captureDiscoveryV2`/`sanitizeReport` (Task 4), `policyGate.assertPolicyAck` (Task 1), `getActivePortal`/`getPortal` (`portalService`), `resolveAdapter` (`adapters/registry`), `env.DISCOVERY_PROFILE_DIR`.
- Produces:
  ```ts
  export class DiscoverySessionActiveError extends Error {}
  export class DiscoverySessionNotActiveError extends Error {}
  export class DiscoverySessionNotFoundError extends Error {}
  export interface DiscoveryControllerDeps { browserManager?: BrowserManager; resolveAdapter?: (url: string) => PortalAdapter; profileDir?: string }
  export class DiscoveryController {
    constructor(deps?: DiscoveryControllerDeps);
    start(db: DatabaseSync, portalId: string): Promise<DiscoverySessionRow>;          // opens the portal URL ONCE
    capture(db: DatabaseSync, sessionId: string): Promise<DiscoveryPageRow>;
    end(db: DatabaseSync, sessionId: string): Promise<DiscoverySessionRow>;
    abort(db: DatabaseSync, sessionId: string): Promise<DiscoverySessionRow>;
    get activePage(): Page | null;                                                    // for validateAdapter (Task 9)
    dispose(): Promise<void>;
  }
  ```

- [ ] **Step 1: Write `discoveryReadOnly.test.ts`** (source grep — the safety guard):

```ts
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const FILES = [
  'src/server/automation/discovery/discoveryController.ts',
  'src/server/automation/discovery/observe.ts',
];
const strip = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
// page-mutating APIs a read-only discovery module must never call
const FORBIDDEN = [
  /\.fill\s*\(/, /\.click\s*\(/, /\.type\s*\(/, /\.press\s*\(/, /\.check\s*\(/, /\.uncheck\s*\(/,
  /\.selectOption\s*\(/, /\.setInputFiles\s*\(/, /\.hover\s*\(/, /\.dragTo\s*\(/,
  /form\s*=>\s*form\.submit\(\)/, /\.tap\s*\(/, /keyboard\./, /mouse\./,
];

it('the discovery modules contain no page-mutating call', () => {
  for (const f of FILES) {
    const src = strip(readFileSync(f, 'utf8'));
    for (const re of FORBIDDEN) expect(src, `${f} matches ${re}`).not.toMatch(re);
  }
});

it('discoveryController has at most ONE page.goto and it targets only the resolved portal URL', () => {
  const src = strip(readFileSync(FILES[0]!, 'utf8'));
  const gotos = src.match(/\.goto\s*\(/g) ?? [];
  expect(gotos.length).toBeLessThanOrEqual(1);
  if (gotos.length === 1) expect(src).toMatch(/\.goto\(\s*portal(Url)?\b/); // the URL argument, not a literal
});

it('the guard is non-vacuous', () => {
  const strip1 = strip("await page.fill('#x','y')");
  expect(/\.fill\s*\(/.test(strip1)).toBe(true);
});
```

- [ ] **Step 2: Write `discoveryController.test.ts`** — a `node:http` fixture serving 2 pages; a fake `BrowserManager` whose `launchPersistentDiscovery` returns a real chromium persistent context (tmp dir) — OR use the real `BrowserManager` with a tmp `profileDir`. Assertions:
  - `start` creates an `active` row, calls `assertPolicyAck` (spy), and `page.goto`s the portal URL exactly once (spy on the context's page);
  - a second `start` for the same adapter → `DiscoverySessionActiveError`;
  - after manually `page.goto`-ing the controller's `activePage` to page 2 (the **test** navigates, simulating the user), `capture` persists a `portal_discovery_pages` row whose `candidates_json` is non-empty and whose JSON contains none of a seeded PII value;
  - `end` sets `status='ended'`, `ended_at`, closes the context;
  - `abort` from `active` → `status='aborted'`.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement `DiscoveryController`.** `start`: `getPortal(db, portalId)` → `resolveAdapter(portal.url)` → `assertPolicyAck(db, portalId, adapter.id, portal.url)` → `findActiveDiscoverySession(db, adapter.id)` throw-if-present → `createDiscoverySession` → `bm.launchPersistentDiscovery({ userDataDir: this.profileDir })` → `const page = ctx.pages()[0] ?? await ctx.newPage()` → `await page.goto(portal.url)` (the one goto) → keep `this.page = page`. `capture`: session must be `active` → `captureDiscoveryV2(this.page)` → derive `stateGuess` via `resolveAdapter(portal.url).getPageIdentity(page, await inspectPage(page))` (best-effort; `'UNKNOWN'` on throw) → `appendDiscoveryPage(...)` with `sanitizeUrlToPattern(page.url())`. `end`/`abort`: `updateDiscoverySession` + `bm.closeDiscovery()`. `dispose`: close context, no DB writes.
- [ ] **Step 5: Run tests — expect PASS.** Full gate.
- [ ] **Step 6: Commit** — `feat(phase-6): DiscoveryController (read-only session lifecycle)`.

**Dependencies:** Tasks 1, 2, 3, 4.
**Verification:** `npx vitest run test/automation/discoveryController.test.ts test/automation/discoveryReadOnly.test.ts` green.
**Acceptance:** spec §5.2, §13.6, §13.7.
**Commit boundary:** one commit.

---

## Task 6: Discovery REST routes + app wiring

**Objective:** Expose discovery sessions over HTTP with sanitized envelopes; wire `app.discovery` into `app.ts`.

**Files:**
- Create: `src/server/routes/discovery.ts`
- Modify: `src/server/app.ts`, `src/server/fastify.d.ts`
- Create: `test/automation/discoveryRoutes.test.ts`

**Interfaces:**
- Consumes: `DiscoveryController` (Task 5), `discoverySessionStore` (Task 2).
- Produces (routes):
  | Method | Path | Result |
  |---|---|---|
  | POST | `/api/portals/:id/discovery-sessions` | `201 {session}` · `409 SESSION_ACTIVE`/`NO_ACTIVE_PORTAL`/`TOS_NOT_ACKNOWLEDGED` · `404` |
  | GET | `/api/portals/:id/discovery-sessions` | `200 {sessions}` |
  | GET | `/api/discovery-sessions/:id` | `200 {session, pages}` · `404` |
  | POST | `/api/discovery-sessions/:id/capture` | `201 {page}` · `409 SESSION_NOT_ACTIVE` · `404` |
  | POST | `/api/discovery-sessions/:id/end` \| `/abort` | `202 {session}` · `404` |
  | POST | `/api/portals/:id/policy-ack` | `200 {status}` (records the ToS acknowledgement) |

  (`/validate-adapter`, `/adapter-diagnostics`, `/adapter-mappings`, `/promote` are added in Tasks 8/9.)

- [ ] **Step 1: Write `discoveryRoutes.test.ts`** using `buildServer({ dbPath, discovery })` with a fake `DiscoveryController` (in-memory session map, no real browser). Cover: 201 create; 409 on a second create; `POST /policy-ack` then create succeeds where it 409'd for `TOS_NOT_ACKNOWLEDGED` before (fake controller throws `ToSNotAcknowledgedError` until ack); `GET /discovery-sessions/:id` shape `{session, pages}`; 404s; `capture` on an ended session → 409; every response body is value-free (`JSON.stringify` contains no seeded PII).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `routes/discovery.ts`** — Zod param/body validation, `mapDiscoveryError(e, reply)` mirroring `mapAutomationError` (`DiscoverySessionActiveError → 409 SESSION_ACTIVE`, `ToSNotAcknowledgedError → 409 TOS_NOT_ACKNOWLEDGED`, `NoActivePortalError → 409`, `DiscoverySession(NotActive|NotFound)Error → 409/404`). No DB SQL in the route (delegate to the controller/store).
- [ ] **Step 4: Wire `app.ts`** — `const discovery = opts.discovery ?? new DiscoveryController();` → `app.decorate('discovery', discovery)` → `onClose` also `await discovery.dispose()` → `await registerDiscoveryRoutes(app)`. Add `BuildServerOptions.discovery?: DiscoveryController`. `fastify.d.ts` → `discovery: DiscoveryController`.
- [ ] **Step 5: Run tests — expect PASS.** Full gate.
- [ ] **Step 6: Commit** — `feat(phase-6): discovery REST routes + app wiring`.

**Dependencies:** Tasks 2, 5.
**Verification:** `npx vitest run test/automation/discoveryRoutes.test.ts` green; full gate.
**Acceptance:** spec §5.4, §12.
**Commit boundary:** one commit.

---

## Task 7: `indiaPortalMap.ts` v2 structure + adapter identity + provenance guard

**Objective:** Enrich the India map with per-mapping lifecycle + provenance + version fields and per-state `urlPattern`; upgrade `getPageIdentity` to URL+heading+anchor scoring; add the guard that makes an un-sourced non-placeholder selector a build failure. **Selectors stay `'TODO:discover'` / `status: 'placeholder'`.**

**Files:**
- Modify: `src/server/automation/adapters/india/indiaPortalMap.ts`, `src/server/automation/adapters/india/indiaAdapter.ts`
- Create: `test/automation/indiaMappingProvenance.test.ts`
- Modify: `test/automation/indiaAdapter.test.ts` (identity scoring)

**Interfaces:**
- Produces:
  ```ts
  export type MappingStatus = 'placeholder' | 'discovered' | 'validated';
  export interface IndiaFieldMapping extends PortalFieldSpec {
    status: MappingStatus;
    discoveredAt?: string;
    validatedAt?: string;
    discoverySessionRef?: string;
    notes?: string;
  }
  export interface IndiaPortalStateConfig {
    headingPattern: RegExp;
    urlPattern?: RegExp;
    anchorField: string | null;
    sectionIds: string[];
    nextSelector: string | null;
    nextSelectorStatus: MappingStatus;
    isFinalReview: boolean;
  }
  export interface IndiaPortalMap {
    adapterVersion: string;
    mappingRevision: string;    // ISO date
    lastDiscoveryAt: string | null;
    matchesUrl: RegExp;
    states: Record<IndiaPortalState, IndiaPortalStateConfig>;
    fields: Record<string, IndiaFieldMapping>;
    uploadStates: readonly IndiaPortalState[];
    checkpointHints: CheckpointHints;
    readonly submitSelector: null;
  }
  export const INDIA_ADAPTER_VERSION: string; // in indiaAdapter.ts
  ```
- Note: `getFieldMap()` must still return a `PortalFieldMap` — return a projection that strips the extra keys, OR rely on structural compatibility (`IndiaFieldMapping extends PortalFieldSpec`, so `Record<string, IndiaFieldMapping>` is assignable to `PortalFieldMap` — verify with `tsc`; if `exactOptionalPropertyTypes` complains, add an explicit `mapValues` projection).

- [ ] **Step 1: Write `indiaMappingProvenance.test.ts`:**

```ts
import { expect, it, describe } from 'vitest';
import { indiaPortalMap } from '../../src/server/automation/adapters/india/indiaPortalMap.js';

describe('india mapping provenance', () => {
  it('every field ships as placeholder / TODO:discover until discovery', () => {
    for (const [k, m] of Object.entries(indiaPortalMap.fields)) {
      if (m.selector === 'TODO:discover') expect(m.status, k).toBe('placeholder');
    }
  });
  it('a non-placeholder selector is impossible without discovery provenance', () => {
    for (const [k, m] of Object.entries(indiaPortalMap.fields)) {
      if (m.selector !== 'TODO:discover') {
        expect(m.status, k).not.toBe('placeholder');
        expect(m.discoverySessionRef, `${k} has a real selector but no discoverySessionRef`).toBeTruthy();
        if (m.status === 'validated') expect(m.validatedAt, k).toBeTruthy();
      }
    }
  });
  it('the same rule holds for every state nextSelector', () => {
    for (const [s, cfg] of Object.entries(indiaPortalMap.states)) {
      if (cfg.nextSelector && cfg.nextSelector !== 'TODO:discover') {
        expect(cfg.nextSelectorStatus, s).not.toBe('placeholder');
      }
    }
  });
  it('carries version metadata', () => {
    expect(indiaPortalMap.adapterVersion).toMatch(/\d/);
    expect(indiaPortalMap.mappingRevision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Rewrite `indiaPortalMap.ts`** to the v2 shape. Every `fields[*]` gets `status: 'placeholder'`; every form-page state gets `nextSelectorStatus: 'placeholder'` and (best-guess, allowed since it is not a *selector*) a `urlPattern` like `/\/personal(-details)?\b/i`. Top-level `adapterVersion: '6.0.0'`, `mappingRevision: '2026-09-06'`, `lastDiscoveryAt: null`.
- [ ] **Step 4: Update `indiaAdapter.ts` `getPageIdentity`** — score each state: `urlPattern?.test(page.url()) ? 0.5 : 0` + `headingPattern.test(heading) ? 0.3 : 0` + `anchorField && anchorField!=='TODO:discover' && (await page.locator(anchorField).count()) > 0 ? 0.2 : 0`. Pick the max; return `{ state, confidence, signals }`. Below any match → `UNKNOWN`/`0`. Export `INDIA_ADAPTER_VERSION = indiaPortalMap.adapterVersion`.
- [ ] **Step 5: Update `indiaAdapter.test.ts`** — a fake `Page` whose `url()`/heading vary: URL-only match → 0.5 (→ `UNKNOWN` via the 0.6 floor is enforced by `detectPage`, but the adapter returns 0.5 honestly); URL + heading → 0.8 → the state; nothing → `UNKNOWN`. Keep the existing `clickNext` throws-on-placeholder test.
- [ ] **Step 6: Run tests — expect PASS.** `npm run typecheck` especially (the `getFieldMap` projection). Full gate.
- [ ] **Step 7: Commit** — `feat(phase-6): india map v2 — mapping lifecycle + provenance + URL/heading/anchor identity`.

**Dependencies:** none (structure only).
**Verification:** `npx vitest run test/automation/indiaMappingProvenance.test.ts test/automation/indiaAdapter.test.ts` green; `npm run typecheck` green.
**Acceptance:** spec §7.1, §7.2, §13.10, §13.11; Global Constraints (lifecycle, never guess).
**Commit boundary:** one commit.

---

## Task 8: `indiaMappingRegistry` — read + promote + status; `/adapter-mappings` route

**Objective:** Read the enriched map for the UI (value-free), compute the lifecycle status counts, and render a paste-ready `indiaPortalMap.ts` edit from a discovered candidate — **the app never writes adapter source.**

**Files:**
- Create: `src/server/automation/adapters/india/indiaMappingRegistry.ts`
- Modify: `src/server/routes/discovery.ts` (add `GET /api/portals/:id/adapter-mappings`, `POST /api/discovery-sessions/:id/promote`)
- Create: `test/automation/indiaMappingRegistry.test.ts`
- Modify: `test/automation/discoveryRoutes.test.ts` (the two new routes)

**Interfaces:**
- Consumes: `indiaPortalMap`, `IndiaFieldMapping`, `MappingStatus`; `getDiscoverySession`/`listDiscoveryPages` (Task 2); `DiscoveryReportV2['candidates']`.
- Produces:
  ```ts
  export interface MappingView {
    canonicalFieldPath: string; label: string; selector: string;
    control: ControlKind; status: MappingStatus; confidence: SelectorConfidence;
    validatedAt?: string; discoverySessionRef?: string; notes?: string;
  }
  export function getIndiaMappings(): MappingView[];
  export interface MappingStatusCounts { placeholder: number; discovered: number; validated: number; total: number; requiredRemaining: number }
  export function getIndiaMappingStatus(): MappingStatusCounts;
  export interface PromoteInput { pageSeq: number; candidateIndex: number; canonicalFieldPath: string }
  export interface PromotedMappingEdit {
    canonicalFieldPath: string;
    /** exact TS to paste into indiaPortalMap.fields */
    literal: string;
    warnings: string[];
  }
  export function promoteCandidate(db: DatabaseSync, sessionId: string, input: PromoteInput): PromotedMappingEdit;
  ```

- [ ] **Step 1: Write `indiaMappingRegistry.test.ts`:**
  - `getIndiaMappings()` returns one row per `indiaPortalMap.fields` key, all `status: 'placeholder'` today, and **no value fields** (only path/label/selector/control/status/confidence/refs);
  - `getIndiaMappingStatus()` → `{ placeholder: <n>, discovered: 0, validated: 0, total: <n> }`;
  - `promoteCandidate` with a seeded session+page (insert a `portal_discovery_pages` row whose `candidates_json` = `[{ label:'Surname', primarySelector:'#f_surname', fallbackSelector:null, selectorConfidence:'stable', control:'text' }]`) and `canonicalFieldPath: 'identity.surname'` → `literal` contains `'identity.surname'`, `selector: '#f_surname'`, `status: 'discovered'`, `discoverySessionRef: '<sessionId>'`, `discoveredAt`; `warnings` is `[]`;
  - a `canonicalFieldPath` not in `indiaPortalMap.fields` → `warnings` includes `'unknown canonical field'`;
  - a `selectorConfidence: 'fragile'` candidate → `warnings` includes a fragility note.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** `promoteCandidate` reads the page row, pulls `candidates_json[candidateIndex]`, builds the `IndiaFieldMapping` literal string (pretty-printed), stamps `status: 'discovered'`, `discoveredAt: new Date().toISOString()`, `discoverySessionRef: sessionId`; collects warnings (unknown field, fragile confidence, control mismatch vs the canonical field's expected kind if known). **No file write.**
- [ ] **Step 4: Add the two routes** to `routes/discovery.ts`: `GET /adapter-mappings` → `{ mappings: getIndiaMappings(), status: getIndiaMappingStatus() }`; `POST /discovery-sessions/:id/promote` (body `PromoteInput`) → `{ mappingEdit: promoteCandidate(...) }`.
- [ ] **Step 5: Extend `discoveryRoutes.test.ts`** for both.
- [ ] **Step 6: Run tests — expect PASS.** Full gate.
- [ ] **Step 7: Commit** — `feat(phase-6): india mapping registry — read, status, promote-to-edit`.

**Dependencies:** Tasks 2, 6, 7.
**Verification:** `npx vitest run test/automation/indiaMappingRegistry.test.ts test/automation/discoveryRoutes.test.ts` green.
**Acceptance:** spec §7.3, §13.12; Global Constraint (app never auto-writes adapter source).
**Commit boundary:** one commit.

---

## Task 9: `validateIndiaAdapter` + `/validate-adapter` route + populated fixture adapter

**Objective:** Given a page, check every non-placeholder mapping resolves to exactly one node with a matching control kind (dropping option labels through the sanitizer), and every state's `nextSelector` resolves; return a value-free `AdapterValidationReport`. Provide a fully-populated fixture India adapter so this runs green in CI.

**Files:**
- Create: `src/server/automation/adapters/india/validateAdapter.ts`
- Modify: `src/server/routes/discovery.ts` (`POST /api/discovery-sessions/:id/validate-adapter`)
- Modify: `test/automation/support/fixtureIndiaAdapter.ts` — export `FIXTURE_INDIA_PORTAL_MAP_V2` where every mapping has `status: 'validated'`, `discoverySessionRef: 'fixture'`, `validatedAt` set
- Create: `test/automation/validateAdapter.test.ts`

**Interfaces:**
- Consumes: `indiaPortalMap` or an injected map; `sanitizeString` (Task 4).
- Produces:
  ```ts
  export interface AdapterFieldValidation { fieldPath: string; resolvable: boolean; nodeCount: number; controlMatches: boolean; optionLabels?: string[]; note?: string }
  export interface AdapterStateValidation { state: string; nextResolvable: boolean }
  export interface AdapterValidationReport {
    adapterVersion: string; mappingRevision: string; ranAt: string;
    fields: AdapterFieldValidation[]; states: AdapterStateValidation[]; ok: boolean;
  }
  export async function validateAdapterAgainstPage(page: Page, map: Pick<IndiaPortalMap,'adapterVersion'|'mappingRevision'|'fields'|'states'>): Promise<AdapterValidationReport>;
  export async function validateIndiaAdapter(page: Page): Promise<AdapterValidationReport>; // uses the real indiaPortalMap
  ```

- [ ] **Step 1: Write `validateAdapter.test.ts`** — serve a small static HTML page with `#surname` (text), `#sex` (`<select>` with `<option>Male/Female`), a `.next` button; call `validateAdapterAgainstPage(page, map)` with a hand-built map: a matching text field → `resolvable: true, controlMatches: true`; the select → `optionLabels: ['Male','Female']`; a `#missing` selector → `resolvable: false`; a `native_select` mapping pointed at `#surname` → `controlMatches: false`; a state whose `nextSelector` is `.next` → `nextResolvable: true`; `report.ok === false` (because of the missing + mismatch). Assert `JSON.stringify(report)` contains no value shapes.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** For each field with `status !== 'placeholder'`: `const n = await page.locator(sel).count()`; `resolvable = n === 1`; read the DOM `tagName`/`type` via `page.locator(sel).evaluate` and compare to the declared `control` (text/textarea/number → input/textarea; native_select → select; radio/checkbox → input[type]); for selects dump `option` labels via `page.locator(sel + ' option').allTextContents()` → each through `sanitizeString`. For each state with a non-placeholder `nextSelector`: `count() === 1`. `ok = fields.every(f => f.resolvable && f.controlMatches) && states.every(s => s.nextResolvable)`.
- [ ] **Step 4: Add the route** — `POST /discovery-sessions/:id/validate-adapter` → session must be `active` → `validateIndiaAdapter(controller.activePage)` → `updateDiscoverySession(db, id, { last_validation_json: JSON.stringify(report) })` → `{ report }`.
- [ ] **Step 5: Populate `FIXTURE_INDIA_PORTAL_MAP_V2`** in the fixture adapter (all `validated`) and add a `validateAdapterAgainstPage` smoke against a fixture page in `validateAdapter.test.ts` (or Task 13's suite) asserting `ok === true`.
- [ ] **Step 6: Run tests — expect PASS.** Full gate.
- [ ] **Step 7: Commit** — `feat(phase-6): validateIndiaAdapter + /validate-adapter + populated fixture map`.

**Dependencies:** Tasks 4, 6, 7, 8.
**Verification:** `npx vitest run test/automation/validateAdapter.test.ts` green.
**Acceptance:** spec §7.4, §13.13.
**Commit boundary:** one commit.

---

## Task 10: Value-conflict — shared vocabulary + pure classification + engine branch

**Objective:** Add `value_conflict` to the generic vocabulary, a pure pre-fill classifier, and the engine branch that pauses on a pre-existing different value (respecting a decision map so a resumed re-walk does not re-pause).

**Files:**
- Modify: `src/shared/automation/types.ts`, `src/shared/automation/events.ts`
- Modify: `src/server/automation/engine/fieldActions.ts` (`classifyPreFill`)
- Modify: `src/server/automation/engine/automationEngine.ts`
- Modify: `test/automation/events.test.ts`, `test/automation/fieldActions.test.ts`, `test/automation/automationEngine.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type WaitingReason = /* …existing… */ | 'value_conflict';
  export type ConflictDecision = 'use_application' | 'keep_portal';
  // events.ts — EVENT_TYPES gains, EVENT_MESSAGES gains:
  //   VALUE_CONFLICT: 'The portal already holds a different value for this field. The run paused for your decision.'
  //   FIELD_CONFLICT_KEPT: 'You chose to keep the value already in the portal for this field.'
  //   FIELD_CONFLICT_OVERWRITTEN: 'You chose to replace the portal value with your application value for this field.'
  // fieldActions.ts
  export async function classifyPreFill(page: Page, spec: PortalFieldSpec, expected: string): Promise<'empty' | 'match' | 'conflict'>;
  // automationEngine.ts
  export type EngineStop =
    | { kind: 'review_ready' }
    | { kind: 'waiting'; reason: WaitingReason; conflictFieldPath?: string }
    | { kind: 'failed'; errorCode: string };
  export interface EngineContext { /* …existing… */
    classifyPreFill: (page: Page, spec: PortalFieldSpec, expected: string) => Promise<'empty' | 'match' | 'conflict'>;
    conflictDecisions: ReadonlyMap<string, ConflictDecision>;
  }
  ```

- [ ] **Step 1: `events.test.ts`** — extend the completeness/purity checks; assert the three new literals exist, are not submit-like, and their messages contain no `${`/`value:`. **`fieldActions.test.ts`** — `classifyPreFill`: empty control → `'empty'`; control holding `norm(expected)` → `'match'`; control holding a different non-empty string → `'conflict'`; unreadable (`readControl` → null) → `'empty'` (defer to `applyField`).
- [ ] **Step 2: `automationEngine.test.ts`** — new cases with a `classifyPreFill` fake:
  - conflict + no decision → emits `VALUE_CONFLICT`, `recordMismatch` called, returns `{ kind: 'waiting', reason: 'value_conflict', conflictFieldPath: 'identity.surname' }`, `applyField` **not** called;
  - conflict + `conflictDecisions: Map(['identity.surname','keep_portal'])` → emits `FIELD_CONFLICT_KEPT`, skips the field, `applyField` not called, loop continues;
  - conflict + `['identity.surname','use_application']` → emits `FIELD_CONFLICT_OVERWRITTEN`, then `applyField` **is** called, then normal verify;
  - `'match'` → no conflict event, `applyField` still called (its `alreadySet` path short-circuits) — unchanged behaviour;
  - a required field left as `keep_portal` conflict is **not** counted toward `fields_verified`.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement.**
  - `types.ts`/`events.ts`: add the members (keep `EVENT_MESSAGES` exhaustive — `tsc` enforces).
  - `fieldActions.ts`: `classifyPreFill` = `readControl` → null → `'empty'`; `norm('') ` → `'empty'`; `norm(actual) === norm(expected)` → `'match'`; else `'conflict'`. (Reuse the module's `norm`.)
  - `automationEngine.ts`: in the field loop, after `if (!m.present) continue;` and before `FIELD_FILL_STARTED`, insert:
    ```ts
    const pre = await ctx.classifyPreFill(ctx.page, m.spec, m.expected ?? '');
    if (pre === 'conflict') {
      const decision = ctx.conflictDecisions.get(m.fieldPath);
      if (decision === undefined) {
        const actual = await ctx.readControl(ctx.page, m.spec.selector, m.spec.control);
        ctx.recordMismatch({ fieldPath: m.fieldPath, expected: m.expected ?? '', actual: actual ?? '' });
        await ctx.emit({ type: 'VALUE_CONFLICT', fieldPath: m.fieldPath, status: 'blocked' });
        return { kind: 'waiting', reason: 'value_conflict', conflictFieldPath: m.fieldPath };
      }
      if (decision === 'keep_portal') {
        await ctx.emit({ type: 'FIELD_CONFLICT_KEPT', fieldPath: m.fieldPath });
        continue;
      }
      await ctx.emit({ type: 'FIELD_CONFLICT_OVERWRITTEN', fieldPath: m.fieldPath });
      // fall through to the normal fill path
    }
    ```
  - Extend `EngineStop`/`EngineContext` types.
- [ ] **Step 5: Fix the compile fan-out** — exactly **two** `EngineContext` construction sites exist: `automationService.ts` `buildContext` (line ~425) and `test/automation/automationEngine.test.ts` `makeCtx` (line ~183). Add `classifyPreFill` + `conflictDecisions` (+ `defaultConflictDecision?`) to both. In `buildContext`, wire `classifyPreFill: (p, spec, exp) => classifyPreFill(p, spec, exp)` (the real fn) and `conflictDecisions: new Map()` for now (Task 11 replaces it with the runner's live map). In `makeCtx`, default to `async () => 'empty'` and `new Map()`, with a `CtxOpts` hook to override. The fake `runLoop` in `automationService.test.ts` receives `ctx` and does not construct one — no change there.
- [ ] **Step 6: Run tests — expect PASS.** Full gate.
- [ ] **Step 7: Commit** — `feat(phase-6): value_conflict — vocabulary + pre-fill classifier + engine pause branch`.

**Dependencies:** Task 2 (the CHECK must already be dropped or the `value_conflict` write path can't be exercised end-to-end — but this task is engine-only/unit, so Task 2 only strictly blocks Task 11).
**Verification:** `npx vitest run test/automation/events.test.ts test/automation/fieldActions.test.ts test/automation/automationEngine.test.ts` green; full gate.
**Acceptance:** spec §6; Global Constraint (pre-existing different value → pause).
**Commit boundary:** one commit.

---

## Task 11: Value-conflict wiring — `resumeRun(decision)` + runner decision map + route + crash default

**Objective:** Carry the operator's conflict decision from `POST /resume` into the runner and every subsequent `EngineContext`; default a crash-recovery resume to `keep_portal` (never blind-overwrite).

**Files:**
- Modify: `src/server/automation/automationService.ts`
- Modify: `src/server/routes/automation.ts`
- Modify: `src/web/src/api/client.ts` (the `resumeAutomationRun` signature)
- Modify: `test/automation/automationService.test.ts`, `test/automation/automationRoutes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // automationService.ts
  resumeRun(db: DatabaseSync, id: string, decision?: ConflictDecision): Promise<AutomationRunRow>;
  // AutomationRunner gains:
  private conflictDecisions = new Map<string, ConflictDecision>();
  private pausedConflictFieldPath: string | null = null;
  ```
- Consumes: `EngineStop.conflictFieldPath`, `EngineContext.conflictDecisions` (Task 10).

- [ ] **Step 1: `automationService.test.ts`** — with a `runLoop` fake that returns `{ kind:'waiting', reason:'value_conflict', conflictFieldPath:'identity.surname' }` on call 1 then `{ kind:'review_ready' }`:
  - `resumeRun(db, id)` (no decision) on a `value_conflict` wait → throws a new `ConflictDecisionRequiredError` (→ route 400);
  - `resumeRun(db, id, 'keep_portal')` → the second `runLoop` call's `ctx.conflictDecisions.get('identity.surname') === 'keep_portal'`; run reaches `review_ready`;
  - crash-recovery (`dispose` then `resumeRun(db, id, 'use_application')` with no in-memory runner) → the fresh runner's `conflictDecisions` defaults **every** unresolved conflict to `keep_portal` regardless of the passed decision, and logs a debug line (assert via a captured logger or a spy) — because the fresh runner doesn't know which field paused.
- [ ] **Step 2: `automationRoutes.test.ts`** — `POST /automation-runs/:id/resume` with `{ decision: 'use_application' }` → 202; with no body on a `value_conflict` wait → 400 `DECISION_REQUIRED`; with `{ decision: 'bogus' }` → 400 validation.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement.**
  - `AutomationRunner`: on a `value_conflict` waiting stop, set `this.pausedConflictFieldPath = stop.conflictFieldPath ?? null`. `buildContext` passes `conflictDecisions: this.conflictDecisions` (a live ref — `ReadonlyMap` view is fine).
  - `resumeRun(db, id, decision?)`: if `cur.waiting_reason === 'value_conflict'` and `decision === undefined` → throw `ConflictDecisionRequiredError`. If the in-memory runner matches, `runner.conflictDecisions.set(runner.pausedConflictFieldPath!, decision!)` before `signalResume`. Crash-recovery branch (`!signalled`): after building the fresh runner, if `cur.waiting_reason === 'value_conflict'`, pre-seed **nothing** field-specific; instead set a runner flag `defaultConflict: 'keep_portal'` so `classifyPreFill === 'conflict'` with no map entry resolves to `keep_portal` + a `logger.debug`. (Add the `defaultConflict` read into the engine branch: `const decision = ctx.conflictDecisions.get(m.fieldPath) ?? ctx.defaultConflictDecision;` — extend `EngineContext` with `defaultConflictDecision?: ConflictDecision`.)
  - `routes/automation.ts`: `resumeBodySchema = z.object({ decision: z.enum(['use_application','keep_portal']).optional() })`, tolerant of an empty/absent body; pass to `resumeRun`; map `ConflictDecisionRequiredError → 400 DECISION_REQUIRED`.
  - `api/client.ts`: `resumeAutomationRun(runId, decision?)` → `POST` with `decision ? { decision } : undefined`.
- [ ] **Step 5: Fix callers** — every existing `resumeRun(db, id)` / `resumeAutomationRun(id)` call compiles unchanged (decision optional).
- [ ] **Step 6: Run tests — expect PASS.** Full gate.
- [ ] **Step 7: Commit** — `feat(phase-6): value_conflict resume — decision plumbing + conservative crash default`.

**Dependencies:** Tasks 2, 10.
**Verification:** `npx vitest run test/automation/automationService.test.ts test/automation/automationRoutes.test.ts` green; full gate.
**Acceptance:** spec §6, §13.15, §13.20.
**Commit boundary:** one commit.

---

## Task 12: Fixture portal v2

**Objective:** Extend the fixture portal so the integration suite can exercise prefill-match, prefill-conflict, a WebForms-style page, extra sections, and an unknown page — all deterministic, no network.

**Files:**
- Modify: `test/helpers/fixturePortal.ts`
- Create: `test/fixtures/india-portal/additional-information.html`, `previous-visits.html`, `webforms-personal.html`, `nowhere.html`
- Modify: `test/fixtures/india-portal/personal.html`, `passport.html`, `address.html` (accept `?prefill=`)
- Modify: `test/automation/support/fixtureIndiaAdapter.ts` (v2 states + prefill-aware map)
- Modify/Create: `test/automation/fixturePortal.test.ts` (extend the existing fixture-contract tests)

**Interfaces:**
- Produces:
  ```ts
  export interface FixturePortal {
    url: string; submitCount: number; requests: { method: string; url: string }[];
    setChallenge(v: ChallengeVariant): void;
    setPrefill(v: 'none' | 'match' | 'conflict'): void;   // NEW
    close(): Promise<void>;
  }
  ```

- [ ] **Step 1: Extend `fixturePortal.test.ts`** — assert: `setPrefill('match')` then `GET /personal` → the `#surname` input has `value="RANA"` (the fixture's canonical match value, matching the Task 13 plan); `setPrefill('conflict')` → `value="SOMEONE-ELSE"`; `GET /webforms-personal` → body contains `__VIEWSTATE`; `GET /nowhere` → 200 with a heading that matches no adapter state; `submitCount` still increments only on `POST /__fixture/submit`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
  - `fixturePortal.ts`: add `state.prefill`; when serving a page that supports prefill, string-replace `value=""` on the known controls with `value="RANA"` (match) / `value="SOMEONE-ELSE"` (conflict) for `#surname` and analogous for a couple more; add the 4 new page names to `PAGE_NAMES`; `webforms-personal.html` posts back to itself and re-renders (increment a `postbackCount`, keep the same path).
  - `webforms-personal.html`: `<input type="hidden" name="__VIEWSTATE" value="/wEPDw...">`, labelled controls, a `<button name="save">Save</button>` that (via a tiny inline script or a form GET to `?posted=1`) re-renders the same URL.
  - `nowhere.html`: `<h1>Session Dashboard</h1>` (matches no `headingPattern`/`urlPattern`).
  - `fixtureIndiaAdapter.ts` v2: add `PREVIOUS_VISITS`, `ADDITIONAL_INFORMATION`, `WEBFORMS_PERSONAL` to `PATH_TO_STATE`/`SECTION_IDS`; give each mapping `status: 'validated'` metadata; keep `submitSelector: null`.
- [ ] **Step 4: Run tests — expect PASS.** Full gate.
- [ ] **Step 5: Commit** — `test(phase-6): fixture portal v2 — prefill, WebForms page, extra sections, unknown page`.

**Dependencies:** Task 7 (v2 mapping shape).
**Verification:** `npx vitest run test/automation/fixturePortal.test.ts` green.
**Acceptance:** spec §9.1.
**Commit boundary:** one commit.

---

## Task 13: Integration scenarios (real engine + headless chromium + fixture v2)

**Objective:** Prove the whole path end-to-end: prefill-match skip, conflict → both decisions, WebForms identity, unknown-page stop, a full populated run to `review_ready`, and a discovery session round-trip — every scenario asserting `submitCount === 0`.

**Files:**
- Create: `test/automation/phase6Integration.test.ts`
- Modify: `test/automation/support/fixtureIndiaAdapter.ts` if a hook is missing

**Interfaces:** consumes `startFixturePortal` (v2), `makeFixtureIndiaAdapter`/`FIXTURE_INDIA_PORTAL_MAP_V2`, `AutomationService` with injected `resolveAdapter`, real `runLoop`, real `BrowserManager` (headless).

- [ ] **Step 1: Write the scenarios** (each: build the real Fastify server on a temp DB, seed a ready application + an active portal pointing at the fixture URL, `POST` a run, poll):
  1. **prefill-match** — `setPrefill('match')`; the run fills the rest, the pre-filled `identity.surname` emits `FIELD_ALREADY_SET` (not `VALUE_CONFLICT`); reaches `review_ready`; `submitCount === 0`.
  2. **prefill-conflict → keep_portal** — `setPrefill('conflict')`; run pauses `value_conflict`; `GET /automation-runs/:id/live` returns `{ fieldPath:'identity.surname', expected:'RANA', actual:'SOMEONE-ELSE' }`; the persisted events contain **neither** `'RANA'` nor `'SOMEONE-ELSE'`; `POST /resume { decision:'keep_portal' }` → `FIELD_CONFLICT_KEPT` → `review_ready`; `submitCount === 0`.
  3. **prefill-conflict → use_application** — same setup; `POST /resume { decision:'use_application' }` → `FIELD_CONFLICT_OVERWRITTEN` → the portal control now reads `RANA` (assert via a follow-up `page`… or via `FIELD_VERIFIED` for that path) → `review_ready`.
  4. **conflict resume without a decision** → `409`/`400 DECISION_REQUIRED`; the run stays `waiting_for_user`.
  5. **WebForms page** — entry at `/webforms-personal`; `getPageIdentity` returns a real state at ≥ 0.6 via `urlPattern`; a save-postback that keeps the same URL does **not** raise a false `NAVIGATION_STALLED` on the first pass (the adapter advances via `.next`).
  6. **unknown page** — entry at `/nowhere` → `UNKNOWN_PORTAL_STATE` → pause `unknown_page`; `FIELD_FILL_STARTED` never emitted; `submitCount === 0`.
  7. **full populated run** — `FIXTURE_INDIA_PORTAL_MAP_V2`, no prefill, `setChallenge('otp')` on `/challenge`; run walks every section, pauses OTP, `/resume`, reaches `review_ready` with `fields_verified === fields_total`; `submitCount === 0`; no event `type` matches `/submit|confirm|lodge|pay/i`.
  8. **discovery round-trip** — `DiscoveryController` with a real persistent context (tmp profile) pointed at the fixture; `start` → the test navigates the page to `/passport` → `capture` → `end`; `GET /discovery-sessions/:id` shows 1 page, `state_guess` non-null, `candidates_json` non-empty, JSON contains no seeded PII.
- [ ] **Step 2: Run — expect FAIL / partial.**
- [ ] **Step 3: Fix any real bug surfaced** (use `superpowers:systematic-debugging` — write the failing case, find the root cause, fix in source not test).
- [ ] **Step 4: Run — expect PASS.** Full gate.
- [ ] **Step 5: Commit** — `test(phase-6): fixture-v2 integration — prefill, conflict decisions, webforms, unknown, full run, discovery`.

**Dependencies:** Tasks 5, 9, 11, 12.
**Verification:** `npx vitest run test/automation/phase6Integration.test.ts` green; full gate.
**Acceptance:** spec §9.2, §13.14–§13.18, §13.22.
**Commit boundary:** one commit.

---

## Task 14: Security suite + no-submit guard extension + diagnostics

**Objective:** Behavioural proof that no PII reaches logs or the DB across a full Phase 6 run + a discovery session; the no-submit / no-solver grep now visibly covers `discovery/**`; and the adapter diagnostics assembly.

**Files:**
- Modify: `test/automation/security.test.ts` (add Phase 6 cases)
- Modify: `test/automation/noAutoSubmit.test.ts` (assert `discovery/` files are in `SCAN`, non-vacuously)
- Create: `src/server/automation/adapters/india/diagnostics.ts`, `test/automation/indiaDiagnostics.test.ts`
- Modify: `src/server/routes/discovery.ts` (`GET /api/portals/:id/adapter-diagnostics`)

**Interfaces:**
- Produces:
  ```ts
  export interface IndiaDiagnostics {
    adapterId: 'india'; adapterVersion: string; mappingRevision: string; lastDiscoveryAt: string | null;
    pagesDiscovered: number; fieldsDiscovered: number;
    mappings: MappingStatusCounts;
    unknownPagesEncountered: number;         // count of automation_events WHERE type='UNKNOWN_PORTAL_STATE'
    lastValidation: { ranAt: string; ok: boolean } | null;
  }
  export function getIndiaDiagnostics(db: DatabaseSync, portalId: string): IndiaDiagnostics;
  ```

- [ ] **Step 1: `noAutoSubmit.test.ts`** — add an assertion that `SCAN.some(f => f.includes('/discovery/'))` is true and that the existing patterns bite on a synthetic `discovery` string (keep it non-vacuous).
- [ ] **Step 2: `security.test.ts`** — new cases:
  - a full fixture-v2 run through a capturing pino stream + a scan of every `automation_events` row and every `portal_discovery_pages` row → contains none of the seeded surname / passport / DOB / conflict value; every `automation_events.message ∈ EVENT_MESSAGES`; `last_validation_json` (if present) contains no value shape;
  - `AUTOMATION_EVIDENCE` unset → no screenshot file is written during a discovery session or a conflict pause;
  - `url_pattern` on every persisted discovery page is masked (no `[0-9a-f]{8,}`, no `\d{5,}` path segment).
- [ ] **Step 3: `indiaDiagnostics.test.ts`** — seed a session + 2 pages + an `automation_runs` row with an `UNKNOWN_PORTAL_STATE` event; `getIndiaDiagnostics` returns the right counts, `mappings` all-placeholder today, `lastValidation` from `last_validation_json`; assert no PII in the payload.
- [ ] **Step 4: Run — expect FAIL.**
- [ ] **Step 5: Implement `diagnostics.ts`** + the route; run.
- [ ] **Step 6: Run tests — expect PASS.** Full gate.
- [ ] **Step 7: Commit** — `test(phase-6): security suite + no-submit guard over discovery + adapter diagnostics`.

**Dependencies:** Tasks 2, 6, 7, 9, 13.
**Verification:** `npx vitest run test/automation/security.test.ts test/automation/noAutoSubmit.test.ts test/automation/indiaDiagnostics.test.ts` green; full gate.
**Acceptance:** spec §11, §13.21, §13.23, §13.24.
**Commit boundary:** one commit.

---

## Task 15: Web — Settings India card, discovery session page, diagnostics panel, conflict panel

**Objective:** The operator-facing UI: portal status + discovery launch, the live discovery session view with promote, the diagnostics panel, and the run-page value-conflict panel. No applicant values on any of these surfaces except the in-memory `/live` conflict pair.

**Files:**
- Create: `src/web/src/pages/Settings/IndiaPortalCard.tsx`, `src/web/src/pages/Discovery/DiscoverySessionPage.tsx`, `src/web/src/pages/Discovery/discoveryChrome.tsx`
- Modify: `src/web/src/api/client.ts`, `src/web/src/main.tsx`, `src/web/src/pages/Settings/PortalsPage.tsx` (mount the card), `src/web/src/pages/Automation/AutomationRunPage.tsx` + `runChrome.tsx`
- Create: `test/web/IndiaPortalCard.test.tsx`, `test/web/DiscoverySessionPage.test.tsx`, `test/web/AutomationRunConflict.test.tsx`

**Interfaces:** consumes the Task 6/8/9/14 routes via `api/client.ts` (`startDiscoverySession`, `getDiscoverySession`, `captureDiscoveryPage`, `endDiscoverySession`, `promoteCandidate`, `getAdapterMappings`, `validateAdapter`, `getAdapterDiagnostics`, `recordPolicyAck`, `resumeAutomationRun(runId, decision?)`).

- [ ] **Step 1: `IndiaPortalCard.test.tsx`** — given `getAdapterMappings`/`getAdapterDiagnostics` responses, the card shows `Needs Discovery` when no session; `Needs Mapping` when a session ended but all placeholder; `Needs Validation` when `discovered > 0 && validated === 0`; `Ready` when `requiredRemaining === 0 && validated === total`. Buttons: **Start Discovery** posts and navigates to `/discovery/:id`; a `409 TOS_NOT_ACKNOWLEDGED` renders an inline acknowledgement prompt whose confirm calls `recordPolicyAck` then retries. No applicant data.
- [ ] **Step 2: `DiscoverySessionPage.test.tsx`** — renders the captured page list (state guess, url pattern, title), a **Capture this page** button (calls `captureDiscoveryPage`, appends), an expandable candidate table with a **Promote** `<select>` of unmapped canonical paths → calls `promoteCandidate` → shows the returned `literal` in a `<pre>` to copy. End Session button. No `<input value>` from the portal is ever shown; assert the component renders only labels/selectors/control kinds.
- [ ] **Step 3: `AutomationRunConflict.test.tsx`** — when `run.waiting_reason === 'value_conflict'`, the ACTION REQUIRED panel shows the `/live` `{ fieldPath, expected, actual }` and three buttons: **Use application value** → `resumeAutomationRun(id,'use_application')`; **Keep portal value** → `resumeAutomationRun(id,'keep_portal')`; **Edit application** → `abortAutomationRun(id)` then `navigate('/applications/'+run.application_id)`. Assert **no** `<form>` / `type=submit` / submit-labelled control anywhere on the page (the Phase 5 test already checks this — keep it green).
- [ ] **Step 4: Run — expect FAIL.**
- [ ] **Step 5: Implement** the three components + client methods + the `discovery/:sessionId` route + mount `IndiaPortalCard` in `PortalsPage` (only when the active portal resolves to `india` — a small `adapterId` hint from `getAdapterDiagnostics` or a `?` field on the portal response; simplest: always render it under the portal list and let it self-hide when `getAdapterMappings` 404s / returns non-india). Follow the existing `runChrome.tsx` / `ReadyForAutomationSection.tsx` patterns (typed client, `role="alert"` for action-required, `role="status"` for passive).
- [ ] **Step 6: Run tests — expect PASS.** `npm run build` (bundle size noted in the report). Full gate.
- [ ] **Step 7: Commit** — `feat(phase-6): web — India portal card, discovery session page, diagnostics, value-conflict panel`.

**Dependencies:** Tasks 6, 8, 9, 11, 14.
**Verification:** `npx vitest run test/web/IndiaPortalCard.test.tsx test/web/DiscoverySessionPage.test.tsx test/web/AutomationRunConflict.test.tsx` green; `npm run build` green.
**Acceptance:** spec §5.5, §13.25.
**Commit boundary:** one commit.

---

## Task 16: Docs, Track B runbook, live discovery session, Phase 6 report

**Objective:** `docs/PHASE-6-REPORT.md` (spec §13.27 contents + the verbatim lines), `docs/ARCHITECTURE.md` §3 paragraph, the progressive-test runbook in `docs/portals/india.md`, and — **with the user, only if §4 permits** — an actual live discovery session, `indiaPortalMap` population from it, and as many of Tests A–G as reachable, results recorded.

**Files:**
- Create: `docs/PHASE-6-REPORT.md`
- Modify: `docs/ARCHITECTURE.md` (§3), `docs/portals/india.md` (runbook + live findings), possibly `src/server/automation/adapters/india/indiaPortalMap.ts` (real selectors from the session, `status: 'discovered'`/`'validated'`, `discoverySessionRef`)

- [ ] **Step 1: Write the Track B runbook** in `docs/portals/india.md` — Tests A–G as a numbered operator procedure, each with the exact UI action, the expected event/state, the stop condition, and "record BLOCKED + reason if it cannot proceed". State `INDIA_LIVE=1` gating and "never in CI".
- [ ] **Step 2: Full gate + `npx vitest run test/automation test/web` counts recorded.**
- [ ] **Step 3: Write `docs/PHASE-6-REPORT.md`** — architecture; tasks 1–16 + commit SHAs; migration 6; API delta (the discovery routes + `/resume {decision}`); UI; discovery model; mapping lifecycle model; controlled autofill; human checkpoints (unchanged from Phase 5, restated); the four no-submit mechanisms (still in place, now also grepping `discovery/**`); PII audit (discovery = structure only, conflict pair in-memory only, `url_pattern` masking); known limitations; deferred work (spec §15); the §13 acceptance table (28 items) with PASS/PARTIAL + evidence; and verbatim:
  ```
  Automatic final visa submission: NOT IMPLEMENTED
  OTP/CAPTCHA/anti-bot bypass: NOT IMPLEMENTED
  ```
- [ ] **Step 4: `docs/ARCHITECTURE.md` §3** — one paragraph after the Phase 5 one: the India integration layer; discovery is read-only + persisted structure-only (migration 6); the mapping lifecycle placeholder→discovered→validated with the provenance guard; the ToS runtime gate; value-conflict as the one generic engine addition; still no submit path. End "See `docs/PHASE-6-REPORT.md`."
- [ ] **Step 5 (with the user):** if the §4 verdict is `PERMITTED`/`UNCLEAR` and the user is ready — run Test A (Start Discovery opens the real portal), Test B (user navigates + captures), Test C (transcribe 3–5 personal-details selectors via `promoteCandidate` output, `Validate Adapter`), then D–G as far as reachable. Record each in `docs/portals/india.md` (findings tables) and the report (Track B section). Commit `indiaPortalMap` selector edits separately as `feat(phase-6): india personal-details selectors from discovery session <id>` etc. **Any step blocked → recorded as BLOCKED with the reason; Phase 6 still completes on Track A.**
- [ ] **Step 6: Commit the docs** — `docs(phase-6): Phase 6 report + ARCHITECTURE §3 + Track B runbook`.

**Dependencies:** Tasks 1–15.
**Verification:** full gate green; report has all §13.27 sections + the two verbatim lines + the 28-item table.
**Acceptance:** spec §13.26, §13.27, §13.28.
**Commit boundary:** one docs commit (+ separate selector commits per Track B session).

---

## After the tasks

- **Whole-branch review (opus)** over `d61468b..HEAD` against the spec's Global Constraints and the 8 Phase 5 rails + the Phase 6 additions (ToS gate is runtime; discovery read-only + non-vacuous; provenance guard bites; no PII in discovery rows; value-conflict never persists values; no submit path; `submitCount === 0`). Fix wave if needed.
- **`superpowers:finishing-a-development-branch`** — merge/push/PR is the user's call.

---

## Self-review

**1. Spec coverage** — every spec section maps to a task:

| Spec § | Task(s) |
|---|---|
| §1 mission / non-goals | Global Constraints; enforced across 5, 10, 13, 14 |
| §2 consume Phase 4/5 unchanged | 10, 11 (engine seam), 13 (reuses `runLoop`/service); guard 14 |
| §3 architecture / new modules | file structure; 2–9 build them |
| §4 ToS gate | 1 |
| §5.1 migration 6 | 2 |
| §5.2 controller + store + browser | 2, 3, 5 |
| §5.3 observer v2 + sanitizer | 4 |
| §5.4 discovery routes | 6, 8, 9 |
| §5.5 discovery UI | 15 |
| §6 value-conflict | 10, 11, 15 (panel), 13 (integration) |
| §7.1 map v2 | 7 |
| §7.2 identity | 7 |
| §7.3 registry / promote | 8 |
| §7.4 validateIndiaAdapter | 9 |
| §8 controlled autofill | 10 + 13 (fixture-proven) + 16 (live) |
| §9.1 fixture v2 | 12 |
| §9.2 test matrix | 13, 14, 15 |
| §10 Track B | 16 |
| §11 PII / security | 4, 14 |
| §12 REST summary | 6, 8, 9, 11 |
| §13 acceptance (28) | 16 assembles the table; each item traced above |
| §14 execution | this plan (16 tasks) |
| §15 open follow-ups | 16 (report) |

No gap.

**2. Placeholder scan** — the only literal "TODO" strings are the **intentional**
`'TODO:discover'` selector placeholders (spec-mandated, Task 7). Every code step
has real code or an exact SQL/TS block. Task 2 Step 4 names a concrete fallback
recipe rather than "handle it"; Task 13 Step 3 points at `systematic-debugging`
with a concrete "fix in source not test" instruction.

**3. Type consistency** — `MappingStatus` / `IndiaFieldMapping` (Task 7) consumed by
8, 9, 14. `ConflictDecision` (Task 10) consumed by 11, 15. `EngineContext.classifyPreFill`
+ `conflictDecisions` + `defaultConflictDecision` (Tasks 10/11) — every `EngineContext`
construction updated in the same task (10 Step 5). `EngineStop.conflictFieldPath`
(Task 10) read by the runner (Task 11). `DiscoverySessionRow` / `DiscoveryPageRow`
(Task 2) consumed by 5, 6, 8, 9, 14. `DiscoveryReportV2` (Task 4) consumed by 5, 8.
`resumeRun(db, id, decision?)` (Task 11) — route + client + tests updated in Task 11.
`AdapterValidationReport` (Task 9) consumed by 14 (`lastValidation`) and 15.
`getIndiaDiagnostics` / `IndiaDiagnostics` (Task 14) consumed by 15.
`captureDiscoveryV2` returns `DiscoveryReportV2` everywhere. `sanitizeString` /
`sanitizeUrlToPattern` (Task 4) used by 4, 9, 5. No name drift found.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-06-phase-6-india-portal-adapter.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration (how Phases 4 & 5 ran).
2. **Inline Execution** — tasks executed in this session with batch checkpoints.

Which approach? — **but not yet:** produce the PHASE 6 PLANNING REPORT and stop for the user's approval first.
