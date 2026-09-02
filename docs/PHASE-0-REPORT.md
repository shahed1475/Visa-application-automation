# Phase 0 — End-of-Phase Report

**Project:** Visa Application Autofill (local-first)
**Phase:** 0 — Configurable Visa Portal Settings Foundation
**Date:** 2026-09-02
**Branch:** `phase-0-portal-settings`
**Final commit:** this ADRs + README + report commit (HEAD of `phase-0-portal-settings`); last code commit `12476fd`
**Overall status: PASS**

---

## 1. What was implemented

A local-only application skeleton plus a fully persistent, configurable **Visa
Portal Settings** system and a navigate-only **Test Connection**. No visa-form
automation.

- **App skeleton** — Fastify 5 API (loopback only) + Vite 5 / React 18 SPA.
  `npm run dev` runs both with hot reload; `npm run build && npm start` runs the
  production shape where Fastify serves the built UI with an `index.html` SPA
  fallback and JSON `404`s for `/api/*`.
- **Persistence** — `node:sqlite` `DatabaseSync` (WAL, foreign keys on) with a
  hand-rolled `PRAGMA user_version` migration runner. Tables: `visa_portals`,
  `app_settings`. (Plan Amendment 01: `better-sqlite3` → `node:sqlite`, because
  enforced Windows code-integrity blocks native addons.)
- **Shared contract** — `src/shared/`: `VisaPortal` / `ConnectionTestResult` /
  `ApiError` types, `isHttpUrl()`, and the Zod `portalInputSchema` /
  `activePortalSchema` used by both server and client.
- **Portal service** (`portalService.ts`) — pure DB logic: create / list /
  get / update / delete portals; get / set / clear active portal; activating a
  missing or disabled portal throws; deleting the active portal clears it.
- **REST API** (`/api`) — `GET/POST /portals`, `GET/PUT/DELETE /portals/:id`,
  `GET/PUT /settings/active-portal`, `POST /portals/:id/test-connection`,
  `GET /health`. All errors sanitized to `{ error: { code, message } }`.
- **Automation engine** — `BrowserManager` (single owned Chromium lifecycle),
  `inspectPage` (portal-agnostic, read-only DOM snapshot + boolean
  security-challenge flags), `PortalAdapter` interface + `genericAdapter` +
  `resolveAdapter(url)` registry (Phase 0 always generic).
- **Test Connection** — `runConnectionTest(url, deps?)`: fresh context, no
  credentials, `page.goto(domcontentloaded, 30s)`, inspect, full-page
  screenshot to `data/screenshots/`, sanitized failure codes. **No fill / type /
  click / submit / CAPTCHA / OTP / MFA code exists.**
- **Frontend** — typed `api` client; `PortalsPage` (list, active radio, row
  actions, empty state); `PortalForm` (create/edit, client-side `http(s)` +
  required-name validation); `TestConnectionPanel` (renders the result, states
  it never fills/submits/solves challenges).
- **§9a guard** — `test/automation/noHardcodedUrl.test.ts` fails the build if a
  URL literal appears in the automation engine or a known government-visa
  hostname appears anywhere in `src/`.
- **Docs** — 4 ADRs, README, this report; the portal-agnostic
  `visa-form-analysis.md` and `automation-risks.md` frameworks (pre-existing,
  reviewed for consistency).

### Bug found and fixed during acceptance (commit `12476fd`)

`POST /api/portals/:id/test-connection` failed from the UI with "Internal server
error". The API client sent `content-type: application/json` on body-less POSTs,
so Fastify's stock parser returned `FST_ERR_CTP_EMPTY_JSON_BODY` — an
**unsanitized** envelope, also a spec §6/§8 violation. Fixed on both sides:
the client only sets the JSON content-type when there is a body; the server has a
JSON parser that treats an empty/unparseable payload as "no body" so route Zod
validation returns the normal sanitized `VALIDATION_ERROR`. +7 regression tests.

---

## 2. Files changed

Full Phase 0 diff vs. the repo root: **59 files, ~13,550 insertions** (includes
the spec/plan/framework docs authored before implementation).

Phase 0 commits (newest first):

