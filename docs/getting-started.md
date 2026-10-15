# Getting started

OpenSDR is an MCP server: your AI assistant (Claude Desktop, Claude Code, Cursor or any other STDIO MCP client) starts it in the background and calls its tools. You don't run it by hand.

**Requirements:** Node.js **22.12 or newer** (`node --version`).

## 1. Add OpenSDR to your client

### Claude Desktop
Open Claude Desktop → **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`). Add:

```json
{
  "mcpServers": {
    "opensdr": {
      "command": "npx",
      "args": ["-y", "opensdr-mcp"]
    }
  }
}
```

If the file already has other servers, add `"opensdr": { … }` inside the existing `mcpServers` object. Then **quit Claude Desktop completely (Cmd+Q / Exit) and reopen it**.

### Claude Code
```bash
claude mcp add opensdr -- npx -y opensdr-mcp
```

### Cursor
Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):
```json
{
  "mcpServers": {
    "opensdr": { "command": "npx", "args": ["-y", "opensdr-mcp"] }
  }
}
```

## 2. Try it in demo mode (no keys)

With no API keys configured, OpenSDR runs in **demo mode**: every tool works on realistic fictional data (`.example` domains), and nothing touches the network.

Ask your assistant:
- *"Run sdr_provider_status"*. It should report `mode: demo`.
- *"Find VP Engineering leaders at fintech companies and draft outreach."*
- Or pick the built-in **autonomous_sdr_workflow** prompt from your client's prompt menu.

See the [demo walkthrough](demo.md) for what a full session looks like.

## 3. Add your API keys

Every provider is optional; add only the ones you have. Keys go in the `env` block of the same config:

```json
{
  "mcpServers": {
    "opensdr": {
      "command": "npx",
      "args": ["-y", "opensdr-mcp"],
      "env": {
        "APOLLO_API_KEY": "…",
        "HUNTER_API_KEY": "…",
        "TAVILY_API_KEY": "…"
      }
    }
  }
}
```

For Claude Code, pass one `-e` per key:
```bash
claude mcp add opensdr -e APOLLO_API_KEY=… -e HUNTER_API_KEY=… -- npx -y opensdr-mcp
```

Restart the client after changing keys. As soon as any key is set, OpenSDR switches to **live mode**. Tools whose provider has no key then tell you which key to add instead of returning demo data.

Where to get each key, and every other setting: [configuration](configuration.md).

### Safe first live test
Add these while you try real keys:
```json
"OPENSDR_READ_ONLY": "1",
"OPENSDR_MAX_CREDITS_PER_CALL": "3"
```
Read-only mode blocks every external write (campaigns, CRM), and the credit cap stops a single call from using up a free-tier allowance.

## 4. Tell OpenSDR what you sell (optional)

Create `~/.opensdr/profile.md` with your product, ideal customer, proof points and sender details. Outreach briefs use it automatically to ground the copy. Read the `opensdr://profile` resource for a template.

## Run from source

```bash
git clone https://github.com/arif-js/opensdr-mcp.git
cd opensdr-mcp
npm install && npm run build
npm run inspect   # try every tool in the MCP Inspector, no keys needed
```
In client configs, use `"command": "node"` and `"args": ["/absolute/path/to/opensdr-mcp/dist/cli.js"]` instead of `npx`.

## Troubleshooting

| Problem | Fix |
|---|---|
| The assistant doesn't see any `sdr_` tools | Check you edited the config file the client actually reads (Claude Desktop: Settings → Developer → Edit Config), that the JSON is valid (no trailing commas), and that you fully restarted the client. |
| `mode: demo` although you added keys | The key isn't reaching the server: check its spelling and that it's inside `env` for the `opensdr` entry, then restart. |
| `NOT_CONFIGURED` | That tool needs a provider you haven't added. The error names the env var to set. |
| `PERMISSION_DENIED` from Apollo | Some Apollo endpoints need a **master** API key, and some plans don't include API access. |
| `READ_ONLY_MODE` | `OPENSDR_READ_ONLY=1` is set. Remove it to allow campaign and CRM writes. |
| Server logs | Logs go to stderr. Claude Desktop shows them in `~/Library/Logs/Claude/mcp-server-opensdr.log`. Set `OPENSDR_LOG_LEVEL=debug` for more detail; keys are always redacted. |
