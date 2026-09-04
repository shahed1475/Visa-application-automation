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
| S5 | https://hcidhaka.gov.in/ | 2026-09-03 — **landing page only; the category-wise document PDF was NOT machine-retrievable** | Bangladesh-national rules: passport 6 months + 2 blank pages; enter/leave via authorised Immigration Check Posts by air/land/sea; **no visa fee for Bangladeshi passport holders**; Tourist needs an online appointment, other categories are walk-in at IVAC Dhaka/Khulna |
| S6 | https://indianvisaonline.gov.in/visa/visa-category.html (closest retrievable page; the underlying MHA visa manual / bilateral India–Bangladesh Revised Travel Arrangement was **not machine-retrievable — `mha.gov.in` HTTP 403**) | 2026-09-03 | 5-year multiple-entry tourist visa for Bangladesh nationals aged 65+ (90-day stay per visit); minors <18 on study travel apply under Entry(X); India was progressively restoring visa services in Bangladesh through 2026 (medical + double-entry business first from Feb 2026; standard tourist processing resumed 28 Jun 2026) |

### Source-access note

The Indian government's category-authoritative pages resisted automated retrieval on 2026-09-03
(re-verified during the whole-branch review on the same date):

- `hcidhaka.gov.in` — the **landing page loads**, but it does not carry the rules themselves: the
  category-wise requirements are published only as a "Documents Required for Visa" PDF that was
  **not machine-retrievable**. So no per-category HCI Dhaka page was ever actually fetched.
- `mha.gov.in` Annex IV ("Visa for Bangladesh Nationals") — **HTTP 403**.
- `boi.gov.in` "list of visas" — **HTTP 404**.
- `indianvisaonline.gov.in/visa/visa-provision.html` and `/visa/visa-category.html` — retrieved OK; provide validity/entries/extension for Tourist, Business, Employment, Student, Transit.

**What this means for `retrievedAt`.** Every Regular eligibility record carries
`source.officialUrl = https://hcidhaka.gov.in/` and `retrievedAt = 2026-09-03`, but those values
were **not** read off a live category page — they come from generally-published HCI Dhaka /
IVAC Bangladesh guidance. Each of those 9 records says so in its own `source.notes`
("NOT A LIVE CATEGORY FETCH…"), so the disclosure travels with the data and not only with this file.
`test/shared/visaKb/data.test.ts` enforces it.

So **validity / entries / extension** for Tourist, Business, Employment, Student and Transit come from `visa-provision.html` (S3). Everything else — the per-category **document lists**, the Medical / Medical Attendant / Conference / Entry(X) terms, and the Bangladesh-specific provisions — rests on the **generally-published standard requirements** cross-referenced across the HCI-Dhaka / IVAC-Bangladesh public guidance and the MHA visa manual (S4, S5). Each such entry carries a `source.notes` flag noting that the category-wise HCI Dhaka PDF was not machine-retrievable on 2026-09-03 and should be re-verified against `hcidhaka.gov.in` before operational use.

Every Regular entry: `source.retrievedAt` = `2026-09-03`, `lastVerified` = `2026-09-03`.

## How to update a rule

1. Edit the affected entry's JSON in `evisa-categories.json`, `regular-categories.json`, or `eligibility.bgd.json`.
2. Set that entry's `lastVerified` and `source.retrievedAt` to today's date.
3. If the change is material (a validity, entries, stay-limit, eligibility status, or documents change — not a wording fix), bump `meta.kbVersion` and `meta.revisionDate` in `meta.json`.
4. Run `npm test` — `test/shared/visaKb/data.test.ts` fails on a dangling eligibility reference, a duplicate category id, missing provenance (`source.officialUrl` / `retrievedAt`), an `applicationMode` mismatch, a category `id` whose `evisa.` / `regular.` prefix disagrees with its `applicationMode`, or a Regular eligibility record sourced to `hcidhaka.gov.in` that drops the "not machine-retrievable / re-verify" disclosure.

## Bangladesh eligibility sources

`eligibility.bgd.json` records the eligibility of Bangladesh (`BGD`) nationals for every seeded
category. Sources:

