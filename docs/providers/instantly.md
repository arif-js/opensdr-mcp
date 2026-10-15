# Instantly API notes

Verified: 2026-10-12 against:
- https://developer.instantly.ai/api-reference/campaign/create-campaign
- https://developer.instantly.ai/api-reference/lead/add-leads-in-bulk-to-a-campaign-or-list
- https://developer.instantly.ai/api-reference/groups/campaign

## Authentication
- API **v2**, base `https://api.instantly.ai/api/v2`.
- **`Authorization: Bearer <token>`** header, `content-type: application/json`.

## Endpoint: Create campaign
- **Method + URL:** `POST https://api.instantly.ai/api/v2/campaigns`
- **Body we send:** `name`, `campaign_schedule` (`{ schedules: [{ name, timing: { from, to }, days: { "0".."6": bool }, timezone }], start_date?, end_date? }`), `sequences` (only the first element is used; `steps[]` with `type: "email"`, `delay`, `delay_unit: "days"`, `variants: [{ subject, body }] }`), and optionally `email_list` (sending accounts) and `daily_limit`.
- **Activation:** the create body has **no activation flag**. Activation/pausing are **separate endpoints** in the campaign group (`activate`, `pause`). OpenSDR never calls them, so a created campaign is never activated by us.
- **Response:** the campaign object including `id`, `name`, and a numeric `status`.
- **`status` numeric enum** (verified 2026-10-13 against https://developer.instantly.ai/api-reference/campaign/get-campaign): `0` Draft, `1` Active, `2` Paused, `3` Completed, `4` Running Subsequences, `-1` Accounts Unhealthy, `-2` Bounce Protect, `-99` Account Suspended. The client maps these to labels (`draft`, `active`, …; unmapped → `unknown_<n>`).
- **Errors:** `400` validation, `401` missing auth, `402` no paid plan, `404` not found, `429` rate limit.

## Endpoint: Get campaign
- **Method + URL:** `GET https://api.instantly.ai/api/v2/campaigns/{id}`.
- **Response:** a single campaign object; mapped to `{ id, name, status }` where `status` is the raw numeric code as a string (`"unknown"` if absent). A `404` maps to `null`.
- **Why:** `sdr_push_to_campaign` fetches the campaign so the preview shows its real status, and only pushes into `draft` or `paused` campaigns; every other status is refused.

## Endpoint: Add leads in bulk
- **Method + URL:** `POST https://api.instantly.ai/api/v2/leads/add`
- **Body:** `{ leads: [...], campaign_id }` (or `list_id`, not both). Lead fields we send: `email` (required with `campaign_id`), `first_name`, `last_name`, `company_name`, `custom_variables` (object; string values only).
- **Limits:** 1–1000 leads per request. We cap at 100 per call.
- **Response:** `{ status, total_sent, leads_uploaded, in_blocklist, duplicated_leads, skipped_count, invalid_email_count, incomplete_count, duplicate_email_count, remaining_in_plan, created_leads[{ id, email, index }] }`. We map `leads_uploaded` → `added`, the skip counters → `skipped`, and `created_leads` → `created_emails[]` so only leads Instantly actually created are marked queued.
- **Idempotency:** creating resources → **not retried** (`idempotent: false`).

## Endpoint: List campaigns
- **Method + URL:** `GET https://api.instantly.ai/api/v2/campaigns`
- **Response:** a paginated collection. **UNCONFIRMED:** the collection key (`items` vs `campaigns`); the client reads `items ?? campaigns ?? data` defensively and maps `{ id, name, status }`.

## Rate limits
- 429 → `RATE_LIMITED`. Exact headers **UNCONFIRMED**; the client honors `Retry-After` when present and otherwise backs off (never for the non-idempotent creates).

## Cost model
- Instantly has no per-call credit cost in our budget engine; `INSTANTLY_COSTS = { createCampaign: 0, addLeads: 0 }`.
