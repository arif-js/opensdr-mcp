You are acting as my sales development rep (SDR) using the OpenSDR tools. Run the full prospecting-to-outreach workflow below for this ideal customer profile (ICP):

> {{icp}}

Target: about {{target_count}} prospects, saved to the list `{{list_name}}`. Credit budget for this whole run: {{max_credits}} provider credits.

## Step 1: Check what is available
Call `sdr_provider_status` first. Tell me in one or two lines which mode we are in (live or demo), which capabilities are configured, and which steps below will be skipped because a provider is missing. If we are in demo mode, say clearly that all data is fictional. Adapt the rest of the plan to what is configured; never pretend a skipped step ran.

## Step 2: Find prospects
1. Use `sdr_lookup_filters` to turn the ICP into normalized titles, seniorities, employee ranges and industries.
2. Use `sdr_search_companies` and/or `sdr_search_people` to find matches. Page with `next_cursor` only as far as needed to reach about {{target_count}} good candidates.
3. Show me a compact table: name, title, company, company size, location, and why they fit the ICP.

**STOP and wait for me** to confirm or edit the selection before spending any enrichment credits.

## Step 3: Enrich the approved prospects
1. Estimate the enrichment cost first. If it is more than 10 credits, **STOP and ask me** before continuing.
2. Call `sdr_waterfall_enrich_person` in batches (max 25 per call), passing `max_credits` so the run stays within {{max_credits}} credits in total.
3. Save everyone to `{{list_name}}` with `sdr_save_prospects`, including people without an email.
4. Summarize: how many found, how many verified, how many not found, credits used so far.

## Step 4: Find a reason to reach out now
If signals are configured, call `sdr_detect_buying_signals` for the prospects' companies (max 10 companies per call), with `attach_to_prospects: true`. Summarize the strongest signal per company with its source URL. Skip companies with no credible signal instead of guessing.

## Step 5: Draft outreach
1. Call `sdr_prepare_outreach_brief` for the saved prospects. If it warns that there is no seller context, **STOP and ask me** for my product, ideal customer and proof points before writing anything.
2. Follow the brief's `rules` and `sequence_framework` exactly. Write one first line per prospect that cites one sourced fact, plus the shared email sequence.
3. Show me the drafts. **STOP and wait for my approval or edits.**
4. Save approved first lines with `sdr_save_prospects` (patch `custom_fields.first_line`).

## Step 6: Stage the campaign (only if I ask)
Only if I explicitly ask to stage the campaign, and only if a campaign provider is configured:
1. Call `sdr_create_campaign` without `confirm`, show me the preview, and **STOP for my approval**. Confirm only after I approve.
2. Call `sdr_push_to_campaign` without `confirm`, show me who is eligible and who is excluded and why, and **STOP for my approval**. Confirm only after I approve.
3. If I ask to sync to my CRM, do the same two-step flow with `sdr_sync_hubspot`.

Remind me that OpenSDR never activates campaigns: I start sending from the Instantly dashboard myself.

## Finish
End with a short summary: prospects saved, emails verified, signals found, drafts saved, anything staged, and the total credits used.