| Commit | Summary |
|--------|---------|
| `12476fd` | fix: body-less JSON requests no longer break Test Connection or leak parser errors |
| `34c50b2` | feat: serve built UI from Fastify in production with SPA fallback |
| `782366f` | feat: portal create/edit form and Test Connection result panel |
| `d19d03e` | feat: portals list page with active selection and typed API client |
| `e2952dd` | feat: navigate-only Test Connection with adapter registry and single-source-of-truth URL |
| `d1e843a` | feat: Playwright browser manager + generic page inspector + no-hardcoded-URL audit |
| `bb356f9` | feat: portal REST + active-portal routes with sanitized errors |
| `26da9fc` | fix: order listPortals by rowid tiebreaker for deterministic sort |
| `093f8fb` | docs: Amendment 01 — note DatabaseSync.close() throws on double-close |
| `df05b0b` | feat: portal service — CRUD plus active-portal selection in SQLite |
| `defd3ae` | feat: SQLite connection helper and user_version migration runner |
| `501bd3b` | feat: shared VisaPortal types, http-url guard, and portal input schema |
| `8b3d9c6` | docs: Amendment 01 — set engines to node >=24 |
| `ef153b0` | docs: Amendment 01 — ratify vitest ^3 bump |
| `1d74ac0` | feat: scaffold Fastify + Vite + SQLite app skeleton with health endpoint |
| `5b6e2c5` | docs: Plan Amendment 01 — swap better-sqlite3 for node:sqlite |
| `605bb60` | chore: gitignore .superpowers SDD scratch |
| `031f3c5` | docs: portal-agnostic visa-form analysis framework and automation risk register |
| `067d339` / `b373f86` / `fd96056` | docs: spec, SSOT audit, implementation plan |
| _(this)_ | docs: Phase 0 ADRs, README, and end-of-phase verification report |

Key source files: `src/server/{app,index,env,logger}.ts`,
`src/server/db/{connection,migrations}.ts`,
`src/server/services/{errors,portalService}.ts`,
`src/server/routes/{errors,health,portals}.ts`,
`src/server/automation/{engine/browserManager,engine/pageInspector,adapters/*,discovery/testConnection}.ts`,
`src/shared/{url,types,schemas}.ts`,
`src/web/src/**` (client, PortalsPage, PortalForm, TestConnectionPanel, styles),
`docs/architecture/ADR-0001..0004.md`, `README.md`.

Nothing outside Phase 0 scope was changed. No `.env`, `data/`, or `dist/`
committed (all gitignored). No `console.log` / debug code in `src/`.

---

## 3. Tests executed

`npm test` — Vitest 3, `pool: forks`. **12 files, 48 tests.**

| File | Tests | Covers |
|------|------:|--------|
| `test/server/schemas.test.ts` | 7 | `isHttpUrl`; `portalInputSchema` (http-only, trim, blank→null, enum, defaults) |
| `test/server/migrations.test.ts` | 3 | fresh DB → `LATEST_SCHEMA_VERSION`; tables created; idempotent |
| `test/server/portalService.test.ts` | 8 | CRUD; newest-first; `updatedAt` bump; delete clears active; reject missing/disabled active; persists across reopen |
| `test/server/portalRoutes.test.ts` | 10 | happy path; 400 validation; 404 mapping; PUT/DELETE; active-portal set/get/409; restart persistence; **§9a target follows saved URL**; **body-less / empty / malformed JSON → sanitized envelope** |
| `test/server/health.test.ts` | 1 | `GET /api/health` |
| `test/server/staticServing.test.ts` | 3 | prod serves `index.html` at `/`; SPA fallback for unknown non-`/api`; JSON 404 for unknown `/api` |
| `test/automation/pageInspector.test.ts` | 1 | title, element counts, recaptcha flag against a fixture |
| `test/automation/testConnection.test.ts` | 5 | exact-URL navigation + basics; **URL change → target change, no code change (§9a)**; GET-only / never submits; redirect final URL; sanitized unreachable-host failure |
| `test/automation/noHardcodedUrl.test.ts` | 2 | no URL literal in `src/server/automation`; no known gov-visa host in `src/` |
| `test/web/PortalsPage.test.tsx` | 2 | renders list from API; empty state |
| `test/web/PortalForm.test.tsx` | 2 | blocks submit on non-http URL; submits a valid portal |
| `test/web/apiClient.test.ts` | 4 | body-less requests send no JSON content-type; DELETE carries no body; bodied requests do; throws server error message on non-2xx |

Also run: `npm run typecheck`, `npm run lint`, `npm run build`, and manual
production + development runtime smokes and a full real-browser acceptance
walkthrough (Playwright-driven).

---

## 4. Test results

```
npm run typecheck   → PASS  (tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.web.json), exit 0
npm run lint        → PASS  (eslint .), exit 0, 0 warnings
npm test            → PASS  Test Files 12 passed (12) | Tests 48 passed (48)
npm run build       → PASS  vite build (40 modules) → dist/web; tsc -p tsconfig.server.json → dist/server, exit 0
```

