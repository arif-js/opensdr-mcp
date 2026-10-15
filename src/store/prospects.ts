import { createHash } from 'node:crypto';
import { OpenSdrError } from '../errors.js';
import type { CompanyRef, EmailStatus, Prospect, ProspectStatus, Signal } from '../types.js';
import { JsonFile } from './json-file.js';

export const EMAIL_STATUS_RANK: Record<EmailStatus, number> = {
  verified: 4,
  likely: 3,
  accept_all: 2,
  unknown: 1,
  invalid: 0,
};

export interface StorePerson {
  id?: string;
  provider_ids?: Record<string, string>;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  title?: string | null;
  seniority?: string | null;
  linkedin_url?: string | null;
  location?: string | null;
  company?: CompanyRef | null;
  email?: string | null;
  email_status?: EmailStatus | null;
  email_confidence?: number | null;
  phone?: string | null;
  sources?: string[];
  updated_at?: string;
}

export interface ProspectPatch {
  notes?: string | null;
  status?: ProspectStatus;
  signals?: Signal[];
  custom_fields?: Record<string, string>;
}

export type ProspectUpsertInput =
  | { person: StorePerson }
  | { prospect_id: string; patch: ProspectPatch };

export interface UpsertOptions {
  list?: string;
  merge?: 'fill_missing' | 'overwrite';
  status?: ProspectStatus;
}

export interface UpsertItemResult {
  prospect_id: string | null;
  outcome: 'created' | 'updated' | 'unchanged' | 'error';
  error?: { code: string; message: string };
}

export interface UpsertResult {
  results: UpsertItemResult[];
  created: number;
  updated: number;
  unchanged: number;
}

export interface QueryFilters {
  list?: string;
  status?: ProspectStatus;
  email_status?: EmailStatus[];
  has_email?: boolean;
  company_domain?: string;
  search?: string;
  limit: number;
  cursor?: string | null;
}

export interface QueryResult {
  prospects: Prospect[];
  next_cursor: string | null;
  total: number;
}

export interface ListSummary {
  name: string;
  count: number;
  with_email: number;
  verified: number;
  statuses: Record<string, number>;
}

interface ListMeta {
  created_at: string;
  description?: string;
}

interface ProspectsData {
  schema_version: number;
  prospects: Record<string, Prospect>;
  lists: Record<string, ListMeta>;
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const value = email.trim().toLowerCase();
  return value === '' ? null : value;
}

export function prospectCandidateKeys(person: StorePerson): string[] {
  const keys: string[] = [];
  const email = normalizeEmail(person.email);
  if (email) keys.push(`email:${email}`);
  if (person.linkedin_url) keys.push(`linkedin:${person.linkedin_url.trim().toLowerCase()}`);
  const apollo = person.provider_ids?.apollo;
  if (apollo) keys.push(`apollo:${apollo}`);
  const name = (person.full_name ?? [person.first_name, person.last_name].filter(Boolean).join(' '))
    .trim()
    .toLowerCase();
  const domain = person.company?.domain?.toLowerCase();
  if (name && domain) keys.push(`name:${name}@${domain}`);
  return keys;
}

export function prospectDedupeKey(person: StorePerson): string | null {
  return prospectCandidateKeys(person)[0] ?? null;
}

export function prospectIdFor(dedupeKey: string): string {
  return `p_${createHash('sha256').update(dedupeKey).digest('hex').slice(0, 12)}`;
}

function isNewer(incoming: string | undefined, current: string | undefined): boolean {
  if (!incoming) return false;
  if (!current) return true;
  return (Date.parse(incoming) || 0) > (Date.parse(current) || 0);
}

const PERSON_FIELDS: (keyof StorePerson)[] = [
  'first_name',
  'last_name',
  'full_name',
  'title',
  'seniority',
  'linkedin_url',
  'location',
  'email',
  'phone',
  'updated_at',
];

