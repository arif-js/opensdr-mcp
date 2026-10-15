<div align="center">

# OpenSDR

**The open-source AI SDR for Claude and any MCP client.**

Find prospects, verify their emails, spot buying signals, draft grounded outreach and stage campaigns, all from a conversation with your AI assistant, using your own API keys.

[![npm](https://img.shields.io/npm/v/opensdr-mcp)](https://www.npmjs.com/package/opensdr-mcp)
[![CI](https://github.com/arif-js/opensdr-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arif-js/opensdr-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-8A2BE2)](https://modelcontextprotocol.io)
[![OpenSDR MCP server on Glama](https://glama.ai/mcp/servers/arif-js/opensdr-mcp/badges/score.svg)](https://glama.ai/mcp/servers/arif-js/opensdr-mcp)

[Quick start](#quick-start) · [Demo](#see-it-in-action) · [How it works](#how-it-works) · [Docs](docs/README.md) · [Contributing](#contributing)

</div>

---

## What it does

OpenSDR is an [MCP](https://modelcontextprotocol.io) server that gives your AI assistant the toolkit of a sales development rep (SDR). You describe who you want to reach; your assistant does the legwork:

- 🔎 **Find prospects** that match your ideal customer profile (Apollo).
- ✉️ **Find and verify work emails** with a cost-aware waterfall: Apollo → Hunter → free local checks.
- 📈 **Spot buying signals** (funding, hiring, leadership changes, launches) with a source link for every one (Tavily or Exa).
- ✍️ **Draft grounded outreach**: every personalized line cites a real, sourced fact.
- 🚀 **Stage campaigns and CRM records** in Instantly and HubSpot, only after you approve a preview.

## Why it's useful

| The usual way | With OpenSDR |
|---|---|
| Four or five SaaS tools (contact database, email finder, signals, sequencer) plus marked-up credits | **Your own API keys, $0 markup.** Pay providers directly, only for what you use. |
| Prospect lists and strategy uploaded to someone else's cloud | **Local-first.** Runs on your machine. No OpenSDR server, no telemetry. |
| "AI SDRs" that send email on their own and burn your domain | **Nothing is sent without your approval.** Campaigns are created as drafts; you press go. |
| Generic, made-up personalization | **Grounded copy.** Every first line cites a provider field or a signal URL. |
| Credits wasted on repeat lookups | **Credit-aware.** Per-call budgets, cost estimates and a 30-day enrichment cache. |
| Hard to try before buying | **Zero-key demo mode.** Every tool works on fictional data before you add a single key. |

## See it in action

A real session in demo mode (no keys, fictional `.example` companies):

> **You:** Find VP Engineering leaders at B2B software and fintech companies, get their emails, and check for buying signals.

| Prospect | Company | Email (verified) | Signal |
|---|---|---|---|
| Amara Haddad, VP Engineering | Bluepeak | amara.haddad@bluepeak.example | Raised a $25M Series B ([source](docs/demo.md#3-find-a-reason-to-reach-out-now)) |
| Sofia Doe, VP Engineering | Ledgerly | sofia.doe@ledgerly.example | Raised a $25M Series B |
| Lena Alvarez, VP Engineering | Wellspring Care | lena.alvarez@wellspringcare.example | Raised a $25M Series B |

> **You:** Meridian Pay asked us not to contact them. Push the rest into my Instantly campaign.

```
Preview (nothing sent yet)
  eligible: 4   excluded: 1 (suppressed: Meridian Pay)
  confirmation_token: 1045338e…  single-use, expires in 15 min
→ Claude shows you the list and waits for your approval before confirming.
```

**[Full walkthrough →](docs/demo.md)** (find → enrich → signals → draft → stage)

## Quick start

Requires **Node.js 22.12+**.

**1. Add OpenSDR to your assistant.** Claude Desktop → Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "opensdr": { "command": "npx", "args": ["-y", "opensdr-mcp"] }
  }
}
```

Claude Code: `claude mcp add opensdr -- npx -y opensdr-mcp`. Cursor and other clients: see [getting started](docs/getting-started.md).

**2. Try it with no keys.** Restart your client and ask: *"Find VP Engineering leaders at fintech companies and draft outreach."* Or pick the built-in **autonomous_sdr_workflow** prompt.

**3. Add the providers you have.** Every key is optional; add them to `env`:

```json
"env": {
  "APOLLO_API_KEY": "…",
  "HUNTER_API_KEY": "…",
  "TAVILY_API_KEY": "…"
}
```

Also supported: `EXA_API_KEY`, `INSTANTLY_API_KEY`, `HUBSPOT_ACCESS_TOKEN`. Where to get each key and every setting: [configuration](docs/configuration.md).

## How it works

```
You ──▶ AI assistant ──MCP──▶ OpenSDR (on your machine) ──your keys──▶ Apollo · Hunter · Tavily/Exa · Instantly · HubSpot
                                 │
                                 ├─ safety gates: preview + confirm · do-not-contact list · read-only switch · credit budget
                                 ├─ engine: email waterfall · signal rules · outreach briefs
                                 └─ local store: ~/.opensdr (lists, cache, suppression)
```

1. **Find:** your ideal customer profile becomes precise search filters. Search never returns emails, so it's cheap.
2. **Enrich:** each person goes through the email waterfall, stopping at the first verified result, within your credit budget. Every result shows a trail of what was tried and what it cost.
3. **Research:** buying signals give a reason to reach out *now*, each with a source URL.
4. **Draft:** an outreach brief hands your assistant sourced facts, a sequence framework and writing rules. The assistant writes; you approve.
5. **Stage:** campaign creation, lead enrollment and CRM sync each return a preview and a single-use token, and run only after you confirm.

OpenSDR has no AI model of its own: your assistant does the thinking and writing, and OpenSDR handles data, verification and safe execution. **[More on the architecture, waterfall and signals →](docs/how-it-works.md)**

## Tools

| Area | Tools |
|---|---|
| System | `sdr_provider_status` |
| Prospect | `sdr_lookup_filters` · `sdr_search_people` · `sdr_search_companies` |
| Enrich | `sdr_waterfall_enrich_person` · `sdr_enrich_company` · `sdr_verify_email` |
| Manage | `sdr_save_prospects` · `sdr_list_prospects` · `sdr_export_csv` · `sdr_manage_suppression` |
| Signals | `sdr_detect_buying_signals` · `sdr_research_account` |
| Engage | `sdr_prepare_outreach_brief` · `sdr_create_campaign` · `sdr_push_to_campaign` · `sdr_sync_hubspot` |

Plus 3 built-in prompts (`autonomous_sdr_workflow`, `icp_prospecting`, `cold_outreach_sequence`) and 4 resources (`opensdr://providers`, `opensdr://lists`, `opensdr://lists/{name}`, `opensdr://profile`). **[Full reference →](docs/tools.md)**

## Safety and privacy

- **Preview + confirm** for every external write, and the confirm is rejected if anything you approved changed in between.
- **Campaigns are drafts, never activated**, and leads only go into draft or paused campaigns.
- **Do-not-contact list** honored by every push, sync and export, with no override.
- **Read-only mode** (`OPENSDR_READ_ONLY=1`) and a **per-call credit cap**.
- **Your keys and data stay on your machine**: no OpenSDR server, no telemetry, keys never logged or stored.
- **Never automates LinkedIn**: it only drafts notes for you to send.

You're responsible for complying with CAN-SPAM, GDPR, CASL and your providers' terms. **[Safety, privacy and compliance →](docs/safety.md)**

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install in Claude Desktop, Claude Code or Cursor; demo mode; troubleshooting |
| [Demo walkthrough](docs/demo.md) | A real end-to-end session |
| [Configuration](docs/configuration.md) | API keys, settings, modes, seller profile, local data |
| [Tools reference](docs/tools.md) | All tools, prompts, resources and error codes |
| [How it works](docs/how-it-works.md) | Architecture, email waterfall, signals, preview + confirm |
| [Safety and privacy](docs/safety.md) | Every guard, what stays local, compliance |
| [Provider API notes](docs/providers/README.md) | How each provider's API is used |

## Roadmap

- More sequencers: Smartlead, Lemlist
- More CRMs: Salesforce, Pipedrive
- Remote transport (Streamable HTTP) for web-based clients
- Ideal-customer fit scoring and reply tracking

Have a provider you need? [Open a provider request](https://github.com/arif-js/opensdr-mcp/issues/new/choose).

## Contributing

Contributions are welcome, whether you write the code yourself or with an AI coding agent.

- **Start here:** [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, checks and the PR process.
- **Add a provider:** data sources, sequencers and CRMs plug in behind small capability interfaces; follow [the add-provider guide](.agents/skills/add-provider/SKILL.md).
- **Using an AI agent?** [AGENTS.md](AGENTS.md) holds the architecture rules and safety invariants. Codex, Cursor and Copilot read it automatically; Claude Code and Gemini CLI load it through `CLAUDE.md` and `GEMINI.md`.
- **Security issues:** please report privately, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Arif

<sub>OpenSDR is an independent open-source project, not affiliated with or endorsed by Anthropic, Apollo.io, Hunter, Exa, Tavily, Instantly or HubSpot. Product names are trademarks of their respective owners.</sub>
