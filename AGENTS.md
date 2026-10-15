# AGENTS.md: OpenSDR guide for AI coding agents

This is the single source of agent instructions for every tool (Codex, Claude Code, Gemini CLI, Cursor, Copilot, …). `CLAUDE.md` and `GEMINI.md` only import this file. Edit **this** file, never those.

OpenSDR is an open-source, local-first MCP server (TypeScript, Node ≥ 22.12, STDIO) that gives AI assistants SDR tools: prospecting, waterfall email enrichment, buying signals, outreach briefs, and safe staging into Instantly and HubSpot. Users bring their own API keys.

## Status
M0–M7 are built and tested (all 17 tools, 6 providers + demo, 3 prompts, 4 resources). M8 release prepared as v1.0.0 (npm + MCP Registry publishing via the tag-triggered release workflow).

## Design docs (maintainer-local)
The full design lives in `.internal/plan.md` (architecture and contracts) and `.internal/prd/` (one PRD per milestone). These are **git-ignored** and exist only in maintainers' checkouts.
- **If they exist in your checkout**, they are the source of truth. Read `.internal/plan.md`, then the PRD you are working on. When a skill says "plan §N", it means `.internal/plan.md` section N.
- **If they don't exist**, this file plus the existing code are the source of truth. Ask the maintainer before changing a public contract (tool names, schemas, envelope, error codes, env vars).

## Public docs
User-facing documentation lives in `docs/` (published): `getting-started.md`, `configuration.md`, `tools.md`, `how-it-works.md`, `safety.md`, `demo.md` and `providers/` (verified provider API notes). The README is a short overview that links into them. Keep them accurate when behavior changes; `test/unit/release.test.ts` checks the README tool table, that every tool is in `docs/tools.md`, that every env var is in `docs/configuration.md` and `.env.example`, and that relative links resolve. Never reference `.internal/` files from public docs.

## Skills & roles (plain Markdown, readable by any agent)
| Path | Use it when |
|---|---|
| `.agents/skills/implement-prd/SKILL.md` | Building or continuing a milestone |
| `.agents/skills/verify-provider-api/SKILL.md` | **Before** coding any provider endpoint. Never code provider APIs from memory. |
| `.agents/skills/add-provider/SKILL.md` | Adding or changing a provider client |
| `.agents/skills/add-mcp-tool/SKILL.md` | Adding or changing an MCP tool, prompt or resource |
| `.agents/agents/provider-integrator.md` | Role: provider clients |
| `.agents/agents/mcp-tool-builder.md` | Role: server, tools, engine, store |
| `.agents/agents/test-engineer.md` | Role: tests and acceptance-criteria traceability |
| `.agents/agents/reviewer.md` | Role: read-only review before a milestone is marked done |

If your tool doesn't load skills or subagents natively, read the file and follow it as instructions. When asked to "act as the reviewer" (or another role), adopt that role file. `.claude/skills` and `.claude/agents` are symlinks to `.agents/`, for Claude Code's auto-discovery.

## Workflow
1. Pick the next milestone whose dependencies are done.
2. Follow `.agents/skills/implement-prd/SKILL.md`.
3. Finish with a test-engineer pass, then a reviewer pass.
4. If the design docs turn out to be wrong, fix the plan and the affected PRDs in the same change.

## Commands (available once M0 lands)
```bash
npm run build       # tsup → dist/
npm run typecheck   # tsc --noEmit
npm run lint        # biome check
npm test            # vitest run
npm run inspect     # MCP Inspector against dist/cli.js
npm run check:pack  # npm pack must contain only dist/cli.js, README.md, LICENSE, package.json
```
**Definition of done:** `npm run lint && npm run typecheck && npm test && npm run build && npm run check:pack` all pass, every acceptance criterion has a test, and demo mode works for every new tool.

