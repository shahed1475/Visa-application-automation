# Phase 0 — Configurable Visa Portal Settings Foundation

**Date:** 2026-09-02
**Status:** Approved (design + acceptance checklist)
**Project:** Visa Application Autofill (local-first)

---

## 1. Purpose & Scope

Build the application skeleton and a **configurable Visa Portal Settings**
system. This is the foundation every later phase builds on.

**In scope (Phase 0):**

- Node.js + Fastify backend, SQLite persistence, React + Vite frontend.
- One `npm run dev` command starts the complete local application.
- CRUD for visa portal configurations, persisted in SQLite.
- Select an active portal; active selection persists across restarts.
- URL validation (must be a valid `http:`/`https:` URL).
- **Test Connection**: launch Playwright, navigate to the configured URL,
  report basic page facts. Navigate-only, report-only.
- Shared, portal-agnostic browser engine separated from portal-specific
  adapter/selector configuration.
- Automated tests, typecheck, lint, build.

**Explicitly out of scope (later phases):**

- Document upload, OCR / document extraction.
- Applicant profile data model and verification UI.
- Real visa-form automation, page adapters for specific portals,
  multi-page form fill, field verification, dynamic dropdown handling.
- Electron packaging, CLI.
- Authentication into portals, account creation flows.

## 2. Engineering Constraints (from master instructions)

- Local-first. Minimize permissions and external data transmission.
- No hard-coded government portal URL anywhere in the automation engine.
- Passport / applicant data is highly sensitive: never logged, never in
  error messages. (No such data exists yet in Phase 0, but the redaction
  infrastructure is established now.)
- Test Connection must **never** submit a form and must **never** attempt
  to solve or bypass CAPTCHA, OTP, MFA, or other security controls.
- CAPTCHA / OTP / MFA / anti-bot challenges are detected and reported,
  then handed to the user. Never automated.
- Final submission (later phases) stays explicitly user-controlled.
- Prefer simple, maintainable code. No unnecessary dependencies.
- Do not claim complete until tested. Run tests, review the diff.

## 3. Architecture

### 3.1 Runtime shape

```
npm run dev
  ├─ Fastify API server (Node process)  — port from .env, default 5174
  │    ├─ SQLite (better-sqlite3)        — data/visa-autofill.db
  │    └─ Playwright (Chromium)          — spawned on demand for Test Connection
  └─ Vite dev server (React UI)          — port 5173, proxies /api → Fastify
```

Production-ish build: `vite build` emits static assets; Fastify serves them
plus `/api`. Single origin, no CORS needed in that mode.

### 3.2 Repository layout

```
visa-autofill/
  package.json               # scripts: dev, build, start, typecheck, lint, test
  tsconfig.json              # base; tsconfig.server.json / tsconfig.web.json extend
  vite.config.ts
  .eslintrc.cjs
  .env.example               # PORT, DATA_DIR, PW_HEADLESS
  .gitignore                 # node_modules, data/, .env, dist/, coverage/
  docs/superpowers/specs/    # this document
  docs/architecture/         # ADRs (see §9)
  src/
    shared/
      types.ts               # VisaPortal, ConnectionTestResult, ApiError, ...
      schemas.ts             # zod schemas, single source of validation truth
    server/
      index.ts               # Fastify bootstrap, route registration, static serve
      env.ts                 # parse + validate process.env once
      logger.ts              # pino instance + redaction config
      db/
        connection.ts        # open better-sqlite3, apply pragmas
        migrations.ts        # ordered migration list + runner (PRAGMA user_version)
      services/
        portalService.ts     # CRUD + active-portal read/write, pure DB logic
      routes/
        portals.ts           # REST handlers, zod validation, error mapping
        health.ts            # GET /api/health
      automation/
        engine/
          browserManager.ts  # Playwright browser lifecycle (portal-agnostic)
          pageInspector.ts   # generic DOM inspection + screenshot + redaction
        adapters/
          baseAdapter.ts     # PortalAdapter interface
          genericAdapter.ts  # default adapter: generic inspection only
          registry.ts        # resolve adapter for a portal (Phase 0: always generic)
        discovery/
          testConnection.ts  # orchestrates navigate-only connection test
    web/
      index.html
      src/
        main.tsx
        App.tsx              # router
        api/client.ts        # thin fetch wrapper, typed via shared/
        pages/
          Settings/
            PortalsPage.tsx        # list + actions
            PortalForm.tsx         # create / edit
            TestConnectionPanel.tsx # runs test, renders ConnectionTestResult
        components/          # small shared UI bits
        styles.css
  test/
    server/portalService.test.ts
    server/schemas.test.ts
    server/migrations.test.ts
    automation/testConnection.test.ts   # against a local fixture server
    fixtures/fake-portal.html
```

### 3.3 Why this shape

- **`src/shared/`** — one definition of `VisaPortal` and its zod schema,
  imported by both server and web. No drift between client and server
  validation.
