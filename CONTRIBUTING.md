# Contributing to OpenSDR

Thanks for helping. OpenSDR is a local-first MCP server, and contributions are welcome from humans and AI coding agents alike.

## Ground rules
- Read [`AGENTS.md`](AGENTS.md) first. It lists the architecture rules, the response format every tool returns, and the safety invariants no change may break (for example: nothing but the MCP transport writes to stdout, and every external write is previewed and confirmed).
- For anything bigger than a small fix, open an issue first so work doesn't overlap.
- Keep pull requests focused: one feature or fix per PR.

## Development setup
Requires Node.js **22.12+**.

```bash
git clone https://github.com/arif-js/opensdr-mcp.git
cd opensdr-mcp
npm install
npm run build
npm run inspect    # opens the MCP Inspector against dist/cli.js (demo mode, no keys needed)
```

To try your local build in Claude Desktop or Claude Code, point the client at `node /absolute/path/to/dist/cli.js` (see the README's quick start for config snippets).

## Before you open a PR
All of these must pass. CI runs the same checks on Node 22 and 24.

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run check:pack
```

- Add tests for every behavior change. Tests never call real provider APIs: inject a `fetchImpl` into `createHttpClient`, or use `undici` `MockAgent` with fixtures in `test/fixtures/<provider>/`.
- Tests that touch the store must use a temporary `OPENSDR_DATA_DIR` (the `testContext()` helper does this by default).
- New tools must work in demo mode, with demo data on `.example` domains only.

## Adding a provider
Data sources, sequencers and CRMs plug in behind capability interfaces in `src/providers/types.ts`. Follow [`.agents/skills/add-provider/SKILL.md`](.agents/skills/add-provider/SKILL.md):

1. **Verify the provider's current API docs first** ([`.agents/skills/verify-provider-api/SKILL.md`](.agents/skills/verify-provider-api/SKILL.md)). Never code endpoints from memory.
2. Implement only the capabilities the provider really supports, using the shared HTTP client.
3. Wire the env var into config, `.env.example` and the README.
4. Add demo fixtures and contract tests.

## Adding or changing a tool, prompt or resource
Follow [`.agents/skills/add-mcp-tool/SKILL.md`](.agents/skills/add-mcp-tool/SKILL.md). Tool names, input schemas, limits and env vars are public contracts: change them only together with the README and `AGENTS.md`. Prompt wording lives in `src/prompts/templates/*.md` and can be improved without touching code.

## Fixtures and secrets
- **Never commit API keys**, `.env` files or real prospect data.
- Recorded provider responses must be scrubbed: replace real names, emails, phone numbers and IDs with fake values on `.example` domains.

## Commit style
Short imperative subject line (e.g. "Add Smartlead campaign sender"), with a body explaining *why* when it isn't obvious.

## Using an AI coding agent
The repo ships agent instructions that work across tools: [`AGENTS.md`](AGENTS.md) (read automatically by Codex, Cursor and Copilot; imported by `CLAUDE.md` and `GEMINI.md`), workflow skills in [`.agents/skills/`](.agents/skills/) and role files in [`.agents/agents/`](.agents/agents/). Review agent-written code as carefully as your own.

## License
By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
