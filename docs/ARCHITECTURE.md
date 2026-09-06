# Architecture — Application Foundation

**Status:** Current. Describes the foundation delivered in Phase 0 and verified as
the Phase 1 "Application Foundation" deliverable (verify + document; no
structural changes).
**Last verified:** 2026-09-02 — `npm install`, `npm run build`, `npm run
typecheck`, `npm run lint`, `npm test` all green (48 tests / 12 files).

Companion documents:

- `docs/architecture/ADR-0001..0004.md` — the four decisions behind this shape.
- `docs/superpowers/specs/2026-09-02-phase-0-portal-settings-design.md` — spec.
- `docs/PHASE-0-REPORT.md` — end-of-phase verification and acceptance checklist.
- `README.md` — setup and run instructions.

---

## 1. What this is

A **local-first** application: one Node.js process runs a Fastify HTTP API plus a
SQLite database; a React/Vite single-page app is the UI. Everything runs on
`127.0.0.1` — nothing is exposed to other hosts. The foundation carries no
applicant data and performs no visa-form automation.

```
                       ┌──────────────────────────────────────────────┐
   browser  ──HTTP──►   │  Node process (127.0.0.1)                    │
   (React SPA)          │                                              │
                        │   Fastify API  ──►  services  ──►  SQLite    │
                        │      │                             (node:    │
                        │      └── @fastify/static (prod)      sqlite)  │
                        │                                              │
                        │   automation/  (Phase 0 Test Connection;     │
                        │                 out of foundation scope)     │
                        └──────────────────────────────────────────────┘

  dev:   Vite dev server :5173  ──proxy /api──►  Fastify :5174
  prod:  Fastify :5174 serves the built SPA from dist/web  +  /api
```

---

## 2. Runtime shapes

### Development — `npm run dev`

`concurrently` runs two processes:

| Process | Command | Port | Role |
|---|---|---|---|
| `dev:server` | `tsx watch src/server/index.ts` | `127.0.0.1:5174` | Fastify API + SQLite, hot-restart on change |
| `dev:web` | `vite` | `127.0.0.1:5173` | React SPA with HMR; proxies `/api` → `:5174` |

### Production — `npm run build && npm start`

`vite build` emits the SPA to `dist/web`; `tsc -p tsconfig.server.json` emits the
server to `dist/server`. `npm start` runs `node dist/server/index.js` with
`NODE_ENV=production`; Fastify then:

- registers `@fastify/static` over `dist/web` (`wildcard: false`),
- serves `index.html` for any non-`/api` path (SPA client-side routing),
- keeps the JSON `{ error: { code, message } }` envelope for unknown `/api/*`,
- refuses to start with a clear message if `dist/web/index.html` is missing.

Single origin, no CORS, no Vite in production.

---

## 3. Source layout

```
src/
  shared/                     # imported by BOTH server and web — one source of truth
    types.ts                  # VisaPortal, ConnectionTestResult, ApiError, PortalType
    schemas.ts                # Zod: portalInputSchema, activePortalSchema (validation truth)
    url.ts                    # isHttpUrl() — zero-dependency http(s) guard

  server/
    index.ts                  # bootstrap: buildServer() + listen 127.0.0.1
    app.ts                    # buildServer({ dbPath }) factory — wiring, used by every test
    env.ts                    # parse + validate process.env once (Zod); derived paths
    logger.ts                 # pino instance + PII redaction config
    fastify.d.ts              # FastifyInstance.db type augmentation

    db/
      connection.ts           # openDatabase(dbPath): DatabaseSync + pragmas
      migrations.ts           # ordered migrations + runMigrations() (PRAGMA user_version)

    routes/                   # HTTP layer: validate → call service → map errors. No DB SQL here.
      health.ts               # GET /api/health
      portals.ts              # portal CRUD + active-portal + test-connection endpoints
      errors.ts               # errorBody(), validationError(), notFoundError()

    services/                 # pure domain logic over the DB. No HTTP types here.
      portalService.ts        # portal CRUD + active-portal selection
      errors.ts               # PortalNotFoundError, PortalDisabledError (typed domain errors)

    automation/               # ⚠ Phase 0 feature (navigate-only Test Connection).
      engine/                 #    Not part of the foundation; documented in ADR-0004.
        browserManager.ts     #    Portal-agnostic Playwright lifecycle.
        pageInspector.ts      #    Read-only DOM snapshot + security-challenge flags.
      adapters/               #    PortalAdapter interface + genericAdapter + registry.
      discovery/testConnection.ts   # runConnectionTest(url) — navigate + observe + screenshot.

  web/
    index.html
    src/
      main.tsx                # React root + createBrowserRouter
      App.tsx                 # layout + <Outlet/>
      styles.css
      api/client.ts           # typed fetch wrapper (throws Error(body.error.message) on non-2xx)
      lib/portalTypes.ts      # PORTAL_TYPE_OPTIONS
      pages/Settings/          # PortalsPage, PortalForm, TestConnectionPanel

test/
  helpers/                    # tempDb.ts (temp SQLite paths), fixtureServer.ts (local HTTP fixture)
  server/                     # schemas, migrations, portalService, portalRoutes, health, staticServing
  automation/                 # pageInspector, testConnection, noHardcodedUrl
  web/                        # PortalsPage, PortalForm, apiClient
```