Non-fatal noise: react-router-dom v6 future-flag warnings on stderr in web
tests; `node:sqlite` `ExperimentalWarning` (suppressed in npm scripts); pino
request logs in the production-mode `staticServing` test.

### Runtime verification

**Production** (`npm run build && npm start`, plain `node dist/server/index.js`):
- Boots `Server listening at http://127.0.0.1:5174` (loopback only).
- `GET /` → 200, built `index.html` (`<title>Visa Autofill</title>`, hashed asset).
- `GET /assets/index-*.js` → 200 `application/javascript`.
- `GET /settings/portals` → 200, byte-identical to `/` (SPA fallback).
- `GET /api/health` → `{"status":"ok"}`; `GET /api/nope` → 404 JSON `NOT_FOUND`.
- Portal CRUD + active-portal round-trips succeed and persist.
- `ftp://` URL → 400 `VALIDATION_ERROR`.
- Empty / malformed JSON body → 400 sanitized `VALIDATION_ERROR` (no framework leak).
- Missing-build guard: with `dist/web` absent, `node dist/server/index.js`
  (production) exits 1 with `Production build not found … Run "npm run build"`.
- Test Connection against a local fixture and against `https://example.com`
  (foreground) → `success: true`, HTTP 200, title, `finalUrl` == configured URL,
  element counts, `securityChallengeFlags` all false, screenshot PNG written
  (1280×720).

**Development** (`npm run dev`): Vite on `localhost:5173`, `/api` proxied to
Fastify `5174`; `GET /`, `/api/health`, and deep route `/settings/portals` all
200; HMR picked up the client fix live.

### Real-browser acceptance walkthrough (Playwright-driven, against prod `:5174`)

| Step | Result |
|------|--------|
| App starts, UI loads, empty state shown (no seed data) | PASS |
| `not-a-url` and `ftp://x` rejected inline, nothing saved | PASS |
| Create portal (name, `http://127.0.0.1:4700/`, type, country) → appears in list | PASS |
| Edit portal — change name + type, other fields preserved | PASS |
| Set active (radio) → indicator + "Clear active portal" + Test Connection panel appear | PASS |
| Run Test Connection → **Reachable**, HTTP 200, title "Final Check Portal", Final URL == configured URL, Redirected No, element counts, "None detected", screenshot path, 258 ms | PASS |
| Screenshot PNG exists on disk under `data/screenshots/` | PASS |
| Kill + restart server → portal AND active selection survive | PASS |
| Delete portal (confirm dialog) → removed, active selection cleared | PASS |
| Production static serving in browser | PASS |
| Development serving in browser | PASS |

---

## 5. §9a — Portal URL single-source-of-truth audit

| Check | Result |
|-------|--------|
| Saved `visa_portals.url` (active row) is the runtime source of truth | **PASS** — `runConnectionTest(url)` takes the target only as a parameter; the route passes `portal.url` from the DB row; no default, no `||`-fallback, no constant. |
| Changing the saved URL changes the Test Connection target with no code change | **PASS** — `test/automation/testConnection.test.ts` "changing the URL changes the target with no code change (spec §9a)"; `test/server/portalRoutes.test.ts` "test-connection targets whatever URL is saved"; reproduced in the browser walkthrough (`finalUrl` matched the configured URL exactly for two different targets). |
| No hidden/default Indian visa URL in runtime code | **PASS** — `grep -rniE "https?://[a-z0-9.-]+" src/` excluding loopback/example/w3/font/captcha hosts → **no matches**. Only http(s) literal in `src/` is `placeholder="https://…"` in `PortalForm.tsx` (a UI ellipsis, not a URL). |
| No hidden/default portal URL in tests, fixtures, constants, env defaults | **PASS** — fixtures are ephemeral `127.0.0.1:<random>` servers; `.env.example` carries **no** portal URL and an explicit warning comment; no constants module holds a URL. The strings `indianvisaonline` / `visa*.gov` appear only inside the audit regex in `noHardcodedUrl.test.ts` and the plan. |
| Example URLs in docs cannot silently become runtime targets | **PASS** — README's example block is labelled "illustration only — **not a default**, nothing is pre-loaded"; Phase 0 ships no seed data; the portal list starts empty (verified in the walkthrough). |
| Static guard enforced in CI | **PASS** — `test/automation/noHardcodedUrl.test.ts` (2 tests) fails the build on a URL literal in the engine or a gov-visa host anywhere in `src/`. |

**No additional regression test needed** — the two existing SSOT tests plus the
static guard cover the requirement. (The acceptance bug fix added coverage for
the request-shape edge that was breaking the feature end-to-end.)

