# Phase 0 — Configurable Visa Portal Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local-first app skeleton (Fastify + SQLite + React/Vite + Playwright) and a fully persistent, configurable Visa Portal Settings system with a navigate-only Test Connection — no visa-form automation.

**Architecture:** One Node process runs a Fastify API + `better-sqlite3` database and spawns Playwright Chromium on demand. A React/Vite UI (dev: separate Vite server proxying `/api`; prod: served static by Fastify) manages portal configs. The portal URL lives only in SQLite; the automation engine is portal-agnostic and receives the URL as a parameter. Portal-specific knowledge lives in an adapter layer resolved by a registry.

**Tech Stack:** TypeScript (ESM, NodeNext), Node 24, Fastify 5, better-sqlite3, Playwright (chromium), Zod 3, Pino, React 18, React Router 6, Vite 5, Vitest, ESLint 9.

## Global Constraints

- **No hard-coded visa portal URL** anywhere: not in backend, frontend, Playwright helpers, constants, `.env`/`.env.example` defaults, tests, or fixtures-as-runtime-target. The active `visa_portals.url` row is the only runtime source of truth. (Spec §9a)
- Phase 0 ships **no seed data**; portal list starts empty. Any example URL in docs must be labelled as example.
- Test Connection is **navigate-only, report-only**: never `fill`/`type`/`click` a form control, never submit a form, never solve or bypass CAPTCHA/OTP/MFA. Challenges are detected and reported only.
- **Never log** passport/applicant data or secrets; no sensitive data in client-facing error messages. (No applicant data exists in Phase 0 — this is groundwork.)
- Server binds `127.0.0.1` only. Secrets only in `.env` (gitignored). `data/` gitignored.
- Prefer simple, maintainable code. No ORM, no migration library, no UI component library, no data-fetching library. Justify any dependency not already listed in the spec §11.
- All relative imports in `src/server/**` and `src/shared/**` use an explicit `.js` extension (NodeNext ESM requirement).
- TS strict mode on. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` must all pass at end of phase (or failures explicitly documented).
- Every task ends with a commit. Conventional Commit messages. Append the two attribution trailers used in this repo's existing commits.

---

## File Structure

```
package.json                       # scripts + deps
tsconfig.json                      # shared base (NodeNext, strict)
tsconfig.server.json               # emits dist/ from src/server + src/shared
tsconfig.web.json                  # noEmit typecheck for src/web + src/shared
vite.config.ts                     # React plugin, /api proxy, build.outDir
vitest.config.ts                   # node env default, forks pool
eslint.config.js                   # flat config
.env.example                       # PORT, DATA_DIR, PW_HEADLESS, LOG_LEVEL (no portal URL)
.gitignore                         # (exists) — ensure dist/, coverage/

src/shared/
  url.ts                           # isHttpUrl() — zero deps
  types.ts                         # VisaPortal, ConnectionTestResult, ApiError
  schemas.ts                       # zod: portalInputSchema, activePortalSchema

src/server/
  env.ts                           # load .env, parse+validate process.env once
  logger.ts                        # pino instance + redaction
  app.ts                           # buildServer({ dbPath }) factory (used by tests)
  index.ts                         # bootstrap: buildServer + listen 127.0.0.1
  fastify.d.ts                     # FastifyInstance.db augmentation
  db/
    connection.ts                  # openDatabase(dbPath) + pragmas
    migrations.ts                  # ordered migrations + runMigrations()
  services/
    errors.ts                      # PortalNotFoundError, PortalDisabledError
    portalService.ts               # CRUD + active-portal, pure DB logic
  routes/
    errors.ts                      # validationError(), notFoundError(), errorBody()
    health.ts                      # GET /api/health
    portals.ts                     # portal CRUD + active-portal + test-connection
  automation/
    engine/
      browserManager.ts            # Playwright browser lifecycle
      pageInspector.ts             # generic DOM inspection (title, counts, flags)
    adapters/
      baseAdapter.ts               # PortalAdapter interface
      genericAdapter.ts            # default: generic inspection only
      registry.ts                  # resolveAdapter(url) -> PortalAdapter
    discovery/
      testConnection.ts            # runConnectionTest(url, deps?) orchestration

src/web/
  index.html
  src/
    main.tsx                       # React root + router
    App.tsx                        # layout + routes
    styles.css
    api/client.ts                  # typed fetch wrapper
    lib/portalTypes.ts             # PORTAL_TYPE_OPTIONS constant
    pages/Settings/
      PortalsPage.tsx              # list + active selector + row actions
      PortalForm.tsx               # create/edit controlled form
      TestConnectionPanel.tsx      # runs test, renders ConnectionTestResult

test/
  helpers/tempDb.ts                # makeTempDbPath() + cleanup
  helpers/fixtureServer.ts         # startFixtureServer(html) -> { url, close, requests }
  server/schemas.test.ts
  server/migrations.test.ts
  server/portalService.test.ts
  server/portalRoutes.test.ts
  server/health.test.ts
  automation/pageInspector.test.ts
  automation/testConnection.test.ts
  automation/noHardcodedUrl.test.ts
  web/PortalsPage.test.tsx
  web/PortalForm.test.tsx

docs/architecture/
  ADR-0001-local-web-app.md
  ADR-0002-portal-config-in-db.md
  ADR-0003-better-sqlite3-and-migrations.md
  ADR-0004-test-connection-navigate-only.md
docs/PHASE-0-REPORT.md             # end-of-phase report
```

---

### Task 1: Project scaffold + health endpoint

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `tsconfig.web.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.env.example`
- Create: `src/server/env.ts`, `src/server/logger.ts`, `src/server/fastify.d.ts`, `src/server/app.ts`, `src/server/index.ts`, `src/server/routes/health.ts`
- Create: `src/web/index.html`, `src/web/src/main.tsx`, `src/web/src/App.tsx`, `src/web/src/styles.css`
- Create: `test/helpers/tempDb.ts`, `test/server/health.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `buildServer(opts: { dbPath: string }): Promise<FastifyInstance>` in `src/server/app.ts`
- Produces: `env` object in `src/server/env.ts` with `{ NODE_ENV, PORT, DATA_DIR, DB_PATH, SCREENSHOT_DIR, PW_HEADLESS: boolean, LOG_LEVEL }`
- Produces: `logger` (pino instance) in `src/server/logger.ts`
- Produces: `makeTempDbPath(): string` and `cleanupTempDb(p: string): void` in `test/helpers/tempDb.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "visa-autofill",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "concurrently -n server,web -c blue,green npm:dev:server npm:dev:web",
    "dev:server": "tsx watch src/server/index.ts",
    "dev:web": "vite",
    "build": "vite build && tsc -p tsconfig.server.json",
    "start": "cross-env NODE_ENV=production node dist/server/index.js",
    "typecheck": "tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.web.json",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fastify/static": "^8.0.0",
    "better-sqlite3": "^11.3.0",
    "fastify": "^5.0.0",
    "pino": "^9.0.0",
    "playwright": "^1.47.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "uuid": "^10.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.10.0",
    "@testing-library/react": "^16.0.0",
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.5.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "concurrently": "^9.0.0",
    "cross-env": "^7.0.3",
    "eslint": "^9.10.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "jsdom": "^25.0.0",
    "pino-pretty": "^11.2.2",
    "tsx": "^4.19.0",
    "typescript": "^5.6.2",
    "typescript-eslint": "^8.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

Rationale for deps beyond spec §11: `cross-env` (Windows-safe env var in `start` script), `@testing-library/react` + `jsdom` (frontend smoke tests — engineering rule "run tests"), `eslint-plugin-react-hooks` (catches hook bugs), plus `@types/*` and eslint plumbing. Record this in the ADR/report.

- [ ] **Step 2: Create the tsconfig files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "types": []
  }
}
```

`tsconfig.server.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"],
    "sourceMap": true
  },
  "include": ["src/server/**/*", "src/shared/**/*"]
}
```

`tsconfig.web.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"],
    "noEmit": true,
    "verbatimModuleSyntax": false
  },
  "include": ["src/web/**/*", "src/shared/**/*", "test/web/**/*"]
}
```

- [ ] **Step 3: Create `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:5174' },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/', 'data/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/web/**/*.{ts,tsx}', 'test/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 4: Create `.env.example` and update `.gitignore`**

`.env.example` (NOTE the comment — no portal URL here by design):
```
# Local server config. Copy to .env and adjust. NEVER put a visa portal URL here —
# portal URLs are configured in the app UI and stored in SQLite (spec §9a).
NODE_ENV=development
PORT=5174
DATA_DIR=data
# Test Connection browser visibility: true = headless (default), false = visible window
PW_HEADLESS=true
LOG_LEVEL=info
```

Append to `.gitignore` (if not already present): `dist/`, `coverage/`, `*.db`, `playwright-report/`.

- [ ] **Step 5: Create `src/server/env.ts`**

```ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5174),
  DATA_DIR: z.string().min(1).default('data'),
  PW_HEADLESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

const parsed = schema.parse(process.env);
const dataDir = path.resolve(parsed.DATA_DIR);

export const env = {
  ...parsed,
  DATA_DIR: dataDir,
  DB_PATH: path.join(dataDir, 'visa-autofill.db'),
  SCREENSHOT_DIR: path.join(dataDir, 'screenshots'),
};
```

- [ ] **Step 6: Create `src/server/logger.ts`**

```ts
import pino from 'pino';
import { env } from './env.js';

export const REDACT_PATHS = [
  'passportNumber', 'passport_number', 'dateOfBirth', 'date_of_birth', 'dob',
  'address', 'documentText', 'mrz', 'applicant', 'password', 'token',
  'req.headers.authorization', 'req.headers.cookie',
  '*.passportNumber', '*.mrz', '*.dateOfBirth',
];

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport:
    env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});
```