| # | URL | Retrieved | What it sourced |
|---|-----|-----------|-----------------|
| S1 | https://indianvisaonline.gov.in/evisa/tvoa.html | 2026-09-03 | The e-Visa universal exclusions (diplomatic/official/service passport; defence/military/security/police background; endorsement on a relative's passport; 6-month passport validity; not of Pakistani origin / no Pakistani passport); per-category purpose gating; e-Conference MEA/MHA clearance; e-Student / e-Medical Attendant supporting-document and quota rules. Page "Last Updated" stamp: **2019-05-16**. |
| S2 | https://indianvisaonline.gov.in/evisa/ | 2026-09-03 | Bangladesh is on the e-Visa eligible-nationalities list ("14.Bangladesh"); the eight admissible e-Visa categories. |
| S5 | https://hcidhaka.gov.in/ | 2026-09-03 — **landing page only, category-wise PDF not machine-retrievable** | Bangladesh nationals are eligible for all regular Indian visa categories; no visa fee for Bangladeshi passport holders. Used as `source.officialUrl` for every Regular eligibility record — see "What this means for `retrievedAt`" above. |
| S6 | https://indianvisaonline.gov.in/visa/visa-category.html (closest retrievable page; MHA visa manual / India–Bangladesh bilateral Revised Travel Arrangement **not machine-retrievable 2026-09-03**) | 2026-09-03 | 5-year multiple-entry tourist visa for Bangladesh nationals aged 65+; Employment-visa skilled-role / minimum-remuneration threshold (broadly USD 25,000/year, with role exemptions); progressive restoration of visa services in Bangladesh through 2026 (medical + double-entry business first from Feb 2026; standard tourist processing resumed 28 Jun 2026); Conference-visa MEA/MHA clearance; Transit and Entry(X) terms. |

Every e-Visa eligibility record carries `source.officialUrl` = the S2 URL, `source.documentDate`
= `2019-05-16` (the S1 exclusions page stamp); every Regular eligibility record carries
`source.officialUrl` = the S5 URL. All eligibility records: `source.retrievedAt` = `lastVerified`
= `2026-09-03`.

Bangladesh eligibility is recorded as one explicit record per seeded category (20 total). Where a
category is offered but gated on an external prerequisite (organiser clearance, remuneration
threshold) the record status is `conditional`, not `eligible`. No seeded category is `ineligible`
or `not_offered` for Bangladesh in this KB version.

## Phase 4 — form model (schema v2)

`form-model.json` (the 11-section India-application section & field catalog — personal
particulars, passport details, address, family, occupation, visa details, previous visits,
references, business/study/medical details) was authored `2026-09-05` from the well-known
structure of the India Regular/e-Visa online application forms. Every section and field carries a
`source`:

| officialUrl | used for |
|---|---|
| `https://indianvisaonline.gov.in/visa/` | the Regular-form-visible sections/fields (personal, passport, address, family, occupation, visa details, previous visits, references, business, study) |
| `https://indianvisaonline.gov.in/evisa/` | the e-Visa base for form-adjacent declarations (e.g. `family.pakistan_ancestry`, `occupation.military_police` — the universal e-Visa exclusion declarations) and the medical-details section |
| `https://hcidhaka.gov.in/` | the one field resting on HCI Dhaka supporting-document guidance rather than a visible form field (`business_details.bd_company_name`) |

**Confidence ceiling.** Phase-4 form-model entries never claim `official_verbatim` — the online
forms are inspectable (field labels, page structure) but no per-field wording was captured
verbatim, so `official_derived` is the ceiling. A field is `official_derived` when it mirrors a
field visibly present on the online form; it drops to `secondary_guidance` when the requirement
rests on HCI Dhaka / IVAC guidance rather than a labelled form field (`family.pakistan_ancestry`,
`occupation.military_police`, `references.india_references_min`, `business_details.bd_company_name`).

**`source.confidence` refinement (Task 2, applied to the Task-1-seeded category/eligibility
data).** Task 1 defaulted every category and eligibility `source.confidence` to
`secondary_guidance`. Reviewed against the honesty already carried in each record's own
`source.notes` (and this file):
- e-Visa categories (`evisa-categories.json`) — all 11 sourced to `tvoa.html` (S1) with a
  `documentDate` → raised to `official_derived`.
- e-Visa eligibility records (`eligibility.bgd.json`) — all 11 sourced to the e-Visa portal (S2)
  with the same `documentDate` → raised to `official_derived`.
- Regular categories (`regular-categories.json`) sourced to `visa-provision.html` (S3) — tourist,
  business, employment, student, transit (5) → raised to `official_derived`. Regular categories
  sourced to `visa-category.html` (medical, medical_attendant, conference, entry_x) stay
  `secondary_guidance` — their `notes` explicitly say the category-wise HCI Dhaka PDF was not
  machine-retrievable and to re-verify.
- Regular eligibility records — all 9 stay `secondary_guidance` (sourced to `hcidhaka.gov.in`,
  each with the "NOT A LIVE CATEGORY FETCH … re-verify" disclosure `data.test.ts` enforces).
