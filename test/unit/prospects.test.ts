import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProspectStore, prospectDedupeKey, prospectIdFor } from '../../src/store/prospects.js';
import type { EmailStatus } from '../../src/types.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opensdr-prospects-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function store(name = 'prospects.json'): ProspectStore {
  return new ProspectStore({ path: path.join(dir, name) });
}

const JANE = { linkedin_url: 'https://www.linkedin.com/in/jane-doe' };

describe('prospect identity', () => {
  it('is stable for the same dedupe key', () => {
    const key = prospectDedupeKey({ email: 'Jane@Acme.com' });
    expect(key).toBe('email:jane@acme.com');
    expect(prospectIdFor(key ?? '')).toMatch(/^p_[0-9a-f]{12}$/);
  });

  it('prefers email, then linkedin, then apollo id, then name + domain', () => {
    expect(
      prospectDedupeKey({
        email: 'a@b.com',
        linkedin_url: 'x',
        provider_ids: { apollo: 'y' },
        full_name: 'A B',
        company: { domain: 'b.com' },
      }),
    ).toBe('email:a@b.com');
    expect(
      prospectDedupeKey({
        provider_ids: { apollo: 'y' },
        full_name: 'A B',
        company: { domain: 'b.com' },
      }),
    ).toBe('apollo:y');
    expect(prospectDedupeKey({ full_name: 'A B', company: { domain: 'b.com' } })).toBe(
      'name:a b@b.com',
    );
  });
});

describe('ProspectStore.upsert merge', () => {
  it('keeps the email when the same person is saved without one first', async () => {
    const prospects = store();
    await prospects.upsert([{ person: { ...JANE, first_name: 'Jane', last_name: 'Doe' } }], {
      list: 'vpe',
    });
    await prospects.upsert(
      [{ person: { ...JANE, email: 'jane@acme.example', email_status: 'verified' } }],
      { list: 'vpe' },
    );

    const result = await prospects.query({ list: 'vpe', limit: 10 });
    expect(result.prospects).toHaveLength(1);
    expect(result.prospects[0].email).toBe('jane@acme.example');
    expect(result.prospects[0].email_status).toBe('verified');
  });

  it('never downgrades email_status under fill_missing', async () => {
    const cases: [EmailStatus, EmailStatus, EmailStatus][] = [
      ['verified', 'likely', 'verified'],
      ['likely', 'verified', 'verified'],
      ['unknown', 'likely', 'likely'],
      ['unknown', 'invalid', 'unknown'],
      ['invalid', 'verified', 'verified'],
      ['accept_all', 'likely', 'likely'],
    ];
    for (const [stored, incoming, expected] of cases) {
      const prospects = store(`merge-${stored}-${incoming}.json`);
      await prospects.upsert([{ person: { ...JANE, email_status: stored } }], { list: 'x' });
      await prospects.upsert([{ person: { ...JANE, email_status: incoming } }], { list: 'x' });
      const result = await prospects.query({ list: 'x', limit: 1 });
      expect(result.prospects[0].email_status).toBe(expected);
    }
  });

  it('overwrite lets the incoming status win', async () => {
    const prospects = store('overwrite.json');
    await prospects.upsert([{ person: { ...JANE, email_status: 'verified' } }], { list: 'x' });
    await prospects.upsert([{ person: { ...JANE, email_status: 'invalid' } }], {
      list: 'x',
      merge: 'overwrite',
    });
    const result = await prospects.query({ list: 'x', limit: 1 });
    expect(result.prospects[0].email_status).toBe('invalid');
  });

  it('fill_missing never blanks a field', async () => {
    const prospects = store('fill.json');
    await prospects.upsert([{ person: { ...JANE, title: 'VP Engineering' } }], { list: 'x' });
    await prospects.upsert([{ person: { ...JANE, title: '' } }], { list: 'x' });
    const result = await prospects.query({ list: 'x', limit: 1 });
    expect(result.prospects[0].title).toBe('VP Engineering');
  });

  it('applies a patch to an existing prospect and errors on an unknown id', async () => {
    const prospects = store('patch.json');
    const created = await prospects.upsert([{ person: { ...JANE, email: 'j@acme.example' } }], {
      list: 'x',
    });
    const id = created.results[0].prospect_id ?? '';
    const patched = await prospects.upsert(
      [
        {
          prospect_id: id,
          patch: { custom_fields: { first_line: 'Saw your Series A' }, status: 'enriched' },
        },
        { prospect_id: 'p_missing', patch: { status: 'queued' } },
      ],
      { list: 'x' },
    );
    expect(patched.results[0].outcome).toBe('updated');
    expect(patched.results[1].outcome).toBe('error');
    expect(patched.results[1].error?.code).toBe('NOT_FOUND');

    const prospect = await prospects.get(id);
    expect(prospect?.custom_fields.first_line).toBe('Saw your Series A');
    expect(prospect?.status).toBe('enriched');
  });

  it('errors on a person with no identity', async () => {
    const prospects = store('noid.json');
    const result = await prospects.upsert([{ person: { first_name: 'No' } }], { list: 'x' });
    expect(result.results[0].outcome).toBe('error');
    expect(result.results[0].error?.code).toBe('BAD_INPUT');
  });
});

describe('ProspectStore query and lists', () => {
  it('filters and paginates', async () => {
    const prospects = store('query.json');
    await prospects.upsert(
      [
        { person: { email: 'a@acme.example', email_status: 'verified' } },
        { person: { email: 'b@other.example' } },
        { person: { email: 'c@acme.example', email_status: 'verified' } },
      ],
      { list: 'acme' },
    );
    const page = await prospects.query({ list: 'acme', limit: 2 });
    expect(page.total).toBe(3);
    expect(page.prospects).toHaveLength(2);
    expect(page.next_cursor).toBeTruthy();
    const verified = await prospects.query({ list: 'acme', email_status: ['verified'], limit: 10 });
    expect(verified.total).toBe(2);
    const search = await prospects.query({ search: 'other.example', limit: 10 });
    expect(search.total).toBe(1);
  });

  it('summarises lists after mixed updates', async () => {
    const prospects = store('summary.json');
    await prospects.upsert(
      [
        { person: { email: 'a@acme.example', email_status: 'verified' } },
        { person: { email: 'b@acme.example' } },
      ],
      { list: 'acme' },
    );
    await prospects.upsert([{ person: { email: 'c@other.example' } }], { list: 'other' });

    const summaries = await prospects.listsSummary();
    const acme = summaries.find((entry) => entry.name === 'acme');
    expect(acme).toMatchObject({ count: 2, with_email: 2, verified: 1 });
  });

  it('deletes a list without deleting prospects', async () => {
    const prospects = store('delete.json');
    const created = await prospects.upsert([{ person: { email: 'a@acme.example' } }], {
      list: 'acme',
    });
    const id = created.results[0].prospect_id ?? '';
    await prospects.deleteList('acme');
    expect(await prospects.get(id)).not.toBeNull();
    expect((await prospects.get(id))?.list).toEqual([]);
    expect(await prospects.listsSummary()).toEqual([]);
  });
});

describe('ProspectStore concurrency', () => {
  it('does not lose writes from two instances', async () => {
    const a = store('concurrent.json');
    const b = store('concurrent.json');
    await Promise.all([
      Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          a.upsert([{ person: { email: `a${index}@acme.example` } }], { list: 'x' }),
        ),
      ),
      Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          b.upsert([{ person: { email: `b${index}@acme.example` } }], { list: 'x' }),
        ),
      ),
    ]);
    const result = await a.query({ list: 'x', limit: 100 });
    expect(result.total).toBe(20);
  });
});
