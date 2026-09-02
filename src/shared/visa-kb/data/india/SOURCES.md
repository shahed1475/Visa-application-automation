# India visa knowledge base — sources & update procedure

Destination: India (`IND`). Applicant nationality in scope for this KB version: Bangladesh (`BGD`).
KB version: `2026-09-03` (see `meta.json`) — matches the `retrievedAt` / `lastVerified` date on every seeded entry.

## Sources used

| # | URL | Retrieved | What it sourced | Notes |
|---|-----|-----------|-----------------|-------|
| S1 | https://indianvisaonline.gov.in/evisa/tvoa.html | 2026-09-03 | Per-sub-type validity, entries, stay limits, application-timing window, exclusions, ports of entry | Page's own "Last Updated" stamp: **2019-05-16**. Authoritative detail page — used as `source.officialUrl` for every e-Visa category entry. |
| S2 | https://indianvisaonline.gov.in/evisa/ | 2026-09-03 | Bangladesh eligibility ("14.Bangladesh"); required-documents-by-type; the eight admissible e-Visa categories; biometrics-on-arrival note | Portal landing / instructions page. Used to cross-check S1 values. |

All e-Visa category entries in `evisa-categories.json` carry:
`source.officialUrl` = the S1 URL, `source.retrievedAt` = `2026-09-03`,
`source.documentDate` = `2019-05-16`, `lastVerified` = `2026-09-03`,
and a per-entry `source.notes` recording any cross-check or caveat.

## Regular / Paper visa sources

| # | URL | retrieved | what it sourced |
|---|-----|-----------|-----------------|
| S3 | https://indianvisaonline.gov.in/visa/visa-provision.html | 2026-09-03 | Tourist/Business/Employment/Student/Transit validity, entries, extension rules; FRRO 14-day/180-day rule |
| S4 | https://indianvisaonline.gov.in/visa/visa-category.html | 2026-09-03 | the regular visa category list (Tourist, Business, Medical, Student, Journalist, Transit, Entry/Family, Conference/misc) |
| S5 | https://hcidhaka.gov.in/ | 2026-09-03 | Bangladesh-national rules: passport 6 months + 2 blank pages; enter/leave via authorised Immigration Check Posts by air/land/sea; **no visa fee for Bangladeshi passport holders**; Tourist needs an online appointment, other categories are walk-in at IVAC Dhaka/Khulna |
| S6 | (context) MHA / bilateral India–Bangladesh Revised Travel Arrangement | 2026-09-03 | 5-year multiple-entry tourist visa for Bangladesh nationals aged 65+ (90-day stay per visit); minors <18 on study travel apply under Entry(X); India was progressively restoring visa services in Bangladesh through 2026 (medical + double-entry business first from Feb 2026; standard tourist processing resumed 28 Jun 2026) |

### Source-access note

The Indian government's category-authoritative pages resisted automated retrieval on 2026-09-03:

- `hcidhaka.gov.in` category-wise document PDFs — not machine-readable / blocked.
- `mha.gov.in` Annex IV ("Visa for Bangladesh Nationals") and BOI "list of visas" — HTTP 403.
- `indianvisaonline.gov.in/visa/visa-provision.html` and `/visa/visa-category.html` — retrieved OK; provide validity/entries/extension for Tourist, Business, Employment, Student, Transit.

So **validity / entries / extension** for Tourist, Business, Employment, Student and Transit come from `visa-provision.html` (S3). Everything else — the per-category **document lists**, the Medical / Medical Attendant / Conference / Entry(X) terms, and the Bangladesh-specific provisions — rests on the **generally-published standard requirements** cross-referenced across the HCI-Dhaka / IVAC-Bangladesh public guidance and the MHA visa manual (S4, S5). Each such entry carries a `source.notes` flag noting that the category-wise HCI Dhaka PDF was not machine-retrievable on 2026-09-03 and should be re-verified against `hcidhaka.gov.in` before operational use.

Every Regular entry: `source.retrievedAt` = `2026-09-03`, `lastVerified` = `2026-09-03`.

## How to update a rule

1. Edit the affected entry's JSON in `evisa-categories.json`, `regular-categories.json`, or `eligibility.bgd.json`.
2. Set that entry's `lastVerified` and `source.retrievedAt` to today's date.
3. If the change is material (a validity, entries, stay-limit, eligibility status, or documents change — not a wording fix), bump `meta.kbVersion` and `meta.revisionDate` in `meta.json`.
4. Run `npm test` — `test/shared/visaKb/data.test.ts` fails on a dangling eligibility reference, a duplicate category id, missing provenance (`source.officialUrl` / `retrievedAt`), or an `applicationMode` mismatch.

## Bangladesh eligibility sources

`eligibility.bgd.json` records the eligibility of Bangladesh (`BGD`) nationals for every seeded
category. Sources:

| # | URL | Retrieved | What it sourced |
|---|-----|-----------|-----------------|
| S1 | https://indianvisaonline.gov.in/evisa/tvoa.html | 2026-09-03 | The e-Visa universal exclusions (diplomatic/official/service passport; defence/military/security/police background; endorsement on a relative's passport; 6-month passport validity; not of Pakistani origin / no Pakistani passport); per-category purpose gating; e-Conference MEA/MHA clearance; e-Student / e-Medical Attendant supporting-document and quota rules. Page "Last Updated" stamp: **2019-05-16**. |
| S2 | https://indianvisaonline.gov.in/evisa/ | 2026-09-03 | Bangladesh is on the e-Visa eligible-nationalities list ("14.Bangladesh"); the eight admissible e-Visa categories. |
| S5 | https://hcidhaka.gov.in/ | 2026-09-03 | Bangladesh nationals are eligible for all regular Indian visa categories; no visa fee for Bangladeshi passport holders. Used as `source.officialUrl` for every Regular eligibility record. |
| S6 | MHA / India–Bangladesh bilateral Revised Travel Arrangement (context) | 2026-09-03 | 5-year multiple-entry tourist visa for Bangladesh nationals aged 65+; Employment-visa skilled-role / minimum-remuneration threshold (broadly USD 25,000/year, with role exemptions); progressive restoration of visa services in Bangladesh through 2026 (medical + double-entry business first from Feb 2026; standard tourist processing resumed 28 Jun 2026); Conference-visa MEA/MHA clearance; Transit and Entry(X) terms. |

Every e-Visa eligibility record carries `source.officialUrl` = the S2 URL, `source.documentDate`
= `2019-05-16` (the S1 exclusions page stamp); every Regular eligibility record carries
`source.officialUrl` = the S5 URL. All eligibility records: `source.retrievedAt` = `lastVerified`
= `2026-09-03`.

Bangladesh eligibility is recorded as one explicit record per seeded category (20 total). Where a
category is offered but gated on an external prerequisite (organiser clearance, remuneration
threshold) the record status is `conditional`, not `eligible`. No seeded category is `ineligible`
or `not_offered` for Bangladesh in this KB version.
