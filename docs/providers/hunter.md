# Hunter API notes

Verified: 2026-10-12 against:
- https://hunter.io/api-documentation (V2 reference; single page for all endpoints)
- https://hunter.io/openapi.json (machine-readable reference linked from the docs)

## Authentication
- API version **v2** (`https://api.hunter.io/v2/`).
- The key can be sent three ways: `api_key` query param, **`X-API-KEY` header**, or `Authorization: Bearer <key>`.
- We use the **`X-API-KEY` header** (preferred; keeps the key out of URLs/logs).
- A shared test key `test-api-key` validates params and returns a dummy response; we do not use it.

## Error model
- Hunter returns `{ "errors": [{ id, code, details }] }` on failure.
- Conventional status codes: `400` bad request, `401` no valid key, **`403` rate limit reached**, `404` not found, `422` unprocessable, **`429` usage limit reached**, `451` unavailable for legal reasons (`claimed_email`), `5XX` server errors.
- **Important:** Hunter uses **403 for rate limiting** (unlike most APIs, which use 429 for that). `src/providers/hunter.ts` maps 403 → `RATE_LIMITED`.
- `451 claimed_email` means the data subject asked Hunter to stop processing their data → mapped to `SUPPRESSED` with a "do not contact" hint.

## Endpoint: Email Finder
- **Method + URL:** `GET https://api.hunter.io/v2/email-finder`
- **Params we send:** `domain`, `first_name`, `last_name` (all required by us; Hunter also accepts `company`, `full_name`, `linkedin_handle`, `max_duration`).
- **Request params:** also `api_key` (or the header).
- **Response fields we read:** `data.{email, score, domain, accept_all, verification.status, sources[].uri}`.
- **`score`:** 0–100, Hunter's probability the address is correct. Thresholds in `src/engine/waterfall.ts`: ≥ 90 → `likely`, 70–89 → `unknown`, < 70 → discard.
- **`verification.status`:** `valid` | `accept_all` | `unknown` (a verification is run automatically on each finder result; no credit if no email is found).
- **Rate limit:** 15 req/s, 500 req/min.
- **Cost:** 1 Hunter credit per email found (no credit charged when nothing is found). Used as the budget estimate.

## Endpoint: Email Verifier
- **Method + URL:** `GET https://api.hunter.io/v2/email-verifier`
- **Params:** `email` (+ `api_key`/header).
- **Behaviour:** the request runs for up to 20s; if it can't finish, Hunter returns **`202`** and you poll the same endpoint (counted once).
- **Response fields we read:** `data.{email, status, score, accept_all, regexp, gibberish, disposable, webmail, mx_records, smtp_server, smtp_check}`.
- **`status` values (verified):** `valid`, `invalid`, `accept_all`, `webmail`, `disposable`, `unknown`.
- **Mapping to OpenSDR `EmailStatus` :** `valid`→`verified`; `invalid`→`invalid`; `accept_all`→`accept_all`; `webmail`→`verified` (+ warning "personal mailbox"); `disposable`→`invalid`; `unknown`→`unknown`.
- **Rate limit:** 10 req/s, 300 req/min.
- **Cost:** 1 Hunter credit per verification.

## Idempotency
- Both endpoints are read-only GETs and are safe to retry (`idempotent: true`).

## Implementation notes
1. **Hunter rate limiting is `403`, not `429`.** The shared HTTP client maps 403 → `PERMISSION_DENIED`. We keep that generic mapping in the HTTP client but override it in the Hunter provider (403 → `RATE_LIMITED`) because Hunter's own docs define 403 as "you have reached the rate limit".
2. **Async verification:** the verifier can return **`202 Accepted`** (async). We treat `202` as `unknown` for now and note that polling is a future enhancement (not needed for v1.0's synchronous flow).

## Cost model used in code
`src/providers/hunter.ts` exports `HUNTER_COSTS = { findEmail: 1, verifyEmail: 1 }` (credits).