### Layering rules

- **`shared/` → nothing.** Pure types + one guard + Zod schemas. Both other
  layers import it; it imports neither.
- **`routes/` → `services/` → `db/`.** Routes never write SQL; services never
  touch `FastifyRequest`/`Reply`. A service takes the `DatabaseSync` handle as
  its first argument, so it is unit-testable without HTTP.
- **`automation/` is isolated.** `engine/` and `adapters/` know nothing about any
  specific portal; the only navigation target is a URL passed in as a parameter
  (spec §9a). Nothing in `db/`, `services/`, or `shared/` imports `automation/`.
- **ESM everywhere.** `module: NodeNext`; every relative import in `server/` and
  `shared/` carries an explicit `.js` extension. The web build uses
  `moduleResolution: Bundler` and omits extensions.

**Phase 1 (visa knowledge base):** `src/shared/visa-kb/` is a pure,
dependency-light module — a Zod schema, a loader that validates and freezes
versioned JSON rule data (`data/india/`), and query functions (category lookup,
application-mode filtering, explicit-never-inferred nationality eligibility,
document requirements, invalid-combination validation). e-Visa and Regular/Paper
categories are separate JSON files; Bangladesh eligibility is a set of explicit
per-category records. The React `/visa-rules` page imports the module directly;
there is no HTTP API. Rule changes are a JSON edit plus a `meta.kbVersion` bump.
See `docs/PHASE-1-REPORT.md`.

**Phase 3 (passport OCR & document extraction):** `src/shared/mrz/` and
`src/shared/documents/` are pure, Zod-only modules — ICAO 9303 check digits, an
authoritative TD3 MRZ parser and line detector, value normalization, document
classification, a heuristic confidence score, the extracted-field → profile
`field_path` map, and a label-based OCR field extractor. `src/server/documents/`
is the Node-only half: magic-byte file typing and local original storage (SHA-256,
path-containment guarded), single-image-PDF handling via `pdfjs-dist` (encrypted
PDFs rejected with no password attempt), a local `tesseract.js` OCR engine with a
vendored `eng` model and no network, a thin stage-by-stage `extractionPipeline`
orchestrator, the profile-application rules (auto-apply empty fields / hold
collisions), and `documentService`. Migration 3 adds `documents`,
`extraction_runs`, `document_fields` and `applicant_field_meta.document_id`. Eight
`/api/documents` endpoints cover upload / extract / review / apply / dismiss /
delete; the React `/documents` pages are the per-field review-and-verify UI. OCR
is text-from-pixels only — `td3.ts` is the sole authority for a valid MRZ — and no
extraction path writes `verified = 1`. See `docs/PHASE-3-REPORT.md`.