- [ ] **Step 7: Create `src/server/fastify.d.ts`**

```ts
import type BetterSqlite3 from 'better-sqlite3';

declare module 'fastify' {
  interface FastifyInstance {
    db: BetterSqlite3.Database;
  }
}
```

- [ ] **Step 8: Create `src/server/routes/health.ts`**

```ts
import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({ status: 'ok' }));
}
```

- [ ] **Step 9: Create `src/server/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { logger } from './logger.js';
import { openDatabase } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildServerOptions {
  dbPath: string;
}

export async function buildServer(
  opts: BuildServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: logger });
  const db = openDatabase(opts.dbPath);
  runMigrations(db);
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    db.close();
  });
  await registerHealthRoutes(app);
  return app;
}
```

> NOTE: `openDatabase` / `runMigrations` are created in Task 3. This task cannot typecheck until Task 3 is done. Implement Step 9–10 code now; run `npm run typecheck` at the end of Task 3, not here. The health test in Step 12 needs a stub — see Step 11.

- [ ] **Step 10: Create `src/server/index.ts`**

```ts
import { buildServer } from './app.js';
import { env } from './env.js';

const app = await buildServer({ dbPath: env.DB_PATH });

try {
  await app.listen({ host: '127.0.0.1', port: env.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 11: Create minimal `src/server/db/connection.ts` + `src/server/db/migrations.ts` stubs**

Create just enough to compile and run the health test; Task 3 replaces the bodies.

`src/server/db/connection.ts`:
```ts
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';

export function openDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
```

`src/server/db/migrations.ts`:
```ts
import type Database from 'better-sqlite3';

export function runMigrations(_db: Database.Database): void {
  // Filled in Task 3.
}
```

- [ ] **Step 12: Create `test/helpers/tempDb.ts` and `test/server/health.test.ts`**

`test/helpers/tempDb.ts`:
```ts
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function makeTempDbPath(): string {
  return path.join(tmpdir(), `visa-autofill-test-${randomUUID()}.db`);
}

export function cleanupTempDb(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(dbPath + suffix, { force: true });
  }
}
```

`test/server/health.test.ts`:
```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let app: FastifyInstance;
let dbPath: string;

beforeEach(async () => {
  dbPath = makeTempDbPath();
  app = await buildServer({ dbPath });
});

afterEach(async () => {
  await app.close();
  cleanupTempDb(dbPath);
});

it('GET /api/health returns ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
});
```

- [ ] **Step 13: Install dependencies and Playwright browser**

Run:
```bash
npm install
npx playwright install chromium
```
Expected: install completes; `better-sqlite3` compiles or downloads a prebuilt binary for Node 24 / Windows. If it fails to build, document the error and STOP for review (fallback path is Node's built-in `node:sqlite`, which is a plan change).

- [ ] **Step 14: Run the health test**

Run: `npm test -- health`
Expected: PASS (1 test).

- [ ] **Step 15: Create the React shell**

`src/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Visa Autofill</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/web/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { App } from './App';
import { PortalsPage } from './pages/Settings/PortalsPage';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/settings/portals" replace /> },
      { path: 'settings/portals', element: <PortalsPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
```

`src/web/src/App.tsx`:
```tsx
import { NavLink, Outlet } from 'react-router-dom';

export function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>Visa Autofill</h1>
        <nav>
          <NavLink to="/settings/portals">Visa Portals</NavLink>
        </nav>
      </header>
      <main className="app__main">
        <Outlet />
      </main>
    </div>
  );
}
```

`src/web/src/styles.css`: minimal readable styling (system font, max-width container, simple table and form styles). Keep under ~80 lines. A stub `PortalsPage` is created in Task 8 — for this task create a placeholder:

`src/web/src/pages/Settings/PortalsPage.tsx` (placeholder, replaced in Task 8):
```tsx
export function PortalsPage() {
  return <p>Visa portal settings load here.</p>;
}
```

- [ ] **Step 16: Manually verify `npm run dev`**

Run: `npm run dev`
Expected: server logs "Server listening at http://127.0.0.1:5174"; Vite serves on 5173. Open `http://localhost:5173` → header + placeholder text render. `curl http://localhost:5173/api/health` → `{"status":"ok"}` (proxied). Stop the dev server. Note the result in your task summary.

- [ ] **Step 17: Commit**

```bash
git add -A
git commit -m "feat: scaffold Fastify + Vite + SQLite app skeleton with health endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

---

### Task 2: Shared types, URL guard, and Zod schemas

**Files:**
- Create: `src/shared/url.ts`, `src/shared/types.ts`, `src/shared/schemas.ts`
- Create: `test/server/schemas.test.ts`

**Interfaces:**
- Consumes: `zod` package
- Produces: `isHttpUrl(value: string): boolean` in `src/shared/url.ts`
- Produces types in `src/shared/types.ts`:
  ```ts
  type PortalType = 'regular' | 'evisa' | 'custom';
  interface VisaPortal {
    id: string; name: string; url: string; portalType: PortalType;
    country: string | null; applicationType: string | null; notes: string | null;
    enabled: boolean; createdAt: string; updatedAt: string;
  }
  interface ConnectionTestResult {
    success: boolean; url: string; httpStatus: number | null;
    pageTitle: string | null; finalUrl: string | null; redirected: boolean;
    redirectChain: string[]; elementCounts: Record<string, number>;
    securityChallengeFlags: Record<string, boolean>;
    screenshotPath: string | null; durationMs: number;
    error?: { code: string; message: string };
  }
  interface ApiError { error: { code: string; message: string }; }
  ```
- Produces in `src/shared/schemas.ts`: `portalInputSchema` (Zod), `PortalInput` (`z.infer`), `activePortalSchema`

- [ ] **Step 1: Write the failing test `test/server/schemas.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { portalInputSchema } from '../../src/shared/schemas.js';
import { isHttpUrl } from '../../src/shared/url.js';

const valid = {
  name: 'Example Visa',
  url: 'https://example.com/apply',
  portalType: 'evisa' as const,
};

describe('isHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('https://example.com/x?y=1')).toBe(true);
  });
  it('rejects non-http protocols and garbage', () => {
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('example.com')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});

describe('portalInputSchema', () => {
  it('accepts a minimal valid portal and defaults enabled to true', () => {
    const parsed = portalInputSchema.parse(valid);
    expect(parsed.enabled).toBe(true);
    expect(parsed.country).toBeNull();
  });
  it('rejects a non-http URL', () => {
    const r = portalInputSchema.safeParse({ ...valid, url: 'ftp://x.com' });
    expect(r.success).toBe(false);
  });
  it('rejects an empty name', () => {
    expect(portalInputSchema.safeParse({ ...valid, name: '  ' }).success).toBe(false);
  });
  it('rejects an unknown portalType', () => {
    expect(portalInputSchema.safeParse({ ...valid, portalType: 'other' }).success).toBe(false);
  });
  it('trims name and coerces blank optionals to null', () => {
    const parsed = portalInputSchema.parse({ ...valid, name: '  Trimmed  ', country: '  ' });
    expect(parsed.name).toBe('Trimmed');
    expect(parsed.country).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- schemas`
Expected: FAIL — cannot resolve `../../src/shared/schemas.js`.

- [ ] **Step 3: Create `src/shared/url.ts`**

```ts
export function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}
```

- [ ] **Step 4: Create `src/shared/types.ts`**

Paste the type definitions from the Interfaces block above. (No runtime code — types only, so `export type` / `export interface`.)

- [ ] **Step 5: Create `src/shared/schemas.ts`**

```ts
import { z } from 'zod';
import { isHttpUrl } from './url.js';

const blankToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null));

export const portalInputSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  url: z
    .string()
    .trim()
    .min(1, 'url is required')
    .max(2048)
    .refine(isHttpUrl, 'url must be a valid http(s) URL'),
  portalType: z.enum(['regular', 'evisa', 'custom']),
  country: blankToNull(100),
  applicationType: blankToNull(100),
  notes: blankToNull(2000),
  enabled: z.boolean().default(true),
});

export type PortalInput = z.infer<typeof portalInputSchema>;

