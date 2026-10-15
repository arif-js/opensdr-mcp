import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnrichmentCache } from '../../src/store/cache.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opensdr-cache-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function cacheAt(now: () => Date, ttlDays = 30, pruneIntervalMs?: number): EnrichmentCache {
  return new EnrichmentCache({
    path: path.join(dir, 'cache.json'),
    ttlDays,
    now,
    pruneIntervalMs,
  });
}

describe('EnrichmentCache', () => {
  it('stores and reads a value', async () => {
    const cache = cacheAt(() => new Date('2026-01-01T00:00:00.000Z'));
    await cache.set('email:a@b.example', { ok: true }, 'hunter');
    expect(await cache.get('email:a@b.example')).toEqual({ ok: true });
  });

  it('returns null for a miss', async () => {
    const cache = cacheAt(() => new Date('2026-01-01T00:00:00.000Z'));
    expect(await cache.get('email:missing@b.example')).toBeNull();
  });

  it('expires entries after the TTL', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const cache = cacheAt(() => now, 1);
    await cache.set('company:acme.example', { name: 'Acme' }, 'apollo');

    now = new Date('2026-01-03T00:00:00.000Z');
    expect(await cache.get('company:acme.example')).toBeNull();
  });

  it('prunes expired entries on write after the prune interval', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const cache = cacheAt(() => now, 1, 60 * 60 * 1000);
    await cache.set('company:old.example', { name: 'Old' }, 'apollo');

    now = new Date('2026-01-03T00:00:00.000Z');
    await cache.set('company:new.example', { name: 'New' }, 'apollo');

    const raw = JSON.parse(await fs.readFile(path.join(dir, 'cache.json'), 'utf8'));
    expect(Object.keys(raw.entries)).toEqual(['company:new.example']);
  });

  it('prune() removes only expired entries', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const cache = cacheAt(() => now, 1);
    await cache.set('a', 1, 'demo');
    now = new Date('2026-01-01T12:00:00.000Z');
    await cache.set('b', 2, 'demo');
    now = new Date('2026-01-03T00:00:00.000Z');
    await cache.prune();

    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
  });
});
