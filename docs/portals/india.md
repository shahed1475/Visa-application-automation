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

## Track B runbook — progressive live discovery & real-portal validation

**This procedure is operator-only and runs against the real authenticated portal.
It is NEVER run in CI.** Every command that talks to the real portal is gated on
the environment flag `INDIA_LIVE=1`; without it, no live integration check runs and
CI exercises the fixture portal only. Before starting, the operator must have:

- a `PERMITTED` or (operator's-call) `UNCLEAR` verdict in the "ToS / robots.txt
  position" section above — and, for `ivacbd.com`, an authenticated review of the
  real Terms & Conditions that clears it (it is `PROHIBITED` by default);
- a recorded policy acknowledgement for the configured portal
  (`app_settings` key `portal_policy_ack:<portalId>`, written via the Settings
  India card's inline ToS prompt or `POST /api/portals/:id/policy-ack`) — without
  it `DiscoveryController.start()` and `AutomationService.startRun()` both refuse
  with `409 TOS_NOT_ACKNOWLEDGED`;
- an authenticated account on the configured portal and a real in-progress visa
  application to walk;
- `AUTOMATION_HEADLESS=false` for every controlled autofill run (Tests D–G) so the
  operator watches every page.

Run the tests in order. **If a test cannot proceed, stop and record it as
`BLOCKED — <reason>` in the "Live discovery session log" below; Phase 6 still
completes on Track A** (fixture-proven infrastructure + this runbook). Completion
does not require Test G to pass on the real portal — it requires G to pass on
fixture v2 (it does, see `docs/PHASE-6-REPORT.md` §"Fixture-v2 E2E") and this
runbook plus whatever live progress was made to be documented.

### Test A — Start Discovery opens the real portal (headed)

1. Settings → the "India Visa Portal" card → **Start Discovery**.
   (If the card shows an inline ToS prompt first, read `docs/portals/india.md`,
   then confirm the acknowledgement and retry.)
2. **Expected:** a **headed** Chromium window opens at the configured portal URL
   (the single permitted `page.goto`); `POST /api/portals/:id/discovery-sessions`
   returns `201 { session }` with `status: 'active'`; the app navigates to
   `/discovery/:sessionId`.
3. **Stop condition:** browser window open, one `portal_discovery_sessions` row
   with `status = 'active'`.
4. Record `BLOCKED — <reason>` if the window does not open, the ToS gate refuses,
   or a second active session is (correctly) refused with `409 SESSION_ACTIVE`.

### Test B — operator navigates and Captures each page

1. In the headed window the operator logs in, completes any OTP / CAPTCHA **by
   hand**, and navigates the authenticated application flow one page at a time.
   The tool never fills, clicks, types, or navigates.
2. On each meaningful page, in `/discovery/:sessionId` click **Capture this page**.
3. **Expected:** `POST /api/discovery-sessions/:id/capture` returns `201 { page }`;
   a `portal_discovery_pages` row is appended (`seq` increments, `page_count`
   bumps); the page shows the state guess, masked `url_pattern`, title, and
   control/candidate counts — **no applicant values anywhere** (the sanitizer runs
   before insert; `.value` is never read).
4. **Stop condition:** one sanitized `portal_discovery_pages` row per captured
   page; fill the "Fingerprint", "Public-page map", "Authenticated-flow map",
   "Field-analysis table", "Dropdown catalogue", "Validation catalogue" and
   "Security-checkpoint catalogue" tables above from the captured data (by hand —
   Phase 6 persists the data, the markdown is updated manually).
5. Record `BLOCKED — <reason>` if a capture returns `409 SESSION_NOT_ACTIVE`, the
   sanitizer test surfaces a leaked value, or a page cannot be reached.

### Test C — transcribe 3–5 personal-details selectors and Validate

1. On a captured personal-details page, expand the per-page **candidate table**.
   For 3–5 personal-details fields, use **Promote → canonical field** (pick the
   unmapped `appliesTo` path from the `<select>`); this calls
   `POST /api/discovery-sessions/:id/promote` and renders the exact
   `indiaPortalMap.ts` `IndiaFieldMapping` literal (`status: 'discovered'`,
   `discoveredAt`, `discoverySessionRef`).
2. Paste each rendered literal into `src/server/automation/adapters/india/indiaPortalMap.ts`.
   **Never hand-edit a selector the promote output did not produce** — the
   provenance guard test fails the build on a non-placeholder selector without a
   `discoverySessionRef`.
3. Re-run the gate (`npm run typecheck && npm run lint && npm test && npm run build`).
4. In `/discovery/:sessionId` click **Validate Adapter** while the live page is the
   personal-details page.
5. **Expected:** `POST /api/discovery-sessions/:id/validate-adapter` returns
   `200 { report }`; each transcribed selector resolves to exactly one node with a
   matching control kind (`AdapterValidationReport.fields[*].resolvable === true &&
   controlMatches === true`); the report is value-free and persisted as
   `portal_discovery_sessions.last_validation_json`.
6. **Stop condition:** those 3–5 mappings show `resolvable` + `controlMatches` in
   the report; commit them as `feat(phase-6): india personal-details selectors from
   discovery session <id>`.
7. Record `BLOCKED — <reason>` if a selector fails to resolve, the control kind
   mismatches, or the gate goes red.

### Test D — controlled autofill of the first real page, verify-and-pause

1. Complete the personal-details mapping for that page (all required fields
   `discovered`, `nextSelector` set). Start an automation run from
   `/applications/:id` → **Start automation** (`AUTOMATION_HEADLESS=false`).
2. **Expected:** the run detects the personal-details page (identity ≥ 0.6 from
   URL + heading + anchor), fills each mapped field, **reads it back**, emits
   `FIELD_VERIFIED` per field; on reaching the next page whose selectors are still
   placeholders `indiaAdapter.clickNext` throws / the loop pauses `unknown_page`.
3. **Stop condition:** the personal-details section shows every field verified in
   `AutomationRunPage`; the run is paused (not `review_ready`); `submitCount`
   is not applicable (no submit affordance exists).
4. Record `BLOCKED — <reason>` if a field will not verify (`value_mismatch` pause),
   the page is misidentified (`UNKNOWN_PORTAL_STATE`), or navigation stalls.

### Test E — a pre-existing-value conflict on the real portal → the 3-way panel

1. On a real page where the portal already holds a **different, non-empty** value
   for a mapped field (a prior session, or manual entry), start / continue a
   controlled run.
2. **Expected:** the engine's pre-fill classifier returns `conflict`; the run emits
   `VALUE_CONFLICT`, records the `{ expected, actual }` pair **in memory only**
   (`GET /api/automation-runs/:id/live`), and pauses `waiting_reason =
   'value_conflict'`. `AutomationRunPage` shows the ACTION REQUIRED panel with the
   single `/live` pair and three buttons: **Use application value**, **Keep portal
   value**, **Edit application**.
3. Choose one:
   - **Use application value** → `POST /resume { decision: 'use_application' }` →
     `FIELD_CONFLICT_OVERWRITTEN` → field overwritten + read-back-verified.
   - **Keep portal value** → `POST /resume { decision: 'keep_portal' }` →
     `FIELD_CONFLICT_KEPT` → field skipped (not counted toward `fields_verified`).
4. **Stop condition:** the run continues past the field per the chosen decision;
   the re-walk after resume does **not** re-pause on the same field; neither value
   appears in `automation_events` or any log (only in `/live`).
5. Record `BLOCKED — <reason>` if resume without a decision is not rejected `400`,
   the re-walk re-pauses, or a value leaks into an event.

### Test F — an OTP / CAPTCHA checkpoint on the real portal → pause + human

1. Let a controlled run reach a portal page carrying an OTP or CAPTCHA challenge.
2. **Expected:** `detectCheckpoint` fires; the run emits `OTP_REQUIRED` /
   `CAPTCHA_REQUIRED` (precedence `captcha > anti_bot > mfa > otp`),
   `page.bringToFront()` foregrounds the browser, and the run pauses
   `waiting_reason = otp | captcha`. Nothing is solved, retrieved, or bypassed.
3. The operator completes the challenge **by hand** in the browser, then clicks
   **Resume**. Resume re-runs `detectCheckpoint`: still present → `409
   CHECKPOINT_STILL_PRESENT` + a `CHECKPOINT_STILL_PRESENT` event; cleared → the
   run continues.
4. **Stop condition:** the run advances past the checkpoint page after the human
   completes it and resumes.
5. Record `BLOCKED — <reason>` if the checkpoint is not detected, `bringToFront`
   does not foreground, or resume proceeds while the challenge is still present.

### Test G — a full controlled walk to the portal's final review page → stop, never submit

1. With every applicable section mapped and `validated` across earlier sessions,
   start a full controlled preparation run over all applicable fields + required
   documents (`AUTOMATION_HEADLESS=false`). Required documents that are not
   uploaded block with `BLOCKED_MISSING_DOCUMENT`; an in-portal attach step pauses
   `document_upload_required` for the operator to attach files by hand.
2. **Expected:** the run walks every section, fills and verifies each field,
   reaches the portal's final review page, sets `status = review_ready`, emits
   `REVIEW_READY`, and **STOPS**. The loop never calls a submit control —
   `submitSelector` is the literal `null`, there is no `submitted` / `completed`
   run status or event type, and the loop `return`s at `isFinalReview` before any
   further action.
3. **Stop condition:** `review_ready`; the SAFE STOP banner is shown; the operator
   confirms in the browser that **nothing was submitted** and no payment or
   appointment step ran.
4. Record `BLOCKED — <reason>` if the run fails to reach the final review page, or
   `PARTIAL` with the furthest section reached.

### Live discovery session log

**NOT ATTEMPTED — deferred: requires the operator present + an authenticated ToS
review clearing the portal; Phase 6 is complete on Track A (fixture-proven
infrastructure + operator runbook).**

Tests A–G have not been run against `indianvisaonline.gov.in` or any IVAC portal.
No live discovery session has been started; `indiaPortalMap.ts` still ships every
selector as `'TODO:discover'` / `status: 'placeholder'`; no
`portal_discovery_sessions` row has ever been created against a real host. The ToS
verdict is `UNCLEAR` and `ivacbd.com` is treated as `PROHIBITED` pending an
authenticated operator review; the operator was not available for a live session.
When a session is run, record per test: date, session id, portal host, the result
(`PASS` / `PARTIAL` / `BLOCKED — <reason>`), and the commit SHA of any
`indiaPortalMap.ts` selector edits.

| Test | Date | Session id | Result | Notes |
|------|------|------------|--------|-------|
| A | — | — | NOT ATTEMPTED | deferred — operator + ToS review required |
| B | — | — | NOT ATTEMPTED | deferred |
| C | — | — | NOT ATTEMPTED | deferred |
| D | — | — | NOT ATTEMPTED | deferred |
| E | — | — | NOT ATTEMPTED | deferred |
| F | — | — | NOT ATTEMPTED | deferred |
| G | — | — | NOT ATTEMPTED | deferred |

---

## Phase 7 — production-controlled autofill procedures

Phase 7 makes the adapter refuse to autofill any mapping that is not
**production-usable**: `status: 'validated'` **and**
`validatedAgainstRevision === indiaPortalMap.mappingRevision`. Everything below is
the operator workflow that gets a mapping to that state and keeps it there.

### Mapping lifecycle

```
placeholder ──discovery──▶ discovered ──human validation──▶ validated ──(revision bump)──▶ stale
                                                               │                              │
                                                       production-usable          NOT usable — re-validate
```

- A `validated` mapping with **no** `validatedAgainstRevision`, or one stamped
  against an **older** `mappingRevision`, is `stale` — it never reaches the engine.
- `getFieldMap()` exposes only the production-usable subset. Today that is the
  **empty set** — every real mapping is still `'TODO:discover'`.

### Field-validation procedure (one field / safe group at a time)

1. **Discover.** Run a Track B session (Tests A–B). `POST
   /api/discovery-sessions/:id/capture` on each page.
2. **Promote.** `POST /api/discovery-sessions/:id/promote` with
   `{ pageSeq, candidateIndex, canonicalFieldPath }`. The response `literal` is a
   paste-ready `indiaPortalMap.fields['<path>']` entry at `status: 'discovered'`.
   The app never writes adapter source — a human pastes and reviews it.
3. **Review the selector** against the live DOM. Confirm it is stable
   (id / `name` / a `data-*` hook — not an nth-child chain). If the portal offers
   a second stable locator, add it as `fallbackSelector`.
4. **Validate.** `POST /api/discovery-sessions/:id/validate-adapter` — the selector
   must resolve to one control of the declared kind (a `radio`/`checkbox` group
   resolves to ≥1 `<input>` of that type), `<select>` option labels dump clean.
5. **Stamp.** Hand-edit `indiaPortalMap.ts`:
   ```ts
   status: 'validated',
   validatedAt: '<ISO now>',
   validatedAgainstRevision: '<current indiaPortalMap.mappingRevision>',
   discoverySessionRef: '<session id>',
   ```
   For a **date** field also assign `transform` + `readBackParse` from
   `adapters/india/transforms.ts` matching the observed portal format (e.g.
   `transform: isoToDMY, readBackParse: parseDMY` for a `DD/MM/YYYY` field). Never
   guess the format — if the field reformats its own value on blur, mark it **Not
   supported** and leave it for manual entry.
6. **Commit** the selector edits separately:
   `feat(phase-7): india <section> selectors from discovery session <id>`.

### Mapping-promotion checklist (what a human confirms before stamping)

- selector came from an actual discovery capture (`discoverySessionRef` set);
- selector resolves to exactly the intended control on the live page;
- `control` kind matches (`validate-adapter` `controlMatches: true`);
- for a `<select>`: the plan's canonical values map to real option
  labels/values (`optionMatch` set correctly);
- for a date: an explicit `transform`/`readBackParse` pair, round-trip-checked;
- `validatedAgainstRevision` equals the **current** `mappingRevision`.

### Recovery procedures

| The run paused with… | What happened | Do this |
|---|---|---|
| `stale_mapping` (`MAPPING_NOT_PRODUCTION_READY`) | a required field's mapping is `placeholder` / `discovered`, or `validated` against an old revision | run discovery + `validate-adapter` for that field, then re-stamp `validatedAgainstRevision` to the current `mappingRevision`. If a `mappingRevision` bump staled everything, re-validate every field before the next run. |
| `option_unavailable` (`DROPDOWN_OPTION_MISSING`) | the portal `<select>` no longer offers the exact option the plan asked for (renamed / removed / disabled) | re-discover the option set; fix the plan value or the mapping's `optionMatch`. Never hand-edit the mapping to point at a "close" option. |
| `SELECTOR_STALE` in the diagnostics count (run continued) | the primary selector missed; the configured `fallbackSelector` carried the run | re-discover the primary selector, update `selector`, keep the fallback, re-stamp. |
| `missing_field_mapping` (`FIELD_UNMAPPED` / `FIELD_NOT_FOUND`) | the field has no mapping at all, or **both** primary and fallback selectors are gone | discover + promote + validate the field; or enter it by hand in the browser and Resume. |
| `unknown_page` (`UNKNOWN_PORTAL_STATE`) | the portal is not on a page the adapter recognises (incl. a session-expired / login-redirect page) | check the browser: sign in again if the session expired, then Resume; if the portal changed, re-run discovery for the new page identity. |
| `otp` / `captcha` / `mfa` / `anti_bot` | a human challenge is on the page | complete it in the browser window, then Resume. The run re-detects and re-validates the page before continuing; a still-present challenge returns `409 CHECKPOINT_STILL_PRESENT`. |
| `value_conflict` | the portal already holds a different value for a field | choose **Use application value** / **Keep portal value** / **Edit application** on the run page. The two values live only in the in-memory `/live` surface. |
| `document_upload_required` | a required document is not attached | attach it in the browser, then Resume. Phase 7 does not drive the file chooser. |

### OTP / CAPTCHA pause–resume

The automation **detects** a challenge and pauses — it never solves, retrieves,
or bypasses one. Sequence: pause → `page.bringToFront()` → operator completes the
challenge in the real browser → operator clicks **Resume** → the run reloads the
page, re-runs checkpoint detection, and only continues if the challenge is gone.

### Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Run refuses to start, `409 TOS_NOT_ACKNOWLEDGED` | no `portal_policy_ack` for this portal id | acknowledge the portal Terms in Settings → India Visa Portal (records `app_settings` key `portal_policy_ack:<portalId>`) |
| Run pauses `stale_mapping` immediately | nothing is production-usable (0 validated + current mappings) | run Track B and validate the fields the plan needs |
| Provenance line shows `0 / 26 production-ready` + stale-mapping warning | expected until Track B validates real selectors | — |
| A date field pauses `value_mismatch` on read-back | the portal echoes a different date format than it accepts | that field needs a custom transform, or is **Not supported** — enter it by hand |
| `clickNext` throws "next-page selector not production-ready" | the state's `nextSelector` is a placeholder / stale | discover + validate the state's `nextSelector`, stamp `nextSelectorValidatedAgainstRevision` |

### Field support tables

**Validated** — production-usable right now:

| Canonical path | Portal selector | Control | Session | Notes |
|---|---|---|---|---|
| _(none — every mapping is still `'TODO:discover'`; Track B not executed)_ | | | | |

**Discovered but not validated** — a selector exists at `status: 'discovered'`,
awaiting human validation + a revision stamp:

| Canonical path | Portal selector | Control | Session | Blocker |
|---|---|---|---|---|
| _(none)_ | | | | |

**Not supported** — no canonical model / KB backing, or portal behaviour the
adapter deliberately does not automate:

| Canonical path in `indiaPortalMap.ts` | Reason |
|---|---|
| `application.indiaCompanyName` / `application.indiaCompanyAddress` / `application.natureOfBusiness` | conditional business-visa fields; present in the map for completeness, filled only when the Phase 4 plan marks them applicable |
| document uploads | detect-and-pause only; the operator attaches files in the browser |
| account registration, payment, appointment booking, final submission | out of scope by design — human actions only |

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