export const activePortalSchema = z.object({
  portalId: z.string().min(1).nullable(),
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- schemas`
Expected: PASS (all cases).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: shared VisaPortal types, http-url guard, and portal input schema

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

---

### Task 3: Database connection + migration runner

**Files:**
- Modify: `src/server/db/connection.ts` (finalize), `src/server/db/migrations.ts` (finalize)
- Create: `test/server/migrations.test.ts`

**Interfaces:**
- Produces: `openDatabase(dbPath: string): BetterSqlite3.Database` (already present from Task 1 Step 11 — keep as-is)
- Produces: `runMigrations(db: BetterSqlite3.Database): void` — applies all migrations with `version > PRAGMA user_version`, each in a transaction, then bumps `user_version`. Idempotent.
- Produces: `LATEST_SCHEMA_VERSION: number` constant in `migrations.ts`

- [ ] **Step 1: Write the failing test `test/server/migrations.test.ts`**

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations, LATEST_SCHEMA_VERSION } from '../../src/server/db/migrations.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let db: BetterSqlite3.Database;
let dbPath: string;

beforeEach(() => {
  dbPath = makeTempDbPath();
  db = openDatabase(dbPath);
});
afterEach(() => {
  db.close();
  cleanupTempDb(dbPath);
});

it('brings a fresh db to the latest schema version', () => {
  runMigrations(db);
  expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
});

it('creates the expected tables', () => {
  runMigrations(db);
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r: { name: string }) => r.name);
  expect(names).toContain('visa_portals');
  expect(names).toContain('app_settings');
});

it('is idempotent when run twice', () => {
  runMigrations(db);
  expect(() => runMigrations(db)).not.toThrow();
  expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- migrations`
Expected: FAIL — `LATEST_SCHEMA_VERSION` is undefined / tables missing.

- [ ] **Step 3: Finalize `src/server/db/migrations.ts`**

```ts
import type BetterSqlite3 from 'better-sqlite3';

interface Migration {
  version: number;
  up: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE visa_portals (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        url              TEXT NOT NULL,
        portal_type      TEXT NOT NULL CHECK (portal_type IN ('regular','evisa','custom')),
        country          TEXT,
        application_type TEXT,
        notes            TEXT,
        enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE TABLE app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1]!.version;

export function runMigrations(db: BetterSqlite3.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    const apply = db.transaction(() => {
      db.exec(migration.up);
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
  }
}
```

- [ ] **Step 4: Confirm `src/server/db/connection.ts` matches Task 1 Step 11**

No change expected. If it drifted, restore it to the Task 1 Step 11 body.

- [ ] **Step 5: Run the migration test**

Run: `npm test -- migrations`
Expected: PASS (3 tests).

- [ ] **Step 6: Run full typecheck (now that Task 1 Step 9's `app.ts` has real deps)**

Run: `npm run typecheck`
Expected: PASS. Fix any ESM `.js`-extension import errors in server/shared files.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: SQLite connection helper and user_version migration runner

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

---

### Task 4: Portal service (CRUD + active portal)

**Files:**
- Create: `src/server/services/errors.ts`, `src/server/services/portalService.ts`
- Create: `test/server/portalService.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `runMigrations`, `portalInputSchema`/`PortalInput`, `VisaPortal` type, `uuid`
- Produces in `src/server/services/errors.ts`:
  ```ts
  class PortalNotFoundError extends Error   // .portalId
  class PortalDisabledError extends Error   // .portalId
  ```
- Produces in `src/server/services/portalService.ts` (all take `db` as first arg):
  ```ts
  createPortal(db, input: PortalInput): VisaPortal
  listPortals(db): VisaPortal[]                       // newest createdAt first
  getPortal(db, id: string): VisaPortal | null
  updatePortal(db, id: string, input: PortalInput): VisaPortal | null
  deletePortal(db, id: string): boolean               // clears active setting if it matched
  getActivePortalId(db): string | null
  getActivePortal(db): VisaPortal | null
  setActivePortal(db, portalId: string | null): void  // throws PortalNotFoundError / PortalDisabledError
  ```

- [ ] **Step 1: Write the failing test `test/server/portalService.test.ts`**

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import * as svc from '../../src/server/services/portalService.js';
import { PortalDisabledError, PortalNotFoundError } from '../../src/server/services/errors.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let db: BetterSqlite3.Database;
let dbPath: string;
const input = {
  name: 'Example Visa',
  url: 'https://example.com/apply',
  portalType: 'evisa' as const,
  country: null,
  applicationType: null,
  notes: null,
  enabled: true,
};

beforeEach(() => {
  dbPath = makeTempDbPath();
  db = openDatabase(dbPath);
  runMigrations(db);
});
afterEach(() => {
  db.close();
  cleanupTempDb(dbPath);
});

it('creates and reads back a portal', () => {
  const created = svc.createPortal(db, input);
  expect(created.id).toMatch(/[0-9a-f-]{36}/);
  expect(created.url).toBe(input.url);
  expect(svc.getPortal(db, created.id)).toEqual(created);
});

it('lists newest first', () => {
  const a = svc.createPortal(db, { ...input, name: 'A' });
  const b = svc.createPortal(db, { ...input, name: 'B' });
  const names = svc.listPortals(db).map((p) => p.name);
  expect(names.slice(0, 2)).toEqual(['B', 'A']);
  void a; void b;
});

it('updates a portal and bumps updatedAt', async () => {
  const created = svc.createPortal(db, input);
  await new Promise((r) => setTimeout(r, 5));
  const updated = svc.updatePortal(db, created.id, { ...input, name: 'Renamed' });
  expect(updated?.name).toBe('Renamed');
  expect(updated?.createdAt).toBe(created.createdAt);
  expect(updated?.updatedAt).not.toBe(created.createdAt);
});

it('returns null updating a missing portal', () => {
  expect(svc.updatePortal(db, 'nope', input)).toBeNull();
});

it('deletes a portal and clears it as active', () => {
  const created = svc.createPortal(db, input);
  svc.setActivePortal(db, created.id);
  expect(svc.getActivePortalId(db)).toBe(created.id);
  expect(svc.deletePortal(db, created.id)).toBe(true);
  expect(svc.getActivePortalId(db)).toBeNull();
  expect(svc.deletePortal(db, created.id)).toBe(false);
});

it('rejects activating a missing or disabled portal', () => {
  expect(() => svc.setActivePortal(db, 'missing')).toThrow(PortalNotFoundError);
  const disabled = svc.createPortal(db, { ...input, enabled: false });
  expect(() => svc.setActivePortal(db, disabled.id)).toThrow(PortalDisabledError);
});

it('setActivePortal(null) clears the setting', () => {
  const created = svc.createPortal(db, input);
  svc.setActivePortal(db, created.id);
  svc.setActivePortal(db, null);
  expect(svc.getActivePortal(db)).toBeNull();
});

it('persists across a reopen of the same file', () => {
  const created = svc.createPortal(db, input);
  db.close();
  const db2 = openDatabase(dbPath);
  runMigrations(db2);
  expect(svc.getPortal(db2, created.id)?.name).toBe('Example Visa');
  db2.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- portalService`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/server/services/errors.ts`**

```ts
export class PortalNotFoundError extends Error {
  constructor(public readonly portalId: string) {
    super(`Portal not found: ${portalId}`);
    this.name = 'PortalNotFoundError';
  }
}

export class PortalDisabledError extends Error {
  constructor(public readonly portalId: string) {
    super(`Portal is disabled: ${portalId}`);
    this.name = 'PortalDisabledError';
  }
}
```

- [ ] **Step 4: Create `src/server/services/portalService.ts`**

```ts
import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { PortalInput } from '../../shared/schemas.js';
import type { VisaPortal } from '../../shared/types.js';
import { PortalDisabledError, PortalNotFoundError } from './errors.js';

const ACTIVE_KEY = 'active_portal_id';

interface PortalRow {
  id: string;
  name: string;
  url: string;
  portal_type: 'regular' | 'evisa' | 'custom';
  country: string | null;
  application_type: string | null;
  notes: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToPortal(row: PortalRow): VisaPortal {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    portalType: row.portal_type,
    country: row.country,
    applicationType: row.application_type,
    notes: row.notes,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPortal(db: BetterSqlite3.Database, input: PortalInput): VisaPortal {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO visa_portals
       (id, name, url, portal_type, country, application_type, notes, enabled, created_at, updated_at)
     VALUES (@id, @name, @url, @portal_type, @country, @application_type, @notes, @enabled, @created_at, @updated_at)`,
  ).run({
    id,
    name: input.name,
    url: input.url,
    portal_type: input.portalType,
    country: input.country,
    application_type: input.applicationType,
    notes: input.notes,
    enabled: input.enabled ? 1 : 0,
    created_at: now,
    updated_at: now,
  });
  return getPortal(db, id)!;
}

export function listPortals(db: BetterSqlite3.Database): VisaPortal[] {
  return db
    .prepare('SELECT * FROM visa_portals ORDER BY created_at DESC, id DESC')
    .all()
    .map((r) => rowToPortal(r as PortalRow));
}

export function getPortal(db: BetterSqlite3.Database, id: string): VisaPortal | null {
  const row = db.prepare('SELECT * FROM visa_portals WHERE id = ?').get(id) as
    | PortalRow
    | undefined;
  return row ? rowToPortal(row) : null;
}

export function updatePortal(
  db: BetterSqlite3.Database,
  id: string,
  input: PortalInput,
): VisaPortal | null {
  const existing = getPortal(db, id);
  if (!existing) return null;
  db.prepare(
    `UPDATE visa_portals SET
       name=@name, url=@url, portal_type=@portal_type, country=@country,
       application_type=@application_type, notes=@notes, enabled=@enabled, updated_at=@updated_at
     WHERE id=@id`,
  ).run({
    id,
    name: input.name,
    url: input.url,
    portal_type: input.portalType,
    country: input.country,
    application_type: input.applicationType,
    notes: input.notes,
    enabled: input.enabled ? 1 : 0,
    updated_at: new Date().toISOString(),
  });
  return getPortal(db, id);
}

export function deletePortal(db: BetterSqlite3.Database, id: string): boolean {
  const tx = db.transaction(() => {
    if (getActivePortalId(db) === id) {
      db.prepare('DELETE FROM app_settings WHERE key = ?').run(ACTIVE_KEY);
    }
    return db.prepare('DELETE FROM visa_portals WHERE id = ?').run(id).changes;
  });
  return tx() > 0;
}

export function getActivePortalId(db: BetterSqlite3.Database): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(ACTIVE_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function getActivePortal(db: BetterSqlite3.Database): VisaPortal | null {
  const id = getActivePortalId(db);
  return id ? getPortal(db, id) : null;
}

export function setActivePortal(db: BetterSqlite3.Database, portalId: string | null): void {
  if (portalId === null) {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(ACTIVE_KEY);
    return;
  }
  const portal = getPortal(db, portalId);
  if (!portal) throw new PortalNotFoundError(portalId);
  if (!portal.enabled) throw new PortalDisabledError(portalId);
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(ACTIVE_KEY, portalId);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- portalService`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: portal service — CRUD plus active-portal selection in SQLite

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

---

### Task 5: Portal REST routes + active-portal routes

**Files:**
- Create: `src/server/routes/errors.ts`, `src/server/routes/portals.ts`
- Modify: `src/server/app.ts` (register portal routes; add error sanitizer hook)
- Create: `test/server/portalRoutes.test.ts`

**Interfaces:**
- Consumes: everything from Task 4, `activePortalSchema`, `portalInputSchema`
- Produces in `src/server/routes/errors.ts`:
  ```ts
  errorBody(code: string, message: string): ApiError
  validationError(err: z.ZodError): ApiError            // code 'VALIDATION_ERROR'
  notFoundError(what: string): ApiError                 // code 'NOT_FOUND'
  ```
- Produces: `registerPortalRoutes(app: FastifyInstance): Promise<void>` — registers:
  `GET/POST /api/portals`, `GET/PUT/DELETE /api/portals/:id`,
  `GET/PUT /api/settings/active-portal`,
  `POST /api/portals/:id/test-connection` (wired in Task 7 — stub here returning 501)

- [ ] **Step 1: Write the failing test `test/server/portalRoutes.test.ts`**

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server/app.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let app: FastifyInstance;
let dbPath: string;

const body = { name: 'Example', url: 'https://example.com', portalType: 'evisa' };

beforeEach(async () => {
  dbPath = makeTempDbPath();
  app = await buildServer({ dbPath });
});
afterEach(async () => {
  await app.close();
  cleanupTempDb(dbPath);
});

async function create(overrides = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/portals',
    payload: { ...body, ...overrides },
  });
  return res.json().portal as { id: string; name: string };
}

it('POST then GET list returns the portal', async () => {
  await create();
  const res = await app.inject({ method: 'GET', url: '/api/portals' });
  expect(res.statusCode).toBe(200);
  expect(res.json().portals).toHaveLength(1);
});

it('POST with a bad URL returns 400 VALIDATION_ERROR', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/portals',
    payload: { ...body, url: 'ftp://example.com' },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe('VALIDATION_ERROR');
});

it('GET /api/portals/:id returns 404 for unknown id', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/portals/nope' });
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe('NOT_FOUND');
});

it('PUT updates, DELETE removes', async () => {
  const p = await create();
  const put = await app.inject({
    method: 'PUT',
    url: `/api/portals/${p.id}`,
    payload: { ...body, name: 'Renamed' },
  });
  expect(put.json().portal.name).toBe('Renamed');
  const del = await app.inject({ method: 'DELETE', url: `/api/portals/${p.id}` });
  expect(del.statusCode).toBe(200);
  const list = await app.inject({ method: 'GET', url: '/api/portals' });
  expect(list.json().portals).toHaveLength(0);
});

it('active-portal: set, get, and reject disabled', async () => {
  const p = await create();
  const put = await app.inject({
    method: 'PUT',
    url: '/api/settings/active-portal',
    payload: { portalId: p.id },
  });
  expect(put.statusCode).toBe(200);
  const get = await app.inject({ method: 'GET', url: '/api/settings/active-portal' });
  expect(get.json().activePortalId).toBe(p.id);
  expect(get.json().portal.id).toBe(p.id);

  const disabled = await create({ enabled: false });
  const bad = await app.inject({
    method: 'PUT',
    url: '/api/settings/active-portal',
    payload: { portalId: disabled.id },
  });
  expect(bad.statusCode).toBe(409);
  expect(bad.json().error.code).toBe('PORTAL_DISABLED');
});

it('active-portal survives a server restart on the same db file', async () => {
  const p = await create();
  await app.inject({
    method: 'PUT',
    url: '/api/settings/active-portal',
    payload: { portalId: p.id },
  });
  await app.close();
  app = await buildServer({ dbPath });
  const get = await app.inject({ method: 'GET', url: '/api/settings/active-portal' });
  expect(get.json().activePortalId).toBe(p.id);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- portalRoutes`
Expected: FAIL — portal routes not registered (404s / 501s).

- [ ] **Step 3: Create `src/server/routes/errors.ts`**

```ts
import type { ZodError } from 'zod';
import type { ApiError } from '../../shared/types.js';

export function errorBody(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export function validationError(err: ZodError): ApiError {
  const message = err.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
  return errorBody('VALIDATION_ERROR', message);
}

export function notFoundError(what: string): ApiError {
  return errorBody('NOT_FOUND', `${what} not found`);
}
```

- [ ] **Step 4: Create `src/server/routes/portals.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { portalInputSchema } from '../../shared/schemas.js';
import { activePortalSchema } from '../../shared/schemas.js';
import * as svc from '../services/portalService.js';
import { PortalDisabledError, PortalNotFoundError } from '../services/errors.js';
import { errorBody, notFoundError, validationError } from './errors.js';

export async function registerPortalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/portals', async () => ({ portals: svc.listPortals(app.db) }));

  app.post('/api/portals', async (req, reply) => {
    const parsed = portalInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    return reply.code(201).send({ portal: svc.createPortal(app.db, parsed.data) });
  });

  app.get<{ Params: { id: string } }>('/api/portals/:id', async (req, reply) => {
    const portal = svc.getPortal(app.db, req.params.id);
    if (!portal) return reply.code(404).send(notFoundError('portal'));
    return { portal };
  });

  app.put<{ Params: { id: string } }>('/api/portals/:id', async (req, reply) => {
    const parsed = portalInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const portal = svc.updatePortal(app.db, req.params.id, parsed.data);
    if (!portal) return reply.code(404).send(notFoundError('portal'));
    return { portal };
  });

  app.delete<{ Params: { id: string } }>('/api/portals/:id', async (req, reply) => {
    const removed = svc.deletePortal(app.db, req.params.id);
    if (!removed) return reply.code(404).send(notFoundError('portal'));
    return { deleted: true };
  });

  app.get('/api/settings/active-portal', async () => ({
    activePortalId: svc.getActivePortalId(app.db),
    portal: svc.getActivePortal(app.db),
  }));

  app.put('/api/settings/active-portal', async (req, reply) => {
    const parsed = activePortalSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    try {
      svc.setActivePortal(app.db, parsed.data.portalId);
    } catch (err) {
      if (err instanceof PortalNotFoundError) {
        return reply.code(404).send(notFoundError('portal'));
      }
      if (err instanceof PortalDisabledError) {
        return reply
          .code(409)
          .send(errorBody('PORTAL_DISABLED', 'Cannot activate a disabled portal'));
      }
      throw err;
    }
    return {
      activePortalId: svc.getActivePortalId(app.db),
      portal: svc.getActivePortal(app.db),
    };
  });

  // Wired for real in Task 7.
  app.post<{ Params: { id: string } }>(
    '/api/portals/:id/test-connection',
    async (_req, reply) =>
      reply.code(501).send(errorBody('NOT_IMPLEMENTED', 'Test Connection lands in Task 7')),
  );
}
```

- [ ] **Step 5: Wire routes + error sanitizer into `src/server/app.ts`**

Add after `registerHealthRoutes(app)`:
```ts
import { registerPortalRoutes } from './routes/portals.js';
import { errorBody } from './routes/errors.js';
// ...
  await registerPortalRoutes(app);

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'unhandled route error');
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    // Never leak internal detail to the client.
    reply.code(status).send(errorBody('INTERNAL', 'Internal server error'));
  });
```

- [ ] **Step 6: Run the route test**

Run: `npm test -- portalRoutes`
Expected: PASS (7 tests).

- [ ] **Step 7: Run full test + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS. Fix issues before committing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: portal REST + active-portal routes with sanitized errors

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

---

### Task 6: Browser engine — BrowserManager + pageInspector + URL-literal audit

**Files:**
- Create: `src/server/automation/engine/browserManager.ts`, `src/server/automation/engine/pageInspector.ts`
- Create: `test/helpers/fixtureServer.ts`
- Create: `test/automation/pageInspector.test.ts`, `test/automation/noHardcodedUrl.test.ts`

**Interfaces:**
- Consumes: `playwright` (`chromium`), `env.PW_HEADLESS`
- Produces in `browserManager.ts`:
  ```ts
  class BrowserManager {
    launch(): Promise<import('playwright').Browser>   // reuses a single instance
    close(): Promise<void>
  }
  ```
- Produces in `pageInspector.ts`:
  ```ts
  interface PageInspection {
    pageTitle: string | null;
    elementCounts: Record<string, number>;
    securityChallengeFlags: Record<string, boolean>;
  }
  inspectPage(page: import('playwright').Page): Promise<PageInspection>
  ```
- Produces in `test/helpers/fixtureServer.ts`:
  ```ts
  interface FixtureServer {
    url: string;                        // http://127.0.0.1:<port>/
    requests: { method: string; url: string }[];
    close(): Promise<void>;
  }
  startFixtureServer(opts: {
    html: string;
    status?: number;
    redirectTo?: string;                // if set, respond 302 -> redirectTo
  }): Promise<FixtureServer>
  ```

- [ ] **Step 1: Create `test/helpers/fixtureServer.ts`**

```ts
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FixtureServer {
  url: string;
  requests: { method: string; url: string }[];
  close(): Promise<void>;
}

export async function startFixtureServer(opts: {
  html: string;
  status?: number;
  redirectTo?: string;
}): Promise<FixtureServer> {
  const requests: { method: string; url: string }[] = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method ?? 'GET', url: req.url ?? '/' });
    // Drain any body but never act on it.
    req.resume();
    if (opts.redirectTo) {
      res.writeHead(302, { location: opts.redirectTo });
      res.end();
      return;
    }
    res.writeHead(opts.status ?? 200, { 'content-type': 'text/html' });
    res.end(opts.html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 2: Write the failing test `test/automation/pageInspector.test.ts`**

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import { BrowserManager } from '../../src/server/automation/engine/browserManager.js';
import { inspectPage } from '../../src/server/automation/engine/pageInspector.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

const HTML = `<!doctype html><html><head><title>Fake Portal A</title></head>
<body>
  <form><input type="text" name="a"><input type="date" name="b">
  <select><option>x</option></select><input type="file"><input type="checkbox">
  <button type="submit">Go</button></form>
  <div class="g-recaptcha"></div>
  <a href="/next">next</a>
</body></html>`;

let bm: BrowserManager;
let fixture: FixtureServer;

beforeEach(async () => {
  bm = new BrowserManager();
  fixture = await startFixtureServer({ html: HTML });
});
afterEach(async () => {
  await bm.close();
  await fixture.close();
});

it('reports title, element counts, and recaptcha flag', async () => {
  const browser = await bm.launch();
  const page = await browser.newPage();
  await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
  const info = await inspectPage(page);
  expect(info.pageTitle).toBe('Fake Portal A');
  expect(info.elementCounts.forms).toBe(1);
  expect(info.elementCounts.dateInputs).toBe(1);
  expect(info.elementCounts.fileInputs).toBe(1);
  expect(info.elementCounts.selects).toBe(1);
  expect(info.securityChallengeFlags.recaptcha).toBe(true);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- pageInspector`
Expected: FAIL — modules not found.

- [ ] **Step 4: Create `src/server/automation/engine/browserManager.ts`**

```ts
import { chromium, type Browser } from 'playwright';
import { env } from '../../env.js';

export class BrowserManager {
  private browser: Browser | null = null;

  async launch(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({ headless: env.PW_HEADLESS });
    }
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
```

- [ ] **Step 5: Create `src/server/automation/engine/pageInspector.ts`**

```ts
import type { Page } from 'playwright';

export interface PageInspection {
  pageTitle: string | null;
  elementCounts: Record<string, number>;
  securityChallengeFlags: Record<string, boolean>;
}

export async function inspectPage(page: Page): Promise<PageInspection> {
  const data = await page.evaluate(() => {
    const count = (sel: string) => document.querySelectorAll(sel).length;
    const html = document.documentElement.outerHTML.toLowerCase();
    return {
      title: document.title,
      counts: {
        forms: count('form'),
        inputs: count('input'),
        textInputs: count('input[type="text"], input:not([type])'),
        selects: count('select'),
        radios: count('input[type="radio"]'),
        checkboxes: count('input[type="checkbox"]'),
        dateInputs: count('input[type="date"]'),
        fileInputs: count('input[type="file"]'),
        buttons: count('button, input[type="submit"], input[type="button"]'),
        links: count('a[href]'),
      },
      flags: {
        recaptcha: html.includes('recaptcha') || count('.g-recaptcha') > 0,
        hcaptcha: html.includes('hcaptcha'),
        turnstile: html.includes('cf-turnstile'),
        cloudflareInterstitial:
          html.includes('just a moment') && html.includes('cloudflare'),
        mentionsOtp: /\botp\b|one[-\s]?time password/.test(html),
        mentionsMfa: /\bmfa\b|multi[-\s]?factor|two[-\s]?factor|\b2fa\b/.test(html),
      },
    };
  });
  return {
    pageTitle: data.title.length > 0 ? data.title : null,
    elementCounts: data.counts,
    securityChallengeFlags: data.flags,
  };
}
```

- [ ] **Step 6: Run the inspector test**

Run: `npm test -- pageInspector`
Expected: PASS. (First run downloads nothing extra — Chromium already installed in Task 1.)

- [ ] **Step 7: Write `test/automation/noHardcodedUrl.test.ts` — the §9a static guard**

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

it('automation engine contains no hard-coded http(s) URL literal', () => {
  const files = walk(path.join('src', 'server', 'automation'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src, `${file} must not embed a URL literal`).not.toMatch(
      /https?:\/\/[^\s'"`]+/,
    );
  }
});

