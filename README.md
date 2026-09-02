# Visa Application Autofill — local-first

A local-only assistant for organising a visa application and (in later phases)
helping fill a configurable visa portal form under the user's control. **Phase 0**
is the foundation: the app skeleton plus a fully persistent, configurable **Visa
Portal Settings** system and a navigate-only **Test Connection**. There is no
visa-form automation yet.

> **Local-only.** The API binds to `127.0.0.1` and is never exposed to other
> hosts. `data/` (SQLite DB + screenshots) and `.env` are gitignored. The tool
> never submits an application and never solves or bypasses CAPTCHA / OTP / MFA /
> anti-bot controls.

## Requirements

- **Node.js ≥ 24** (uses the built-in `node:sqlite`).
- Chromium for Playwright (installed once, see below).

## Setup

```bash
npm install
npx playwright install chromium
```

Optionally copy `.env.example` to `.env` and adjust. **Do not put a portal URL in
`.env`** — portal URLs are configured in the app UI and stored in SQLite.

| Var          | Default | Meaning                                             |
|--------------|---------|----------------------------------------------------|
| `NODE_ENV`   | `development` | `development` \| `production` \| `test`        |
| `PORT`       | `5174`  | Fastify API port (loopback only)                    |
| `DATA_DIR`   | `data`  | SQLite DB + screenshots live here                   |
| `PW_HEADLESS`| `true`  | `true` = headless Chromium; `false` = visible window |
| `LOG_LEVEL`  | `info`  | pino level                                          |

## Run

**Development** (Vite dev server + API, hot reload):

```bash
npm run dev
# UI:  http://localhost:5173
# API: http://127.0.0.1:5174  (proxied under /api by Vite)
```

**Production shape** (Fastify serves the built UI):

```bash
npm run build
npm start
# App + API: http://127.0.0.1:5174
```

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Using it (Phase 0)

The app ships with **no portals** — the list starts empty and nothing is
hard-coded. In **Visa Portals**:

1. **Add portal** — name, URL (must be `http(s)`), type, and optional
   country / application type / notes.
2. **Edit** / **Delete** a portal from its row.
3. Select a portal **active** (the radio). The active selection persists across
   restarts.
4. **Run Test Connection** against the active portal — it navigates to the saved
   URL and reports HTTP status, page title, final URL, element counts, any
   detected security challenges (reported, never solved), and a screenshot path
   under `data/screenshots/`. It never fills, clicks, or submits anything.

### Example portal (illustration only — **not a default**, nothing is pre-loaded)

```
Name: Example Country e-Visa
URL:  https://example.gov.example/     (placeholder — replace with your real portal)
Type: e-Visa
```

The configured `visa_portals.url` of the active row is the **only** thing Test
Connection navigates to. See `docs/architecture/ADR-0002-portal-config-in-db.md`
and spec §9a.

## Docs

- `docs/ARCHITECTURE.md` — application-foundation architecture (layout, layering, the 13 foundation requirements → code, config, security posture, known issues)
- `docs/superpowers/specs/2026-09-02-phase-0-portal-settings-design.md` — Phase 0 spec
- `docs/superpowers/plans/2026-09-02-phase-0-portal-settings.md` — implementation plan
- `docs/superpowers/plans/2026-09-02-phase-0-AMENDMENT-01-node-sqlite.md` — the `node:sqlite` amendment
- `docs/architecture/ADR-0001..0004` — architecture decisions
- `docs/visa-form-analysis.md` — portal-agnostic field-analysis / discovery framework
- `docs/automation-risks.md` — portal-agnostic automation risk register
- `docs/PHASE-0-REPORT.md` — end-of-phase verification report
