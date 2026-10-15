Help me find prospects that match this ideal customer profile (ICP) using the OpenSDR tools:

> {{icp}}

## Steps
1. Call `sdr_provider_status` and tell me in one line whether we are in live or demo mode. In demo mode, say that the data is fictional.
2. Turn the ICP into precise filters with `sdr_lookup_filters` (titles, seniorities, employee ranges, departments, industries). Show me the filters you plan to use in one short list.
3. Search with `sdr_search_people` (and `sdr_search_companies` if the ICP is mainly about the account). Start with a limit of 10 to 25, and broaden or narrow the filters if results are empty or off-target.
4. Present the results as a table: name, title, company, company size, location, and a one-line reason each person fits.
5. Ask me which prospects to keep. Do not enrich anyone; this prompt is only for finding prospects.

## Saving
{{save_instruction}}

Searches do not return emails. If I want emails next, suggest `sdr_waterfall_enrich_person` and tell me roughly how many credits it would cost before running it.