it('no source file outside docs/tests references a known government visa host', () => {
  const roots = ['src'];
  const banned = /indianvisaonline|\bvisa[a-z0-9.-]*\.gov\b/i;
  for (const root of roots) {
    for (const file of walk(root)) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file} must not name a specific gov visa host`).not.toMatch(banned);
    }
  }
});
```

- [ ] **Step 8: Run the audit test**

Run: `npm test -- noHardcodedUrl`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: Playwright browser manager + generic page inspector + no-hardcoded-URL audit

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

---

### Task 7: Adapters + Test Connection orchestration + route wiring

**Files:**
- Create: `src/server/automation/adapters/baseAdapter.ts`, `genericAdapter.ts`, `registry.ts`
- Create: `src/server/automation/discovery/testConnection.ts`
- Modify: `src/server/routes/portals.ts` (replace the 501 stub)
- Create: `test/automation/testConnection.test.ts`
- Modify: `test/server/portalRoutes.test.ts` (add the single-source-of-truth route test)

**Interfaces:**
- Produces in `baseAdapter.ts`:
  ```ts
  interface PortalAdapter {
    readonly id: string;
    matches(url: string): boolean;
    inspect(page: import('playwright').Page): Promise<PageInspection>;
  }
  ```
- Produces in `registry.ts`: `resolveAdapter(url: string): PortalAdapter` (Phase 0 → always `genericAdapter`)
- Produces in `testConnection.ts`:
  ```ts
  runConnectionTest(
    url: string,
    deps?: { browserManager?: BrowserManager; screenshotDir?: string },
  ): Promise<ConnectionTestResult>
  ```
  `url` is the ONLY navigation target. No default value, no fallback constant.

- [ ] **Step 1: Write the failing test `test/automation/testConnection.test.ts`**

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runConnectionTest } from '../../src/server/automation/discovery/testConnection.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

const pageA = `<!doctype html><title>Portal A</title><body><form>
<input name="x"><button type="submit">submit</button></form></body>`;
const pageB = `<!doctype html><title>Portal B</title><body><p>hi</p></body>`;

let shotDir: string;
const servers: FixtureServer[] = [];

beforeEach(() => {
  shotDir = path.join(tmpdir(), `visa-shots-${randomUUID()}`);
});
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  rmSync(shotDir, { recursive: true, force: true });
});

