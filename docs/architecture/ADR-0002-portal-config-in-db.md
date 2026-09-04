# ADR-0002: Portal configuration (incl. URL) lives in SQLite, never in code

## Status: Accepted

## Context

The tool is portal-agnostic. A specific visa portal URL must never be baked into
the automation engine, constants, `.env` defaults, tests, or fixtures used as a
runtime target (spec §9a). The engine navigates only to a URL the user has
configured, and portal-specific knowledge (selectors, step maps — later phases)
must stay out of the shared browser code.

## Decision

- A portal is a row in the **`visa_portals`** table
  (`id, name, url, portal_type, country, application_type, notes, enabled,
  created_at, updated_at`). The **`url` column of the active row is the only
  runtime source of truth** for what Playwright navigates to.
- The active portal is a single **`app_settings`** row (`key =
  'active_portal_id'`), not a boolean column — so there is no "exactly one
  active" invariant to enforce across rows. Activating a missing or disabled
  portal is rejected at the service layer; deleting the active portal clears the
  setting.
- The automation engine receives the URL **as a parameter**:
  `runConnectionTest(url, deps?)` has no default, no `||`-fallback, no constant.
- Portal-specific behaviour is resolved through an **adapter registry**
  (`src/server/automation/adapters/registry.ts`). Phase 0 ships only
  `genericAdapter` (portal-agnostic, inspect-only). Future portal adapters keep
  their selectors internal to their own module and declare their own
  `matches(url)`.
- **Phase 0 ships no seed data.** The portal list starts empty. Any example URL
  in documentation is labelled as an example and cannot become a runtime target.

## Consequences

- **Positive:** changing the saved URL changes the Test Connection target with
  zero code changes — proven by `test/automation/testConnection.test.ts`
  ("changing the URL changes the target") and
  `test/server/portalRoutes.test.ts` ("test-connection targets whatever URL is
  saved"). A static guard (`test/automation/noHardcodedUrl.test.ts`) fails the
  build if a URL literal or a known government-visa hostname appears in the
  engine or `src/`.
- **Positive:** the engine stays reusable across portals; adapters are additive.
- **Negative:** every consumer must thread the URL through explicitly; there is
  no ambient "current portal". This is intentional.
