# Apollo API notes

Verified: 2026-10-12 against:
- https://docs.apollo.io/reference/people-api-search
- https://docs.apollo.io/reference/organization-search
- https://docs.apollo.io/docs/find-people-using-filters
- https://docs.apollo.io/reference/authentication
- https://knowledge.apollo.io/hc/en-us/articles/4412665755661-Use-Search-Filters-to-Find-Prospects (filters glossary)

## Authentication
- Every request sends the key in the **`x-api-key`** header. Source: the authentication reference page ("Pass the key in the `x-api-key` header of every request").
- Some endpoints require a **master API key**. For the two search endpoints used here, both the standard API key and a master key are accepted (`API key access` row on each endpoint page).
- We also send `content-type: application/json`, `accept: application/json` and `cache-control: no-cache` (the official tutorial sets `Cache-Control: no-cache`).

## Endpoint: People API Search
- **Method + URL:** `POST https://api.apollo.io/api/v1/mixed_people/api_search`
- **Credit cost:** **0 credits** (documented on the endpoint's "Credit usage" row). People search is free.
- **Returns emails/phones?** No. The docs state the endpoint "doesn't return email addresses or phone numbers". Use people enrichment (`sdr_waterfall_enrich_person`) for that.
- **Display limit:** 50,000 records, 100 per page, up to 500 pages.
- **Rate limits:** not published as a fixed number; limits vary by plan. 429 is returned when exceeded → mapped to `RATE_LIMITED`. The exact rate-limit response headers are **UNCONFIRMED**; the client honors `Retry-After` when present and otherwise backs off exponentially.
- **Request params we send** (JSON body; the tutorial shows query params, and permits passing them in the request body):
  | OpenSDR input | Apollo param | Notes |
  |---|---|---|
  | `job_titles` | `person_titles[]` | up to 10 in our tool; array of strings |
  | `person_seniorities` | `person_seniorities[]` | enum, see below |
  | `person_locations` | `person_locations[]` | cities / US states / countries |
  | `organization_domains` | `q_organization_domains_list[]` | no `www.`, no `@`; up to 1,000 (we cap at 50) |
  | `organization_locations` | `organization_locations[]` | company HQ location |
  | `employee_ranges` | `organization_num_employees_ranges[]` | strings like `51,200` |
  | `keywords` | `q_keywords` | free text |
  | pagination | `page`, `per_page` | `per_page` 1–100 |
- **Seniority enum (verified):** `owner`, `founder`, `c_suite`, `partner`, `vp`, `head`, `director`, `manager`, `senior`, `entry`, `intern`. Matches `src/types.ts` `Seniority`.
- **Response fields we read:** `total_entries`, `people[].{id, first_name, last_name_obfuscated, title, last_refreshed_at, organization.name}`. Search returns an **obfuscated** last name (`last_name_obfuscated`, e.g. `Mo***s`) and only `organization.name` plus availability flags.
- **Error bodies:** `401` invalid key, `403` need master API key / plan, `422` validation error, `429` too many requests.

## Endpoint: Organization Search
- **Method + URL:** `POST https://api.apollo.io/api/v1/mixed_companies/search`
- **Credit cost:** **1 credit per page** (up to 100 results per page). This is the value used by the budget engine.
- **Display limit:** 50,000 records, 100 per page, up to 500 pages.
- **Request params we send:**
  | OpenSDR input | Apollo param | Notes |
  |---|---|---|
  | `domains` | `q_organization_domains_list[]` | normalized |
  | `employee_ranges` | `organization_num_employees_ranges[]` | strings like `51,200` |
  | `locations` | `organization_locations[]` | HQ location |
  | `revenue_ranges` | `revenue_range[min]` / `revenue_range[max]` | integers, no symbols |
  | `technologies` | `currently_using_any_of_technology_uids[]` | underscore form, e.g. `salesforce` |
  | `industries` + `keywords` | `q_organization_keyword_tags[]` | Apollo has no industry enum for this endpoint |
  | pagination | `page`, `per_page` | `per_page` 1–100 |
- **Response fields:** `organizations[]` (plus `accounts[]` for CRM records). We read `organizations[].{id, name, primary_domain, website_url, industry, estimated_num_employees, founded_year, organization_city, organization_state, organization_country, technology_names, linkedin_url, latest_funding_stage, total_funding}`. **UNCONFIRMED:** the exact organization field names — the reference page did not include a response sample, so the mapper reads them defensively and drops missing fields.
- **Error bodies:** `401` invalid key, `403` plan/pricing, `429` too many requests.

## Idempotency
- Both endpoints are read-only searches and are safe to retry (the client uses `idempotent: true`).

## Implementation notes
1. **`person_departments` filter does not exist** on the People API Search endpoint. The Apollo UI exposes a "Departments & Job Function" option inside the Job Titles filter, but the API reference lists no `person_departments[]` request parameter. So `sdr_lookup_filters` with `kind: "department"` cannot map to an Apollo enum. We keep a **curated** department list as guidance for building `job_titles`, and record it as curated (not an Apollo enum).
2. **`revenue_range` is not an enum.** Apollo takes numeric `revenue_range[min]` / `revenue_range[max]`. We model the taxonomy as named buckets that carry `min`/`max` integers; `sdr_search_companies` resolves the bucket label to those numbers.
3. **`sdr_lookup_filters` kinds** for `industry` and `department` are curated keyword lists, not Apollo enums (Apollo matches industries/keywords as free tags). Only `seniority` and `employee_range` are exact Apollo values.
4. **Employee range values are UNCONFIRMED.** The API reference lists no allowed-value set; it only shows example strings (`1,10`; `250,500`; `10000,20000`). We seed the taxonomy with the standard Apollo UI headcount buckets in `"<min>,<max>"` form. Values are passed through to Apollo, which validates them.
5. **Credits:** the current `mixed_people/api_search` endpoint costs **0 credits**; `mixed_companies/search` costs 1 credit per page.

## Endpoint: People Enrichment (match)
- **Method + URL:** `POST https://api.apollo.io/api/v1/people/match`
- **Credit cost:** **1–9 credits per person** — 1 for demographics or email, **+8 if a mobile phone is returned**. If no credit-consuming data is found, the request costs 0. `match_confidence: none` is never charged a demographic credit. We estimate **1 credit** per match for the budget (email + demographics only; we never reveal phones).
- **Params we send:** `first_name`, `last_name`, `domain`, `id` (Apollo id), `linkedin_url`, `email`, `organization_name` — whichever the caller supplied.
- **Always sent explicitly:** `reveal_personal_emails: false` and `reveal_phone_number: false`. Personal emails and phone numbers are out of scope (phone reveal needs a webhook, which a local STDIO server can't receive).
- **Response fields we read:** `person.{id, first_name, last_name, name, email, email_status, title, linkedin_url, organization.{name, primary_domain}}`, `match_confidence`.
- **`match_confidence`:** `high` | `medium` | `low` | `none`. `none` means no match (we return `null`).
- **Idempotency:** read-only POST; safe to retry (`idempotent: true`).
- **Errors:** `400` webhook/poll misuse, `401` invalid key, `429` rate limited.

## Endpoint: Organization Enrichment
- **Method + URL:** `GET https://api.apollo.io/api/v1/organizations/enrich?domain=<domain>`
- **Credit cost:** **1 credit per organization**.
- **Params:** `domain` (or `linkedin_url` / `website`); optional `name` to improve accuracy.
- **Response fields we read:** `organization.{id, name, primary_domain, website_url, industry, estimated_num_employees, founded_year, organization_city/state/country, technology_names, linkedin_url, latest_funding_stage, total_funding}` (same defensive mapping as search). **UNCONFIRMED:** the exact field names — the reference page has no response sample.
- **Idempotency:** read-only GET; safe to retry.
- **Errors:** `401`, `403` insufficient scope, `422` no identifier, `429`.

## Cost model used in code
`src/providers/apollo.ts` exports `APOLLO_COSTS = { peopleSearch: 0, companySearch: 1, matchPerson: 1, enrichCompany: 1 }` (credits).