**Phase 4 (India visa application builder):** `src/shared/application/` is the pure
plan engine — a condition evaluator, an eligibility evaluator, form-rule and
document-rule resolvers, and `buildApplicationPlan(input) → ApplicationPlan`
(sections / fields / documents / eligibility / `missing` / verification rollup / a
five-condition `readyForAutomation` gate). It imports no `node:*`, no `fastify`, no
`react`/router, no `better-sqlite3`, never reaches into `../server`, and never reads
`process.env` — `test/shared/application/enginePurity.test.ts` greps the source and
fails the build otherwise. India-specific form rules live only in
`src/shared/visa-kb/` KB v2 (`schemaVersion: 2` — a form model plus per-category
`formRules` / `conditionalDocuments`); the engine, `applicationService`,
`routes/applications.ts` and the dashboard carry no KB category-id literal, asserted
by `test/shared/application/architectureGuard.test.ts`. Every rule the plan surfaces
carries a `source` (official URL + `retrievedAt` + `confidence`);
`test/shared/application/provenanceGuard.test.ts` builds a plan for every category
and fails on any empty source. Migration 4 adds `applicant_family`,
`applicant_occupation`, `visa_applications`, `application_field_values` and five
`applicant_identity` columns; `src/server/services/applicationService.ts` holds
persistence and plan assembly (pinning `kb_version` per application, recomputing
`draft ↔ ready` from the plan), and `src/server/routes/applications.ts` is the thin
HTTP layer. The React `/applications/:id` dashboard is a verification/preparation
view only — its "Start automation (Phase 5)" control is rendered disabled and inert
with no handler; there is no portal automation, form fill or submission anywhere in
this phase. See `docs/PHASE-4-REPORT.md`.

**Phase 5 (India visa browser automation):** `src/shared/automation/` is the pure
core — a run state machine (`RunStatus`, `LEGAL_TRANSITIONS`, terminal set
`review_ready` / `failed` / `aborted`), a closed 36-literal event vocabulary with
fixed non-interpolated messages, and a pure `mapFields` `FieldPlan → portal-control`
mapper; `test/automation/architectureGuard.test.ts` greps the source and fails on a
`node:` / `playwright` / `fastify` / `react` / `../server/` import. `src/server/automation/`
holds the Playwright half — condition-based control primitives (no `waitForTimeout`),
fill + read-back verification, page detection with a 0.6 confidence floor,
detect-only OTP/CAPTCHA/MFA/anti-bot checkpoint detection, the run loop, the
`AutomationService` + background runner, and the seven `/api/automation-runs`
endpoints. The engine never imports a concrete adapter — it reaches a portal only
through a `PortalAdapter` (resolved from the active portal URL via a registry); India
selectors live only under `adapters/india/` and ship as the literal string
`'TODO:discover'` (real discovery is user-driven, see `docs/portals/india.md`), both
asserted by guard tests. Migration 5 adds `automation_runs` + `automation_events`.
The loop stops at `review_ready` and has **no submit path** — enforced four ways
(`PortalAdapter.submitSelector` typed `readonly null`; a structural `return` before
any submit action; a source-grep guard test; `submitCount === 0` across every
fixture E2E). OTP / CAPTCHA / MFA / anti-bot are **human checkpoints** — the run
pauses, foregrounds the browser, and waits for `POST /resume`; nothing is solved or
bypassed. No field value is ever stored or logged. The engine is proven end-to-end
against a local fixture portal; no run has touched a real India portal. See
`docs/PHASE-5-REPORT.md`.

---

## 4. The thirteen foundation requirements → where they live

