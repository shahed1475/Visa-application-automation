# Visa Form Analysis — Framework

**Status:** Framework only. No real visa-form field rows are populated.
**Date:** 2026-09-02
**Applies to:** every visa portal the user configures in Settings — this document is
portal-agnostic. Portal-specific findings go in a per-portal appendix (§14),
never in the body of this document and never in application code.

---

## 0. How to use this document

This file has two clearly separated parts:

| Part | Content | Changes when… |
|------|---------|---------------|
| **Body (§1–§13)** | Portal-agnostic methodology, schemas, taxonomies, checklists | Rarely — only when we improve the method |
| **Appendix (§14 + `docs/portals/<slug>.md`)** | Actual discovered pages, fields, dropdowns, selectors for ONE configured portal | Every discovery run against that portal |

**Rule:** nothing in the Body names a specific portal, URL, or selector. The word
"portal" always means *whatever portal the user has configured and marked active
in Settings* (spec §9a — the URL is read from SQLite at runtime, never hard-coded).

### Current state

- Portals configured: **0**
- Portal appendices written: **0**
- Live discovery runs completed: **0** (the Phase 0 Settings foundation +
  navigate-only Test Connection are complete; discovery of a real portal begins
  only once the user configures and activates a portal URL in Settings)

---

## 1. Discovery methodology

Discovery is **research and documentation only**. It never fills a real
application, never submits, never creates an account, never handles OTP/CAPTCHA.

### 1.1 Stages

| Stage | Actor | Tooling | Boundary |
|-------|-------|---------|----------|
| **D0 — Preconditions** | System | Settings DB | A portal exists, is enabled, is marked active, URL passes `isHttpUrl` |
| **D1 — Public-page discovery** | Automated (Playwright) | `runConnectionTest` + page walker | **STOP** at the first registration / login / OTP / CAPTCHA / other security boundary |
| **D2 — Authenticated-flow discovery** | Human-in-the-loop | User drives a real browser; a discovery script snapshots each page the user lands on | User performs all login / OTP / CAPTCHA / navigation; script only observes |
| **D3 — Per-field analysis** | Analyst (human + assisted) | DOM snapshots from D1/D2 | Classify every field per §3–§7 |
| **D4 — Verification** | Analyst | Re-inspect; second pass on a different day/session | Confirm selectors + dynamics are stable, not session artifacts |

