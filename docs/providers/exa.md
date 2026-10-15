# Exa API notes

Verified: 2026-10-12 against:
- https://exa.ai/docs/reference/search (redirect target of https://docs.exa.ai/reference/search)

## Authentication
- **`POST https://api.exa.ai/search`**.
- Key in the **`x-api-key`** header. `Authorization: Bearer <key>` is also accepted; we use `x-api-key`.

## Request body (fields we send)
| OpenSDR input | Exa field | Notes |
|---|---|---|
| `query` | `query` | required, min length 1 |
| `max_results` | `numResults` | default 10, max 100 (we cap at 10) |
| `include_domains` | `includeDomains` | hostnames or `*.example.com` wildcards |
| `exclude_domains` | `excludeDomains` | |
| `start_date` | `startPublishedDate` | ISO 8601 |
| `end_date` | `endPublishedDate` | ISO 8601 |
| `topic` | `category` | `news` for signals; other values are hints |
| excerpts | `contents.text` | we request `{ maxCharacters: 1500 }` |

- `type` defaults to `auto`; we send `auto`.
- **Caveat:** the `company` and `people` categories do **not** support `startPublishedDate`, `endPublishedDate` or `excludeDomains` (400 if sent). We only use `category: "news"` for signals, which supports date filters.

## Response fields we read
- `results[].{ title, url, publishedDate, text, highlights[] }`
- `costDollars` (actual cost) and `requestId`.
- **UNCONFIRMED:** whether `contents.text` accepts `{ maxCharacters }` — documented as a child attribute of `contents`; we send it and additionally trim to 1,500 chars locally, so the cap holds either way.

## Error bodies
- `{ requestId, error, tag }` with the matching HTTP status. 401 → key, 429 → rate limit (429 also maps to `RATE_LIMITED`).

## Idempotency
- Read-only search POST; safe to retry (`idempotent: true`).

## Cost model used in code
- Exa bills in **dollars** (`costDollars`), not credits. Our budget engine is credit-based, so `src/providers/exa.ts` exports `EXA_COSTS = { webSignals: 1 }` as a **nominal 1-unit estimate per search**. Recorded here so the estimate is not mistaken for an Exa unit.
