# How it works

## The big picture

```
 You ── plain English ──▶ AI assistant (Claude Desktop, Claude Code, Cursor, …)
                                │  MCP over STDIO (runs on your machine)
                                ▼
 ┌────────────────────────── OpenSDR ──────────────────────────┐
 │  17 tools · 3 prompts · 4 resources                          │
 │                                                              │
 │  Safety gates ─ read-only switch · preview + confirm ·       │
 │                 do-not-contact list · credit budget          │
 │                                                              │
 │  Engine ─ email waterfall · signal rules · outreach briefs   │
 │                                                              │
 │  Providers ─ Apollo · Hunter · Tavily/Exa · Instantly ·      │
 │              HubSpot · Demo                                  │
 │                                                              │
 │  Local store ─ ~/.opensdr (lists, cache, suppression)        │
 └──────────────────────────────────────────────────────────────┘
                                │  HTTPS, with your own keys
                                ▼
            Apollo · Hunter · Tavily/Exa · Instantly · HubSpot
```

- **Your assistant does the thinking and writing.** OpenSDR has no AI model of its own. It finds, verifies, stores and stages data, and hands the assistant structured facts with sources. The assistant writes the copy.
- **Everything runs locally.** Your client starts OpenSDR as a background process. There is no OpenSDR server or account; requests go straight from your machine to the providers whose keys you added.
- **Every provider is optional.** Each capability (people search, enrichment, signals, campaigns, CRM) is served by whichever provider you configured.

## A typical session

1. **Find:** your ideal customer profile becomes normalized filters (`sdr_lookup_filters`), then a people or company search. Search never returns emails, so it's cheap.
2. **Enrich:** the approved people go through the email waterfall, within your credit budget.
3. **Research:** buying signals and account sources give a reason to reach out *now*, each with a URL.
4. **Draft:** an outreach brief bundles sourced facts, a sequence framework and writing rules; the assistant writes and you approve.
5. **Stage:** campaign creation, lead enrollment and CRM sync each show a preview first and run only after you confirm.

## The email waterfall

`sdr_waterfall_enrich_person` tries the cheapest reliable source first and stops as soon as it has a verified email:

```
1. Suppressed?            → stop, no credits spent
2. Cached result?         → return it (0 credits)
3. Apollo match           → email marked "verified" by Apollo? → done
4. Hunter email finder    → score ≥ 90 → likely · 70–89 → unknown · < 70 → discarded
                            (a Hunter result can upgrade, never downgrade, an Apollo result)
5. Hunter verifier        → optional (verify_with_hunter): deliverable → verified
6. Local checks (free)    → syntax · MX record · disposable domain · role address (info@, sales@…)
```

Each result includes the email, a status (`verified`, `likely`, `accept_all`, `unknown`, `invalid`), a confidence score and a **trail** showing every tier that ran, why, and what it cost. Paid tiers stop before they would exceed the credit budget, and results are cached for 30 days so you never pay twice for the same person.

OpenSDR deliberately does **not** do SMTP "ping" verification: it's unreliable from most networks and can get your IP blocklisted.

## Buying signals

`sdr_detect_buying_signals` searches recent news and web content through Tavily or Exa and classifies results into funding, hiring, leadership changes, product launches, acquisitions and tech changes:

- **Confidence** is `high` when the company name appears in the title, a signal keyword matches and the date is inside the lookback window; `medium` or `low` when fewer of those hold.
- Duplicate stories (the same article syndicated across sites, or tracking-link variants) are collapsed.
- **Every signal has a source URL.** Excerpts are capped in length and labelled as untrusted third-party text, so the assistant treats them as facts to cite, never as instructions.

## Outreach briefs

`sdr_prepare_outreach_brief` doesn't write emails. It gives the assistant:
- per-prospect facts, each with its source (a provider field or a signal URL),
- the top signals per prospect,
- a sequence framework (touches, channels, timing, word limits),
- rules: cite one sourced fact per first line, never invent facts or customers, include an opt-out line, no fake "Re:" subjects, skip suppressed prospects.

## Preview and confirm

The three tools that write to external services (`sdr_create_campaign`, `sdr_push_to_campaign`, `sdr_sync_hubspot`) work in two steps:

```
call without confirm ──▶ preview: who/what would be sent, who is excluded and why,
                         plus a single-use confirmation token (expires in 15 minutes)
        │
   you approve in the conversation
        │
call with confirm + token ──▶ gates re-checked ──▶ action runs
```

At confirm time, the gates run again. If any approved lead or contact was **added or changed** since the preview, the confirm is rejected and a new preview is required. Leads that dropped out (for example, newly suppressed) are skipped and reported. Details: [safety and privacy](safety.md).

## Providers

| Capability | Providers |
|---|---|
| People and company search | Apollo |
| Person and company enrichment | Apollo |
| Email finding and verification | Hunter (+ free local checks) |
| Buying signals and research | Tavily or Exa |
| Campaigns | Instantly (API v2) |
| CRM | HubSpot |
| Everything (fictional data) | Demo |

How each provider's API is used, including endpoints and known caveats, is documented in [`docs/providers/`](providers/README.md). New providers plug in behind the same capability interfaces; see [CONTRIBUTING](../CONTRIBUTING.md#adding-a-provider).
