import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuppressionStore } from '../../src/store/suppression.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opensdr-suppression-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function store(): SuppressionStore {
  return new SuppressionStore({ path: path.join(dir, 'suppression.json') });
}

describe('SuppressionStore', () => {
  it('suppresses a domain and its subdomains but not look-alikes', async () => {
    const suppression = store();
    await suppression.add({ domains: ['acme.com'] });

    expect(await suppression.isSuppressed({ email: 'x@acme.com' })).toMatchObject({
      suppressed: true,
    });
    expect(await suppression.isSuppressed({ email: 'y@eu.acme.com' })).toMatchObject({
      suppressed: true,
    });
    expect(await suppression.isSuppressed({ email: 'z@notacme.com' })).toMatchObject({
      suppressed: false,
    });
  });

  it('checks the email domain even when a different company domain is passed', async () => {
    const suppression = store();
    await suppression.add({ domains: ['acme.com'] });
    // Prospect email is on a suppressed domain but their company domain is not.
    expect(
      await suppression.isSuppressed({ email: 'jane@acme.com', domain: 'acme.io' }),
    ).toMatchObject({ suppressed: true });
    // And the reverse: the company domain is suppressed but the email domain is not.
    await suppression.add({ domains: ['blocked.example'] });
    expect(
      await suppression.isSuppressed({ email: 'jane@other.example', domain: 'blocked.example' }),
    ).toMatchObject({ suppressed: true });
  });

  it('suppresses an exact email', async () => {
    const suppression = store();
    await suppression.add({ emails: ['Opt.Out@Acme.com'], reason: 'opt-out' });
    const result = await suppression.isSuppressed({ email: 'opt.out@acme.com' });
    expect(result).toMatchObject({ suppressed: true, reason: 'opt-out' });
    expect(result.matched?.type).toBe('email');
  });

  it('add is idempotent', async () => {
    const suppression = store();
    const first = await suppression.add({ emails: ['a@acme.com'], domains: ['acme.com'] });
    expect(first.added_emails).toBe(1);
    const second = await suppression.add({ emails: ['a@acme.com'], domains: ['acme.com'] });
    expect(second.added_emails).toBe(0);
    expect(second.total_emails).toBe(1);
  });

  it('remove requires the exact value', async () => {
    const suppression = store();
    await suppression.add({ domains: ['acme.com'] });
    expect(await suppression.remove('other.com')).toBe(false);
    expect(await suppression.remove('acme.com')).toBe(true);
    expect(await suppression.isSuppressed({ domain: 'acme.com' })).toMatchObject({
      suppressed: false,
    });
  });

  it('checks a mix of emails and domains', async () => {
    const suppression = store();
    await suppression.add({ domains: ['acme.com'] });
    const results = await suppression.check(['x@acme.com', 'loud.example', 'acme.com']);
    expect(results.map((entry) => entry.suppressed)).toEqual([true, false, true]);
  });

  it('lists entries with pagination', async () => {
    const suppression = store();
    await suppression.add({ domains: ['a.com', 'b.com', 'c.com'] });
    const page = await suppression.list({ limit: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.next_cursor).toBeTruthy();
    const next = await suppression.list({ limit: 2, cursor: page.next_cursor });
    expect(next.entries).toHaveLength(1);
    expect(next.next_cursor).toBeNull();
  });
});
