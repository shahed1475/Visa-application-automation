# Plan Amendment 01 — Replace `better-sqlite3` with `node:sqlite`

**Date:** 2026-09-02
**Applies to:** `docs/superpowers/plans/2026-09-02-phase-0-portal-settings.md`
**Status:** Approved by user. **Overrides every `better-sqlite3` reference in the plan.**

## Why

`better-sqlite3`'s native `.node` addon cannot load on the target machine —
Windows Application Control / Code Integrity is *Enforced* and blocks unsigned
native addons (`ERR_DLOPEN_FAILED`). Not fixable from userland. The plan's
pre-documented fallback (spec §11, ADR-0003) — Node's built-in `node:sqlite`
`DatabaseSync` — is verified working on Node v24.18.0 here.

## Global substitutions (apply everywhere in the plan)

| Plan says | Use instead |
|-----------|-------------|
| `better-sqlite3` dependency | *(removed)* — `node:sqlite` is built in |
| `@types/better-sqlite3` devDependency | *(removed)* — types ship with `@types/node` |
| `import Database from 'better-sqlite3'` | `import { DatabaseSync } from 'node:sqlite'` |
| `import type BetterSqlite3 from 'better-sqlite3'` | `import type { DatabaseSync } from 'node:sqlite'` |
| `BetterSqlite3.Database` / `Database.Database` (type) | `DatabaseSync` |
| `new Database(dbPath)` | `new DatabaseSync(dbPath)` |
| `db.pragma('user_version', { simple: true })` (read) | `(db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version` |
| `db.pragma(\`user_version = ${n}\`)` (write) | `db.exec(\`PRAGMA user_version = ${n}\`)` |
| `db.pragma('journal_mode = WAL')` etc. | `db.exec('PRAGMA journal_mode = WAL')` etc. |
| `db.transaction(fn)` helper | explicit `db.exec('BEGIN')` / `'COMMIT'` / `'ROLLBACK'` in try/catch |

`db.prepare(...)`, `.get()`, `.all()`, `.run()`, `db.exec(...)`, `db.close()`
exist on `DatabaseSync` and behave equivalently for this project's usage.

## Specific file changes

### `package.json` (Task 1)

- **dependencies:** remove `better-sqlite3`. Keep everything else.
- **devDependencies:** remove `@types/better-sqlite3`. Bump `@types/node` to `^24.0.0`
  (so `node:sqlite` types resolve). Bump `vitest` to `^3.0.0` (**ratified** — vitest 2.x
  strips the `node:` specifier prefix and cannot resolve `node:sqlite`, collecting 0
  tests with `Failed to load url sqlite`; fixed in vitest 3, which runs fine on the
  still-pinned `vite@^5.4` / `@vitejs/plugin-react@^4.3`). If `@vitest/coverage-*` is
  ever added it must match `^3`.
- **scripts:** `node:sqlite` emits an `ExperimentalWarning` on import in Node 24.
  Prefix the node-invoking scripts with
  `cross-env NODE_OPTIONS=--disable-warning=ExperimentalWarning` so output stays
  pristine:
  ```json
  "dev:server": "cross-env NODE_OPTIONS=--disable-warning=ExperimentalWarning tsx watch src/server/index.ts",
  "start": "cross-env NODE_ENV=production NODE_OPTIONS=--disable-warning=ExperimentalWarning node dist/server/index.js",
  "test": "cross-env NODE_OPTIONS=--disable-warning=ExperimentalWarning vitest run",
  "test:watch": "cross-env NODE_OPTIONS=--disable-warning=ExperimentalWarning vitest"
  ```
  (`dev` stays `concurrently ... npm:dev:server npm:dev:web`; `typecheck` and
  `lint` don't touch `node:sqlite`.)

### `src/server/db/connection.ts` (Task 1 stub, Task 3 final)

```ts
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
```

### `src/server/db/migrations.ts` (Task 1 stub, Task 3 final)

Task 1 stub:
```ts
import type { DatabaseSync } from 'node:sqlite';
export function runMigrations(_db: DatabaseSync): void {
  // Filled in Task 3.
}
```

Task 3 final `runMigrations` body:
```ts
export function runMigrations(db: DatabaseSync): void {
  const { user_version: current } = db
    .prepare('PRAGMA user_version')
    .get() as { user_version: number };
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.up);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
```
`migration.version` is an integer from an in-code constant array — never user
input — so the template-literal `PRAGMA` write is safe. `LATEST_SCHEMA_VERSION`
is unchanged.

Task 3 test: `db.pragma('user_version', { simple: true })` in the plan's test
code becomes
`(db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version`.

### `src/server/fastify.d.ts` (Task 1)

```ts
import type { DatabaseSync } from 'node:sqlite';
declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseSync;
  }
}
```

### `src/server/services/portalService.ts` (Task 4) — named-parameter binding

`node:sqlite` named parameters differ from `better-sqlite3`. In SQL, use `:name`.
When binding, EITHER pass an object whose keys include the `:` prefix, OR call
`stmt.setAllowBareNamedParameters(true)` once before `.run(obj)` with bare keys,
OR use positional `?` parameters. **Pick positional `?` parameters** for the
INSERT and UPDATE statements — unambiguous and dependency-neutral:

```ts
db.prepare(
  `INSERT INTO visa_portals
     (id, name, url, portal_type, country, application_type, notes, enabled, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(id, input.name, input.url, input.portalType, input.country,
      input.applicationType, input.notes, input.enabled ? 1 : 0, now, now);
```

`.get(id)` / `.all()` with positional `?` are already positional in the plan and
need no change. Everything else in Task 4 (row mapping, `getActivePortalId`,
`setActivePortal` upsert via `ON CONFLICT`) is unchanged — just positional `?`.

### `src/server/app.ts` logger typing (Task 1) — ratified deviation

Passing a concrete pino instance as `Fastify({ loggerInstance })` trips a type
mismatch (fastify 5.12 / pino 9.14: `FastifyBaseLogger` vs pino `BaseLogger`
`msgPrefix`). **Preferred fix:** let `buildServer`'s return type infer (drop the
explicit `: Promise<FastifyInstance>` annotation) and keep
`Fastify({ loggerInstance: logger })`. If that still doesn't typecheck, a single
`loggerInstance: logger as unknown as FastifyBaseLogger` with a one-line comment
is acceptable. Runtime behaviour is identical either way.

### Tests that type the db (Tasks 1, 3, 4, 5, 7, 10)

Replace `let db: BetterSqlite3.Database;` with `let db: DatabaseSync;` and the
import accordingly. `test/helpers/tempDb.ts` is unaffected (it only deals in file
paths).

## Not changed

- `§9a` single-source-of-truth: unchanged. The portal URL still comes only from
  the DB row.
- Security infrastructure, redaction, `data/` gitignore, `127.0.0.1` bind: unchanged.
- Automation engine, adapters, Test Connection, frontend: unchanged (they never
  imported `better-sqlite3`).
- ADR-0003 should be written to describe the **actual** choice: `node:sqlite`
  `DatabaseSync`, adopted because the machine's Application Control policy blocks
  native addons; hand-rolled `user_version` migration runner unchanged.
