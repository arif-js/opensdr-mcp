import { normalizeDomain } from '../engine/normalize.js';
import type {
  SuppressionChecker,
  SuppressionQuery,
  SuppressionResult,
} from '../engine/suppression.js';
import { JsonFile } from './json-file.js';

export interface SuppressionMatch {
  type: 'email' | 'domain';
  value: string;
  reason?: string;
}

export interface SuppressionEntry {
  value: string;
  type: 'email' | 'domain';
  reason?: string;
  added_at: string;
}

export interface SuppressionCheckResult extends SuppressionResult {
  matched?: SuppressionMatch;
}

interface SuppressionData {
  schema_version: number;
  emails: string[];
  domains: string[];
  entries: SuppressionEntry[];
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function domainMatches(domain: string, entry: string): boolean {
  return domain === entry || domain.endsWith(`.${entry}`);
}

export class SuppressionStore implements SuppressionChecker {
  private readonly file: JsonFile<SuppressionData>;

  constructor(options: { path: string; warn?: (message: string, meta?: unknown) => void }) {
    this.file = new JsonFile<SuppressionData>({
      path: options.path,
      schemaVersion: 1,
      defaultValue: () => ({ schema_version: 1, emails: [], domains: [], entries: [] }),
      ...(options.warn ? { warn: options.warn } : {}),
    });
  }

  async isSuppressed(query: SuppressionQuery): Promise<SuppressionCheckResult> {
    const data = await this.file.read();
    return this.checkData(data, query);
  }

  private checkData(data: SuppressionData, query: SuppressionQuery): SuppressionCheckResult {
    const email = query.email ? normalizeEmail(query.email) : undefined;
    if (email && data.emails.includes(email)) {
      const entry = data.entries.find((item) => item.type === 'email' && item.value === email);
      const matched: SuppressionMatch = { type: 'email', value: email };
      if (entry?.reason) matched.reason = entry.reason;
      return { suppressed: true, ...(entry?.reason ? { reason: entry.reason } : {}), matched };
    }

    // Check the email's own domain AND any company domain passed in — a prospect's
    // company domain can differ from their email domain.
    const domains = new Set<string>();
    if (query.domain) domains.add(normalizeDomain(query.domain));
    if (email?.includes('@')) {
      const emailDomain = email.split('@').pop() ?? '';
      if (emailDomain) domains.add(normalizeDomain(emailDomain));
    }
    for (const domain of domains) {
      if (!domain) continue;
      const entry = data.entries.find(
        (item) => item.type === 'domain' && domainMatches(domain, item.value),
      );
      if (entry) {
        const matched: SuppressionMatch = { type: 'domain', value: entry.value };
        if (entry.reason) matched.reason = entry.reason;
        return { suppressed: true, ...(entry.reason ? { reason: entry.reason } : {}), matched };
      }
    }
    return { suppressed: false };
  }

  async add(input: { emails?: string[]; domains?: string[]; reason?: string }): Promise<{
    added_emails: number;
    added_domains: number;
    total_emails: number;
    total_domains: number;
  }> {
    const added = { added_emails: 0, added_domains: 0, total_emails: 0, total_domains: 0 };
    const now = new Date().toISOString();
    await this.file.update((current) => {
      const emails = new Set(current.emails);
      const domains = new Set(current.domains);
      const entries = [...current.entries];

      for (const raw of input.emails ?? []) {
        const value = normalizeEmail(raw);
        if (!value) continue;
        if (!emails.has(value)) {
          emails.add(value);
          entries.push({
            value,
            type: 'email',
            ...(input.reason ? { reason: input.reason } : {}),
            added_at: now,
          });
          added.added_emails += 1;
        }
      }
      for (const raw of input.domains ?? []) {
        const value = normalizeDomain(raw);
        if (!value) continue;
        if (!domains.has(value)) {
          domains.add(value);
          entries.push({
            value,
            type: 'domain',
            ...(input.reason ? { reason: input.reason } : {}),
            added_at: now,
          });
          added.added_domains += 1;
        }
      }
      added.total_emails = emails.size;
      added.total_domains = domains.size;
      return { schema_version: 1, emails: [...emails], domains: [...domains], entries };
    });
    return added;
  }

  async remove(value: string): Promise<boolean> {
    const email = normalizeEmail(value);
    const domain = normalizeDomain(value);
    let removed = false;
    await this.file.update((current) => {
      const emails = current.emails.filter((item) => item !== email);
      const domains = current.domains.filter((item) => item !== domain);
      const entries = current.entries.filter(
        (item) => item.value !== email && item.value !== domain,
      );
      removed =
        emails.length !== current.emails.length || domains.length !== current.domains.length;
      return { schema_version: 1, emails, domains, entries };
    });
    return removed;
  }

  async list(options: { limit: number; cursor?: string | null }): Promise<{
    entries: SuppressionEntry[];
    next_cursor: string | null;
    total: number;
  }> {
    const data = await this.file.read();
    const offset = this.decodeCursor(options.cursor);
    const slice = data.entries.slice(offset, offset + options.limit);
    const nextOffset = offset + slice.length;
    return {
      entries: slice,
      next_cursor: nextOffset < data.entries.length ? this.encodeCursor(nextOffset) : null,
      total: data.entries.length,
    };
  }

  async check(
    values: string[],
  ): Promise<{ value: string; suppressed: boolean; reason?: string }[]> {
    const data = await this.file.read();
    return values.map((value) => {
      const query: SuppressionQuery = value.includes('@') ? { email: value } : { domain: value };
      const result = this.checkData(data, query);
      return {
        value,
        suppressed: result.suppressed,
        ...(result.reason ? { reason: result.reason } : {}),
      };
    });
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
      return 0;
    }
  }
}