| # | Requirement | Implementation | Verified by |
|---|---|---|---|
| 1 | **Frontend application** | `src/web/` — React 18, Vite 5, React Router 6, one typed API client, no UI-component or data-fetching library | `test/web/*` (6 tests); browser walkthrough in `PHASE-0-REPORT.md` |
| 2 | **Backend / local service** | `src/server/` — Fastify 5, `buildServer({ dbPath })` factory in `app.ts`, `index.ts` binds `127.0.0.1` only | `test/server/health.test.ts`, `portalRoutes.test.ts` |
| 3 | **SQLite database** | `node:sqlite` `DatabaseSync` (see ADR-0003 — `better-sqlite3` blocked by enforced Windows code-integrity); file at `${DATA_DIR}/visa-autofill.db`; `data/` gitignored | `test/server/portalService.test.ts` "persists across a reopen" |
| 4 | **Database initialization** | `db/connection.ts` — `openDatabase(dbPath)` creates the parent dir, opens the file, sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` | `test/server/migrations.test.ts` |
| 5 | **Migration mechanism** | `db/migrations.ts` — ordered `{ version, up }[]`; `runMigrations()` reads `PRAGMA user_version`, applies each newer migration inside `BEGIN…COMMIT` (rolls back on error), bumps `user_version`; idempotent; `LATEST_SCHEMA_VERSION` exported | `migrations.test.ts` (3): reaches latest version; tables created; idempotent on re-run |
| 6 | **Health-check endpoint** | `routes/health.ts` — `GET /api/health` → `{ "status": "ok" }` | `health.test.ts` |
| 7 | **Application configuration** | `env.ts` — `.env` loaded via `process.loadEnvFile` if present, then `process.env` parsed once with a Zod schema (`NODE_ENV`, `PORT`, `DATA_DIR`, `PW_HEADLESS`, `LOG_LEVEL`); derived `DB_PATH` / `SCREENSHOT_DIR`. `.env.example` committed, `.env` gitignored, **no portal URL** | fails fast on invalid env; `.env.example` documents every var |
| 8 | **Error-handling layer** | `routes/errors.ts` (`errorBody` / `validationError` / `notFoundError`) + `services/errors.ts` (typed `PortalNotFoundError` / `PortalDisabledError`) + `app.ts` `setErrorHandler` that logs the real error and returns a sanitized `{ error: { code, message } }` (`INTERNAL` for anything unmapped) + a tolerant JSON body parser so empty/malformed bodies become a sanitized `VALIDATION_ERROR`, never a raw framework error | `portalRoutes.test.ts` (10): 400 validation, 404 mapping, 409 disabled, empty/malformed JSON → sanitized envelope |
| 9 | **Structured logger** | `logger.ts` — single `pino` instance; `redact` covers `passportNumber` / `dateOfBirth` / `address` / `mrz` / `applicant` / `password` / `token` / `authorization` / `cookie` (+ wildcards); `silent` under `NODE_ENV=test`; `pino-pretty` transport only in development | logger is `silent` in tests (asserted implicitly by clean test output); redaction paths listed in `REDACT_PATHS` |
| 10 | **Test framework** | Vitest 3, `pool: 'forks'`, `node` env by default with per-file `// @vitest-environment jsdom` for web tests; `test/helpers/` for temp DBs and a local HTTP fixture server | `npm test` → 48 tests / 12 files, all pass |
| 11 | **Type checking** | `tsconfig.json` base: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `forceConsistentCasingInFileNames`, `types: []`. `tsconfig.server.json` (NodeNext, emits `dist/`) and `tsconfig.web.json` (Bundler, `noEmit`, DOM libs) extend it. `npm run typecheck` runs both | `npm run typecheck` → exit 0 |
| 12 | **Linting** | `eslint.config.js` — flat config: `@eslint/js` recommended + `typescript-eslint` recommended + `eslint-plugin-react-hooks` for `src/web` / `test/web`; `no-unused-vars` with `^_` ignore; ignores `dist/`, `data/`, `coverage/` | `npm run lint` → exit 0, 0 warnings |
| 13 | **Development scripts** | `dev` (both processes), `dev:server`, `dev:web`, `build`, `start`, `typecheck`, `lint`, `test`, `test:watch`. Node-invoking scripts prefix `NODE_OPTIONS=--disable-warning=ExperimentalWarning` (for `node:sqlite`) and use `cross-env` for Windows | each script exercised in `PHASE-0-REPORT.md` §4 |

---

## 5. Request lifecycle (example: `POST /api/portals`)

1. `@fastify/static` (prod only) does not match `/api/*` → routing continues.
2. Content-type parser: `application/json` body parsed; empty/unparseable → `undefined`.
3. `routes/portals.ts` handler: `portalInputSchema.safeParse(req.body)`.
   - failure → `reply.code(400).send(validationError(err))` → `{ error: { code: 'VALIDATION_ERROR', message } }`.
4. success → `svc.createPortal(app.db, parsed.data)` — the service builds the row
   (`randomUUID()` id, ISO timestamps), runs the prepared `INSERT`, returns the
   mapped `VisaPortal`.