function newProspect(person: StorePerson, status: ProspectStatus): Prospect {
  const prospect: Prospect = {
    id: person.id ?? 'p_unknown',
    provider_ids: person.provider_ids ?? {},
    first_name: person.first_name ?? null,
    last_name: person.last_name ?? null,
    full_name: person.full_name ?? null,
    title: person.title ?? null,
    seniority: person.seniority ?? null,
    linkedin_url: person.linkedin_url ?? null,
    location: person.location ?? null,
    company: person.company ?? null,
    email: normalizeEmail(person.email),
    email_status: person.email_status ?? null,
    email_confidence: person.email_confidence ?? null,
    phone: person.phone ?? null,
    sources: person.sources ?? [],
    updated_at: person.updated_at,
    list: [],
    status,
    signals: [],
    notes: null,
    custom_fields: {},
    campaigns: [],
  };
  return prospect;
}

function mergePerson(
  existing: Prospect,
  incoming: StorePerson,
  merge: 'fill_missing' | 'overwrite',
): Prospect {
  const next: Prospect = {
    ...existing,
    list: [...existing.list],
    provider_ids: { ...existing.provider_ids },
  };
  for (const field of PERSON_FIELDS) {
    const value = incoming[field];
    if (value === undefined || value === null || value === '') continue;
    const current = next[field];
    if (merge === 'overwrite' || current === undefined || current === null || current === '') {
      (next as Record<string, unknown>)[field] =
        field === 'email' ? normalizeEmail(value as string) : value;
    }
  }
  if (incoming.company) {
    next.company = { ...(next.company ?? {}), ...incoming.company };
  }
  if (incoming.provider_ids) {
    next.provider_ids = { ...incoming.provider_ids, ...next.provider_ids };
  }
  if (incoming.sources?.length) {
    next.sources = Array.from(new Set([...(next.sources ?? []), ...incoming.sources]));
  }
  if (incoming.email_status) {
    const current = next.email_status;
    if (merge === 'overwrite' || !current) {
      next.email_status = incoming.email_status;
    } else if (EMAIL_STATUS_RANK[incoming.email_status] > EMAIL_STATUS_RANK[current]) {
      next.email_status = incoming.email_status;
    } else if (
      incoming.email_status === 'invalid' &&
      current !== 'invalid' &&
      isNewer(incoming.updated_at, existing.updated_at)
    ) {
      next.email_status = 'invalid';
    }
  }
  if (
    incoming.email_confidence !== undefined &&
    incoming.email_confidence !== null &&
    (merge === 'overwrite' || next.email_confidence === undefined || next.email_confidence === null)
  ) {
    next.email_confidence = incoming.email_confidence;
  }
  return next;
}

function applyPatch(existing: Prospect, patch: ProspectPatch): Prospect {
  const next: Prospect = { ...existing };
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.signals !== undefined) next.signals = patch.signals;
  if (patch.custom_fields !== undefined) {
    next.custom_fields = { ...next.custom_fields, ...patch.custom_fields };
  }
  return next;
}

export class ProspectStore {
  private readonly file: JsonFile<ProspectsData>;

  constructor(options: { path: string; warn?: (message: string, meta?: unknown) => void }) {
    this.file = new JsonFile<ProspectsData>({
      path: options.path,
      schemaVersion: 1,
      defaultValue: () => ({ schema_version: 1, prospects: {}, lists: {} }),
      ...(options.warn ? { warn: options.warn } : {}),
    });
  }