---

## 6. §9a — Manual automation-risk audit (findings)

Reviewed the whole implementation against the checklist. Severity: **none of
these block Phase 0.**

| Area | Finding | Severity |
|------|---------|----------|
| Hard-coded selectors | None. `inspectPage` uses only generic tag/`type` selectors for counting; no id/class/xpath tied to any portal. `genericAdapter` holds no selectors. | — |
| Hard-coded portal URLs | None in runtime code, tests, fixtures, env. (See §5.) | — |
| Unsafe page-structure assumptions | `inspectPage` only counts elements and scans lowercased HTML for challenge markers; it never asserts a structure or acts on one. Nothing depends on a specific DOM shape. | — |
| Hidden submission paths | None. No route, service, or engine function submits anything. The only `<form onSubmit>` is `PortalForm` (portal config), which calls `api.createPortal` / `api.updatePortal`. | — |
| Accidental form submission | Not possible — the engine has no `page.fill/type/click`, no `form.submit`, no submit-button click. `test/automation/testConnection.test.ts` asserts the fixture only ever receives `GET`. | — |
| CAPTCHA / security-control bypass | None. Challenges are detected as booleans and reported; there is no solver, no third-party service, no evasion. | — |
| OTP / MFA automation | None. No OTP retrieval, no code entry, no MFA handling anywhere. | — |
| Sensitive-data logging | pino `redact` configured for passport/DOB/address/MRZ/applicant/password/token/cookie/authorization paths; logger `silent` in tests. No applicant data exists in Phase 0. Screenshots capture only the public landing page (no filled fields, by construction). | Low (groundwork; revisit when applicant data lands) |
| Unsafe persistence | WAL + `foreign_keys=ON`; migrations are transactional and `user_version`-gated; `data/` gitignored. `deletePortal` does a sequential check-then-act (no transaction) — safe for a single-user local app; noted for future multi-writer scenarios. | Low |
| Brittle Playwright assumptions | `waitUntil: 'domcontentloaded'` + 30 s timeout; redirect chain reconstructed best-effort; screenshot best-effort (`.catch(() => false)`); `BrowserManager` re-launches if `!isConnected()`. Single-shot, no retry — acceptable for a probe. | Low |
| Portal-specific logic in shared code | None. `browserManager` / `pageInspector` know nothing about any portal; the only adapter is `genericAdapter`. Registry is empty of portal adapters. | — |
| Improper error handling | Route errors, unknown routes, and JSON-parse failures all resolve to `{ error: { code, message } }`; `setErrorHandler` maps anything else to `INTERNAL`. **The one gap found (raw `FST_ERR_CTP_EMPTY_JSON_BODY` on body-less JSON) was fixed in `12476fd`** and is regression-tested. | Fixed |
| Unsafe browser lifecycle | `runConnectionTest` owns its `BrowserManager` when none is injected and always `close()`s it in `finally`; context is closed in an inner `finally`. No leaked browser on the success or failure path. | — |

---

## 7. Remaining issues / limitations

- **Test Connection is a single shot** with a 30 s navigation timeout and no
  retry — a reachability probe, not a monitor.
- **External navigation from a background/sandboxed server process** was
  intermittently blocked in the CI-like environment used for this walkthrough
  (foreground `runConnectionTest` and the built `npm start` server both reached
  `https://example.com` successfully; a detached background server sometimes
  timed out). This is an environment network policy, not a code defect — the
  local-fixture and foreground paths prove the feature.
- **No end-to-end browser test in CI** — the UI walkthrough is manual
  (Playwright-driven, documented here). Component behaviour is covered by the
  jsdom tests.
- **`node:sqlite`** emits an `ExperimentalWarning` (suppressed in scripts) and
  `DatabaseSync.close()` throws on double-close.
- **`deletePortal`** is a non-transactional check-then-act (fine for single-user
  local use).
- **`window.confirm`** is used for delete confirmation (blocks the event loop;
  acceptable for a local tool, replaceable with an in-app modal later).
- Minor: the browser requests `/favicon.ico` (404, no favicon shipped) — cosmetic.
- Production request logging is not silenced (no applicant data exists to leak).

---

## 8. Browser / discovery verification & security-boundary result

- **No real visa portal was configured or contacted.** The portal list ships
  empty; discovery of a specific portal begins only when the user saves and
  activates a portal URL in Settings.
- Test Connection was exercised against **local HTTP fixtures** and (foreground)
  against **`https://example.com`** (RFC 2606 reserved example domain — not a
  visa portal, not hard-coded).
