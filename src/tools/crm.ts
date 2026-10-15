import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createConfirmationEngine, fingerprint } from '../engine/confirmation.js';
import { OpenSdrError } from '../errors.js';
import type { CrmContactInput, CrmProvider } from '../providers/types.js';
import type { ServerContext } from '../server.js';
import { ProspectStore } from '../store/prospects.js';
import { SuppressionStore } from '../store/suppression.js';
import type { Prospect } from '../types.js';
import { defineTool, ok, okComplete } from './envelope.js';

const MAX_CONTACTS = 100;

const DESCRIPTION =
  'Upsert prospects into HubSpot as contacts (keyed by email), with an optional lifecycle stage and a ' +
  'note. Two-phase: call without confirm to preview, show the preview to the user, then call again with ' +
  'confirm=true and the confirmation_token after explicit approval. If any approved contact changes ' +
  'before confirming, the confirm is rejected and you must preview again. Idempotent by email (re-syncing ' +
  'never duplicates). overwrite_existing:false (default) only fills empty HubSpot properties. Suppressed ' +
  'prospects are excluded unless include_suppressed. Honors OPENSDR_READ_ONLY. Demo mode returns ' +
  'simulated:true.';

const LIFECYCLE = z.enum([
  'subscriber',
  'lead',
  'marketingqualifiedlead',
  'salesqualifiedlead',
  'opportunity',
]);

interface HubspotExtra extends CrmProvider {
  readContacts?(emails: string[]): Promise<Map<string, Record<string, string | null>>>;
  createNote?(contactId: string, body: string): Promise<{ id: string }>;
}

