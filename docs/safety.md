# Safety, privacy and compliance

Outbound tools can damage your sender reputation, your brand and your legal standing if they act on their own. OpenSDR is built so that **nothing leaves your machine for an inbox, a sequencer or a CRM without a preview you approve**.

## Safety guards

| Guard | What it does |
|---|---|
| **Preview + confirm** | Campaign creation, lead enrollment and CRM sync first return a preview and a single-use, 15-minute confirmation token. The assistant must show you the preview and get your approval before confirming. |
| **Approved = executed** | If any approved lead or contact is added or changed between preview and confirm (email, name, company, custom fields, CRM properties or note text), the confirm is rejected. |
| **Previews are complete** | A preview too large to show in full is refused (select fewer prospects), so you never approve leads you didn't see. |
| **Draft-only campaigns** | Campaigns are created as drafts and never activated. You start sending from Instantly yourself. |
| **No pushing into live campaigns** | Leads are only enrolled into campaigns whose status is draft or paused, checked at preview and again at confirm. |
| **Do-not-contact list** | Suppressed emails and domains (including subdomains) are removed from every push, sync and export. No tool flag can override it. |
| **Verification gate** | Only `verified` or `likely` emails are enrolled by default; `invalid` emails never are. |
| **Read-only switch** | `OPENSDR_READ_ONLY=1` disables every external write. |
| **Credit budget** | Each call is capped by `OPENSDR_MAX_CREDITS_PER_CALL` (default 25) and an optional per-call `max_credits`. Enrichment results are cached so you don't pay twice. |
| **No duplicate creates** | Requests that create something (campaigns, leads, notes) are never retried automatically, so a timeout can't create duplicates. |
| **Untrusted web content** | Signal and research excerpts are capped, labelled untrusted, and can't trigger any action on their own. No tool fetches arbitrary URLs. |

## Privacy

- **No OpenSDR server, no telemetry.** OpenSDR runs on your machine and only talks to the providers you configure.
- **Your keys stay yours.** They're read from environment variables, never written to disk, never returned by a tool, and redacted from logs and errors.
- **Your data stays local.** Lists, the cache and the suppression list live in `~/.opensdr` with owner-only permissions. Delete the folder to remove everything.
- Data you send to a provider (for example a person's name to Apollo) is governed by that provider's terms and privacy policy.

## Compliance

You are responsible for using OpenSDR lawfully, including CAN-SPAM, GDPR/UK-GDPR, CASL and each provider's terms of service (some limit how long you may store their data). OpenSDR helps by:

- requiring an opt-out line in every campaign email step,
- keeping a suppression list that every outward action honors,
- never sending email or activating campaigns itself,
- **never automating LinkedIn**: it only drafts connection notes for you to send yourself.

## Reporting a vulnerability

Please report security issues privately. See [SECURITY.md](../SECURITY.md) for how, and for the full threat model.