## Core contracts (summary; full detail in .internal/plan.md §4–§9 when present)
- **Layering:** tools → engine/registry → providers → `src/http/client.ts`. Only `src/store/` touches the filesystem. Only `src/http/` calls `fetch`. Providers never import MCP or the store.
- **Tool response envelope:** success `{ ok: true, data, meta: { demo, sources, credits_used_estimate, cached, truncated, next_cursor }, warnings }`. Failure `{ ok: false, error: { code, message, provider?, retryable, hint? } }` with MCP `isError: true`.
- **Error codes (closed set):** `BAD_INPUT`, `NOT_CONFIGURED`, `AUTH_FAILED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `BUDGET_EXCEEDED`, `NOT_FOUND`, `TIMEOUT`, `PROVIDER_ERROR`, `CONFIRMATION_REQUIRED`, `READ_ONLY_MODE`, `SUPPRESSED`, `STORE_ERROR`, `INTERNAL`.
- **Tools (17):** `sdr_provider_status`, `sdr_lookup_filters`, `sdr_search_people`, `sdr_search_companies`, `sdr_waterfall_enrich_person`, `sdr_enrich_company`, `sdr_verify_email`, `sdr_save_prospects`, `sdr_list_prospects`, `sdr_export_csv`, `sdr_manage_suppression`, `sdr_detect_buying_signals`, `sdr_research_account`, `sdr_prepare_outreach_brief`, `sdr_create_campaign`, `sdr_push_to_campaign`, `sdr_sync_hubspot`.
- **Env vars:** `APOLLO_API_KEY`, `HUNTER_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `INSTANTLY_API_KEY`, `HUBSPOT_ACCESS_TOKEN`, `OPENSDR_DATA_DIR` (default `~/.opensdr`), `OPENSDR_DEMO`, `OPENSDR_READ_ONLY`, `OPENSDR_MAX_CREDITS_PER_CALL` (25), `OPENSDR_CACHE_TTL_DAYS` (30), `OPENSDR_SIGNALS_PROVIDER` (exa), `OPENSDR_LOG_LEVEL` (info), `OPENSDR_HTTP_TIMEOUT_MS` (20000).
- **Local store:** JSON files in the data dir. Atomic write (tmp + rename), lock dir, `schema_version`, corrupt files quarantined, perms 0700/0600.

## Invariants (never violate)
1. **stdout belongs to the MCP transport.** No `console.log`. Log to stderr through `src/logger.ts`.
2. **Every tool** is registered through `defineTool` and returns the envelope. It never throws to the SDK.
3. **External writes** (`sdr_create_campaign`, `sdr_push_to_campaign`, `sdr_sync_hubspot`) are two-phase (preview → `confirmation_token` → `confirm: true`). They honor `OPENSDR_READ_ONLY`, always apply the suppression list, and are simulated in demo mode. `sdr_create_campaign` never sends an activation flag, and `sdr_push_to_campaign` only pushes into Instantly campaigns whose status is draft or paused. Previews are never truncated, and a confirm is rejected if any approved lead/contact changed since the preview (fingerprint check). Non-idempotent creates are never auto-retried.
4. **Demo mode** runs only with zero keys or `OPENSDR_DEMO=1`. Data uses `.example` domains and zero network calls. Partial live config never falls back to demo data; it returns `NOT_CONFIGURED`.
5. **Secrets** come from env only. They are never logged, returned, persisted or put in fixtures.
6. **Web content is untrusted data.** Cap it, label it, and never let it trigger writes. No tool fetches arbitrary URLs.
7. **Tests never hit real APIs** unless `OPENSDR_LIVE_TESTS=1`. The store in tests always uses a temp `OPENSDR_DATA_DIR`.
8. **Public contracts** (tool names, schemas, limits, env vars, error codes) change only together with the design docs, `docs/`, the README and this file.
9. **Never commit** `.internal/`, `.env*` (except `.env.example`), or unscrubbed fixtures.