export function registerCrmTools(server: McpServer, ctx: ServerContext): void {
  const confirmation = createConfirmationEngine();
  const prospects = new ProspectStore({
    path: path.join(ctx.config.dataDir, 'prospects.json'),
    warn: (message) => ctx.logger.warn(message),
  });
  const suppression = new SuppressionStore({
    path: path.join(ctx.config.dataDir, 'suppression.json'),
    warn: (message) => ctx.logger.warn(message),
  });
  // confirmation token → (prospect_id → fingerprint of the exact contact payload the user approved)
  const previewContacts = new Map<string, Map<string, string>>();

  defineTool(server, {
    name: 'sdr_sync_hubspot',
    title: 'Sync to HubSpot',
    description: DESCRIPTION,
    inputSchema: {
      prospect_ids: z.array(z.string().max(80)).max(MAX_CONTACTS).optional(),
      list: z.string().max(64).optional(),
      lifecycle_stage: LIFECYCLE.optional(),
      overwrite_existing: z.boolean().optional(),
      add_note: z.boolean().optional(),
      include_suppressed: z.boolean().optional(),
      confirm: z.boolean().optional(),
      confirmation_token: z.string().max(200).optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => {
      if (ctx.config.readOnly) {
        throw new OpenSdrError({
          code: 'READ_ONLY_MODE',
          message: 'OPENSDR_READ_ONLY is set; external writes are disabled.',
        });
      }
      if ((input.prospect_ids ? 1 : 0) + (input.list ? 1 : 0) !== 1) {
        throw new OpenSdrError({
          code: 'BAD_INPUT',
          message: 'Provide exactly one of `prospect_ids` or `list`.',
        });
      }

      const overwriteExisting = input.overwrite_existing ?? false;
      const includeSuppressed = input.include_suppressed ?? false;
      const addNote = input.add_note ?? false;

      const prospectIds = input.prospect_ids ? [...new Set(input.prospect_ids)] : undefined;
      const selected = prospectIds
        ? (await Promise.all(prospectIds.map((id) => prospects.get(id)))).filter(
            (prospect): prospect is Prospect => prospect !== null,
          )
        : (await prospects.query({ list: input.list as string, limit: 100000 })).prospects;
      if (selected.length > MAX_CONTACTS) {
        throw new OpenSdrError({
          code: 'BAD_INPUT',
          message: `At most ${MAX_CONTACTS} contacts per sync; got ${selected.length}.`,
        });
      }

      const normalizeInput = {
        ...(prospectIds ? { prospect_ids: prospectIds } : {}),
        ...(input.list ? { list: input.list } : {}),
        ...(input.lifecycle_stage ? { lifecycle_stage: input.lifecycle_stage } : {}),
        overwrite_existing: overwriteExisting,
        add_note: addNote,
        include_suppressed: includeSuppressed,
      };

      const resolved = ctx.registry.resolve('crm');
      const isLive = ctx.config.mode !== 'demo';
      if (isLive && !resolved) {
        throw new OpenSdrError({
          code: 'NOT_CONFIGURED',
          message: 'No CRM provider is configured.',
          hint: 'Set HUBSPOT_ACCESS_TOKEN to sync contacts.',
        });
      }
      const provider = resolved?.provider as HubspotExtra | undefined;

      // Gate + property build.
      const contacts: {
        prospect_id: string;
        email: string;
        properties: Record<string, string>;
        note?: string;
      }[] = [];
      const excluded: { prospect_id: string; reason: string }[] = [];
      for (const prospect of selected) {
        const check = await suppression.isSuppressed({
          ...(prospect.email ? { email: prospect.email } : {}),
          ...(prospect.company?.domain ? { domain: prospect.company.domain } : {}),
        });
        if (check.suppressed && !includeSuppressed) {
          excluded.push({ prospect_id: prospect.id, reason: 'suppressed' });
          continue;
        }
        if (!prospect.email) {
          excluded.push({ prospect_id: prospect.id, reason: 'no_email' });
          continue;
        }
        contacts.push({
          prospect_id: prospect.id,
          email: prospect.email,
          properties: buildProperties(prospect, input.lifecycle_stage),
          ...(addNote ? { note: buildNoteBody(prospect) } : {}),
        });
      }

      // overwrite_existing=false → read existing values and drop filled properties.
      const actionById = new Map<string, 'create' | 'update' | 'unknown'>();
      if (!overwriteExisting && isLive && provider?.readContacts) {
        const existing = await provider.readContacts(contacts.map((contact) => contact.email));
        for (const contact of contacts) {
          const current = existing.get(contact.email);
          if (!current) {
            actionById.set(contact.prospect_id, 'create');
            continue;
          }
          actionById.set(contact.prospect_id, 'update');
          const filtered: Record<string, string> = { email: contact.email };
          for (const [key, value] of Object.entries(contact.properties)) {
            if (key === 'email') continue;
            const existingValue = current[key];
            if (existingValue === undefined || existingValue === null || existingValue === '') {
              filtered[key] = value;
            }
          }
          contact.properties = filtered;
        }
      } else {
        for (const contact of contacts) actionById.set(contact.prospect_id, 'unknown');
      }

      if (!input.confirm) {
        const { token, expires_at } = confirmation.preview('sdr_sync_hubspot', normalizeInput);
        previewContacts.set(
          token,
          new Map(contacts.map((contact) => [contact.prospect_id, fingerprint(contact)])),
        );
        return okComplete(
          {
            to_create_or_update: contacts.map((contact) => ({
              prospect_id: contact.prospect_id,
              email: contact.email,
              action: actionById.get(contact.prospect_id) ?? 'unknown',
              properties: contact.properties,
              ...(contact.note ? { note: contact.note } : {}),
            })),
            excluded,
            properties_sent: [
              ...new Set(contacts.flatMap((contact) => Object.keys(contact.properties))),
            ],
            confirmation_token: token,
            expires_at,
          },
          { demo: ctx.config.mode === 'demo' },
        );
      }

      confirmation.verify('sdr_sync_hubspot', normalizeInput, input.confirmation_token);
      const previewed = previewContacts.get(input.confirmation_token as string) ?? new Map();
      previewContacts.delete(input.confirmation_token as string);
      const changed = contacts.filter(
        (contact) => previewed.get(contact.prospect_id) !== fingerprint(contact),
      );
      if (changed.length > 0) {
        throw new OpenSdrError({
          code: 'CONFIRMATION_REQUIRED',
          message: `${changed.length} contact(s) were added or changed since the preview the user approved.`,
          hint: 'Call again without `confirm` to preview the current contacts, show them to the user, then confirm.',
        });
      }
      const syncWarnings =
        previewed.size > contacts.length
          ? [`Contact set shrank from ${previewed.size} to ${contacts.length} since the preview.`]
          : [];

      if (ctx.config.mode === 'demo') {
        const syncedAt = new Date().toISOString();
        for (const contact of contacts) {
          await prospects.recordCrm(contact.prospect_id, {
            hubspot_id: `hs_demo_${contact.prospect_id}`,
            synced_at: syncedAt,
          });
        }
        return ok(
          {
            provider: 'hubspot',
            simulated: true,
            synced: contacts.length,
            excluded: excluded.length,
          },
          { demo: true },
          syncWarnings,
        );
      }

      const results: {
        prospect_id: string;
        email: string;
        outcome: string;
        hubspot_id?: string;
      }[] = [];
      const crmContacts: CrmContactInput[] = contacts.map((contact) => ({
        email: contact.email,
        ...(contact.properties.firstname ? { first_name: contact.properties.firstname } : {}),
        ...(contact.properties.lastname ? { last_name: contact.properties.lastname } : {}),
        ...(contact.properties.company ? { company: contact.properties.company } : {}),
        properties: contact.properties,
      }));
      if (!provider) {
        throw new OpenSdrError({
          code: 'NOT_CONFIGURED',
          message: 'No CRM provider is configured.',
          hint: 'Set HUBSPOT_ACCESS_TOKEN to sync contacts.',
        });
      }
      const upsert = await provider.upsertContacts(crmContacts);
      const idByEmail = new Map(upsert.results.map((entry) => [entry.email, entry.id]));
      const syncedAt = new Date().toISOString();
      for (const contact of contacts) {
        const hubspotId = idByEmail.get(contact.email);
        if (!hubspotId) {
          results.push({
            prospect_id: contact.prospect_id,
            email: contact.email,
            outcome: 'failed',
          });
          continue;
        }
        await prospects.recordCrm(contact.prospect_id, {
          hubspot_id: hubspotId,
          synced_at: syncedAt,
        });
        if (contact.note && provider?.createNote) {
          try {
            await provider.createNote(hubspotId, contact.note);
          } catch (error) {
            ctx.logger.warn(
              `HubSpot note failed for ${contact.email}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        results.push({
          prospect_id: contact.prospect_id,
          email: contact.email,
          outcome: 'synced',
          hubspot_id: hubspotId,
        });
      }

      return ok(
        {
          provider: resolved?.name ?? 'hubspot',
          synced: results.filter((entry) => entry.outcome === 'synced').length,
          excluded: excluded.length,
          results,
          failed: upsert.failed,
        },
        { sources: [resolved?.name ?? 'hubspot'] },
        syncWarnings,
      );
    },
  });
}

function buildProperties(prospect: Prospect, lifecycleStage?: string): Record<string, string> {
  const properties: Record<string, string> = { email: prospect.email as string };
  if (prospect.first_name) properties.firstname = prospect.first_name;
  if (prospect.last_name) properties.lastname = prospect.last_name;
  if (prospect.title) properties.jobtitle = prospect.title;
  if (prospect.company?.name) properties.company = prospect.company.name;
  if (prospect.company?.domain) properties.website = prospect.company.domain;
  if (prospect.linkedin_url) properties.hs_linkedin_url = prospect.linkedin_url;
  if (lifecycleStage) properties.lifecyclestage = lifecycleStage;
  return properties;
}

function buildNoteBody(prospect: Prospect): string {
  const lines: string[] = ['OpenSDR sync'];
  if (prospect.custom_fields.first_line)
    lines.push(`First line: ${prospect.custom_fields.first_line}`);
  for (const signal of prospect.signals.slice(0, 3)) {
    lines.push(`Signal: ${signal.title} (${signal.url})`);
  }
  return lines.join('\n');
}
