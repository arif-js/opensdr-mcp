import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OpenSdrError } from '../errors.js';
import type { ServerContext } from '../server.js';
import { toCsv } from '../store/csv.js';
import { type ProspectPatch, ProspectStore, type StorePerson } from '../store/prospects.js';
import { SuppressionStore } from '../store/suppression.js';
import { CompanyRef, EmailStatus, ProspectStatus, Signal } from '../types.js';
import { defineTool, ok } from './envelope.js';

const SLUG = /^[a-z0-9-_]+$/;
const DEFAULT_COLUMNS = [
  'first_name',
  'last_name',
  'email',
  'email_status',
  'title',
  'company_name',
  'company_domain',
  'linkedin_url',
  'location',
  'status',
  'first_line',
];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function requireSlug(list: string): string {
  if (SLUG.test(list)) return list;
  const suggestion = slugify(list);
  throw new OpenSdrError({
    code: 'BAD_INPUT',
    message: `Invalid list name "${list}".`,
    hint: `Use lowercase letters, digits, "-" and "_". Try "${suggestion || 'my-list'}".`,
  });
}

const patchSchema = z.object({
  notes: z.string().max(4000).nullable().optional(),
  status: ProspectStatus.optional(),
  signals: z.array(Signal).max(50).optional(),
  custom_fields: z.record(z.string(), z.string().max(2000)).optional(),
});

const personEntrySchema = z.object({
  provider_ids: z.record(z.string(), z.string()).optional(),
  first_name: z.string().max(120).nullable().optional(),
  last_name: z.string().max(120).nullable().optional(),
  full_name: z.string().max(200).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  seniority: z.string().max(60).nullable().optional(),
  linkedin_url: z.string().max(300).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  company: CompanyRef.nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  email_status: EmailStatus.nullable().optional(),
  email_confidence: z.number().nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  sources: z.array(z.string()).optional(),
  updated_at: z.string().optional(),
});

const patchEntrySchema = z.object({ prospect_id: z.string().max(80), patch: patchSchema });

const SAVE_DESCRIPTION =
  'Save or update prospects in a local named list. Accepts full person objects (deduped by email, ' +
  'LinkedIn URL, Apollo id, or name + domain) or { prospect_id, patch } edits. Use this to persist ' +
  'drafted copy (patch custom_fields.first_line) and to set status/notes/signals. Local write, no ' +
  'credits, no network. Suppressed people are still saved but flagged. Next: sdr_list_prospects or ' +
  'sdr_export_csv.';

const LIST_DESCRIPTION =
  'Query saved prospects by list, status, email status, company domain or free-text search, and ' +
  'optionally return a per-list summary with counts. Free, local, read-only. Use it to review a list ' +
  'before sdr_export_csv or sdr_push_to_campaign. Paginated with an opaque cursor.';

const EXPORT_DESCRIPTION =
  'Export prospects to a UTF-8 (BOM) CSV that opens cleanly in Excel or Sheets. Select by list or by ' +
  'prospect_ids. RFC 4180 quoting plus a formula-injection guard. Suppressed prospects are excluded ' +
  'unless include_suppressed=true. Free and local. Refuses to overwrite an existing file unless ' +
  'overwrite=true. Does not upload anything.';

const SUPPRESSION_DESCRIPTION =
  'Maintain the do-not-contact list (emails and domains) and check values against it. Use when a ' +
  'prospect opts out, bounces, or asks not to be contacted. Domains suppress their subdomains too. ' +
  'The suppression list is honored by every outward tool and cannot be bypassed from a tool call. ' +
  'Free and local. add is idempotent; remove needs the exact value.';

