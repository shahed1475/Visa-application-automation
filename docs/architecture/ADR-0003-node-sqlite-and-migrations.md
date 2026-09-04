# ADR-0003: `node:sqlite` (DatabaseSync) + hand-rolled `user_version` migrations

## Status: Accepted (supersedes the plan's original `better-sqlite3` choice — see Plan Amendment 01)

## Context

Phase 0 needs local persistence for portal configs and app settings. The spec
called for a synchronous SQLite binding with prepared statements and a
hand-rolled migration runner (no ORM, no migration library).

The plan originally specified **`better-sqlite3`**. On the target machine that
native addon cannot load: Windows Application Control / Code Integrity is
*Enforced* and blocks unsigned native `.node` addons (`ERR_DLOPEN_FAILED`). This
is not fixable from userland. The spec's pre-documented fallback — Node's
built-in **`node:sqlite` `DatabaseSync`** — is verified working on Node v24.18.0.

## Decision

- Persistence uses **`node:sqlite` `DatabaseSync`** (built into Node ≥ 22.13 /
  ≥ 23.4; the project pins `engines.node >= 24` and passes only
  `--disable-warning=ExperimentalWarning`). No third-party database dependency.
- **`openDatabase(dbPath)`** opens the file and sets `PRAGMA journal_mode = WAL`
  and `PRAGMA foreign_keys = ON`.
- **Migrations** are an ordered in-code array of `{ version, up }`. `runMigrations`
  reads `PRAGMA user_version`, applies each newer migration inside an explicit
  `BEGIN` / `COMMIT` (rolling back on error), and bumps `user_version`. It is
  idempotent. `LATEST_SCHEMA_VERSION` is exported for tests.
- Statements use **positional `?` parameters** (named-parameter binding differs
  between `node:sqlite` and `better-sqlite3`; positional is unambiguous).
- No `db.transaction()` helper exists on `DatabaseSync`; multi-statement work
  uses explicit `BEGIN`/`COMMIT`/`ROLLBACK` or, for the single-user local case,
  sequential check-then-act.

## Consequences

- **Positive:** zero native-module risk; works under enforced code-integrity
  policy; nothing to compile on install.
- **Positive:** the migration runner is ~20 lines, versioned, transactional, and
  fully tested (`test/server/migrations.test.ts`).
- **Negative:** `node:sqlite` still emits an `ExperimentalWarning` on import in
  Node 24 (suppressed in the npm scripts). `DatabaseSync.close()` throws on
  double-close (unlike `better-sqlite3`) — tests that reopen a DB must close each
  handle exactly once.
- **Negative:** the API surface is narrower than `better-sqlite3` (no bespoke
  transaction helper, no `pragma(..., { simple: true })`); acceptable for this
  project's usage.
