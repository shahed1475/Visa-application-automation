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

**VERDICT: UNCLEAR** — assessed 2026-09-06 (Phase 6, Task 1). Could not verify —
operator must confirm before a live run. A runtime gate
(`src/server/automation/discovery/policyGate.ts`, `assertPolicyAck`) now blocks
any live connection to `indianvisaonline.gov.in` / `ivacbd.com` via the `india`
adapter until the operator records an acknowledgement
(`app_settings` key `portal_policy_ack:<portalId>`).

**robots.txt findings (2026-09-06):**

- `https://indianvisaonline.gov.in/robots.txt` → **HTTP 404** (no robots.txt
  served). Also tried `…/visa/robots.txt` (404). No `Disallow` lines could be
  retrieved for the application paths (`/visa/…`, `/evisa/…`). Public landing and
  e-Visa info pages carry advisory notices about unauthorized intermediaries and
  non-refundable fees, but **no statement found for or against automated /
  assisted access**. The registration/authenticated flow could not be reached
  unauthenticated to review its inline Terms.
- `https://www.ivacbd.com/robots.txt` → retrieved. Cloudflare-managed file with a
  `Content-Signal: search=yes,ai-train=no,use=reference` directive, explicit
  `Disallow: /` for a list of AI crawlers (ClaudeBot, GPTBot, CCBot, Amazonbot,
  Bytespider, Google-Extended, meta-externalagent, Applebot-Extended,
  CloudflareBrowserRenderingCrawler), and a trailing catch-all:

  ```
  User-agent: *
  Disallow: /
  ```

  (An earlier `User-agent: * / Allow: /` block also appears — the file has two
  conflicting `*` records.) Direct non-browser fetches of `www.ivacbd.com` pages
  returned **HTTP 403**. The published Terms & Conditions page
  (`/terms-and-conditions`) also returned 403 and could not be reviewed.

**Rationale.** For `indianvisaonline.gov.in` the position is genuinely
unverifiable from outside the authenticated flow: no robots.txt, no located ToS
clause on automation. For `ivacbd.com` the robots.txt contains a catch-all
`Disallow: /` and the host actively blocks non-browser clients (403), which
should be treated as **effectively prohibiting automated access to ivacbd.com**
pending an operator review of the real Terms & Conditions; the conflicting
`Allow: /` record and the fact that the primary target is a human-driven,
read-only discovery session (not a crawler) leave enough doubt that the overall
verdict is UNCLEAR rather than PROHIBITED. The operator must open each portal's
Terms while authenticated and confirm before enabling Track B; treat
`ivacbd.com` as PROHIBITED unless that review clears it.

**If PROHIBITED, Track B is not executed; the tool remains a manual-entry aid for
this portal.**

Constraints that apply even if a review returns PERMITTED: read-only public-page
discovery only, user-driven authentication, no automated submission, human-only
OTP/CAPTCHA, human-paced navigation (`automation-risks.md` R15).

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