- **engine vs adapters** — `browserManager` / `pageInspector` know nothing
  about any specific portal. All portal-specific knowledge (URL, later:
  selectors, step maps) lives in the DB config and, later, in an adapter
  module resolved by `registry.ts`. Satisfies "portal-specific
  configuration separated from the shared engine" and "no hard-coded URL".
- **services vs routes** — `portalService` is pure DB logic, unit-tested
  without HTTP. Routes only validate, call the service, map errors.
- **single package** — simplest thing that works. Electron/CLI can be
  added later by wrapping `src/server` without moving files.

## 4. Data Model

SQLite, created and migrated on server start.

```sql
-- migration 1
CREATE TABLE visa_portals (
  id               TEXT PRIMARY KEY,          -- uuid v4
  name             TEXT NOT NULL,
  url              TEXT NOT NULL,
  portal_type      TEXT NOT NULL,             -- 'regular' | 'evisa' | 'custom'
  country          TEXT,
  application_type TEXT,
  notes            TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1, -- 0/1
  created_at       TEXT NOT NULL,             -- ISO 8601
  updated_at       TEXT NOT NULL
);

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- active portal stored as app_settings row: key='active_portal_id'
```

Pragmas on open: `journal_mode = WAL`, `foreign_keys = ON`.

**Active portal as a settings row**, not a boolean column, so there is no
"exactly one active" invariant to enforce across rows. Setting a
non-existent / disabled portal active is rejected at the service layer.
Deleting the active portal clears the setting.

## 5. Validation Rules (zod, in `src/shared/schemas.ts`)

`portalInputSchema`:

| Field            | Rule |
|------------------|------|
| name             | trimmed, 1–120 chars, required |
| url              | parses via `new URL()`, protocol `http:` or `https:`, ≤ 2048 chars |
| portal_type      | enum `regular` \| `evisa` \| `custom` |
| country          | optional, ≤ 100 chars |
| application_type | optional, ≤ 100 chars |
| notes            | optional, ≤ 2000 chars |
| enabled          | boolean, default `true` |

Invalid protocol (e.g. `ftp://`, `javascript:`, bare `example.com`) →
`400` with a clear message, no portal written.

## 6. API

Base path `/api`. JSON in/out. All responses on error:
`{ "error": { "code": string, "message": string } }` — sanitized, no stack
traces, no internal paths.

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/health` | `{ status: 'ok' }` |
| GET    | `/api/portals` | list all portals (newest first) |
| POST   | `/api/portals` | create; body = `portalInputSchema` |
| GET    | `/api/portals/:id` | one portal; 404 if missing |
| PUT    | `/api/portals/:id` | update; body = `portalInputSchema` |
| DELETE | `/api/portals/:id` | delete; clears active if it was active |
| GET    | `/api/settings/active-portal` | `{ activePortalId: string \| null, portal: VisaPortal \| null }` |
| PUT    | `/api/settings/active-portal` | body `{ portalId: string \| null }`; 400 if portal missing or disabled |
| POST   | `/api/portals/:id/test-connection` | run Test Connection against that portal's URL |

Error codes: `VALIDATION_ERROR`, `NOT_FOUND`, `PORTAL_DISABLED`,
`CONNECTION_TEST_FAILED`, `INTERNAL`.

## 7. Test Connection

`POST /api/portals/:id/test-connection`

**Steps:**

1. Load portal config from DB (URL comes from DB — never a constant).
2. `browserManager.launch()` — Chromium, `headless` from `PW_HEADLESS`
   (default `true`). Fresh context, no stored state, no credentials.
3. `page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })`.
4. `pageInspector.inspect(page, response)` collects:
   - `httpStatus` (from navigation response, may be null)
   - `pageTitle`
   - `finalUrl` (after redirects)
   - `redirected` (bool) + `redirectChain` (list of URLs, best effort)
   - `elementCounts`: forms, inputs (by type where cheap), selects,
     radios, checkboxes, date inputs, file inputs, buttons, links
   - `securityChallengeFlags`: booleans for reCAPTCHA / hCaptcha /
     Turnstile / Cloudflare interstitial / generic `otp`|`mfa` text —
     **detection only, reported to the user**
   - `screenshotPath`: one full-page PNG in `data/screenshots/`
5. `browserManager.close()`.
6. Return `ConnectionTestResult`:
   ```ts
   {
     success: boolean,
     url: string,
     httpStatus: number | null,
     pageTitle: string | null,
     finalUrl: string | null,
     redirected: boolean,
     redirectChain: string[],
     elementCounts: Record<string, number>,
     securityChallengeFlags: Record<string, boolean>,
     screenshotPath: string | null,
     durationMs: number,
     error?: { code: string, message: string }   // sanitized on failure
   }
   ```

**Hard prohibitions (enforced by having no such code paths):**

- No `page.fill`, `page.type`, `page.click` on form controls.
- No `form.submit()`, no submit-button clicks.
- No CAPTCHA/OTP/MFA solving, no third-party solver calls, no automation
  of any challenge. Flags are surfaced in the UI with a note that the
  user handles these manually in later phases.

**Failure handling:** DNS failure, TLS error, timeout, navigation error →
`success: false` with a sanitized `error` message (host + reason category,
no raw internal stack). Screenshot attempted on a best-effort basis.

## 8. Security & Privacy Infrastructure (established now)

- **Logger**: single pino instance. `redact` configured for keys that
  will matter later (`passportNumber`, `dateOfBirth`, `address`,
  `documentText`, `mrz`, `applicant`, `password`, `authorization`,
  `cookie`) plus a rule to never log full request bodies for portal
  writes at info level. Phase 0 carries no applicant data; this is
  groundwork so later phases inherit safe defaults.
- **Secrets**: only in `.env` (gitignored). `.env.example` committed with
  placeholder values. No secrets in source.
- **Filesystem**: `data/` (DB + screenshots) is gitignored.
- **Network**: server binds `127.0.0.1` only. Playwright makes exactly one
  outbound navigation per Test Connection, to the user-configured URL.
- **Error surface**: client-facing errors are mapped through a small
  sanitizer; internal detail goes to the server log only.

## 9. Architectural Decision Records

Written to `docs/architecture/` as short ADRs during implementation:

- ADR-0001: Local web app (Fastify + Vite) over Electron for Phase 0.
- ADR-0002: Portal URL and config in SQLite, never in code; engine is
  portal-agnostic; adapters resolved via registry.
- ADR-0003: `better-sqlite3` for persistence (synchronous, simple,
  well-supported); migration runner is hand-rolled via `user_version`.
- ADR-0004: Test Connection is navigate-only / report-only by design;
  security challenges are detected and delegated to the user.

## 10. Testing Strategy

| Area | Tool | What |
|------|------|------|
| Schema validation | Vitest | valid input passes; `ftp://`, `javascript:`, bare host, over-length all rejected |
| portalService CRUD | Vitest | create/read/update/delete against a temp SQLite file; timestamps set; delete clears active |
| active portal | Vitest | set/get; rejecting missing or disabled portal; cleared on delete |
| migrations | Vitest | fresh DB reaches expected `user_version`; runner is idempotent |
| Test Connection | Vitest + Playwright | local fixture HTTP server serves `test/fixtures/fake-portal.html`; assert title, finalUrl, element counts, screenshot created; a redirect fixture; a 404 path; assert **no** fill/submit occurs |
| API routes | Vitest + `fastify.inject()` | happy path + validation errors + 404 mapping |