it('navigates to the exact URL it is given and reports basics', async () => {
  const a = await startFixtureServer({ html: pageA });
  servers.push(a);
  const result = await runConnectionTest(a.url, { screenshotDir: shotDir });
  expect(result.success).toBe(true);
  expect(result.pageTitle).toBe('Portal A');
  expect(result.finalUrl).toBe(a.url);
  expect(result.httpStatus).toBe(200);
  expect(result.elementCounts.forms).toBe(1);
  expect(result.screenshotPath && existsSync(result.screenshotPath)).toBe(true);
});

it('changing the URL changes the target with no code change (spec §9a)', async () => {
  const a = await startFixtureServer({ html: pageA });
  const b = await startFixtureServer({ html: pageB });
  servers.push(a, b);
  const ra = await runConnectionTest(a.url, { screenshotDir: shotDir });
  const rb = await runConnectionTest(b.url, { screenshotDir: shotDir });
  expect(ra.pageTitle).toBe('Portal A');
  expect(rb.pageTitle).toBe('Portal B');
});

it('never issues a POST / never submits a form', async () => {
  const a = await startFixtureServer({ html: pageA });
  servers.push(a);
  await runConnectionTest(a.url, { screenshotDir: shotDir });
  expect(a.requests.every((r) => r.method === 'GET')).toBe(true);
});

it('follows redirects and records the final URL', async () => {
  const dest = await startFixtureServer({ html: pageB });
  const entry = await startFixtureServer({ html: '', redirectTo: dest.url });
  servers.push(dest, entry);
  const result = await runConnectionTest(entry.url, { screenshotDir: shotDir });
  expect(result.redirected).toBe(true);
  expect(result.finalUrl).toBe(dest.url);
  expect(result.pageTitle).toBe('Portal B');
});

