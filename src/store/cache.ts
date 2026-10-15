import { JsonFile } from './json-file.js';

interface CacheRecord {
  value: unknown;
  stored_at: string;
  source: string;
}

interface CacheData {
  schema_version: number;
  entries: Record<string, CacheRecord>;
  last_prune_at: string | null;
}

export interface CacheOptions {
  path: string;
  ttlDays: number;
  now?: () => Date;
  pruneIntervalMs?: number;
}

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export class EnrichmentCache {
  private readonly file: JsonFile<CacheData>;
  private readonly ttlMs: number;
  private readonly now: () => Date;
  private readonly pruneIntervalMs: number;

  constructor(options: CacheOptions) {
    this.ttlMs = options.ttlDays * 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    this.pruneIntervalMs = options.pruneIntervalMs ?? PRUNE_INTERVAL_MS;
    this.file = new JsonFile<CacheData>({
      path: options.path,
      schemaVersion: 1,
      defaultValue: () => ({ schema_version: 1, entries: {}, last_prune_at: null }),
    });
  }

  private isExpired(record: CacheRecord): boolean {
    const storedMs = Date.parse(record.stored_at);
    if (Number.isNaN(storedMs)) return true;
    return this.now().getTime() - storedMs > this.ttlMs;
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.file.read();
    const record = data.entries[key];
    if (!record || this.isExpired(record)) return null;
    return record.value as T;
  }

  async set(key: string, value: unknown, source: string): Promise<void> {
    await this.file.update((current) => {
      const entries = { ...current.entries };
      const nowMs = this.now().getTime();
      let lastPrune = current.last_prune_at;
      const shouldPrune = !lastPrune || nowMs - Date.parse(lastPrune) > this.pruneIntervalMs;
      if (shouldPrune) {
        for (const [entryKey, record] of Object.entries(entries)) {
          if (this.isExpired(record)) delete entries[entryKey];
        }
        lastPrune = this.now().toISOString();
      }
      entries[key] = { value, stored_at: this.now().toISOString(), source };
      return { schema_version: 1, entries, last_prune_at: lastPrune };
    });
  }

  async prune(): Promise<void> {
    await this.file.update((current) => {
      const entries = { ...current.entries };
      for (const [entryKey, record] of Object.entries(entries)) {
        if (this.isExpired(record)) delete entries[entryKey];
      }
      return { schema_version: 1, entries, last_prune_at: this.now().toISOString() };
    });
  }
}
