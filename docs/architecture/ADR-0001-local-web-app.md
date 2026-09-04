# ADR-0001: Local web app (Fastify + Vite) over Electron for Phase 0

## Status: Accepted

## Context

The tool must run entirely on the user's own machine, touch the network only
when the user explicitly asks (Test Connection, later: user-driven portal
navigation), and never expose a service to other hosts. It needs a UI for
managing portal configurations and, later, for reviewing extracted applicant
data before a user-controlled submit.

Options considered:

- **Electron desktop app** — single window, no ports, familiar "app" feel, but a
  large dependency, a native build/packaging pipeline per OS, and its own
  security surface (nodeIntegration, contextIsolation, auto-update).
- **Local web app** — a Node process serving an API plus a static SPA, opened in
  the user's browser. Minimal dependencies, trivial to run, no packaging.
- **CLI only** — insufficient for the review/verification UI later phases need.

## Decision

Phase 0 is a **local web application**:

- One Node process runs a **Fastify** API bound to `127.0.0.1` only.
- The React UI is built with **Vite**. In development, Vite serves the SPA on
  `127.0.0.1:5173` and proxies `/api` to Fastify on `5174`. In production,
  `vite build` emits static assets that **Fastify itself serves** from
  `dist/web`, with an `index.html` fallback for client routes and JSON `404`s
  preserved for `/api/*` (ADR — see `src/server/app.ts`).
- `npm run dev` starts the whole stack; `npm run build && npm start` runs the
  production shape.

## Consequences

- **Positive:** small dependency footprint; no native toolchain; `npm run dev`
  is the entire setup after `npm install` + `npx playwright install chromium`;
  the server code has no UI-framework coupling.
- **Positive:** the loopback bind + gitignored `data/` + `.env` keep the app
  local by construction; there is no "expose to LAN" switch.
- **Negative:** the user runs two dev processes (mitigated by `concurrently`)
  and opens a browser tab rather than launching an app icon.
- **Future:** Electron (or a Tauri/webview shell) can wrap `src/server`
  unchanged later — the server is already a standalone factory
  (`buildServer({ dbPath })`); nothing in `src/server` imports UI code.
