# Tools, prompts and resources

OpenSDR exposes 17 MCP tools, 3 prompts and 4 resources. You don't call them directly: you ask your assistant in plain English, and it picks the tools. This page is a reference for what each one does.

**Legend:** 💸 may use paid provider credits · ✍️ writes locally · 🌐 writes to an external service (always preview + confirm)

## System
| Tool | What it does | Key inputs |
|---|---|---|
| `sdr_provider_status` | Shows the mode (live/demo), configured providers, limits and credits used this session. No network calls. | – |

## Prospect
| Tool | What it does | Key inputs |
|---|---|---|
| `sdr_lookup_filters` | Free, local lookup of normalized titles, seniorities, employee/revenue ranges, departments and industries, so searches match precisely. | `kind`, `query` |
| `sdr_search_people` | Finds people by title, seniority, location, company domain, company size or keywords (Apollo). Never returns emails. | `job_titles`, `person_seniorities`, `organization_domains`, `employee_ranges`, `limit` (max 50), `cursor` |
| `sdr_search_companies` 💸 | Finds accounts matching your ideal customer profile (Apollo). | `industries`, `employee_ranges`, `revenue_ranges`, `technologies`, `locations`, `max_credits` |

## Enrich
| Tool | What it does | Key inputs |
|---|---|---|
| `sdr_waterfall_enrich_person` 💸 ✍️ | Finds and verifies work emails through the [waterfall](how-it-works.md#the-email-waterfall). Returns status, confidence and a per-tier trail. Results are cached. | `people` (up to 25: name + domain, Apollo id, LinkedIn URL or saved prospect id), `max_credits`, `verify_with_hunter`, `force_refresh` |
| `sdr_enrich_company` 💸 ✍️ | Firmographics: industry, headcount, revenue range, tech stack, funding. Cached. | `domains` (up to 10) |
| `sdr_verify_email` | Free local checks (syntax, MX, disposable, role address), plus an optional Hunter verification. | `emails` (up to 25), `use_provider` |

## Manage
| Tool | What it does | Key inputs |
|---|---|---|
| `sdr_save_prospects` ✍️ | Saves people to a named list, deduplicating and merging. Also how drafted copy (`custom_fields.first_line`) is saved. | `list`, `people`, `merge` |
| `sdr_list_prospects` | Queries saved prospects by list, status, email status or text. | `list`, `status`, `email_status`, `search`, `include_lists_summary` |
| `sdr_export_csv` ✍️ | Exports a list to CSV that is safe to open in Excel or Sheets (formula injection is escaped). Suppressed prospects are excluded by default. | `list` or `prospect_ids`, `columns`, `path` |
| `sdr_manage_suppression` ✍️ | Do-not-contact list for emails and whole domains (including subdomains). | `action` (`add`/`remove`/`list`/`check`), `emails`, `domains`, `reason` |

## Signals
| Tool | What it does | Key inputs |
|---|---|---|
| `sdr_detect_buying_signals` 💸 | Finds recent funding, hiring, leadership changes, launches, acquisitions and tech changes. Every signal has a source URL and a confidence (Tavily or Exa). | `companies` (up to 10), `signal_types`, `lookback_days` (default 90), `attach_to_prospects` |
| `sdr_research_account` 💸 | Gathers cited sources about an account (overview, product, customers, competitors, pricing, news, hiring) for the assistant to summarize. | `domain`, `focus`, `max_sources` |

## Engage
| Tool | What it does | Key inputs |
|---|---|---|
| `sdr_prepare_outreach_brief` | Builds a grounded brief: sourced facts and signals per prospect, a sequence framework and writing rules. The assistant writes the copy. | `prospect_ids` (up to 25), `seller_context`, `touches`, `tone` |
| `sdr_create_campaign` 🌐 | Creates an Instantly campaign as a **draft**. Never activates it. Every email step must include an opt-out line. | `name`, `steps`, `schedule`, then `confirm` + `confirmation_token` |
| `sdr_push_to_campaign` 🌐 | Enrolls verified, non-suppressed leads into a **draft or paused** Instantly campaign, at most 100 per call. | `campaign_id`, `list` or `prospect_ids`, then `confirm` + `confirmation_token` |
| `sdr_sync_hubspot` 🌐 | Upserts contacts into HubSpot by email, optionally with a lifecycle stage and a note. Only fills empty fields unless told otherwise. | `list` or `prospect_ids`, `lifecycle_stage`, `add_note`, then `confirm` + `confirmation_token` |

## Prompts

Ready-made workflows you can pick from your client's prompt menu. Each one tells the assistant which tools to use, in what order, and where to **stop for your approval**.

| Prompt | Arguments | What it does |
|---|---|---|
| `autonomous_sdr_workflow` | `icp`, `list_name`, `target_count` (25), `max_credits` (50) | The full run: search → enrich → signals → draft → (optionally) stage. Stops after search, before spending more than 10 credits, before saving drafts and before every write. |
| `icp_prospecting` | `icp`, `list_name` (optional) | Turns a plain-English ideal customer profile into precise searches and a results table. Saves only what you approve; spends no enrichment credits. |
| `cold_outreach_sequence` | `list_name` or `prospect_ids`, `tone` | Drafts a grounded sequence and per-prospect first lines, then saves them after approval. Never stages a campaign. |

## Resources

Read-only views your client can attach to a conversation. They never call a provider.

| URI | Content |
|---|---|
| `opensdr://providers` | Same as `sdr_provider_status` |
| `opensdr://lists` | All saved lists with counts |
| `opensdr://lists/{name}` | Prospects in one list (first 200) |
| `opensdr://profile` | Your seller profile, or a template to create one |

## Responses and errors

Every tool returns the same JSON shape, which makes results predictable for the assistant:

```json
{ "ok": true, "data": { … }, "meta": { "demo": false, "sources": ["apollo"], "credits_used_estimate": 2, "cached": false, "truncated": false, "next_cursor": null }, "warnings": [] }
```

Failures return `{ "ok": false, "error": { "code", "message", "provider", "retryable", "hint" } }`. The `hint` tells the assistant (and you) what to do next.

| Code | Meaning |
|---|---|
| `BAD_INPUT` | The request was invalid; the message says which field. |
| `NOT_CONFIGURED` | The tool needs a provider key that isn't set. |
| `AUTH_FAILED` / `PERMISSION_DENIED` | The provider rejected the key or its scope. |
| `RATE_LIMITED` / `QUOTA_EXCEEDED` | Slow down, or the provider account is out of credits. |
| `BUDGET_EXCEEDED` | The call would exceed `OPENSDR_MAX_CREDITS_PER_CALL` or your `max_credits`. |
| `CONFIRMATION_REQUIRED` | A write needs a fresh preview and your approval. |
| `READ_ONLY_MODE` | `OPENSDR_READ_ONLY=1` blocks external writes. |
| `SUPPRESSED` | The contact or domain is on your do-not-contact list. |
| `NOT_FOUND`, `TIMEOUT`, `PROVIDER_ERROR`, `STORE_ERROR`, `INTERNAL` | As named. |
