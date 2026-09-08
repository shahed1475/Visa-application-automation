## What this is

The complete implementation of the local India-visa autofill agent, Phases 0–8, against the docs-only `master` baseline. `master` currently contains only planning documents and no `src/` — this PR brings the entire codebase.

**223 commits · 342 files · ~76k insertions.**

## Hard safety rails (unchanged across every phase)

```
Automatic final visa submission:      NOT IMPLEMENTED
Payment / fee handling:                NOT IMPLEMENTED
Appointment booking:                   NOT IMPLEMENTED
OTP / CAPTCHA / anti-bot bypass:       NOT IMPLEMENTED
Real Indian portal fields validated:   NONE (Track B not executed)
```

The automation's only terminal success state is `review_ready` — it fills the form, verifies every value it wrote, and stops at the portal's review page for the human operator to check and submit manually. No branch is gated on a timing profile or any value that could skip a read-back, checkpoint, or safe-stop. Timing is reliability-only: fixed waits, no `Math.random`, no jitter, no stealth plugin, no `navigator.webdriver` spoofing.

## Phase by phase

| Phase | Delivers |
|---|---|
| **0** | Configurable visa-portal settings foundation; portal-URL single-source-of-truth; `node:sqlite` persistence |
| **1** | India visa knowledge base (Regular-visa data, with provenance caveats) |
| **2** | Applicant profile system |
| **3** | Passport OCR & document extraction — offline `tesseract`, MRZ-primary pipeline |
| **4** | Visa application builder — application plan as the source of truth |
| **5** | India visa browser automation engine (headless Chromium, controlled fill loop, checkpoints, resume) |
| **6** | India portal adapter + human-present live discovery + controlled autofill (Track A) |
| **7** | Production-controlled adapter — validated + current-revision mappings only, stale-mapping guard, exact-dropdown / explicit-date / fallback-selector safe-stops |
| **8** | Real-portal readiness — configurable `fast`/`normal`/`careful` timing profiles, deterministic sub-2-minute performance benchmark, run-page observability (elapsed / ETA / section / value-free milestone timeline), resumable `document_upload_required` pause, discovery→mapping promotion ergonomics, Track B execution checklist + per-field validation report template |

## Not included / still manual

- **Track B is not executed** — zero real Indian portal fields validated. `indiaPortalMap.ts` ships every selector as `TODO:discover` / `status: 'placeholder'`, so a real run pauses `stale_mapping` on the first required field until an operator runs the discovery→validation process.
- **No DB migration** — `LATEST_SCHEMA_VERSION` stays 6.
- **No new runtime dependency.**
- `session_expired` real-portal detection, `custom_select` pre-write availability probe, and the 19 deferred minor review findings — logged in the Phase 8 SDD ledger, none blocking.
- Headed-browser test dependency (Phases 5–8) — the benchmark and resume/matrix suites launch a real headless Chromium; a displayless CI runner would need a virtual display.

## Verification (branch HEAD `c3fe1f2`)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | **1265 passed / 120 files**, exit 0 |
| web bundle | 463.88 kB JS / 118.82 kB gzip |

## Reviews

- **Phase 5** whole-branch review + must-fix wave landed.
- **Phase 6** whole-branch review (READY-TO-MERGE-WITH-FIXES) + must-fix wave landed.
- **Combined Phase 7 + 8** whole-branch review (opus, `74fc162..bcb40af`): verdict *READY TO MERGE WITH FIXES* — 0 Critical, 5 Important, 19 Minor. All 5 Important + 2 promoted Minors fixed in `bcb40af`; scoped re-review **PASS**. All 8 binding invariants verified holding.
- **Phase 7 + 8 security review** (opus, focused on the delta): **CLEAN — no HIGH or MEDIUM findings.**

Full write-ups: `.superpowers/sdd/2026-09-08-phase-8-real-portal-readiness/` (`final-review.md`, `security-review.md`), `docs/superpowers/reports/PHASE-8-REPORT.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01BbsKdQAzp4zzAo4Sgxj4Ai
