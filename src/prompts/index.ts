import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, type GetPromptResult, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import autonomousSdrWorkflow from './templates/autonomous_sdr_workflow.md';
import coldOutreachSequence from './templates/cold_outreach_sequence.md';
import icpProspecting from './templates/icp_prospecting.md';
import safety from './templates/safety.md';

/** Raw template text by prompt name. Exported so tests can lint every template. */
export const PROMPT_TEMPLATES = {
  autonomous_sdr_workflow: autonomousSdrWorkflow,
  icp_prospecting: icpProspecting,
  cold_outreach_sequence: coldOutreachSequence,
} as const;

export const SAFETY_TEMPLATE = safety;

const TONES = ['direct', 'friendly', 'formal'] as const;

/**
 * Fill `{{key}}` placeholders that appear in `values`. Unknown placeholders are left untouched,
 * because templates also show outreach variables such as `{{first_name}}` to the model.
 */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? values[key] : match,
  );
}

function message(text: string, description: string): GetPromptResult {
  return {
    description,
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: `${text.trim()}\n\n${SAFETY_TEMPLATE.trim()}\n` },
      },
    ],
  };
}

function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}

function positiveInt(value: string | undefined, fallback: number, max: number, name: string) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw invalid(`${name} must be a whole number between 1 and ${max}.`);
  }
  return parsed;
}

const LIST_NAME = /^[a-z0-9_-]{1,64}$/;

function listName(value: string, name: string): string {
  const trimmed = value.trim();
  if (!LIST_NAME.test(trimmed)) {
    throw invalid(`${name} must be 1-64 characters of lowercase letters, digits, "-" or "_".`);
  }
  return trimmed;
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'autonomous_sdr_workflow',
    {
      title: 'Autonomous SDR workflow',
      description:
        'End-to-end prospecting run: find prospects for an ICP, enrich them within a credit budget, ' +
        'find buying signals, draft grounded outreach, and optionally stage a campaign. Stops for ' +
        'your approval before spending credits, before saving drafts, and before every write.',
      argsSchema: {
        icp: z.string().min(3).describe('Who to target, in plain English.'),
        list_name: z.string().describe('Prospect list to save to (lowercase, digits, - or _).'),
        target_count: z
          .string()
          .optional()
          .describe('About how many prospects to find (default 25).'),
        max_credits: z
          .string()
          .optional()
          .describe('Provider credit budget for the run (default 50).'),
      },
    },
    (args) =>
      message(
        renderTemplate(PROMPT_TEMPLATES.autonomous_sdr_workflow, {
          icp: args.icp.trim(),
          list_name: listName(args.list_name, 'list_name'),
          target_count: String(positiveInt(args.target_count, 25, 500, 'target_count')),
          max_credits: String(positiveInt(args.max_credits, 50, 10000, 'max_credits')),
        }),
        'Autonomous SDR workflow',
      ),
  );

  server.registerPrompt(
    'icp_prospecting',
    {
      title: 'ICP prospecting',
      description:
        'Turn an ideal customer profile into precise searches, show matching prospects in a table, ' +
        'and save only the ones you approve. Does not spend enrichment credits.',
      argsSchema: {
        icp: z.string().min(3).describe('Who to target, in plain English.'),
        list_name: z.string().optional().describe('Prospect list to save approved people to.'),
      },
    },
    (args) => {
      const list = args.list_name?.trim() ? listName(args.list_name, 'list_name') : undefined;
      const saveInstruction = list
        ? `When I approve prospects, save only those with \`sdr_save_prospects\` to the list \`${list}\`, then confirm how many were saved.`
        : 'Do not save anything unless I ask. If I do, ask me for a list name and save only the approved prospects with `sdr_save_prospects`.';
      return message(
        renderTemplate(PROMPT_TEMPLATES.icp_prospecting, {
          icp: args.icp.trim(),
          save_instruction: saveInstruction,
        }),
        'ICP prospecting',
      );
    },
  );

  server.registerPrompt(
    'cold_outreach_sequence',
    {
      title: 'Cold outreach sequence',
      description:
        'Draft a grounded multi-touch sequence and per-prospect first lines from an outreach brief, ' +
        'show them for approval, then save them. Never creates or pushes a campaign.',
      argsSchema: {
        list_name: z.string().optional().describe('Prospect list to write for.'),
        prospect_ids: z
          .string()
          .optional()
          .describe('Comma-separated prospect ids (max 25), instead of list_name.'),
        tone: z.string().optional().describe('direct, friendly or formal (default direct).'),
      },
    },
    (args) => {
      const hasList = Boolean(args.list_name?.trim());
      const ids = (args.prospect_ids ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      if (hasList === ids.length > 0) {
        throw invalid('Provide exactly one of list_name or prospect_ids.');
      }
      if (ids.length > 25) throw invalid('prospect_ids accepts at most 25 ids.');
      const tone = (args.tone?.trim().toLowerCase() || 'direct') as (typeof TONES)[number];
      if (!TONES.includes(tone)) throw invalid(`tone must be one of: ${TONES.join(', ')}.`);

      const target = hasList
        ? `the prospects in the list \`${listName(args.list_name as string, 'list_name')}\``
        : `${ids.length} selected prospect(s)`;
      const targetInstruction = hasList
        ? `the prospects in that list (use \`sdr_list_prospects\` with list \`${(args.list_name as string).trim()}\` to get their ids, at most 25 per brief) with \`tone: "${tone}"\``
        : `\`prospect_ids: ${JSON.stringify(ids)}\` with \`tone: "${tone}"\``;
      return message(
        renderTemplate(PROMPT_TEMPLATES.cold_outreach_sequence, {
          target,
          target_instruction: targetInstruction,
          tone,
        }),
        'Cold outreach sequence',
      );
    },
  );
}
