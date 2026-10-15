# Configuration

OpenSDR is configured entirely through environment variables, set in the `env` block of your MCP client's config (see [getting started](getting-started.md)). There is no config file to manage and no OpenSDR account.

## Provider keys

Every provider is optional. Add the ones you have; each one unlocks more tools.

| Variable | Enables | Where to get it |
|---|---|---|
| `APOLLO_API_KEY` | People and company search, person match (waterfall tier 1), company enrichment | Apollo → Settings → Integrations → API. Some endpoints need a **master** key, and API access depends on your plan. |
| `HUNTER_API_KEY` | Email finder (waterfall tier 2) and email verifier | hunter.io → Dashboard → API |
| `TAVILY_API_KEY` | Buying signals and account research | app.tavily.com → API Keys |
| `EXA_API_KEY` | Buying signals and account research (alternative to Tavily) | dashboard.exa.ai → API Keys |
| `INSTANTLY_API_KEY` | Draft campaign creation and lead enrollment (Instantly **API v2**) | Instantly → Settings → Integrations → API |
| `HUBSPOT_ACCESS_TOKEN` | Contact sync and notes | HubSpot → Settings → Integrations → Private Apps. Create an app with `crm.objects.contacts.read`, `crm.objects.contacts.write` (and `crm.objects.notes.write` for notes) and copy its token. |

Keys are read from the environment only. OpenSDR never writes them to disk, never returns them from a tool, and redacts them from logs and errors.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `OPENSDR_DATA_DIR` | `~/.opensdr` | Where lists, the cache, the suppression list and CSV exports are stored |
| `OPENSDR_DEMO` | `0` | `1` forces demo mode even when keys are set |
| `OPENSDR_READ_ONLY` | `0` | `1` disables every tool that writes to an external service (campaigns, CRM) |
| `OPENSDR_MAX_CREDITS_PER_CALL` | `25` | Hard cap on estimated paid provider credits per tool call |
| `OPENSDR_CACHE_TTL_DAYS` | `30` | How long enrichment results are reused before paying again |
| `OPENSDR_SIGNALS_PROVIDER` | `exa` | Which signals provider to use when both Exa and Tavily keys are set (`exa` or `tavily`) |
| `OPENSDR_LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug`. Logs go to stderr only. |
| `OPENSDR_HTTP_TIMEOUT_MS` | `20000` | Timeout for each provider request, in milliseconds |

A ready-to-copy list with comments is in [`.env.example`](../.env.example).

## Modes

| Mode | When | Behavior |
|---|---|---|
| **Demo** | No provider keys at all, or `OPENSDR_DEMO=1` | Every tool works on fictional data (`.example` domains), with zero network calls. Results are labelled `demo: true`; write tools return `simulated: true`. |
| **Live** | At least one provider key | Each tool uses its configured provider. A tool whose provider has no key returns `NOT_CONFIGURED` naming the key to add. It never falls back to demo data. |

Run `sdr_provider_status` (or read the `opensdr://providers` resource) to see the current mode, which providers are active, and the credits used this session.

## Seller profile

Create `profile.md` in the data directory (default `~/.opensdr/profile.md`) describing:
- **Product:** what you sell and for whom
- **Ideal customer:** industries, company size, titles, the problem you solve
- **Proof points:** real, verifiable results or customers you can mention
- **Sender:** your name, role and company

`sdr_prepare_outreach_brief` uses it automatically. Without it, the brief asks the assistant to collect this from you before writing.

## Local data

```
~/.opensdr/                  (owner-only permissions: 0700)
├── prospects.json           saved prospects and lists
├── suppression.json         do-not-contact emails and domains
├── cache.json               enrichment results (reused for OPENSDR_CACHE_TTL_DAYS)
├── profile.md               your seller profile (optional, you create it)
└── exports/                 CSV exports
```

Files are written atomically and locked, so two clients (for example Claude Desktop and Cursor) can share the same data safely. Delete the folder to start fresh.