it('reports a sanitized failure for an unreachable host', async () => {
  const result = await runConnectionTest('http://127.0.0.1:1/', { screenshotDir: shotDir });
  expect(result.success).toBe(false);
  expect(result.error?.code).toBeDefined();
  expect(result.error?.message).not.toMatch(/stack|ECONNREFUSED.*at /i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- testConnection`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the adapter files**

`src/server/automation/adapters/baseAdapter.ts`:
```ts
import type { Page } from 'playwright';
import type { PageInspection } from '../engine/pageInspector.js';

export interface PortalAdapter {
  readonly id: string;
  matches(url: string): boolean;
  inspect(page: Page): Promise<PageInspection>;
}
```

`src/server/automation/adapters/genericAdapter.ts`:
```ts
import type { PortalAdapter } from './baseAdapter.js';
import { inspectPage } from '../engine/pageInspector.js';

export const genericAdapter: PortalAdapter = {
  id: 'generic',
  matches: () => true,
  inspect: (page) => inspectPage(page),
};
```

`src/server/automation/adapters/registry.ts`:
```ts
import type { PortalAdapter } from './baseAdapter.js';
import { genericAdapter } from './genericAdapter.js';

// Portal-specific adapters are added here in a later phase. Each one must
// declare its own matches(url) and keep its selectors internal to the module.
const adapters: PortalAdapter[] = [];

export function resolveAdapter(url: string): PortalAdapter {
  return adapters.find((a) => a.matches(url)) ?? genericAdapter;
}
```

- [ ] **Step 4: Create `src/server/automation/discovery/testConnection.ts`**

```ts
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ConnectionTestResult } from '../../../shared/types.js';
import { BrowserManager } from '../engine/browserManager.js';
import { resolveAdapter } from '../adapters/registry.js';
import { env } from '../../env.js';

const NAV_TIMEOUT_MS = 30_000;

export interface RunConnectionTestDeps {
  browserManager?: BrowserManager;
  screenshotDir?: string;
}

export async function runConnectionTest(
  url: string,
  deps: RunConnectionTestDeps = {},
): Promise<ConnectionTestResult> {
  const started = Date.now();
  const manager = deps.browserManager ?? new BrowserManager();
  const ownsManager = !deps.browserManager;
  const screenshotDir = deps.screenshotDir ?? env.SCREENSHOT_DIR;

  const base: ConnectionTestResult = {
    success: false,
    url,
    httpStatus: null,
    pageTitle: null,
    finalUrl: null,
    redirected: false,
    redirectChain: [],
    elementCounts: {},
    securityChallengeFlags: {},
    screenshotPath: null,
    durationMs: 0,
  };

  try {
    const browser = await manager.launch();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });

      const adapter = resolveAdapter(url);
      const inspection = await adapter.inspect(page);

      const redirectChain: string[] = [];
      let prev = response?.request().redirectedFrom() ?? null;
      while (prev) {
        redirectChain.unshift(prev.url());
        prev = prev.redirectedFrom();
      }

      await mkdir(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `test-${Date.now()}.png`);
      const shotOk = await page
        .screenshot({ path: screenshotPath, fullPage: true })
        .then(() => true)
        .catch(() => false);

      const finalUrl = page.url();
      return {
        ...base,
        success: true,
        httpStatus: response?.status() ?? null,
        pageTitle: inspection.pageTitle,
        finalUrl,
        redirected: finalUrl !== url || redirectChain.length > 0,
        redirectChain,
        elementCounts: inspection.elementCounts,
        securityChallengeFlags: inspection.securityChallengeFlags,
        screenshotPath: shotOk ? screenshotPath : null,
        durationMs: Date.now() - started,
      };
    } finally {
      await context.close();
    }
  } catch (err) {
    return {
      ...base,
      durationMs: Date.now() - started,
      error: sanitizeError(err, url),
    };
  } finally {
    if (ownsManager) await manager.close();
  }
}

function sanitizeError(err: unknown, url: string): { code: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  let host = 'the configured URL';
  try {
    host = new URL(url).host;
  } catch {
    /* keep default */
  }
  let code = 'NAVIGATION_ERROR';
  if (/ENOTFOUND|getaddrinfo|ERR_NAME_NOT_RESOLVED/i.test(raw)) code = 'DNS_LOOKUP_FAILED';
  else if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(raw)) code = 'CONNECTION_REFUSED';
  else if (/timeout/i.test(raw)) code = 'TIMEOUT';
  else if (/certificate|ERR_CERT|SSL|TLS/i.test(raw)) code = 'TLS_ERROR';
  return { code, message: `Could not load ${host} (${code})` };
}
```

> DESIGN NOTE (do not remove): this module has no `page.fill`, `page.type`,
> `page.click`, `form.submit`, or any CAPTCHA/OTP/MFA handling — by design.
> Test Connection is navigate-and-observe only (spec §7, Global Constraints).

- [ ] **Step 5: Replace the test-connection route stub in `src/server/routes/portals.ts`**

```ts
import { runConnectionTest } from '../automation/discovery/testConnection.js';
// ...
  app.post<{ Params: { id: string } }>(
    '/api/portals/:id/test-connection',
    async (req, reply) => {
      const portal = svc.getPortal(app.db, req.params.id);
      if (!portal) return reply.code(404).send(notFoundError('portal'));
      const result = await runConnectionTest(portal.url); // URL sourced only from DB row
      return { result };
    },
  );
```

- [ ] **Step 6: Add the route-level single-source-of-truth test to `test/server/portalRoutes.test.ts`**

```ts
import { startFixtureServer } from '../helpers/fixtureServer.js';