  async upsert(inputs: ProspectUpsertInput[], options: UpsertOptions = {}): Promise<UpsertResult> {
    const merge = options.merge ?? 'fill_missing';
    const result: UpsertResult = { results: [], created: 0, updated: 0, unchanged: 0 };

    await this.file.update((current) => {
      const prospects = { ...current.prospects };
      const lists = { ...current.lists };
      if (options.list) {
        lists[options.list] = lists[options.list] ?? { created_at: new Date().toISOString() };
      }

      for (const input of inputs) {
        if ('prospect_id' in input) {
          const existing = prospects[input.prospect_id];
          if (!existing) {
            result.results.push({
              prospect_id: input.prospect_id,
              outcome: 'error',
              error: { code: 'NOT_FOUND', message: `No prospect with id ${input.prospect_id}.` },
            });
            continue;
          }
          const next = applyPatch(existing, input.patch);
          if (options.list && !next.list.includes(options.list))
            next.list = [...next.list, options.list];
          const changed = JSON.stringify(next) !== JSON.stringify(existing);
          prospects[input.prospect_id] = next;
          result.results.push({
            prospect_id: input.prospect_id,
            outcome: changed ? 'updated' : 'unchanged',
          });
          if (changed) result.updated += 1;
          else result.unchanged += 1;
          continue;
        }

        const keys = prospectCandidateKeys(input.person);
        if (keys.length === 0) {
          result.results.push({
            prospect_id: null,
            outcome: 'error',
            error: {
              code: 'BAD_INPUT',
              message:
                'A person needs an email, LinkedIn URL, Apollo id, or name + company domain.',
            },
          });
          continue;
        }

        let id: string | undefined;
        for (const key of keys) {
          const candidate = prospectIdFor(key);
          if (prospects[candidate]) {
            id = candidate;
            break;
          }
        }
        if (!id) {
          for (const [existingId, existingProspect] of Object.entries(prospects)) {
            const existingKeys = prospectCandidateKeys(existingProspect);
            if (keys.some((key) => existingKeys.includes(key))) {
              id = existingId;
              break;
            }
          }
        }
        if (!id) id = prospectIdFor(keys[0]);

        const existing = prospects[id];
        if (!existing) {
          const prospect = newProspect({ ...input.person, id }, options.status ?? 'new');
          if (options.list) prospect.list = [options.list];
          prospects[id] = prospect;
          result.created += 1;
          result.results.push({ prospect_id: id, outcome: 'created' });
        } else {
          const next = mergePerson(existing, input.person, merge);
          if (options.list && !next.list.includes(options.list))
            next.list = [...next.list, options.list];
          const changed = JSON.stringify(next) !== JSON.stringify(existing);
          prospects[id] = next;
          result.results.push({ prospect_id: id, outcome: changed ? 'updated' : 'unchanged' });
          if (changed) result.updated += 1;
          else result.unchanged += 1;
        }
      }

      return { schema_version: 1, prospects, lists };
    });

    return result;
  }

  async get(id: string): Promise<Prospect | null> {
    const data = await this.file.read();
    return data.prospects[id] ?? null;
  }

  async update(id: string, patch: ProspectPatch): Promise<Prospect> {
    let updated: Prospect | null = null;
    await this.file.update((current) => {
      const existing = current.prospects[id];
      if (!existing) {
        throw new OpenSdrError({ code: 'NOT_FOUND', message: `No prospect with id ${id}.` });
      }
      updated = applyPatch(existing, patch);
      return { ...current, prospects: { ...current.prospects, [id]: updated } };
    });
    if (!updated)
      throw new OpenSdrError({ code: 'NOT_FOUND', message: `No prospect with id ${id}.` });
    return updated;
  }

