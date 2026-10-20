import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { OpenSdrError } from '../errors.js';

export interface ConfirmationEngine {
  preview(toolName: string, input: unknown): { token: string; expires_at: string };
  verify(toolName: string, input: unknown, token: string | undefined): void;
}

export interface ConfirmationOptions {
  secret?: string;
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const STRIPPED_KEYS = new Set(['confirm', 'confirmation_token']);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (STRIPPED_KEYS.has(key)) continue;
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function canonicalJson(input: unknown): string {
  return JSON.stringify(canonicalize(input));
}

/** Stable hash of a value, used to prove the payload executed is the payload that was previewed. */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

interface TokenRecord {
  toolName: string;
  hash: string;
  expiresAt: number;
  used: boolean;
}

export function createConfirmationEngine(options: ConfirmationOptions = {}): ConfirmationEngine {
  const secret = options.secret ?? randomBytes(32).toString('hex');
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const records = new Map<string, TokenRecord>();

  // Keep expired records for one extra TTL so a late confirm still reports `expired`.
  const prune = () => {
    const current = now();
    for (const [token, record] of records) {
      if (current > record.expiresAt + ttlMs) records.delete(token);
    }
  };

  const hashFor = (toolName: string, input: unknown): string =>
    createHmac('sha256', secret)
      .update(`${toolName}\n${canonicalJson(input)}`)
      .digest('hex');

  return {
    preview(toolName, input) {
      prune();
      const hash = hashFor(toolName, input);
      const token = createHmac('sha256', secret).update(hash).digest('hex');
      const expiresAt = now() + ttlMs;
      records.set(token, { toolName, hash, expiresAt, used: false });
      return { token, expires_at: new Date(expiresAt).toISOString() };
    },

    verify(toolName, input, token) {
      const fail: (reason: 'missing' | 'mismatch' | 'expired', message: string) => never = (
        reason,
        message,
      ) => {
        throw new OpenSdrError({
          code: 'CONFIRMATION_REQUIRED',
          message: `${message} (reason: ${reason})`,
          hint: 'Call the tool again without `confirm` to get a fresh preview, show it to the user, then confirm.',
        });
      };
      if (!token) fail('missing', 'A confirmation_token is required when confirm is true.');
      const record = records.get(token as string);
      if (!record) fail('mismatch', 'Unknown or already-expired confirmation token.');

      const expected = hashFor(toolName, input);
      const sameTool = record.toolName === toolName;
      const sameHash =
        record.hash.length === expected.length &&
        timingSafeEqual(Buffer.from(record.hash), Buffer.from(expected));
      if (!sameTool || !sameHash) {
        fail('mismatch', 'The confirmation token does not match this tool and input.');
      }
      if (record.used) fail('mismatch', 'This confirmation token has already been used.');
      if (now() > record.expiresAt) fail('expired', 'The confirmation token has expired.');

      record.used = true;
    },
  };
}

/** In-memory cache for preview state with TTL-based pruning on write and read. */
export class ExpiringMap<K, V> {
  private readonly map = new Map<K, { expiresAt: number; data: V }>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  get size(): number {
    return this.map.size;
  }

  set(key: K, data: V, expiresAt: number): void {
    const current = this.now();
    for (const [k, v] of this.map) {
      if (current > v.expiresAt) this.map.delete(k);
    }
    this.map.set(key, { expiresAt, data });
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.data;
  }

  take(key: K): V | undefined {
    const val = this.get(key);
    this.map.delete(key);
    return val;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }
}
