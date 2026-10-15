import { OpenSdrError } from '../errors.js';
import type { HttpClient } from '../http/client.js';
import type { Capability, CrmContactInput, CrmProvider, CrmUpsertResult } from './types.js';

export const HUBSPOT_COSTS = { upsertContacts: 0, createNote: 0 } as const;

const BASE_URL = 'https://api.hubapi.com';
const CHUNK = 100;
const CONTACT_TO_NOTE_ASSOCIATION = 202;

export interface HubspotDeps {
  http: HttpClient;
  apiKey: string;
}

export interface HubspotProvider extends CrmProvider {
  readContacts(emails: string[]): Promise<Map<string, Record<string, string | null>>>;
  createNote(contactId: string, body: string): Promise<{ id: string }>;
}

interface BatchUpsertResponse {
  results?: { id: string; properties?: Record<string, string | null> }[];
  errors?: { message?: string }[];
}

interface BatchReadResponse {
  results?: { id: string; properties?: Record<string, string | null> }[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toProperties(contact: CrmContactInput): Record<string, string> {
  const properties: Record<string, string> = { email: contact.email };
  if (contact.first_name) properties.firstname = contact.first_name;
  if (contact.last_name) properties.lastname = contact.last_name;
  if (contact.company) properties.company = contact.company;
  for (const [key, value] of Object.entries(contact.properties ?? {})) {
    if (typeof value === 'string' && value !== '') properties[key] = value;
  }
  return properties;
}

export function createHubspotProvider(deps: HubspotDeps): HubspotProvider {
  const headers = { authorization: `Bearer ${deps.apiKey}` };

  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    options: { idempotent?: boolean } = {},
  ): Promise<T> => {
    try {
      return await deps.http.request<T>({
        provider: 'hubspot',
        method,
        url: `${BASE_URL}${path}`,
        headers,
        ...(body !== undefined ? { body } : {}),
        // Reads and email-keyed upserts are safe to retry; one-shot creates (notes) are not.
        idempotent: options.idempotent ?? true,
      });
    } catch (error) {
      if (error instanceof OpenSdrError && error.code === 'PERMISSION_DENIED') {
        throw new OpenSdrError({
          code: 'PERMISSION_DENIED',
          message: error.message,
          provider: 'hubspot',
          retryable: false,
          hint: 'The HubSpot private app is missing a scope. Enable crm.objects.contacts.read and crm.objects.contacts.write (plus crm.objects.notes.write for notes).',
        });
      }
      throw error;
    }
  };

  return {
    name: 'hubspot',

    estimateCost(capability: Capability): number {
      void capability;
      return 0;
    },

    async upsertContacts(contacts: CrmContactInput[]): Promise<CrmUpsertResult> {
      const result: CrmUpsertResult = { upserted: 0, results: [], failed: [] };
      for (const group of chunk(contacts, CHUNK)) {
        const response = await call<BatchUpsertResponse>(
          'POST',
          '/crm/v3/objects/contacts/batch/upsert',
          {
            inputs: group.map((contact) => ({
              id: contact.email,
              idProperty: 'email',
              properties: toProperties(contact),
            })),
          },
        );
        const results = response.results ?? [];
        // Match results to inputs by email; HubSpot does not guarantee result order, and a
        // dropped contact would otherwise shift every later id. Fall back to position only when
        // every input got exactly one result; otherwise treat unmatched contacts as failed.
        const resultsCarryEmail = results.some(
          (entry) => typeof entry.properties?.email === 'string' && entry.properties.email !== '',
        );
        const positional = !resultsCarryEmail && results.length === group.length;
        group.forEach((contact, index) => {
          const entry = resultsCarryEmail
            ? results.find(
                (candidate) =>
                  (candidate.properties?.email ?? '').toLowerCase() === contact.email.toLowerCase(),
              )
            : positional
              ? results[index]
              : undefined;
          if (entry?.id) {
            result.results.push({ email: contact.email, id: entry.id, action: 'updated' });
            result.upserted += 1;
          } else {
            result.failed.push({
              email: contact.email,
              error: 'HubSpot did not return a contact id.',
            });
          }
        });
        for (const error of response.errors ?? []) {
          result.failed.push({ email: '', error: error.message ?? 'Unknown HubSpot error' });
        }
      }
      return result;
    },

    async readContacts(emails: string[]): Promise<Map<string, Record<string, string | null>>> {
      const found = new Map<string, Record<string, string | null>>();
      for (const group of chunk(emails, CHUNK)) {
        const response = await call<BatchReadResponse>(
          'POST',
          '/crm/v3/objects/contacts/batch/read',
          {
            idProperty: 'email',
            properties: [
              'email',
              'firstname',
              'lastname',
              'jobtitle',
              'company',
              'website',
              'lifecyclestage',
            ],
            inputs: group.map((email) => ({ id: email })),
          },
        );
        for (const entry of response.results ?? []) {
          const email = entry.properties?.email;
          if (email) found.set(email, entry.properties ?? {});
        }
      }
      return found;
    },

    async createNote(contactId: string, body: string): Promise<{ id: string }> {
      const note = await call<{ id: string }>(
        'POST',
        '/crm/v3/objects/notes',
        { properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body } },
        { idempotent: false },
      );
      await call<unknown>(
        'PUT',
        `/crm/v3/objects/contacts/${contactId}/associations/notes/${note.id}/${CONTACT_TO_NOTE_ASSOCIATION}`,
      );
      return { id: note.id };
    },
  };
}
