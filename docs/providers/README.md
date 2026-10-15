# Provider API notes

How OpenSDR uses each provider's API: endpoints, authentication, pagination, rate limits, credit costs and known caveats. Each file records the date it was checked against the provider's official documentation.

| Provider | Notes | Used for |
|---|---|---|
| Apollo | [apollo.md](apollo.md) | People/company search, person match, company enrichment |
| Hunter | [hunter.md](hunter.md) | Email finder, email verifier |
| Tavily | [tavily.md](tavily.md) | Buying signals, account research |
| Exa | [exa.md](exa.md) | Buying signals, account research |
| Instantly | [instantly.md](instantly.md) | Draft campaigns, lead enrollment (API v2) |
| HubSpot | [hubspot.md](hubspot.md) | Contact upsert, notes |

Items marked **UNCONFIRMED** are assumptions the docs didn't settle; the code takes the safer option. If you can confirm or correct one, a PR is very welcome.

Contributors: re-verify a provider against its current official docs before changing its client. See [`.agents/skills/verify-provider-api/SKILL.md`](../../.agents/skills/verify-provider-api/SKILL.md).