export function registerManageTools(server: McpServer, ctx: ServerContext): void {
  const prospects = new ProspectStore({
    path: path.join(ctx.config.dataDir, 'prospects.json'),
    warn: (message) => ctx.logger.warn(message),
  });
  const suppression = new SuppressionStore({
    path: path.join(ctx.config.dataDir, 'suppression.json'),
    warn: (message) => ctx.logger.warn(message),
  });

  defineTool(server, {
    name: 'sdr_save_prospects',
    title: 'Save prospects',
    description: SAVE_DESCRIPTION,
    inputSchema: {
      list: z.string().min(1).max(64).describe('List slug ([a-z0-9-_]).'),
      people: z
        .array(z.union([patchEntrySchema, personEntrySchema]))
        .min(1)
        .max(100)
        .describe('People or { prospect_id, patch } edits.'),
      merge: z.enum(['fill_missing', 'overwrite']).optional().describe('Merge strategy.'),
      status: ProspectStatus.optional().describe('Default status for new prospects.'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const list = requireSlug(input.list);
      const storeInputs = input.people.map((entry) =>
        'prospect_id' in entry
          ? { prospect_id: entry.prospect_id, patch: entry.patch as ProspectPatch }
          : { person: entry as StorePerson },
      );
      const result = await prospects.upsert(storeInputs, {
        list,
        ...(input.merge ? { merge: input.merge } : {}),
        ...(input.status ? { status: input.status } : {}),
      });

      const results = [] as {
        prospect_id: string | null;
        outcome: string;
        suppressed?: boolean;
        suppressed_reason?: string;
        error?: { code: string; message: string };
      }[];
      for (const item of result.results) {
        const entry: (typeof results)[number] = {
          prospect_id: item.prospect_id,
          outcome: item.outcome,
        };
        if (item.error) entry.error = item.error;
        if (item.prospect_id) {
          const prospect = await prospects.get(item.prospect_id);
          if (prospect) {
            const check = await suppression.isSuppressed({
              ...(prospect.email ? { email: prospect.email } : {}),
              ...(prospect.company?.domain ? { domain: prospect.company.domain } : {}),
            });
            entry.suppressed = check.suppressed;
            if (check.reason) entry.suppressed_reason = check.reason;
          }
        }
        results.push(entry);
      }

      const prospectIds = results
        .map((entry) => entry.prospect_id)
        .filter((id): id is string => typeof id === 'string');

      return ok(
        {
          list,
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          prospect_ids: prospectIds,
          results,
        },
        { demo: ctx.config.mode === 'demo' },
      );
    },
  });

  defineTool(server, {
    name: 'sdr_list_prospects',
    title: 'List prospects',
    description: LIST_DESCRIPTION,
    inputSchema: {
      list: z.string().max(64).optional().describe('Filter by list membership.'),
      status: ProspectStatus.optional(),
      email_status: z.array(EmailStatus).max(5).optional(),
      has_email: z.boolean().optional(),
      company_domain: z.string().max(200).optional(),
      search: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).default(25),
      cursor: z.string().max(500).nullable().optional(),
      include_lists_summary: z.boolean().optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const result = await prospects.query({
        ...(input.list ? { list: input.list } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.email_status ? { email_status: input.email_status } : {}),
        ...(input.has_email !== undefined ? { has_email: input.has_email } : {}),
        ...(input.company_domain ? { company_domain: input.company_domain } : {}),
        ...(input.search ? { search: input.search } : {}),
        limit: input.limit,
        cursor: input.cursor ?? null,
      });
      const data: Record<string, unknown> = {
        prospects: result.prospects,
        total: result.total,
      };
      if (input.include_lists_summary) data.lists_summary = await prospects.listsSummary();
      return ok(data, {
        demo: ctx.config.mode === 'demo',
        next_cursor: result.next_cursor,
      });
    },
  });

  defineTool(server, {
    name: 'sdr_export_csv',
    title: 'Export CSV',
    description: EXPORT_DESCRIPTION,
    inputSchema: {
      list: z.string().max(64).optional(),
      prospect_ids: z.array(z.string().max(80)).max(1000).optional(),
      columns: z.array(z.string().max(120)).max(40).optional(),
      path: z.string().max(500).optional(),
      overwrite: z.boolean().optional(),
      include_suppressed: z.boolean().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      if ((input.list ? 1 : 0) + (input.prospect_ids ? 1 : 0) !== 1) {
        throw new OpenSdrError({
          code: 'BAD_INPUT',
          message: 'Provide exactly one of `list` or `prospect_ids`.',
        });
      }

      let selected = [] as { prospect: Awaited<ReturnType<ProspectStore['get']>> }[];
      if (input.list) {
        const result = await prospects.query({ list: input.list, limit: 100000 });
        selected = result.prospects.map((prospect) => ({ prospect }));
      } else {
        for (const id of input.prospect_ids ?? []) {
          const prospect = await prospects.get(id);
          if (prospect) selected.push({ prospect });
        }
      }

      const columns = input.columns ?? [...DEFAULT_COLUMNS];
      if (input.include_suppressed) columns.push('suppressed');

      const rows: unknown[][] = [];
      let excluded = 0;
      for (const { prospect } of selected) {
        if (!prospect) continue;
        const suppressed = (
          await suppression.isSuppressed({
            ...(prospect.email ? { email: prospect.email } : {}),
            ...(prospect.company?.domain ? { domain: prospect.company.domain } : {}),
          })
        ).suppressed;
        if (suppressed && !input.include_suppressed) {
          excluded += 1;
          continue;
        }
        rows.push([...columns.map((column) => exportCell(prospect, column))]);
      }

      if (rows.length === 0) {
        return ok(
          { path: null, rows: 0, columns, excluded_suppressed: excluded },
          { demo: ctx.config.mode === 'demo' },
          ['No rows to export; no file was written.'],
        );
      }

      const target = await resolveExportPath(ctx, input.path, input.list, input.overwrite ?? false);
      const csv = toCsv([columns, ...rows]);
      await fs.writeFile(target, csv, 'utf8');

      return ok(
        { path: target, rows: rows.length, columns, excluded_suppressed: excluded },
        { demo: ctx.config.mode === 'demo' },
      );
    },
  });

  defineTool(server, {
    name: 'sdr_manage_suppression',
    title: 'Manage suppression',
    description: SUPPRESSION_DESCRIPTION,
    inputSchema: {
      action: z.enum(['add', 'remove', 'list', 'check']),
      emails: z.array(z.string().max(320)).max(200).optional(),
      domains: z.array(z.string().max(200)).max(200).optional(),
      reason: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      cursor: z.string().max(500).nullable().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      if (input.action === 'list') {
        const listed = await suppression.list({ limit: input.limit, cursor: input.cursor ?? null });
        return ok(listed, { demo: ctx.config.mode === 'demo' });
      }
      if (input.action === 'check') {
        const values = [...(input.emails ?? []), ...(input.domains ?? [])];
        const checked = await suppression.check(values);
        return ok({ results: checked }, { demo: ctx.config.mode === 'demo' });
      }
      if (input.action === 'remove') {
        const values = [...(input.emails ?? []), ...(input.domains ?? [])];
        const removed: string[] = [];
        for (const value of values) {
          if (await suppression.remove(value)) removed.push(value);
        }
        return ok({ removed, count: removed.length }, { demo: ctx.config.mode === 'demo' });
      }
      const added = await suppression.add({
        ...(input.emails ? { emails: input.emails } : {}),
        ...(input.domains ? { domains: input.domains } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      });
      return ok(added, { demo: ctx.config.mode === 'demo' });
    },
  });
}

function exportCell(
  prospect: NonNullable<Awaited<ReturnType<ProspectStore['get']>>>,
  column: string,
): unknown {
  if (column === 'suppressed') return true;
  if (column === 'first_line') return prospect.custom_fields.first_line ?? '';
  if (column === 'company_name') return prospect.company?.name ?? '';
  if (column === 'company_domain') return prospect.company?.domain ?? '';
  if (column.startsWith('custom_fields.')) {
    return prospect.custom_fields[column.slice('custom_fields.'.length)] ?? '';
  }
  const value = (prospect as unknown as Record<string, unknown>)[column];
  return value ?? '';
}

async function resolveExportPath(
  ctx: ServerContext,
  customPath: string | undefined,
  list: string | undefined,
  overwrite: boolean,
): Promise<string> {
  if (customPath) {
    if (!path.isAbsolute(customPath)) {
      throw new OpenSdrError({
        code: 'BAD_INPUT',
        message: 'Export path must be absolute.',
        hint: 'Omit `path` to write under the data dir, or pass an absolute path ending in .csv.',
      });
    }
    if (!customPath.toLowerCase().endsWith('.csv')) {
      throw new OpenSdrError({ code: 'BAD_INPUT', message: 'Export path must end in .csv.' });
    }
    const parent = path.dirname(customPath);
    try {
      await fs.access(parent);
    } catch {
      throw new OpenSdrError({
        code: 'BAD_INPUT',
        message: `Export parent directory does not exist: ${parent}`,
      });
    }
    if (!overwrite && (await exists(customPath))) {
      throw new OpenSdrError({
        code: 'BAD_INPUT',
        message: 'Refusing to overwrite an existing file.',
        hint: 'Pass overwrite: true to replace it.',
      });
    }
    return customPath;
  }

  const dir = path.join(ctx.config.dataDir, 'exports');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const base = list ?? 'selection';
  return path.join(dir, `${base}-${stamp}.csv`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