it('test-connection targets whatever URL is saved for the portal (spec §9a)', async () => {
  const site = await startFixtureServer({
    html: '<!doctype html><title>Saved Target</title><body>ok</body>',
  });
  try {
    const p = await create({ url: site.url });
    const res = await app.inject({
      method: 'POST',
      url: `/api/portals/${p.id}/test-connection`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.pageTitle).toBe('Saved Target');
    expect(res.json().result.finalUrl).toBe(site.url);
  } finally {
    await site.close();
  }
});
```

- [ ] **Step 7: Run the new tests**

Run: `npm test -- testConnection portalRoutes`
Expected: PASS (testConnection: 5; portalRoutes: 8).

- [ ] **Step 8: Re-run the audit + full suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS — including `noHardcodedUrl` (the new automation files must stay URL-literal-free).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: navigate-only Test Connection with adapter registry and single-source-of-truth URL

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

---

### Task 8: Frontend — API client + Portals list page

**Files:**
- Create: `src/web/src/api/client.ts`, `src/web/src/lib/portalTypes.ts`
- Replace: `src/web/src/pages/Settings/PortalsPage.tsx` (real implementation)
- Modify: `src/web/src/styles.css` (table + button styles)
- Create: `test/web/PortalsPage.test.tsx`

**Interfaces:**
- Produces in `api/client.ts`: `api` object with typed methods:
  ```ts
  api.listPortals(): Promise<{ portals: VisaPortal[] }>
  api.createPortal(input: PortalInput): Promise<{ portal: VisaPortal }>
  api.updatePortal(id: string, input: PortalInput): Promise<{ portal: VisaPortal }>
  api.deletePortal(id: string): Promise<{ deleted: true }>
  api.getActivePortal(): Promise<{ activePortalId: string | null; portal: VisaPortal | null }>
  api.setActivePortal(portalId: string | null): Promise<{ activePortalId: string | null; portal: VisaPortal | null }>
  api.testConnection(id: string): Promise<{ result: ConnectionTestResult }>
  ```
  On non-2xx it throws `Error(body.error.message)`.
- Produces in `lib/portalTypes.ts`: `PORTAL_TYPE_OPTIONS: { value: PortalType; label: string }[]`
- Produces: `PortalsPage` React component (default-less named export)

- [ ] **Step 1: Create `src/web/src/api/client.ts`**

```ts
import type { PortalInput } from '../../../shared/schemas';
import type { ConnectionTestResult, VisaPortal } from '../../../shared/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  listPortals: () => request<{ portals: VisaPortal[] }>('/portals'),
  createPortal: (input: PortalInput) =>
    request<{ portal: VisaPortal }>('/portals', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updatePortal: (id: string, input: PortalInput) =>
    request<{ portal: VisaPortal }>(`/portals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deletePortal: (id: string) =>
    request<{ deleted: true }>(`/portals/${id}`, { method: 'DELETE' }),
  getActivePortal: () =>
    request<{ activePortalId: string | null; portal: VisaPortal | null }>(
      '/settings/active-portal',
    ),
  setActivePortal: (portalId: string | null) =>
    request<{ activePortalId: string | null; portal: VisaPortal | null }>(
      '/settings/active-portal',
      { method: 'PUT', body: JSON.stringify({ portalId }) },
    ),
  testConnection: (id: string) =>
    request<{ result: ConnectionTestResult }>(`/portals/${id}/test-connection`, {
      method: 'POST',
    }),
};
```

- [ ] **Step 2: Create `src/web/src/lib/portalTypes.ts`**

```ts
import type { PortalType } from '../../../shared/types';

export const PORTAL_TYPE_OPTIONS: { value: PortalType; label: string }[] = [
  { value: 'regular', label: 'Regular Visa' },
  { value: 'evisa', label: 'e-Visa' },
  { value: 'custom', label: 'Custom' },
];
```

- [ ] **Step 3: Write the failing test `test/web/PortalsPage.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortalsPage } from '../../src/web/src/pages/Settings/PortalsPage';

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    listPortals: vi.fn().mockResolvedValue({
      portals: [
        {
          id: 'p1', name: 'Example Visa', url: 'https://example.com',
          portalType: 'evisa', country: 'Exampleland', applicationType: 'Tourist',
          notes: null, enabled: true,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    }),
    getActivePortal: vi.fn().mockResolvedValue({ activePortalId: null, portal: null }),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it('renders the portal list from the API', async () => {
  render(
    <MemoryRouter>
      <PortalsPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('Example Visa')).toBeTruthy());
  expect(screen.getByText('https://example.com')).toBeTruthy();
});

it('shows an empty state when there are no portals', async () => {
  const { api } = await import('../../src/web/src/api/client');
  (api.listPortals as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ portals: [] });
  render(
    <MemoryRouter>
      <PortalsPage />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByText(/no visa portals configured/i)).toBeTruthy(),
  );
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- PortalsPage`
Expected: FAIL — `PortalsPage` is still the placeholder / no list.

- [ ] **Step 5: Implement `src/web/src/pages/Settings/PortalsPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { VisaPortal } from '../../../../shared/types';
import { api } from '../../api/client';
import { PortalForm } from './PortalForm';
import { TestConnectionPanel } from './TestConnectionPanel';

type Editing = { mode: 'create' } | { mode: 'edit'; portal: VisaPortal } | null;

export function PortalsPage() {
  const [portals, setPortals] = useState<VisaPortal[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, active] = await Promise.all([
        api.listPortals(),
        api.getActivePortal(),
      ]);
      setPortals(list.portals);
      setActiveId(active.activePortalId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load portals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function makeActive(id: string | null) {
    try {
      await api.setActivePortal(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set active portal');
    }
  }

  async function remove(portal: VisaPortal) {
    if (!window.confirm(`Delete portal "${portal.name}"?`)) return;
    try {
      await api.deletePortal(portal.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete portal');
    }
  }

  if (editing) {
    return (
      <PortalForm
        initial={editing.mode === 'edit' ? editing.portal : undefined}
        onCancel={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
      />
    );
  }

  return (
    <section>
      <div className="section-head">
        <h2>Visa Portals</h2>
        <button onClick={() => setEditing({ mode: 'create' })}>Add portal</button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && portals.length === 0 && (
        <p>No visa portals configured yet. Add one to get started.</p>
      )}

      {portals.length > 0 && (
        <table className="portals">
          <thead>
            <tr>
              <th>Active</th><th>Name</th><th>URL</th><th>Type</th>
              <th>Country</th><th>Application</th><th>Enabled</th><th></th>
            </tr>
          </thead>
          <tbody>
            {portals.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    type="radio"
                    name="active-portal"
                    aria-label={`Set ${p.name} active`}
                    checked={activeId === p.id}
                    disabled={!p.enabled}
                    onChange={() => makeActive(p.id)}
                  />
                </td>
                <td>{p.name}</td>
                <td className="mono">{p.url}</td>
                <td>{p.portalType}</td>
                <td>{p.country ?? '—'}</td>
                <td>{p.applicationType ?? '—'}</td>
                <td>{p.enabled ? 'Yes' : 'No'}</td>
                <td className="row-actions">
                  <button onClick={() => setEditing({ mode: 'edit', portal: p })}>
                    Edit
                  </button>
                  <button onClick={() => remove(p)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {activeId && (
        <>
          <button className="link" onClick={() => makeActive(null)}>
            Clear active portal
          </button>
          <TestConnectionPanel portalId={activeId} />
        </>
      )}
    </section>
  );
}
```

> NOTE: this imports `PortalForm` and `TestConnectionPanel`, created in Task 9.
> To keep this task's test green now, create minimal stubs:
> `PortalForm.tsx` → `export function PortalForm() { return null; }`
> `TestConnectionPanel.tsx` → `export function TestConnectionPanel() { return null; }`
> Task 9 replaces both.

- [ ] **Step 6: Add table/button styles to `src/web/src/styles.css`**

Add readable styles for `.section-head`, `table.portals`, `.row-actions`, `.error`, `.mono`, `.link`. Keep it simple and legible; no design system.

- [ ] **Step 7: Run the page test**

Run: `npm test -- PortalsPage`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: portals list page with active selection and typed API client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

---

### Task 9: Frontend — Portal form + Test Connection panel

**Files:**
- Replace: `src/web/src/pages/Settings/PortalForm.tsx`, `src/web/src/pages/Settings/TestConnectionPanel.tsx`
- Modify: `src/web/src/styles.css` (form + result styles)
- Create: `test/web/PortalForm.test.tsx`

**Interfaces:**
- Consumes: `api`, `PORTAL_TYPE_OPTIONS`, `isHttpUrl` (from `src/shared/url`), `VisaPortal`, `PortalInput`
- Produces:
  ```ts
  function PortalForm(props: {
    initial?: VisaPortal;
    onCancel: () => void;
    onSaved: (portal: VisaPortal) => void | Promise<void>;
  }): JSX.Element
  function TestConnectionPanel(props: { portalId: string }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test `test/web/PortalForm.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PortalForm } from '../../src/web/src/pages/Settings/PortalForm';

vi.mock('../../src/web/src/api/client', () => ({
  api: {
    createPortal: vi.fn().mockResolvedValue({
      portal: { id: 'new', name: 'New', url: 'https://ok.example' },
    }),
  },
}));

afterEach(() => cleanup());

it('blocks submit and shows an error for a non-http URL', async () => {
  render(<PortalForm onCancel={() => {}} onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText(/portal name/i), {
    target: { value: 'My Portal' },
  });
  fireEvent.change(screen.getByLabelText(/portal url/i), {
    target: { value: 'ftp://bad' },
  });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() =>
    expect(screen.getByText(/valid http\(s\) url/i)).toBeTruthy(),
  );
  expect(api.createPortal).not.toHaveBeenCalled();
});

it('submits a valid new portal', async () => {
  const onSaved = vi.fn();
  render(<PortalForm onCancel={() => {}} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText(/portal name/i), {
    target: { value: 'My Portal' },
  });
  fireEvent.change(screen.getByLabelText(/portal url/i), {
    target: { value: 'https://portal.example/apply' },
  });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  const { api } = await import('../../src/web/src/api/client');
  await waitFor(() => expect(api.createPortal).toHaveBeenCalledTimes(1));
  expect(onSaved).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- PortalForm`
Expected: FAIL — stub `PortalForm` renders `null`.

- [ ] **Step 3: Implement `src/web/src/pages/Settings/PortalForm.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import type { PortalType, VisaPortal } from '../../../../shared/types';
import type { PortalInput } from '../../../../shared/schemas';
import { isHttpUrl } from '../../../../shared/url';
import { PORTAL_TYPE_OPTIONS } from '../../lib/portalTypes';
import { api } from '../../api/client';

interface Props {
  initial?: VisaPortal;
  onCancel: () => void;
  onSaved: (portal: VisaPortal) => void | Promise<void>;
}

export function PortalForm({ initial, onCancel, onSaved }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [portalType, setPortalType] = useState<PortalType>(
    initial?.portalType ?? 'evisa',
  );
  const [country, setCountry] = useState(initial?.country ?? '');
  const [applicationType, setApplicationType] = useState(
    initial?.applicationType ?? '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setSubmitError(null);
    if (name.trim().length === 0) {
      setFieldError('Portal name is required.');
      return;
    }
    if (!isHttpUrl(url.trim())) {
      setFieldError('Portal URL must be a valid http(s) URL.');
      return;
    }
    const payload: PortalInput = {
      name: name.trim(),
      url: url.trim(),
      portalType,
      country: country.trim() || null,
      applicationType: applicationType.trim() || null,
      notes: notes.trim() || null,
      enabled,
    };
    setSaving(true);
    try {
      const res = initial
        ? await api.updatePortal(initial.id, payload)
        : await api.createPortal(payload);
      await onSaved(res.portal);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save portal.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="portal-form" onSubmit={handleSubmit}>
      <h2>{initial ? 'Edit portal' : 'Add portal'}</h2>

      <label>
        Portal name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label>
        Portal URL
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          required
        />
      </label>

      <label>
        Portal type
        <select
          value={portalType}
          onChange={(e) => setPortalType(e.target.value as PortalType)}
        >
          {PORTAL_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Country
        <input value={country} onChange={(e) => setCountry(e.target.value)} />
      </label>

      <label>
        Application / visa type
        <input
          value={applicationType}
          onChange={(e) => setApplicationType(e.target.value)}
        />
      </label>

      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enabled
      </label>

      {fieldError && <p className="error" role="alert">{fieldError}</p>}
      {submitError && <p className="error" role="alert">{submitError}</p>}

      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Implement `src/web/src/pages/Settings/TestConnectionPanel.tsx`**

```tsx
import { useState } from 'react';
import type { ConnectionTestResult } from '../../../../shared/types';
import { api } from '../../api/client';

export function TestConnectionPanel({ portalId }: { portalId: string }) {
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await api.testConnection(portalId);
      setResult(res.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test Connection failed.');
    } finally {
      setRunning(false);
    }
  }

  const flags = result
    ? Object.entries(result.securityChallengeFlags).filter(([, v]) => v)
    : [];

  return (
    <div className="test-connection">
      <h3>Test Connection</h3>
      <p className="hint">
        Navigates to the active portal URL and reports what it sees. It never
        fills or submits anything, and never solves CAPTCHA/OTP/MFA.
      </p>
      <button onClick={run} disabled={running}>
        {running ? 'Testing…' : 'Run Test Connection'}
      </button>

      {error && <p className="error" role="alert">{error}</p>}

      {result && (
        <dl className="result">
          <dt>Outcome</dt>
          <dd>{result.success ? 'Reachable' : `Failed — ${result.error?.message}`}</dd>
          {result.success && (
            <>
              <dt>HTTP status</dt><dd>{result.httpStatus ?? 'n/a'}</dd>
              <dt>Page title</dt><dd>{result.pageTitle ?? '(none)'}</dd>
              <dt>Final URL</dt><dd className="mono">{result.finalUrl}</dd>
              <dt>Redirected</dt><dd>{result.redirected ? 'Yes' : 'No'}</dd>
              <dt>Elements</dt>
              <dd>
                {Object.entries(result.elementCounts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}
              </dd>
              <dt>Security challenges detected</dt>
              <dd>
                {flags.length === 0
                  ? 'None detected'
                  : `${flags.map(([k]) => k).join(', ')} — you handle these manually`}
              </dd>
              <dt>Screenshot</dt>
              <dd className="mono">{result.screenshotPath ?? '(not captured)'}</dd>
              <dt>Duration</dt><dd>{result.durationMs} ms</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add form + result styles to `src/web/src/styles.css`**

Style `.portal-form label` (block, spacing), `.form-actions`, `.test-connection`, `dl.result`. Keep minimal.

- [ ] **Step 6: Run the form test + full frontend tests**

Run: `npm test -- PortalForm PortalsPage`
Expected: PASS (4 tests total).

- [ ] **Step 7: Full gate**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: portal create/edit form and Test Connection result panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

---

### Task 10: Production build — static serving + `npm start`

**Files:**
- Modify: `src/server/app.ts` (serve `dist/web` when `NODE_ENV=production`)
- Create: `test/server/staticServing.test.ts`

**Interfaces:**
- Consumes: `@fastify/static`, `env.NODE_ENV`
- Produces: in production, `GET /` and unknown non-`/api` routes return `dist/web/index.html`; `/api/*` unknown routes still return a JSON `NOT_FOUND`.

- [ ] **Step 1: Write the failing test `test/server/staticServing.test.ts`**

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let app: FastifyInstance;
let dbPath: string;

beforeEach(async () => {
  vi.resetModules();
  process.env.NODE_ENV = 'production';
  mkdirSync(path.resolve('dist/web'), { recursive: true });
  writeFileSync(path.resolve('dist/web/index.html'), '<!doctype html><title>App</title>');
  dbPath = makeTempDbPath();
  const { buildServer } = await import('../../src/server/app.js');
  app = await buildServer({ dbPath });
});

afterEach(async () => {
  await app.close();
  cleanupTempDb(dbPath);
  process.env.NODE_ENV = 'test';
  rmSync(path.resolve('dist/web/index.html'), { force: true });
  vi.resetModules();
});

it('serves index.html at the root in production', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('<title>App</title>');
});

it('returns SPA fallback for an unknown non-api route', async () => {
  const res = await app.inject({ method: 'GET', url: '/settings/portals' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('App');
});

it('still returns JSON 404 for unknown /api routes', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/nope' });
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe('NOT_FOUND');
});
```

> NOTE: `env.ts` reads `NODE_ENV` at module load. The test sets it before the
> dynamic `import()` and calls `vi.resetModules()` so `env` re-evaluates.
> Keep `pool: 'forks'` (vitest.config) so this env mutation stays isolated.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- staticServing`
Expected: FAIL — root returns 404, no static handler.

- [ ] **Step 3: Add static serving to `src/server/app.ts`**

```ts
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { env } from './env.js';
import { notFoundError } from './routes/errors.js';
// ... after routes are registered, before the error handler:

  if (env.NODE_ENV === 'production') {
    const webRoot = path.resolve('dist/web');
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.code(404).send(notFoundError('route'));
      }
      const indexPath = path.join(webRoot, 'index.html');
      if (existsSync(indexPath)) return reply.type('text/html').send(/* stream */ require('node:fs').createReadStream(indexPath));
      return reply.code(404).send(notFoundError('route'));
    });
  } else {
    app.setNotFoundHandler((req, reply) =>
      reply.code(404).send(notFoundError('route')),
    );
  }
```

Replace the `require(...)` shim with an ESM-friendly read — use `reply.sendFile('index.html')` from `@fastify/static` instead:
```ts
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.code(404).send(notFoundError('route'));
      }
      return reply.sendFile('index.html');
    });