5. `reply.code(201).send({ portal })`.
6. Any thrown error → `setErrorHandler` logs it and returns
   `{ error: { code: 'INTERNAL', message: 'Internal server error' } }` with the
   error's status (or 500). Domain errors (`PortalNotFoundError`,
   `PortalDisabledError`) are caught in the handler and mapped to 404 / 409
   before they reach the generic handler.

---

## 6. Data model

`node:sqlite`, created and migrated on server start (migration 1):

```sql
CREATE TABLE visa_portals (
  id               TEXT PRIMARY KEY,           -- randomUUID()
  name             TEXT NOT NULL,
  url              TEXT NOT NULL,              -- the only runtime navigation target (spec §9a)
  portal_type      TEXT NOT NULL CHECK (portal_type IN ('regular','evisa','custom')),
  country          TEXT,
  application_type TEXT,
  notes            TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at       TEXT NOT NULL,             -- ISO 8601
  updated_at       TEXT NOT NULL
);

CREATE TABLE app_settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
-- active portal: app_settings row  key = 'active_portal_id'
```

Active portal is a settings row, not a column flag, so there is no
"exactly one active" invariant across rows. Activating a missing/disabled portal
is rejected in the service; deleting the active portal clears the setting.

To add a table or column: append a `{ version: N, up: '…' }` entry to the
`migrations` array in `db/migrations.ts`. `runMigrations` applies it on next
start; `LATEST_SCHEMA_VERSION` updates automatically.

**Phase 2:** migration 2 adds the eight normalized applicant tables (`applicants`
+ four 1:1 section tables + `applicant_travel` / `applicant_reference` +
`applicant_field_meta`, all `ON DELETE CASCADE`); `src/server/services/applicantService.ts`
and `src/shared/applicant/` hold that domain, and per-field provenance
(`source` / `confidence` / `raw_value` / `verified`) lives in `applicant_field_meta`,
keyed by `(applicant_id, field_path)` and kept separate from the canonical data in
the section tables. See `docs/PHASE-2-REPORT.md`.

**Phase 4:** migration 4 (`LATEST_SCHEMA_VERSION → 4`) adds `applicant_family` and
`applicant_occupation` (1:1 profile sections) plus five `applicant_identity`
columns, and the per-application pair `visa_applications` (one applicant → many;
pins `kb_version`) + `application_field_values` (`application.*` values +
verification, `UNIQUE(application_id, field_path)`, both `ON DELETE CASCADE`). No
profile data is copied into either application table. See `docs/PHASE-4-REPORT.md`.

**Phase 5:** migration 5 (`LATEST_SCHEMA_VERSION → 5`) adds `automation_runs`
(one `visa_applications` row → many; `status` CHECK excludes any `completed` /
`submitted` value; `waiting_reason` CHECK; required-only progress counters;
sanitized `error_code` / `error_message`) + `automation_events` (`run_id`
`ON DELETE CASCADE`, `UNIQUE(run_id, seq)`, `type` from the closed vocabulary,
`field_path` is the canonical `appliesTo` identifier and `message` from the fixed
`EVENT_MESSAGES` set — **neither table has a column for a field value**). An
optional relative `evidence_path` (screenshots, off by default, under a gitignored
`data/automation/`) is the only file reference. See `docs/PHASE-5-REPORT.md`.

---

## 7. Configuration reference

`.env` (optional; copy from `.env.example`) — **never contains a portal URL**.

| Var | Type / default | Used for |
|---|---|---|
| `NODE_ENV` | `development` \| `production` \| `test` (def. `development`) | logger level & transport; prod static serving |
| `PORT` | positive int (def. `5174`) | Fastify listen port (loopback) |
| `DATA_DIR` | string (def. `data`) | resolved to abs path; holds the DB and screenshots |
| `PW_HEADLESS` | `true` \| `false` (def. `true`) | Test Connection browser visibility (Phase 0 feature) |
| `LOG_LEVEL` | pino level (def. `info`) | logger level when not `test` |

Derived (not from env): `DB_PATH = ${DATA_DIR}/visa-autofill.db`,
`SCREENSHOT_DIR = ${DATA_DIR}/screenshots`.

Invalid or out-of-enum values make `env.ts` throw at startup (fail fast).

---

## 8. Security & privacy posture (foundation)