  async query(filters: QueryFilters): Promise<QueryResult> {
    const data = await this.file.read();
    const search = filters.search?.trim().toLowerCase();
    let items = Object.values(data.prospects).filter((prospect) => {
      if (filters.list && !prospect.list.includes(filters.list)) return false;
      if (filters.status && prospect.status !== filters.status) return false;
      if (
        filters.email_status?.length &&
        (!prospect.email_status || !filters.email_status.includes(prospect.email_status))
      )
        return false;
      if (filters.has_email !== undefined && Boolean(prospect.email) !== filters.has_email)
        return false;
      if (
        filters.company_domain &&
        prospect.company?.domain?.toLowerCase() !== filters.company_domain.toLowerCase()
      )
        return false;
      if (search) {
        const haystack = [
          prospect.full_name,
          prospect.email,
          prospect.title,
          prospect.company?.name,
          prospect.company?.domain,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    items = items.sort((a, b) => a.id.localeCompare(b.id));

    const offset = this.decodeCursor(filters.cursor);
    const slice = items.slice(offset, offset + filters.limit);
    const nextOffset = offset + slice.length;
    return {
      prospects: slice,
      next_cursor: nextOffset < items.length ? this.encodeCursor(nextOffset) : null,
      total: items.length,
    };
  }

  async addToList(id: string, list: string): Promise<void> {
    await this.file.update((current) => {
      const existing = current.prospects[id];
      if (!existing)
        throw new OpenSdrError({ code: 'NOT_FOUND', message: `No prospect with id ${id}.` });
      const lists = {
        ...current.lists,
        [list]: current.lists[list] ?? { created_at: new Date().toISOString() },
      };
      const next = existing.list.includes(list)
        ? existing
        : { ...existing, list: [...existing.list, list] };
      return { schema_version: 1, lists, prospects: { ...current.prospects, [id]: next } };
    });
  }

  async removeFromList(id: string, list: string): Promise<void> {
    await this.file.update((current) => {
      const existing = current.prospects[id];
      if (!existing)
        throw new OpenSdrError({ code: 'NOT_FOUND', message: `No prospect with id ${id}.` });
      const next = { ...existing, list: existing.list.filter((entry) => entry !== list) };
      return { ...current, prospects: { ...current.prospects, [id]: next } };
    });
  }

  async recordCampaign(
    id: string,
    campaign: { provider: string; campaign_id: string; pushed_at: string },
  ): Promise<void> {
    await this.file.update((current) => {
      const existing = current.prospects[id];
      if (!existing)
        throw new OpenSdrError({ code: 'NOT_FOUND', message: `No prospect with id ${id}.` });
      const campaigns = existing.campaigns.filter(
        (entry) => entry.campaign_id !== campaign.campaign_id,
      );
      campaigns.push(campaign);
      const next: Prospect = { ...existing, campaigns, status: 'queued' };
      return { ...current, prospects: { ...current.prospects, [id]: next } };
    });
  }

  async recordCrm(
    id: string,
    crm: { hubspot_id?: string | null; synced_at: string },
  ): Promise<void> {
    await this.file.update((current) => {
      const existing = current.prospects[id];
      if (!existing)
        throw new OpenSdrError({ code: 'NOT_FOUND', message: `No prospect with id ${id}.` });
      const next: Prospect = { ...existing, crm };
      return { ...current, prospects: { ...current.prospects, [id]: next } };
    });
  }

  async deleteList(name: string): Promise<number> {
    let removed = 0;
    await this.file.update((current) => {
      const prospects = { ...current.prospects };
      for (const [id, prospect] of Object.entries(prospects)) {
        if (prospect.list.includes(name)) {
          prospects[id] = { ...prospect, list: prospect.list.filter((entry) => entry !== name) };
          removed += 1;
        }
      }
      const lists = { ...current.lists };
      delete lists[name];
      return { schema_version: 1, prospects, lists };
    });
    return removed;
  }

  async listsSummary(): Promise<ListSummary[]> {
    const data = await this.file.read();
    const summaries = new Map<string, ListSummary>();
    for (const name of Object.keys(data.lists)) {
      summaries.set(name, { name, count: 0, with_email: 0, verified: 0, statuses: {} });
    }
    for (const prospect of Object.values(data.prospects)) {
      for (const name of prospect.list) {
        const summary = summaries.get(name) ?? {
          name,
          count: 0,
          with_email: 0,
          verified: 0,
          statuses: {},
        };
        summary.count += 1;
        if (prospect.email) summary.with_email += 1;
        if (prospect.email_status === 'verified') summary.verified += 1;
        summary.statuses[prospect.status] = (summary.statuses[prospect.status] ?? 0) + 1;
        summaries.set(name, summary);
      }
    }
    return [...summaries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private encodeCursor(offset: number): string {
    return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string | null | undefined): number {
    if (!cursor) return 0;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        o?: number;
      };
      return typeof parsed.o === 'number' && parsed.o >= 0 ? parsed.o : 0;
    } catch {
      throw new OpenSdrError({ code: 'BAD_INPUT', message: 'Invalid cursor.' });
    }
  }
}
