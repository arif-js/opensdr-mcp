# Demo walkthrough

This is a real session with OpenSDR in **demo mode**: no API keys, fictional companies on `.example` domains, zero network calls. Every result below was produced by the actual server. You can reproduce it yourself in about two minutes ([getting started](getting-started.md)).

> In live mode the flow is identical. Only the data comes from your own Apollo, Hunter, Tavily/Exa, Instantly and HubSpot accounts.

---

## 1. Ask for prospects

> **You:** Find VP Engineering leaders at B2B software and fintech companies.

Claude normalizes the title with `sdr_lookup_filters` ("vp eng" → `VP Engineering`) and calls `sdr_search_people`:

| Name | Title | Company | Location |
|---|---|---|---|
| Amara Haddad | VP Engineering | Bluepeak | Boston, MA |
| Sofia Doe | VP Engineering | Ledgerly | New York, NY |
| Lena Alvarez | VP Engineering | Wellspring Care | Raleigh, NC |
| Jane Haddad | VP Engineering | Pinehurst Software | Portland, OR |
| Priya Doe | VP Engineering | Meridian Pay | London, UK |

Search never returns emails, so it costs nothing. Claude stops here and asks which people to keep.

## 2. Find and verify their work emails

> **You:** Keep all five, find their emails, and save them to a list called `vp-eng`.

`sdr_waterfall_enrich_person` runs the email waterfall for each person and reports exactly what it did:

| Person | Email | Status | Confidence |
|---|---|---|---|
| Amara Haddad | amara.haddad@bluepeak.example | verified | 96 |
| Sofia Doe | sofia.doe@ledgerly.example | verified | 96 |
| Lena Alvarez | lena.alvarez@wellspringcare.example | verified | 96 |
| Jane Haddad | jane.haddad@pinehurst.example | verified | 96 |
| Priya Doe | priya.doe@meridianpay.example | verified | 96 |

Every result carries a trail, for example:

```
suppression: clear → cache: miss → apollo: verified → hunter_finder: skipped (already verified) → local checks: ok
```

Summary: 5 found, 5 verified, 0 credits used (demo). `sdr_save_prospects` saves all five to `vp-eng`.

## 3. Find a reason to reach out now

> **You:** Any buying signals at their companies?

`sdr_detect_buying_signals` returns sourced evidence and attaches it to the saved prospects:

| Company | Signal | Confidence | Source |
|---|---|---|---|
| Bluepeak | funding: "Bluepeak raises a $25M Series B" | high | `https://news.example/bluepeak/story-a` |
| Ledgerly | funding: "Ledgerly raises a $25M Series B" | high | `https://news.example/ledgerly/story-a` |
| Wellspring Care | funding: "Wellspring Care raises a $25M Series B" | high | `https://news.example/wellspring-care/story-a` |
| … | … | … | … |

Every signal has a URL. In live mode these are real articles you can open and check.

## 4. Draft grounded outreach

> **You:** Draft a 4-touch sequence. We sell CI test acceleration for engineering teams.

`sdr_prepare_outreach_brief` gives Claude a brief instead of writing copy itself:

- **Facts per prospect, each with a source:** `title: VP Engineering` (provider), `funding: Bluepeak raises a $25M Series B` (`https://news.example/bluepeak/story-a`).
- **A sequence framework:** day 0 signal-anchored email (≤ 90 words), day 2 LinkedIn note, day 5 value + proof email, day 10 permission-based breakup.
- **Rules:** cite one sourced fact per first line, never invent facts, include an opt-out line, skip suppressed prospects.

Claude writes the copy, shows it to you, and saves the first lines you approve.

## 5. Honor do-not-contact

> **You:** Meridian Pay asked us not to contact them.

`sdr_manage_suppression` adds `meridianpay.example` to the suppression list. From now on, that domain is removed from every push, CRM sync and export, and no tool flag can override it.

## 6. Stage the campaign, with a preview first

> **You:** Push the list into my Instantly campaign.

`sdr_push_to_campaign` **does not send anything** on the first call. It returns a preview:

```
eligible: 4   suppressed: 1   no_email: 0   unverified: 0   invalid: 0   already_in_campaign: 0
eligible: jane.haddad@pinehurst.example, lena.alvarez@wellspringcare.example,
          sofia.doe@ledgerly.example, amara.haddad@bluepeak.example
excluded: Priya Doe (suppressed)
confirmation_token: 1045338e…  (single-use, expires in 15 minutes)
```

Claude shows you this preview. Only after you approve does it call again with `confirm: true` and the token. If anything in the approved leads changed in between, the confirm is rejected. In live mode, OpenSDR only pushes into **draft or paused** campaigns and never activates a campaign: you press "go" in Instantly yourself.

---

**Try it:** add OpenSDR to your MCP client without any keys ([getting started](getting-started.md)), then run the built-in `autonomous_sdr_workflow` prompt.