- **Loopback only.** `app.listen({ host: '127.0.0.1' })`. There is no flag to
  bind `0.0.0.0`.
- **No secrets in source.** `.env` and `data/` are gitignored; `.env.example`
  holds placeholders only.
- **Sanitized errors.** Clients only ever see `{ error: { code, message } }`;
  stack traces and internal paths go to the server log exclusively.
- **PII-aware logging from day one.** `logger.REDACT_PATHS` already covers the
  fields later phases will handle (passport number, DOB, address, MRZ, …), plus
  request `authorization` / `cookie` headers. The foundation itself stores and
  logs no applicant data.
- **No portal URL anywhere in code.** Enforced by
  `test/automation/noHardcodedUrl.test.ts` (fails the build on a URL literal in
  the engine or a known government-visa hostname in `src/`).

---

## 9. Explicitly NOT in the foundation

- **OCR / document extraction** — not present.
- **Portal-specific visa adapters / selectors** — only the generic, inspect-only
  `genericAdapter` and an (empty) adapter registry exist.
- **Extended browser automation** — the Phase 0 navigate-only Test Connection is
  present and isolated under `src/server/automation/` (ADR-0004); this phase does
  not extend it. No form fill, no click, no submit, no CAPTCHA/OTP/MFA handling.
- **Applicant profile model, verification UI, multi-page form fill, Electron/CLI
  packaging** — later phases.

---

## 10. How to verify the foundation

```bash
npm install                 # deps resolve; node:sqlite is built in
npm run typecheck           # tsc server + web, strict — exit 0
npm run lint                # eslint flat config — exit 0, 0 warnings
npm test                    # vitest run — 48 tests / 12 files pass
npm run build               # vite build → dist/web ; tsc → dist/server — exit 0
npm start                   # prod server on 127.0.0.1:5174 ; GET /api/health → {"status":"ok"}
```

Test inventory (12 files, 48 tests) is enumerated in `docs/PHASE-0-REPORT.md` §3.

---

## 11. Known issues & recommendations

### Dependency advisories (`npm audit` — 5 open, all requiring a major bump)

| Severity | Package | Advisory | Real-world exposure here | Recommendation |
|---|---|---|---|---|
| HIGH | `@fastify/static` `<=10.1.1` (direct, `^8`) | path traversal in directory listing; route-guard bypass via encoded separators / non-canonical paths | **Low.** Serves only built public assets from `dist/web`, `wildcard:false` (no listing), no auth/route guards to bypass, bound to `127.0.0.1`, single local user. | Bump to `@fastify/static@^10.1.3` (needs Fastify ≥5 — already satisfied); re-run gates + prod static smoke. Small, isolated usage (`register` + `reply.sendFile`). |
| HIGH / MODERATE | `vite` `<=6.4.2` + transitive `esbuild` `<=0.24.2` (dev only) | a malicious website can make the **dev server** answer cross-origin requests | **Dev-only.** Not in the production path (`npm start` uses `@fastify/static`, no Vite). Requires running `npm run dev` while visiting a hostile page. | Plan a `vite@8` upgrade (breaking: config + plugin-react majors). Not urgent for a local single-dev setup. |
| MODERATE | `react-router` / `react-router-dom` `6.x` (direct, `^6.26.0`) | DOM-based issues in SSR/loader patterns | **Low.** The app uses plain client-side `createBrowserRouter` with static routes, no loaders/actions/SSR. | Migrate to `react-router-dom@7` as a dedicated task (well-documented codemod path). |

None of these block the foundation and none are fixed by a non-breaking bump, so
they are left for a scoped dependency-upgrade task rather than changed here.
`uuid` (unused, carried a moderate advisory) **was removed** from `package.json`
during this verification — the code uses `node:crypto`'s `randomUUID`.

### Other

- `node:sqlite` emits an `ExperimentalWarning` on import (suppressed in the npm
  scripts) and `DatabaseSync.close()` throws on double-close.
- `deletePortal` is a non-transactional check-then-act — safe for a single-user
  local app; revisit if concurrent writers ever appear.
- The delete confirmation uses `window.confirm` (blocks the event loop briefly).
- No favicon is shipped (`GET /favicon.ico` → 404) — cosmetic.
