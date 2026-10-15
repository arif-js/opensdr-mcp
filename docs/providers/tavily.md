# Tavily API notes

Verified: 2026-10-12 against:
- https://docs.tavily.com/documentation/api-reference/introduction
- https://docs.tavily.com/documentation/best-practices/best-practices-search
- https://docs.tavily.com/llms.txt (index)
(The endpoint reference page itself was intermittently unavailable during verification; parameters below are cross-checked against the best-practices page and the docs index.)

## Authentication
- **`POST https://api.tavily.com/search`** (base URL `https://api.tavily.com`).
- **`Authorization: Bearer tvly-YOUR_API_KEY`** header. Optional `X-Project-ID`, `X-Session-Id`, `X-Human-Id` headers are available; we don't use them in v1.0.

## Request body (fields we send)
| OpenSDR input | Tavily field | Notes |
|---|---|---|
| `query` | `query` | required, keep under 1,500 chars |
| `max_results` | `max_results` | default 5 |
| `search_depth` | `search_depth` | we send `basic` (1 credit) to control cost |
| `topic` | `topic` | `news` for signals (adds `published_date`) |
| `include_domains` | `include_domains` | |
| `exclude_domains` | `exclude_domains` | |
| `start_date` / `end_date` | `start_date` / `end_date` | `YYYY-MM-DD` |
| published dates | `include_published_date` | `true` so results carry `published_date` |

## Response fields we read
- `results[].{ title, url, content, score, published_date }`
- `usage` (credits) when `include_usage` is set; we don't request it in v1.0.
- **UNCONFIRMED:** the exact top-level envelope beyond `results` (e.g. `answer`, `usage`) — we only read `results`.

## Credits
- `search_depth: basic` = **1 credit**; `advanced` = **2 credits**; `auto_parameters` may silently pick `advanced`. We pin `basic` and never enable `auto_parameters`, so each search is 1 credit. Exposed as `TAVILY_COSTS = { webSignals: 1 }`.

## Error bodies
- Standard HTTP status codes; 401 → bad key, 429 → rate/usage limit. The docs page did not include an error-body schema (**UNCONFIRMED**).

## Idempotency
- Read-only search POST; safe to retry (`idempotent: true`).
