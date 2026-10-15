# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- MCPB bundle (`opensdr-mcp.mcpb`): a self-contained build for one-click install in Claude Desktop and for Smithery, with a settings form for API keys. Built by `npm run build:mcpb` (plus a Smithery variant, `opensdr-mcp-smithery.mcpb`) and attached to every GitHub Release.
- `glama.json` for the Glama listing.

### Fixed
- Demo mode: enrichment now returns the same person the search found, demo names are unique, company names keep their casing, and results are labelled with the demo source.
- Unfilled bundle placeholders such as `${user_config.apollo_api_key}` are treated as "not set" instead of as a key.

## [1.0.0] - 2026-10-15

### Added
- MCP server over STDIO with 17 tools across prospecting, enrichment, signals, outreach and lead management:
  `sdr_provider_status`, `sdr_lookup_filters`, `sdr_search_people`, `sdr_search_companies`, `sdr_waterfall_enrich_person`, `sdr_enrich_company`, `sdr_verify_email`, `sdr_save_prospects`, `sdr_list_prospects`, `sdr_export_csv`, `sdr_manage_suppression`, `sdr_detect_buying_signals`, `sdr_research_account`, `sdr_prepare_outreach_brief`, `sdr_create_campaign`, `sdr_push_to_campaign`, `sdr_sync_hubspot`.
- Providers: Apollo, Hunter, Exa, Tavily, Instantly (API v2) and HubSpot, plus a zero-key demo mode with fictional data.
- Email waterfall: Apollo match → Hunter finder → optional Hunter verifier → free local syntax, MX, disposable and role-address checks, with a per-tier trail.
- Built-in prompts: `autonomous_sdr_workflow`, `icp_prospecting`, `cold_outreach_sequence`.
- Resources: `opensdr://providers`, `opensdr://lists`, `opensdr://lists/{name}`, `opensdr://profile`.
- Safety: two-phase confirmation for every external write, payload fingerprinting between preview and confirm, draft-only campaigns, refusal to push into active campaigns, suppression list, read-only mode, per-call credit budget and enrichment cache.
- Local JSON store with atomic writes, file locking and owner-only permissions; safe CSV export.

[Unreleased]: https://github.com/arif-js/opensdr-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/arif-js/opensdr-mcp/releases/tag/v1.0.0