D2 is **out of scope for the current phase** (user chose "public pages only,
automated"). It is documented here so the method is complete.

### 1.2 Rules of engagement (all stages)

1. Start from the **configured portal URL only**. Never a hard-coded or guessed URL.
2. Do **not** create an account, enter credentials, or type anything into a
   real form field during discovery.
3. Do **not** request, enter, read, or automate OTP / MFA codes.
4. Do **not** solve, click, or otherwise interact with CAPTCHA / anti-bot
   challenges. Detect and record only.
5. Do **not** submit any application or click a final "Submit" / "Pay" control.
6. **Stop immediately** at any security boundary and record exactly where it is
   (§11). Do not attempt to work around it.
7. Collect only **non-sensitive structural metadata** (§1.4). No personal data.
8. Rate-limit politely: serial navigation, human-like pauses, one page at a time,
   respect `robots.txt` for the public site, abort on any 403 / rate-limit page.
9. If the portal cannot be inspected beyond public pages, record the limitation
   and stop.

### 1.3 Tooling approach (D1)

- **Playwright Chromium**, headed or headless (`PW_HEADLESS`), fresh context,
  no stored state, no credentials, one outbound navigation origin.
- Per page capture:
  - full URL and path, HTTP status, final URL after redirects, redirect chain
  - `document.title`
  - full-page screenshot (saved to `data/screenshots/discovery/<slug>/`)
  - DOM snapshot (outerHTML) and the **accessibility tree** (`page.accessibility.snapshot()`)
  - element inventory via the same counters as `pageInspector` (forms, inputs by
    type, selects, radios, checkboxes, date inputs, file inputs, buttons, links)
  - all in-page links (href + visible text + whether same-origin)
  - all forms: `action`, `method`, and for each control: `tag`, `type`, `name`,
    `id`, `placeholder`, `required`, `maxlength`, `pattern`, associated
    `<label for>` text, `aria-*`, `disabled`, `readonly`
  - framework fingerprint signals (§8.2)
  - security-boundary signals (§11.2)
- **Never** execute page scripts that submit, click submit buttons, or fill fields.
- Discovery walker only follows links that are (a) same-origin, (b) `GET`,
  (c) not matched by a stop-list (`/login`, `/register`, `/signin`, `/otp`,
  `/captcha`, `/payment`, `/pay`, `logout`, …), (d) within a max depth.

### 1.4 What is recorded vs never recorded

| Recorded (non-sensitive structure) | Never recorded |
|---|---|
| URL / path, page title, purpose | Any applicant personal data |
| Links, buttons, navigation relationships | Credentials, OTP codes, CAPTCHA tokens |
| Form + control metadata (name/id/type/label/validation attrs) | Field *values* the user might later enter |
| Selector candidates + confidence | Session cookies, auth tokens, bearer headers |
| Dropdown option **structure** (not personal choices) | Screenshots containing personal data (D2) — redact before saving |
| Where the security boundary is | Full network response bodies with personal data |

---

## 2. Field-analysis table schema

### 2.1 Mandated table (per the phase brief)

| Page | Field | Label | Input Type | Required | Data Source | Dynamic? | Validation | Automation Strategy |
|------|-------|-------|-----------|----------|-------------|----------|-----------|---------------------|

### 2.2 Extended table (what discovery actually fills in)

| Column | Allowed values / format | Notes |
|--------|-------------------------|-------|
| **Page** | `<workflow-step-id>` from §12 | e.g. `applicant-details`, `passport-info` |
| **Section** | free text or `—` | Fieldset / card / accordion the field sits in |
| **Field ID** | the **observed** stable identifier | id, else name, else `label:"…"`, else `aria:"…"`; never invented |
| **Label** | exact visible label text (verbatim, incl. casing) | plus `aria-label` if different |
| **Input Type** | `text` `email` `tel` `number` `password`(never filled) `date` `select-single` `select-multi` `combobox-typeahead` `radio-group` `checkbox` `checkbox-group` `file` `textarea` `hidden` `readonly` `rich-widget` | `rich-widget` = custom JS control needing its own handling notes |
| **Required** | `hard` `conditional(<expr>)` `soft` `no` `unknown` | `conditional` names the controlling field/value |
| **Data Source** | one code from §3 | the primary source; secondary in Notes |
| **Dynamic?** | `no` `visibility` `options` `required` `value` `multiple` | see §6.2 |
| **Depends On** | `<Field ID>=<value>` list, or `—` | the controlling field(s) |
| **Validation** | codes from §10.2 + verbatim message(s) | e.g. `format(date:DD/MMM/YYYY); required; server` |
| **Confidence** | `high` `medium` `low` | see §7.1 |
| **Verification Method** | code from §7.3 | how a fill is confirmed |
| **Automation Strategy** | `autofill` `autofill+confirm` `prompt-user` `prompt-user(reference)` `skip(portal-computed)` `skip(security)` `manual-only` | see §7.4 |
| **Notes** | free text | edge cases, transliteration, truncation, timing, iframe/shadow DOM |

### 2.3 Illustrative example row (hypothetical — NOT from any real portal)

> Shown only to demonstrate the format. Do not treat as a real finding.

| Page | Field | Label | Input Type | Required | Data Source | Dynamic? | Validation | Automation Strategy |
|------|-------|-------|-----------|----------|-------------|----------|-----------|---------------------|
| `passport-info` | `‹observed-id›` | "Passport Number" | text | hard | `PASSPORT_MRZ` | no | `required; pattern(alnum, 6–9); server` | `autofill+confirm` |

---

## 3. Data-source taxonomy

Every field is assigned exactly one **primary** data source. Secondary sources
(fallbacks) are noted separately.

| Code | Meaning | Auto-fill? | Example field categories |
|------|---------|-----------|--------------------------|
| `PASSPORT_MRZ` | Directly parsable from the passport Machine-Readable Zone (ICAO 9303) | Yes, with confirm | surname, given names, passport number, nationality code, DOB, sex, expiry date, document type, issuing state |
| `PASSPORT_VIZ` | On the passport data page but **not** in the MRZ; needs OCR of the visual zone | Yes, with confirm; lower confidence than MRZ | place of birth (full), place of issue / issuing authority, date of issue, sometimes father's/mother's/spouse name (varies by country) |
| `PASSPORT_DERIVED` | Computed or transformed from passport data | Yes, with confirm; show the transformation | age, nationality **adjective** ("Indian") from country code, name split/join, transliteration, "name as in passport" concatenation, MRZ check-digit fields |
| `USER_PROFILE` | Stable personal data not on the passport | Prompt user; reusable across applications once saved | email, phone, residential address, occupation, employer, marital status, parents' names (if not on passport), education, national ID / SSN-equivalent |
| `USER_TRIP` | Specific to this trip / application | Prompt user every application | purpose of visit, intended arrival/departure dates, ports of entry/exit, duration, accommodation address, itinerary, host/sponsor, funds |
| `SAVED_REFERENCE` | From a saved template / reference library the user maintains | Fill from selected template, then confirm | employer full address, in-country reference contact, previous visa/travel history, standard answers to recurring questions, emergency contact |
| `DOCUMENT_OTHER` | From a non-passport document the user uploads | Extract + confirm; often manual | photo (upload only), bank balance (statement), invitation letter details, flight/ticket numbers, hotel booking ref |
| `COMPUTED_BY_PORTAL` | The portal fills or derives this itself | **Never touch** | application reference number, fee amount, auto-filled "nationality" mirrored from a prior page, server timestamps |
| `NON_INFERABLE` | Cannot be reliably determined by the system under any circumstances | **Never auto-fill; always user-answered** | eligibility / security / character questions ("have you been refused a visa", "convicted", "military service", "intent"), consent checkboxes, biometric-appointment selection, declaration/attestation |

### 3.1 Assignment rules

- If a field's value could plausibly come from two sources, assign the **most
  authoritative** (`PASSPORT_MRZ` > `PASSPORT_VIZ` > `PASSPORT_DERIVED` >
  `SAVED_REFERENCE` > `USER_PROFILE` > `USER_TRIP`) and list the others as
  fallbacks in Notes.
- Any field that is a **legal declaration, consent, or eligibility question** is
  `NON_INFERABLE` regardless of how "obvious" the answer seems.
- Any field the portal pre-populates is `COMPUTED_BY_PORTAL` — record its value
  for verification but never write to it.
- When unsure, default to `NON_INFERABLE` (fail safe → ask the user).

---

## 4. Passport-field reference (ICAO 9303)

Standardised passport data elements and how they map to visa-form fields. This is
**general passport knowledge**, not a portal structure claim.

### 4.1 MRZ data elements (TD3 / passport booklet, 2 lines × 44 chars)

| Element | MRZ location | Form-label variants seen on visa forms | Transformation / gotchas |
|---------|--------------|----------------------------------------|--------------------------|
| Document type | L1 pos 1–2 | (rarely on form) | `P` = passport; `PA`,`PD` etc. exist |
| Issuing State / Nationality | L1 pos 3–5 / L2 pos 11–13 | "Nationality", "Country of passport", "Issuing country" | 3-letter ICAO code → must map to the portal's country list value (which may be full name, 2-letter, or its own code). `D` = Germany, `GBR` subtypes for UK. |
| Primary identifier (surname) | L1 after code, before `<<` | "Surname", "Family name", "Last name" | `<` → space; multiple surnames joined by single `<`; **may be truncated** at 39 chars — VIZ is authoritative for full name |
| Secondary identifier (given names) | L1 after `<<` | "Given names", "First name(s)", "Forename" | same `<` rules; truncation risk; portal may want first / middle split — needs heuristic + user confirm |
| Passport number | L2 pos 1–9 | "Passport number", "Document number" | trailing `<` = filler (strip); alphanumeric; check digit at pos 10 |
| Nationality | L2 pos 11–13 | "Nationality" | may differ from issuing state (rare) |
| Date of birth | L2 pos 14–19 | "Date of birth" | `YYMMDD` → reformat to portal format; **century inference** (YY 50–99 → 19YY, else 20YY) then sanity-check against expiry |
| Sex | L2 pos 21 | "Sex", "Gender" | `M` / `F` / `<` (unspecified) → map to portal options; some portals only offer M/F |
| Date of expiry | L2 pos 22–27 | "Passport expiry date", "Date of expiry", "Valid until" | `YYMMDD`; century = 20YY (passports rarely valid past 2099) |
| Personal number / optional data | L2 pos 29–42 | national ID, sometimes blank | country-specific; often **not** what the visa form's "national ID" wants |
| Check digits | various | (never on form) | used only to validate our own MRZ parse |

### 4.2 VIZ-only elements (printed on data page, not in MRZ)

| Element | Form-label variants | Notes |
|---------|--------------------|-------|
| Place of birth | "Place of birth", "City of birth", "Town of birth" | Often "CITY" or "CITY, COUNTRY"; portal may want city + country separately; OCR-error prone |
| Place of issue / Issuing authority | "Place of issue", "Issuing authority" | Free text; abbreviations common ("MHA", "PASSPORT OFFICE X") |
| Date of issue | "Date of issue", "Passport issue date" | Cross-check: issue < expiry, expiry − issue ≈ 5 or 10 years |
| Father's / Mother's / Spouse name | "Father's name", "Mother's name", "Spouse name" | Present on passports of some countries (e.g. South Asia); absent on most → `USER_PROFILE` fallback |
| Old passport number | "Previous passport number" | Only on some passports; usually `SAVED_REFERENCE` |

### 4.3 Name-handling policy

- Store the **exact passport spelling** (VIZ) as the canonical name.
- MRZ name is a fallback and may be truncated / all-caps / diacritic-stripped.
- Splitting "given names" into first/middle is a **heuristic** → always
  `autofill+confirm`, never silent.
- Transliteration (non-Latin scripts) → `prompt-user` unless the passport itself
  prints a Latin transliteration.
- "Name as it appears in passport" fields → concatenate per the portal's stated
  order; confirm.

---

## 5. Field classification — required / optional

| Class | Definition | Detection signals |
|-------|-----------|-------------------|
| `hard` | Cannot advance the page without it | `required` attr; `aria-required`; asterisk in label; blocking error on blur/submit |
| `conditional(<expr>)` | Required only when another field has a certain value | becomes `required` after a parent change; error appears only in that branch |
| `soft` | Portal encourages but allows blank ("recommended") | non-blocking warning; page advances |
| `no` | Truly optional | no error when blank |
| `unknown` | Could not be determined without submitting (which we don't do) | record as `unknown`, resolve in D2/real use |

Never infer `hard` vs `soft` by submitting. Use attributes + blur-triggered
validation + the portal's own legend/asterisk convention.

---

## 6. Dynamic-field analysis structure

### 6.1 Per dynamic field, record:

```
Field ID:
Dynamic type:        visibility | options | required | value | multiple
Controlled by:       <Field ID> = <value(s)>
Trigger event:       change | blur | click | async-load | route-change
Observed behaviour:  <what happens>
Reset behaviour:     does its value clear when the parent changes? (Y/N)
Timing signal:       how do we know it finished updating? (see §6.3)
Failure mode:        what if it never updates / errors?
```

### 6.2 Dynamic types

| Type | Meaning |
|------|---------|
| `visibility` | Field appears / disappears |
| `options` | The list of choices changes (dependent dropdown) |
| `required` | Toggles between required and optional |
| `value` | Auto-populated / recalculated from another field |
| `multiple` | A repeatable group grows/shrinks ("add another traveller", "add previous trip") |

### 6.3 Dynamic dropdown / dependent-dropdown analysis

For **every** `select` or combobox, record:

| Attribute | Values |
|-----------|--------|
| **Population** | `static` (options in initial HTML) / `xhr-on-parent-change` / `xhr-on-focus` / `xhr-typeahead` / `client-computed` |
| **Parent chain** | ordered list, e.g. `country → state → city` |
| **Request** | (if XHR) method + path pattern + which param carries the parent value — record the **observed** request, do not guess |
| **Ready signal** | `network-idle` / `specific-response-200` / `spinner-removed` / `option-count>1` / `dom-mutation-settled` — pick the most specific reliable one |
| **Placeholder option** | how "-- Select --" is represented (value `""`, `"0"`, `"-1"`, absent) |
| **Option shape** | `value` vs visible `label`; is `value` a code or the label itself? |
| **Cascade reset** | when parent changes, does child reset to placeholder? does grandchild? |
| **Match strategy for autofill** | match by `value` / exact label / normalised label (case, accents, whitespace) / fuzzy (flagged) |
| **No-match behaviour** | what automation does if our value isn't in the list → `prompt-user` |
| **Failure mode** | options never load / load empty / request 500 / times out |

**Autofill rule for dependent dropdowns:** set parent → wait for the recorded
*ready signal* (never a fixed `sleep`) → verify child options are present →
select child → verify selection → repeat down the chain. Abort the chain and
prompt the user on any timeout or no-match.

---

## 7. Confidence & verification requirements

### 7.1 Confidence levels

| Level | Criteria |
|-------|----------|
| `high` | Direct `PASSPORT_MRZ` value, no transformation, unambiguous label, stable selector, simple input type |
| `medium` | One transformation (date reformat, code→label map, name split), or `PASSPORT_VIZ` via OCR, or a dropdown match by normalised label |
| `low` | Multiple transformations, fuzzy dropdown match, OCR of a noisy field, ambiguous label, custom widget, or any `SAVED_REFERENCE`/heuristic |

### 7.2 Mandatory verification (all auto-filled fields)

1. After filling, **re-read the field's current value from the DOM**.
2. Compare against the intended value using the field's **Verification Method** (§7.3).
3. On mismatch: retry once; on second mismatch → stop the page, screenshot,
   mark the field failed, prompt the user.
4. `low`-confidence fields and **every** `NON_INFERABLE` field are shown to the
   user for explicit confirmation before the page is advanced.
5. The **final review page** always shows every field for user review regardless
   of confidence. Nothing is submitted without the explicit user action (spec §7,
   rule 19).

### 7.3 Verification-method codes

| Code | Use for | Check |
|------|---------|-------|
| `exact` | text, email, tel, passport number | `domValue === intended` |
| `normalized` | names, addresses (case/whitespace/accent-insensitive) | `norm(domValue) === norm(intended)` |
| `date-format` | date inputs / masked text | parse both to ISO, compare; also confirm the visible mask |
| `option-value` | selects | selected `option.value === intended.value` **and** visible label matches |
| `checked-state` | radio / checkbox | `element.checked === intended` |
| `file-name` | file inputs | selected file name + size match the chosen document; never assert contents in logs |
| `visible-text` | custom widgets | the widget's rendered display text equals intended |

### 7.4 Automation-strategy codes

| Code | Behaviour |
|------|-----------|
| `autofill` | Fill, verify (§7.2), continue. Only for `high` confidence, non-declaration fields |
| `autofill+confirm` | Fill, verify, then require user confirmation before advancing the page |
| `prompt-user` | Do not fill; collect from the user (profile / trip form) |
| `prompt-user(reference)` | Prompt the user to pick a saved template / reference entry |
| `skip(portal-computed)` | Leave alone; only read for verification |
| `skip(security)` | Security boundary — pause, hand to user (§11) |
| `manual-only` | Automation opens the page and steps back; the user does this field/section entirely |

---

## 8. Selector strategy

### 8.1 Selector priority (most → least stable)

1. Stable `id` (not autogenerated — reject ids that look like `:r3:`, hashes, GUIDs)
2. `name` attribute
3. Associated `<label for>` → target its control
4. ARIA: `role` + accessible name
5. `data-*` test hooks (`data-testid`, `data-qa`, `data-cy`) if present
6. Scoped CSS within a labelled fieldset / section
7. Visible text (for buttons/links)
8. Positional / nth-of-type — **last resort, always flagged `fragile`**

For every field record: **primary selector**, **fallback selector**, and a
**selector-confidence** rating (`stable` / `moderate` / `fragile`). Never invent
a selector — if discovery did not observe it, the cell is `unknown`.

### 8.2 Portal fingerprint (record once per portal)

| Signal | Why it matters |
|--------|----------------|
| Rendering: plain HTML / SSR templates (JSP, ASP.NET, PHP) / SPA (React, Angular, Vue) | Determines navigation model, whether selectors are stable across "pages", postback behaviour |
| ASP.NET WebForms markers (`__VIEWSTATE`, `__EVENTTARGET`) | Every interaction is a full postback; fields re-render; ids are often `ctl00_...` |
| Client framework version (if detectable) | Custom widget behaviour, event dispatch quirks |
| Fields inside `<iframe>` | Need frame targeting; cross-origin frames may be inaccessible |
| Shadow DOM / web components | Need `>>>` / shadow-piercing; some controls not reachable |
| Autoformatting / input masks | Typed value ≠ stored value; verify the masked result |
| CSP / anti-automation headers, bot-detection JS | May break Playwright; record and stop if so |
| i18n: language switch, locale-dependent date formats | Pin language; record date/number formats |

---

## 9. Required-field & conditional-logic manifest

Per workflow step, discovery produces a **required-field manifest** — the set of
fields that must be present and fillable before automation touches the step.
`automation-risks.md` R1/R5 use this as the gate for structure reconciliation.

```
Step ID:
Always-required fields:      [ <Field ID>, … ]
Conditionally-required:      [ { field: <Field ID>, when: "<Controller>=<value>" }, … ]
Repeatable groups:           [ { group: <name>, min: <n>, item-required: [ <Field ID>, … ] } ]
Portal-computed (read-only): [ <Field ID>, … ]      # verify, never write
Reconciliation rule:         every always-required field must resolve to a live,
                             enabled control matching its recorded input type,
                             or the step is aborted (R5 → `abort`).
Unexpected-required rule:    a `required` control not in this manifest → pause
                             for the user (R5 → `needs-user`).
```

The manifest is stored in the portal appendix (§14), not in engine code.

---

## 10. Validation & error analysis structure

### 10.1 Per field / page, record:

```
Scope:            field | cross-field | page | workflow
Side:             client | server | both
Trigger:          change | blur | input | submit | navigate-next
Error surface:    inline-below-field | inline-tooltip | summary-top | toast |
                  modal | aria-live-region | field-border-only
Message text:     "<verbatim>"
Blocking:         yes (page won't advance) | no (warning)
Format mask:      "<mask or pattern>" (e.g. DD/MMM/YYYY, uppercase-forced)
Max length:       <n> (and whether enforced by truncation or by error)
Cross-field rule: "<e.g. departure date must be after arrival date>"
Success signal:   how we detect the page was accepted and advanced
```

### 10.2 Validation codes (for the field table's Validation column)

`required` · `format(<desc>)` · `pattern(<regex-as-shown>)` · `minlen(n)` ·
`maxlen(n)` · `range(<min..max>)` · `date-range(<rule>)` · `cross-field(<rule>)` ·
`match(<other-field>)` · `server` · `async(<lookup>)` · `file(<type/size rule>)` ·
`unknown`

### 10.3 "Did the page advance?" detection

Because discovery never submits, this is resolved in real use. Candidate signals
to record for later: URL / route change, step indicator increment, a known
next-page element appears, previous-page form detaches, a success `aria-live`
message. **Never** assume advancement from the absence of an error alone.

---

## 11. Security / CAPTCHA / OTP / MFA checkpoint documentation

### 11.1 Per checkpoint, record:

```
Checkpoint ID:
Type:             image-captcha | recaptcha-v2 | recaptcha-v3 | hcaptcha |
                  turnstile | cloudflare-interstitial | email-otp | sms-otp |
                  authenticator-totp | security-questions | device-verification |
                  rate-limit-page | login-wall | registration-wall
Location in flow: <workflow step / URL where it appears>
Trigger:          always | on-login | on-submit | after-N-actions | new-device |
                  suspicious-activity | unknown
Detection signals: selectors / iframe origins / page text / status code
Required behaviour: PAUSE automation → surface to user → wait → detect completion
                    → resume. NEVER solve, NEVER call a solver, NEVER auto-read OTP.
Completion signal: how automation knows the user finished
Timeout policy:    how long to wait; what to do on timeout (save state, stop)
```

### 11.2 Detection signal library (portal-agnostic)

| Type | Common signals (detect only) |
|------|------------------------------|
| reCAPTCHA v2 | `iframe[src*="recaptcha"]`, `.g-recaptcha`, `grecaptcha` global |
| reCAPTCHA v3 | script `recaptcha/api.js?render=`, no visible widget |
| hCaptcha | `iframe[src*="hcaptcha"]`, `.h-captcha` |
| Cloudflare Turnstile | `iframe[src*="challenges.cloudflare.com"]`, `.cf-turnstile` |
| Cloudflare interstitial | title/text "Just a moment…", `cf-browser-verification`, HTTP 403 + `cf-mitigated` |
| Image CAPTCHA (custom) | `<img>` near an input with alt/name containing "captcha", "verification code" |
| Email/SMS OTP | inputs named/labelled "OTP", "verification code", "one-time"; text "sent to your email/phone" |
| TOTP / authenticator | text "authenticator app", 6-digit code input |
| Login wall | password input present; "sign in" / "login" heading; redirect to `/login` |
| Registration wall | "create account", "register"; redirect to `/register` / `/signup` |
| Rate-limit | HTTP 429; text "too many requests" / "try again later" |

### 11.3 Hard rules

- The system contains **no** CAPTCHA-solving code, **no** third-party solver
  integration, **no** OTP auto-retrieval from email/SMS, **no** anti-bot evasion.
- On any checkpoint: persist state (§13), screenshot, pause, notify the user,
  and only continue when the user signals they have completed it manually.
- Final application submission is a **user action only** (rule 19).

---

## 12. Multi-page workflow documentation structure

### 12.1 Per portal, record the workflow map:

```
Workflow: <visa type / application type from Settings>
Entry point:        <public URL or "post-login landing">
Navigation model:   linear-wizard | tabbed | free-nav | server-postback | spa-routes
Back allowed:       yes | no | partial
Server-side save:   auto | explicit "Save draft" | none
Resume mechanism:   "resume application" + reference no. | account-bound | none
Session model:      cookie | token; idle timeout = <duration>; hard cap = <duration>
Application ref:     <where/when it is issued and how to capture it>
Steps (ordered):
  1. <step-id>  <title>  <URL/route>  <purpose>  <security boundary? >
  2. …
Review step:        <step-id> — shows all entered data for user review
Final submit:       <the single control that submits> — USER-CONTROLLED ONLY
Confirmation page:  <what it shows: reference, next steps, appointment, payment>
Payment:            <if any> — user-controlled; out of automation scope
```

### 12.2 Step record (one per workflow step)

```
Step ID:
Title (verbatim):
URL / route:
Preconditions:      <prior steps, session, uploaded docs>
Sections on page:
Fields:             → rows in the §2 table, tagged with this Step ID
Dynamic behaviour:  → §6 entries
Validations:        → §10 entries
Navigation out:     next-button selector(s), "save & continue", "save & exit"
Advance signal:     → §10.3
Known hazards:
```

---

## 13. Recovery & state documentation structure

### 13.1 Persisted automation state (per run)

| Field | Purpose |
|-------|---------|
| `run_id`, `portal_id`, `workflow_id` | Identify the run (portal by id, never URL literal) |
| `current_step_id` | Where we are |
| `steps_completed[]` | Which steps were filled **and verified** |
| `fields_verified[]` (field id + verification result; **no values**) | Resume without re-filling; audit |
| `last_safe_checkpoint` | The last point we can resume from |
| `portal_application_ref` | The portal's own reference number, once issued |
| `pending_user_action` | `none` \| `security-checkpoint` \| `confirm-fields` \| `provide-input` |
| `screenshots[]`, `dom_snapshots[]` (redacted) | Diagnostics |
| `status` | `running` \| `paused-for-user` \| `failed` \| `awaiting-final-submit` \| `done` |

**Never persist field values, passport data, credentials, OTPs, or CAPTCHA tokens
in state or logs** (rule 14–15).

### 13.2 Resumability

| Question | Framework answer |
|----------|------------------|
| Can automation re-attach to an in-progress **portal** session? | Only if the portal supports "resume application" with a reference; otherwise the user logs back in manually and automation re-attaches to the tab |
| Can we re-run a step safely? | Only steps marked **idempotent** in the workflow map; re-filling must not create duplicate repeatable-group entries |
| Duplicate-submission guard | Never auto-click final submit; detect "application already submitted" pages and stop |

### 13.3 Failure classification

| Class | Examples | Action |
|-------|----------|--------|
| `retryable` | transient network error, element not yet ready, one verification mismatch | retry with backoff (bounded) |
| `needs-user` | security checkpoint, no-match dropdown, low-confidence field, session expired | pause, persist state, notify |
| `abort` | portal structure changed (selectors gone), repeated verification failure, rate-limited / blocked, ToS/robots signal | stop, snapshot, full report |

### 13.4 Diagnostics captured on failure

Screenshot · redacted DOM snapshot · console messages · network summary
(URLs + status only, **no bodies**) · current step + field · error class + message
(sanitised) · Playwright/browser versions · timestamp. All artifacts pass through
the same redaction rules before being written.

---

## 14. Portal-specific appendix template

When a portal is configured and a discovery run is authorised, copy this into
`docs/portals/<portal-slug>.md` (slug derived from the Settings entry, **not**
from a hard-coded name):

```markdown
# Portal Appendix: <name from Settings>

- Portal ID (Settings): <uuid>
- Portal type: regular | evisa | custom
- Country / application type: <from Settings>
- Discovery run date: <YYYY-MM-DD>
- Discovery stage reached: D1 (public) | D2 (authenticated, user-driven)
- Automation boundary reached at: <URL / step> — <type of boundary>

## Fingerprint
<§8.2 table filled in>

## Public-page map (D1)
| Path | Title | Purpose | Key links/buttons | Forms before boundary | Leads to reg/login/security? |
|------|-------|---------|-------------------|-----------------------|------------------------------|

## Authenticated-flow map (D2) — only if/when user-driven discovery is done
<§12 workflow map + step records>

## Field-analysis table
<§2.2 extended table — the real rows>

## Dropdown catalogue
<one §6.3 block per dropdown>

## Validation catalogue
<§10.1 blocks>

## Security-checkpoint catalogue
<§11.1 blocks>

## Adapter configuration notes
<what the portal adapter module needs: selectors, ready signals, step order,
navigation model — to be stored in the adapter/config layer, never inline in
the shared engine>

## Open questions
<unresolved items requiring real use or user input>
```

---

## 15. Consistency with the Phase 0 specification

| This document | Phase 0 spec |
|---------------|--------------|
| Discovery starts from the configured portal URL only (§1.2) | §9a single-source-of-truth; §7 Test Connection |
| Public-page walker reuses the same element inventory as `pageInspector` | spec §7 `ConnectionTestResult.elementCounts` |
| Security checkpoints detected, never solved (§11) | Global Constraints; rules 17–18; ADR-0004 |
| Portal-specific findings → adapter/config layer, never engine (§8.1, §14) | §3.2 engine vs adapters; ADR-0002 |
| No field values / passport data / credentials in state or logs (§13.1) | §8 security infrastructure; rules 14–16 |
| Final submission user-controlled (§7.2, §12.1) | rule 19 |
| Per-portal appendix, portal-agnostic body | spec is portal-agnostic; no seed data |

---

## 16. End-of-phase counts (current)

| Metric | Count | Reason |
|--------|-------|--------|
| Pages identified | **0** | No portal configured; no live discovery run |
| Fields identified | **0** | ” |
| Dynamic fields | **0** | ” |
| Dependent dropdowns | **0** | ” |
| Fields requiring user input | **0** (framework defines the categories) | ” |
| Fields auto-populatable | **0** (framework defines the method) | ” |

### Unresolved questions

1. Which portal(s) will the user configure? (Deliberately unanswered — §9a.)
2. Does the target portal support "resume application" by reference, or is the
   flow strictly account-bound? (Resolve in D2 / real use.)
3. Portal rendering model (SSR vs SPA vs WebForms) — determines selector and
   navigation strategy. (Resolve in D1.)
4. Where exactly does the first security boundary sit — before or after the user
   can see the full list of required documents / field labels? (Resolve in D1.)
5. Are any required fields only discoverable after login? (Likely yes; resolve in D2.)
6. Date/number/locale formats and whether language can be pinned. (Resolve in D1.)
7. Does the portal expose dependent-dropdown data via inspectable XHR, or compute
   it inline? (Resolve in D1/D2.)
