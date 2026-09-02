# India visa knowledge base — sources & update procedure

Destination: India (`IND`). Applicant nationality in scope for this KB version: Bangladesh (`BGD`).
KB version: `2026-09-02` (see `meta.json`).

## Sources used

| # | URL | Retrieved | What it sourced | Notes |
|---|-----|-----------|-----------------|-------|
| S1 | https://indianvisaonline.gov.in/evisa/tvoa.html | 2026-09-03 | Per-sub-type validity, entries, stay limits, application-timing window, exclusions, ports of entry | Page's own "Last Updated" stamp: **2019-05-16**. Authoritative detail page — used as `source.officialUrl` for every e-Visa category entry. |
| S2 | https://indianvisaonline.gov.in/evisa/ | 2026-09-03 | Bangladesh eligibility ("14.Bangladesh"); required-documents-by-type; the eight admissible e-Visa categories; biometrics-on-arrival note | Portal landing / instructions page. Used to cross-check S1 values. |

All e-Visa category entries in `evisa-categories.json` carry:
`source.officialUrl` = the S1 URL, `source.retrievedAt` = `2026-09-03`,
`source.documentDate` = `2019-05-16`, `lastVerified` = `2026-09-03`,
and a per-entry `source.notes` recording any cross-check or caveat.

## How to update a rule

1. Edit the affected entry's JSON in `evisa-categories.json`, `regular-categories.json`, or `eligibility.bgd.json`.
2. Set that entry's `lastVerified` and `source.retrievedAt` to today's date.
3. If the change is material (a validity, entries, stay-limit, eligibility status, or documents change — not a wording fix), bump `meta.kbVersion` and `meta.revisionDate` in `meta.json`.
4. Run `npm test` — `test/shared/visaKb/data.test.ts` fails on a dangling eligibility reference, a duplicate category id, missing provenance (`source.officialUrl` / `retrievedAt`), or an `applicationMode` mismatch.
