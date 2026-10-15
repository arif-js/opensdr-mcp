# Security Policy

## Reporting a vulnerability
**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/arif-js/opensdr-mcp/security/advisories/new)). Include steps to reproduce, the affected version, and the impact you expect.

You can expect an acknowledgement within a few days. Fixes are released as a patch version, and reporters are credited unless they prefer not to be.

## Supported versions
Only the latest released version receives security fixes.

## Threat model
OpenSDR runs locally as an MCP server over STDIO, launched by your MCP client (Claude Desktop, Claude Code, Cursor, …). There is no OpenSDR server and no telemetry.

| Area | How OpenSDR protects it |
|---|---|
| **API keys** | Read from environment variables only. Never written to disk, never returned by tools, and redacted from logs and error messages. |
| **Network** | Calls go only to the providers you configure (Apollo, Hunter, Exa, Tavily, Instantly, HubSpot). No tool fetches arbitrary URLs, so there is no SSRF surface. |
| **Untrusted web content** | Signal and research excerpts are third-party text. They are length-capped, labelled untrusted in tool descriptions, and cannot trigger actions on their own. |
| **Outbound actions** | Campaign creation, lead enrollment and CRM sync are two-phase: a preview, then a single-use, expiring confirmation token. A confirm is rejected if any approved lead or contact changed since the preview. Campaigns are created as drafts and never activated; leads are only pushed into draft or paused campaigns. `OPENSDR_READ_ONLY=1` disables every external write. |
| **Do-not-contact** | The suppression list is applied to every push, sync and export, and no tool flag can override it. |
| **Local data** | Stored in `~/.opensdr` (or `OPENSDR_DATA_DIR`) with owner-only permissions (0700 directory, 0600 files), using atomic writes. |
| **CSV export** | Cells that could be interpreted as spreadsheet formulas are escaped, and existing files are never overwritten without an explicit flag. |

## In scope
- Ways to make OpenSDR send, enroll or sync without a matching, user-approved preview.
- Leaks of API keys or local prospect data.
- Prompt-injection paths from provider or web content to a write action.
- Path traversal or overwrite issues in exports or the data directory.

## Out of scope
- Vulnerabilities in third-party providers or MCP clients themselves.
- Misuse by a user who has deliberately configured keys and confirmed actions.