```

- [ ] **Step 4: Run the static test**

Run: `npm test -- staticServing`
Expected: PASS (3 tests).

- [ ] **Step 5: Real build + smoke-start**

Run:
```bash
npm run build
npm start
```
Expected: `dist/web/` and `dist/server/index.js` produced; server boots on 127.0.0.1:5174; open `http://localhost:5174` → UI loads and `/api/health` responds. Stop it. Record the result.

- [ ] **Step 6: Full gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: serve built UI from Fastify in production with SPA fallback

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

---

### Task 11: ADRs, single-source-of-truth audit, and end-of-phase verification

**Files:**
- Create: `docs/architecture/ADR-0001-local-web-app.md` … `ADR-0004-test-connection-navigate-only.md`
- Create: `docs/PHASE-0-REPORT.md`
- Modify: `README.md` (create if missing — run instructions, example portal clearly marked as example)

**Interfaces:** none (documentation + verification only)

- [ ] **Step 1: Write the four ADRs**

Each ADR: `# ADR-000N: <title>` / `## Status: Accepted` / `## Context` / `## Decision` / `## Consequences`. Content:
- **0001** — Local web app (Fastify + Vite dev server, Fastify static in prod) chosen over Electron for Phase 0; Electron can wrap `src/server` later without moving files.
- **0002** — Portal config (incl. URL) stored in `visa_portals` (SQLite); automation engine is portal-agnostic and receives the URL as a parameter; adapters resolved via `registry.ts`; no seed data.
- **0003** — `better-sqlite3` (synchronous, prepared statements, well-supported on Node 24) + hand-rolled `PRAGMA user_version` migration runner instead of an ORM/migration library. Note the documented fallback: Node's built-in `node:sqlite`.
- **0004** — Test Connection is navigate-only / report-only by design; security challenges (CAPTCHA/OTP/MFA) are detected and delegated to the user; enforced by the absence of fill/submit/solve code and guarded by `test/automation/noHardcodedUrl.test.ts` + the `sanitizeError` boundary.

- [ ] **Step 2: Create `README.md`**

Include: what Phase 0 is, `npm install` + `npx playwright install chromium`, `npm run dev`, `npm run build && npm start`, the env vars, and an **"Example portal (illustration only — not a default)"** block:
```
Name: Example Country e-Visa
URL: https://example.gov.example/  (placeholder — replace with your real portal)
Type: e-Visa
```
State explicitly: the app ships with no portals; nothing is hard-coded.

- [ ] **Step 3: Run the manual §9a audit and record the command + output**

Run:
```bash
grep -rniE "https?://[a-z0-9.-]+" src/ | grep -viE "127\.0\.0\.1|localhost|example|w3\.org|schema|fonts\.|recaptcha|hcaptcha|cloudflare"
```
Expected: no matches pointing at a real portal. Also confirm `npm test -- noHardcodedUrl` passes. Paste both into the report.

- [ ] **Step 4: Full verification gate**

Run each and capture exact output for the report:
```bash
npm run typecheck
npm run lint
npm test
npm run build
```
Expected: all pass. Any failure must be documented in the report, not hidden.

- [ ] **Step 5: Manual acceptance walkthrough**

With `npm run dev` running, in the browser:
1. Add a portal (use your real portal URL or `https://example.com`). Confirm it appears in the list.
2. Edit it — change the name — confirm the change persists.
3. Set it active (radio). Confirm the active indicator + "Clear active portal" appears.
4. Run **Test Connection**. Confirm it reports HTTP status, page title, final URL, element counts, security-challenge line, screenshot path. Confirm a PNG exists at that path under `data/screenshots/`.
5. Stop the server (Ctrl+C). Restart `npm run dev`. Confirm the portal **and** the active selection are still there.
6. Delete the portal. Confirm it is removed and the active selection clears.
7. Try to save a portal with URL `not-a-url` and with `ftp://x` — confirm both are rejected with a clear message and nothing is saved.

Record pass/fail for every numbered item.

- [ ] **Step 6: Fill in `docs/PHASE-0-REPORT.md`**

Sections (spec §13): 1) What was implemented; 2) Files changed (from `git diff --stat main..HEAD` or full log); 3) Tests executed (list every test file + count); 4) Test results (paste the gate output from Step 4); 5) Remaining issues / limitations (e.g. no e2e browser test of the UI, `better-sqlite3` native-module dependency, Test Connection is single-shot with a 30s timeout); 6) Recommended next phase (Phase 1 — document upload + extraction). Then walk the spec §12 acceptance checklist and mark each box with evidence.

- [ ] **Step 7: Review the full diff**

Run: `git log --oneline` and `git diff --stat $(git rev-list --max-parents=0 HEAD)..HEAD`
Read every changed file group. Confirm: no stray debug code, no `console.log`, no committed `.env`, no committed `data/`, no hard-coded portal URL, no `dist/` committed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: Phase 0 ADRs, README, and end-of-phase verification report

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FqohHBzHB1VFWaCYBtQmEg"
```

- [ ] **Step 9: Present the end-of-phase report to the user and STOP**

Do not start Phase 1. Present: what was implemented, files changed, tests executed, test results, remaining issues, recommended next phase — and the completed §12 acceptance checklist with evidence per box.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §1 scope / §2 constraints | All tasks; constraints in Global Constraints |
| §3.1 runtime shape | T1 (dev), T10 (prod static) |
| §3.2 repo layout | T1 + File Structure |
| §4 data model (visa_portals, app_settings, user_version, WAL) | T3 |
| §5 validation rules (all fields, protocol rejection) | T2 |
| §6 API (all endpoints, error envelope, codes) | T5, T7 (test-connection) |
| §7 Test Connection (steps, result shape, prohibitions, failure handling) | T6, T7 |
| §8 security infra (pino redaction, .env, data/ gitignore, 127.0.0.1, error sanitizer) | T1 (logger, env, gitignore), T5 (error handler) |
| §9 ADRs | T11 |
| §9a single-source-of-truth audit (+ test proving URL change → target change, + static audit) | T6 (static test), T7 (unit + route test), T11 (manual audit + report) |
| §10 testing strategy (schema, service, active, migrations, test-connection, routes) | T2, T3, T4, T5, T6, T7 |
| §11 dependencies | T1 (package.json + rationale for extras) |
| §12 acceptance checklist | T11 Step 6 |
| §13 end-of-phase report format | T11 Step 6/9 |
| §14 next phase preview | T11 (report section 6) |

No gaps found.

**2. Placeholder scan:** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". `styles.css` steps describe specific selectors to style rather than giving full CSS — acceptable (cosmetic, not behavior; no test depends on exact CSS). ADR/README steps give section-by-section content. The `require('node:fs')` shim in T10 Step 3 is explicitly flagged and replaced with `reply.sendFile` in the same step.

**3. Type consistency:** `VisaPortal` (camelCase) is the single shape from T2 used everywhere; DB rows (snake_case `PortalRow`) are converted only inside `portalService.ts` via `rowToPortal`. `ConnectionTestResult` shape identical in T2 (definition), T7 (`base` object), and T9 (panel rendering). `runConnectionTest(url, deps?)` signature identical in T7 interface, implementation, and both callers (route in T7, test in T7). `buildServer({ dbPath })` identical in T1, T5, T7, T10 and every test. `api.*` method names in T8 match the routes in T5/T7. `PortalNotFoundError`/`PortalDisabledError` names consistent T4 → T5.

Fixes applied inline during review: none required.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-02-phase-0-portal-settings.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
