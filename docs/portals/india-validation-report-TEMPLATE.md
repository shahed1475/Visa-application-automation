# India portal — Track B per-field validation report (per session)

> **How to use.** Copy this file to
> `docs/portals/india-validation-report-<sessionId>.md` at the start of a Track B
> live discovery session, fill it as you go (steps 6–18 of the "Track B execution
> checklist (numbered)" in `docs/portals/india.md`), and commit it in the SAME
> commit as the `src/server/automation/adapters/india/indiaPortalMap.ts` selector
> edits it documents.
>
> **This file records STRUCTURE and OUTCOMES only** — selectors, control kinds,
> option *counts*, pages walked, checkpoints cleared. It must contain **no
> secrets, no OTP/CAPTCHA values, no real applicant data, and no dropdown option
> labels** (counts only). If you are about to paste a value, stop.

---

## Session front-matter

| Field | Value |
|---|---|
| Portal id (Settings entry) | `<portal id>` |
| Portal URL snapshot (the stored URL `page.goto` opened) | `<https://…>` |
| Portal type (`regular` / `evisa`) | `<…>` |
| Discovery `sessionId` (`portal_discovery_sessions.id`) | `<…>` |
| Session date (ISO, local) | `<YYYY-MM-DD>` |
| Operator | `<name>` |
| Adapter version (git sha of `src/server/automation/adapters/india/` at session start) | `<sha>` |
| `indiaPortalMap.mappingRevision` at session start | `<revision string>` |
| ToS / robots.txt verdict in force (`PERMITTED` / `UNCLEAR` — operator's call) | `<…>` |
| Policy acknowledgement recorded (`app_settings` key `portal_policy_ack:<portalId>`) | `Y / N` |
| `AUTOMATION_HEADLESS` for every controlled autofill run | `false` |

---

## Pages walked

One row per meaningful portal page reached (in order). "Outcome" is one of:
`captured` · `captured + promoted` · `autofilled + verified` · `checkpoint —
cleared by operator` · `BLOCKED — <reason>` · `PARTIAL — <furthest point>`.

| # | Portal state / page (heading or adapter state guess) | Masked `url_pattern` | Capture `seq` | Outcome |
|---|---|---|---|---|
| 1 | `<…>` | `<…>` | `<…>` | `<…>` |
| 2 | | | | |
| 3 | | | | |

---

## Per-field validation

One row per canonical field touched this session. Fill `read-back verified?` only
after a controlled autofill run actually wrote the field and the value was read
back on the portal (checklist step 12 / Test D). `status stamped`,
`validatedAgainstRevision`, `validatedAt` are the three hand-applied stamps in
`indiaPortalMap.ts` (the `// TODO:` comment lines mark the spot); leave them at
`discovered` / blank for a field that did not clear read-back + `validate-adapter`.
**Options observed = COUNT ONLY. Never the labels.**

| canonical field path | portal selector | fallback selector | control kind | options observed (count only) | date transform (if any) | read-back verified? (Y/N) | status stamped | validatedAgainstRevision | validatedAt | commit sha |
|---|---|---|---|---|---|---|---|---|---|---|
| `<application.…>` | `<selector>` | `<selector or —>` | `text` / `select` / `radio` / `checkbox` / `date` | `<n or —>` | `isoToDMY` / `parseDMY` / `—` | `<Y/N>` | `discovered` / `validated` | `<revision or —>` | `<ISO or —>` | `<sha or —>` |
| | | | | | | | | | | |
| | | | | | | | | | | |

### Fields deliberately NOT automated

| canonical field path | reason (self-reformats on blur / no canonical backing / conditional / operator-only) |
|---|---|
| `<…>` | `<…>` |

---

## Checkpoints encountered

One row per OTP / CAPTCHA / MFA / anti-bot / login-redirect / session-expired
page hit during the session. The operator clears every one **by hand** in the
browser — the tool only detects and pauses.

| Checkpoint type (`otp` / `captcha` / `mfa` / `anti_bot` / `login-redirect` / `session-expired`) | Portal page it appeared on | How the operator cleared it | Run resumed cleanly? (Y/N) |
|---|---|---|---|
| `<…>` | `<…>` | `<…>` | `<…>` |

---

## Adapter validation (`POST /api/discovery-sessions/:id/validate-adapter`)

| Run | Live page at time of run | Non-placeholder selectors checked | All `resolvable`? | All `controlMatches`? | Notes |
|---|---|---|---|---|---|
| 1 | `<…>` | `<n>` | `<Y/N>` | `<Y/N>` | `<…>` |

---

## Totals

| Metric | Count |
|---|---|
| Fields validated this session (`status: 'validated'` + current `mappingRevision`) | `<n>` |
| Fields discovered but NOT validated (`status: 'discovered'`) | `<n>` |
| Fields still placeholder (`'TODO:discover'`) | `<n>` |
| Fields production-usable AFTER this session (adapter `getFieldMap()` subset) | `<n>` |
| Required fields (per the application plan walked) still WITHOUT a production mapping | `<n>` |

Required fields still unmapped (canonical paths):

- `<application.…>`
- `<…>`

---

## Session log entry (also add to `docs/portals/india.md` → "### Live discovery session log")

| Test | Date | Session id | Result | Notes |
|------|------|------------|--------|-------|
| A | `<…>` | `<…>` | `PASS` / `PARTIAL` / `BLOCKED — <reason>` | |
| B | | | | |
| C | | | | |
| D | | | | |
| E | | | | |
| F | | | | |
| G | | | | |

---

## Attestation

> No submission, payment, appointment booking, or account registration was
> attempted during this session. The run's `submitCount` remained **0**
> (`submitSelector` is the literal `null`; there is no `submitted` / `completed`
> run status). OTP and CAPTCHA challenges were completed **by the operator only**
> in the real browser window — the tool detected and paused, it never solved,
> retrieved, or bypassed a challenge. No selector was promoted straight to
> `validated`: every production selector went through a controlled read-back and
> this git-reviewed commit. No applicant values, secrets, or dropdown option
> labels are recorded in this file.

Operator signature: `___________________________`  Date: `____________`