- **Security boundary:** the automation is navigate-and-observe only. For the
  example targets there was no registration / login / OTP / CAPTCHA / MFA /
  anti-bot wall to reach. The mechanism that *would* stop at one is verified
  present: `securityChallengeFlags` are detected and surfaced to the user, and
  the engine contains **no code** to fill, click, submit, authenticate, retrieve
  an OTP, or solve/bypass a challenge. For a real portal the boundary is
  explicit: the tool loads the public landing page, reports what it sees
  (including any detected challenge), and stops.

---

## 9. Deferred to Phase 1 (not started)

Per spec §14 — **Phase 1: document upload + extraction.** Passport image / PDF
upload, local MRZ / OCR extraction with confidence scoring and mandatory user
verification, a structured applicant-profile draft in SQLite. **No portal
interaction.** Real visa-form autofill, per-portal adapters/selectors,
multi-page form fill, field verification, and the user-controlled submit come in
later phases. None of CAPTCHA/OTP/MFA/anti-bot handling is ever added.

---

## 10. Spec §12 acceptance checklist

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | `npm run dev` starts the local application successfully | **PASS** | Vite `:5173` + Fastify `:5174` both boot; `/` and proxied `/api/health` → 200. |
| 2 | React/Vite UI loads in the browser | **PASS** | Browser walkthrough: header + "Visa Portals" + empty state render at `:5173` and `:5174`. |
| 3 | Fastify API responds successfully | **PASS** | `GET /api/health` → `{"status":"ok"}`; full CRUD round-trips. |
| 4 | SQLite database initializes and persists data | **PASS** | `migrations.test.ts` (3); `portalService.test.ts` "persists across a reopen"; DB file created under `data/`. |
| 5 | User can create a Visa Portal configuration | **PASS** | Walkthrough create step; `portalRoutes.test.ts` POST. |
| 6 | User can edit and delete a portal configuration | **PASS** | Walkthrough edit + delete; `portalService.test.ts` / `portalRoutes.test.ts`. |
| 7 | User can select an active portal | **PASS** | Walkthrough radio → indicator; `portalRoutes.test.ts` active-portal set/get. |
| 8 | Portal URL is stored in SQLite and loaded at runtime | **PASS** | `visa_portals.url` column; route reads `portal.url` from the DB row for Test Connection. |
| 9 | No visa portal URL is hard-coded in the automation engine | **PASS** | `noHardcodedUrl.test.ts` (2); §5 grep → no matches. |
| 10 | Test Connection launches Playwright and navigates to the configured URL | **PASS** | Walkthrough: Chromium launched, navigated to configured `http://127.0.0.1:4700/`; `testConnection.test.ts` (5). |
| 11 | Test Connection reports useful results (title, final URL, …) | **PASS** | Walkthrough result panel: outcome, HTTP status, title, final URL, redirected, element counts, security-challenge line, screenshot path, duration. |
| 12 | Test Connection never submits a visa application | **PASS** | No fill/click/submit code (ADR-0004); `testConnection.test.ts` "never issues a POST / never submits a form". |
| 13 | CAPTCHA/OTP/MFA/security challenges are not bypassed | **PASS** | Detect-only boolean flags; no solver/evasion code anywhere (§6 audit, ADR-0004). |
| 14 | Portal-specific selectors/config separated from the shared engine | **PASS** | `browserManager`/`pageInspector` are portal-agnostic; adapters resolved via `registry.ts`; Phase 0 = `genericAdapter` only. |
| 15 | Portal URL single-source-of-truth audit passes (§9a) | **PASS** | §5 of this report — all six checks PASS. |
| 16 | Restarting the application does not lose saved portal settings | **PASS** | Walkthrough: killed + restarted server, portal + active selection survived; `portalRoutes.test.ts` "active-portal survives a server restart". |
| 17 | Typecheck/lint/tests/build pass, or failures documented | **PASS** | §4 — all four green (exit 0), 48/48 tests. |
| 18 | Git diff reviewed for unintended changes | **PASS** | §7 of the plan / §2 here — no `.env`, `data/`, `dist/`, `console.log`, or out-of-scope changes; each task a focused commit. |
| 19 | Claude reports exactly what was implemented, tested, and any limitations | **PASS** | This report. |

**No required item fails. Phase 0 is complete.**

---

## 11. Recommended next phase

**Phase 1 — Document upload + extraction** (spec §14): local passport image/PDF
upload, MRZ/OCR extraction with confidence scoring and mandatory user
verification, a structured applicant-profile draft persisted in SQLite. No
portal interaction; no autofill; no submission.
