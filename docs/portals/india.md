# Portal Appendix: India visa portal (configured per Settings)

- Portal ID (Settings): _(from the Settings entry — not hard-coded here)_
- Portal type: `regular` / `evisa` — **configured per Settings**
- Country / application type: India — _(from Settings)_
- Discovery run date: _(none yet)_
- Discovery stage reached: **`NOT STARTED`**
- Automation boundary reached at: **`not yet discovered`**

> **Status.** This appendix is a scaffold. The India adapter
> (`src/server/automation/adapters/india/`) ships with **placeholder selectors**
> (`'TODO:discover'`, `selectorConfidence: 'fragile'`). No automation run can
> proceed past the first page until a user-driven discovery session against the
> authenticated portal fills these tables in and the adapter's `nextSelector` /
> field selectors are populated. Never guess a selector — if discovery did not
> observe it, the cell stays `unknown` (docs/visa-form-analysis.md §8.1).

## ToS / robots.txt position

Not yet assessed. Before any live-portal discovery run: check the portal's Terms
of Service for a prohibition on automated/assisted access, and its robots.txt for
the application paths. If assisted automation is prohibited, record it here and do
not use the tool against this portal (`automation-risks.md` R15). Discovery is
public-pages-only, read-only, human-paced; the authenticated flow is user-driven.

## Fingerprint

<!-- §8.2 table — populate from a discovery run -->

| Signal | Observation |
|--------|-------------|
| Rendering (plain HTML / SSR template / SPA) | _(populate from a discovery run)_ |
| ASP.NET WebForms markers (`__VIEWSTATE`, `__EVENTTARGET`) | _(populate from a discovery run)_ |
| Client framework version | _(populate from a discovery run)_ |
| Fields inside `<iframe>` | _(populate from a discovery run)_ |
| Shadow DOM / web components | _(populate from a discovery run)_ |
| Autoformatting / input masks | _(populate from a discovery run)_ |
| CSP / anti-automation headers, bot-detection JS | _(populate from a discovery run)_ |
| i18n: language switch, locale-dependent date formats | _(populate from a discovery run)_ |

## Public-page map (D1)

| Path | Title | Purpose | Key links/buttons | Forms before boundary | Leads to reg/login/security? |
|------|-------|---------|-------------------|-----------------------|------------------------------|
| _(populate from a discovery run)_ | | | | | |

## Authenticated-flow map (D2) — only if/when user-driven discovery is done

_(populate from a discovery run — §12 workflow map + one step record per step)_

Provisional page/state sequence the adapter models (headings only, unverified):
`REGISTRATION → OTP → PERSONAL_DETAILS → PASSPORT_DETAILS → ADDRESS → FAMILY →
OCCUPATION → VISA_DETAILS → REFERENCES → DOCUMENTS → REVIEW → FINAL_REVIEW`.
Final submission on `FINAL_REVIEW` is a **user action only** — the adapter's
`submitSelector` is the literal `null`.

## Field-analysis table

<!-- §2.2 extended table — the real rows. Empty until discovery. -->

| Page | Section | Field ID | Label | Input Type | Required | Data Source | Dynamic? | Depends On | Validation | Confidence | Verification Method | Automation Strategy | Notes |
|------|---------|----------|-------|-----------|----------|-------------|----------|-----------|-----------|-----------|--------------------|--------------------|-------|
| _(populate from a discovery run)_ | | | | | | | | | | | | | |

## Dropdown catalogue

<!-- one §6.3 block per dropdown -->

| Field ID | Options observed | Option-match strategy | Dependent on | Notes |
|----------|------------------|-----------------------|--------------|-------|
| _(populate from a discovery run)_ | | | | |

## Validation catalogue

<!-- §10.1 blocks -->

| Scope | Side | Trigger | Error surface | Message text | Blocking | Notes |
|-------|------|---------|---------------|--------------|----------|-------|
| _(populate from a discovery run)_ | | | | | | |

## Security-checkpoint catalogue

<!-- §11.1 blocks -->

| Checkpoint ID | Type | Location in flow | Trigger | Detection signals | Completion signal | Notes |
|---------------|------|------------------|---------|-------------------|-------------------|-------|
| _(populate from a discovery run)_ | | | | | | |

## Required-field & conditional-logic manifest

<!-- §9 — per workflow step. Empty until discovery. -->

_(populate from a discovery run)_

## Adapter configuration notes

The adapter module (`src/server/automation/adapters/india/indiaPortalMap.ts`)
holds: `matchesUrl` (host pattern), per-state `headingPattern` / `anchorField` /
`sectionIds` / `nextSelector`, the canonical-path → selector `fields` map,
`uploadStates`, `checkpointHints`, and `submitSelector: null`. Every selector is
currently `'TODO:discover'`. A discovery run populates:

- each state's `anchorField` and `nextSelector` (the "Next" / "Save & Continue" control),
- each `fields[...]` entry's `selector`, `fallbackSelector`, `selectorConfidence`, `control`, `optionMatch`,
- the `DOCUMENTS` state's document-id set (`documentIdsForState`).

## Open questions

- Portal type in effect (`regular` vs `evisa`) — resolved from the Settings entry at run time.
- Whether the authenticated flow is a linear wizard, tabbed, or server-postback (fingerprint).
- Real page headings vs the provisional `headingPattern`s above.
- Session idle timeout and resume mechanism (application reference number).
- ToS / robots.txt position (see section above) — **must be assessed before any live run**.