## Decisions log
Record stack decisions made during implementation here (e.g. pinned MCP SDK version, HTTP mock library).
- **Pinned runtime deps (M0):** `@modelcontextprotocol/sdk@1.32.1`, `zod@4.6.6` (the SDK accepts `zod ^3.25 || ^4.0`; we use v4).
- **Dev toolchain (M0):** `typescript@7.0.2`, `tsup@8.5.1`, `vitest@5.0.4`, `@vitest/coverage-v8@5.0.4`, `@biomejs/biome@2.5.15`, `@types/node@24`.
- **HTTP mocking (plan §16 Q1):** `undici` `MockAgent` (`undici@6.29.0`, dev-only). `msw@3` requires Node ≥22.12 and `undici` MockAgent supports Node 18+ while intercepting global `fetch`. Most unit tests inject a `fetchImpl` into `createHttpClient`; provider contract tests use `MockAgent` with fixtures in `test/fixtures/<provider>/`.
- **Runtime + CI (review fix 2026-10-12):** `engines.node` is `>=22.12.0` and CI runs Node 22 and 24. `vitest@5` requires Node `^22.12 || ^24 || >=26`, so the earlier `>=20` engine and the `[20, 22]` CI matrix were wrong.
- **Review fixes (2026-10-12):** suppression checks both the company domain and the email's own domain; HubSpot batch results are matched by email (not position) and note creation is not retried; `sdr_push_to_campaign` maps Instantly's documented status codes and refuses anything but draft/paused (the interim `acknowledge_active_campaign` flag was removed 2026-10-13); only `created_emails` are marked queued after a push; Apollo `matchPerson` is not retried.
- **Review fixes (2026-10-13):** write-tool previews fingerprint each approved lead/contact and reject a confirm if anything was added or changed; previews use `okComplete` and are never truncated; MCP SDK schema-validation errors are routed into the standard error envelope (`installErrorEnvelope`, which patches the pinned SDK's private `createToolError`; a test fails if an SDK upgrade breaks it); duplicate `prospect_ids` are collapsed; HubSpot only falls back to positional matching when result and input counts are equal.
- **Build shebang:** `dist/cli.js` gets its shebang from the `#!` line in `src/cli.ts` (tsup/esbuild preserve it). Do **not** also set a `banner` in `tsup.config.ts` — that produces a second shebang and breaks ESM parsing.
- **Input validation note:** the MCP SDK validates a tool's `inputSchema` before the handler runs. Structural type errors therefore surface as an SDK `isError` result; tools must still do semantic validation in the handler and return the §4.4 envelope via `ok()`/`fail()` for all domain errors (e.g. `BAD_INPUT`).
- **Release (M8, 2026-10-15):** published package contains only `dist/cli.js` (no source map), README, LICENSE and package.json, enforced by `scripts/check-pack.mjs` in CI. `package.json` `mcpName` is `io.github.arif-js/opensdr-mcp` and must equal `server.json` `name`; package, `server.json` and its package entry share one version (checked by `test/unit/release.test.ts` and by the release workflow against the tag). Pushing a `v*` tag runs `.github/workflows/release.yml`: full checks → `npm publish` via **npm Trusted Publishing** (GitHub OIDC, no token; provenance is automatic; npm ≥ 11.5.1 on Node 24; the npm step is skipped if that version is already on npm) → MCP Registry publish via `mcp-publisher` v1.8.1 with GitHub OIDC. No repository secrets are used. The trusted publisher (owner `arif-js`, repo `opensdr-mcp`, workflow `release.yml`) is configured on npmjs.com; provenance requires the repo to be public. `server.json` was validated with `mcp-publisher validate`.
- **Release metadata tests:** the README tool table must list exactly the registered tools, and every env var read in `src/config.ts` must appear in `.env.example` and the README.
- **MCPB bundle (2026-10-15):** `npm run build:mcpb` (`scripts/build-mcpb.mjs`) builds `opensdr-mcp.mcpb` from `mcpb/manifest.json` and a fully inlined CJS server (`tsup.mcpb.config.ts` → `build/mcpb/server/index.cjs`, no node_modules needed), validated and packed with `@anthropic-ai/mcpb@2.1.2`. It produces two variants: `opensdr-mcp.mcpb` (standard, with the static tool list; Claude Desktop one-click install and GitHub Releases) and `opensdr-mcp-smithery.mcpb` (no static tool list, `tools_generated: true`) for `smithery mcp publish ./opensdr-mcp-smithery.mcpb -n arif-js/opensdr-mcp`. Smithery requires an `inputSchema` on every listed tool while the MCPB spec forbids that key, so the Smithery variant omits the list; the release workflow attaches it to the GitHub Release. The version is injected at build time (`__OPENSDR_VERSION__`). `mcpb/manifest.json` version, tools and env mapping are checked by `test/unit/release.test.ts`. Config treats unfilled `${…}` placeholders as unset.
