Write personalized cold outreach for {{target}} using the OpenSDR tools. Tone: {{tone}}.

## Steps
1. Call `sdr_prepare_outreach_brief` for {{target_instruction}}. If it warns that there is no seller context, **STOP and ask me** for my product, ideal customer and proof points before writing anything.
2. Follow the brief exactly:
   - Use its `sequence_framework` for the number of touches, channels, timing and word limits.
   - Obey every item in its `rules`, especially: cite one sourced fact per first line, never invent facts, include an opt-out line in every email, and skip prospects marked `suppressed: true`.
3. Write:
   - one shared email sequence using template variables such as `{{first_name}}`, `{{company_name}}` and `{{first_line}}`, and
   - one personalized first line per prospect, each followed by the source it cites.
   LinkedIn notes are drafts for me to send myself.
4. Show me all drafts in a readable layout. **STOP and wait for my approval or edits.**
5. After I approve, save each prospect's first line with `sdr_save_prospects` (patch `custom_fields.first_line`), and the sequence as JSON in `custom_fields.sequence_json`.

Do not create or push to a campaign in this prompt. When the drafts are saved, tell me that the next step, if I want it, is `sdr_create_campaign` followed by `sdr_push_to_campaign`, each with a preview I approve first.