No real government portal is contacted in automated tests.

Scripts:

- `npm run dev` — concurrently: `tsx watch src/server/index.ts` + `vite`
- `npm run build` — `vite build` + `tsc -p tsconfig.server.json`
- `npm start` — run built server (serves built UI)
- `npm run typecheck` — `tsc --noEmit` across configs
- `npm run lint` — eslint
- `npm test` — vitest run

## 11. Dependencies

**Runtime:** `fastify`, `@fastify/static`, `better-sqlite3`, `playwright`,
`zod`, `pino`, `uuid`, `react`, `react-dom`, `react-router-dom`.

**Dev:** `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`,
`@types/*`, `eslint` + minimal config, `tsx`, `concurrently`,
`pino-pretty` (dev log formatting only).

No ORM, no migration library, no UI component library, no data-fetching
library. `better-sqlite3` is a native module — implementation verifies it
builds on Node 24 / Windows; documented fallback is Node's built-in
`node:sqlite`.

## 12. Acceptance Checklist

Phase is complete only when all are true:

- [ ] `npm run dev` starts the local application successfully.
- [ ] React/Vite UI loads in the browser.
- [ ] Fastify API responds successfully.
- [ ] SQLite database initializes and persists data.
- [ ] User can create a Visa Portal configuration.
- [ ] User can edit and delete a portal configuration.
- [ ] User can select an active portal.
- [ ] Portal URL is stored in SQLite and loaded at runtime.
- [ ] No visa portal URL is hard-coded in the automation engine.
- [ ] Test Connection successfully launches Playwright and navigates to the configured URL.
- [ ] Test Connection reports useful basic results such as page title and final URL.
- [ ] Test Connection never submits a visa application.
- [ ] CAPTCHA/OTP/MFA/security challenges are not bypassed.
- [ ] Portal-specific selectors/configuration are separated from the shared browser engine.
- [ ] Restarting the application does not lose saved portal settings.
- [ ] Typecheck/lint/tests/build pass, or any failures are clearly documented.
- [ ] Git diff has been reviewed for unintended changes.
- [ ] Claude reports exactly what was implemented, tested, and any remaining limitations.

**Do not mark the phase complete if any required checkbox fails.**

## 13. End-of-Phase Report Format

1. What was implemented
2. Files changed
3. Tests executed
4. Test results
5. Remaining issues / limitations
6. Recommended next phase

## 14. Recommended Next Phase (preview, not part of Phase 0)

Phase 1 — Document upload + extraction: passport image/PDF upload, local
MRZ / OCR extraction, structured applicant profile draft, stored in
SQLite, no portal interaction.
