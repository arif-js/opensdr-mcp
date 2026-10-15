import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { DnsResolver } from '../../src/engine/email-validator.js';
import { createHttpClient, type FetchLike } from '../../src/http/client.js';
import type { EmailCheck } from '../../src/types.js';
import { testConfig, testContext } from '../helpers/context.js';
import { jsonOf, linkClient } from '../helpers/mcp.js';

const dirs: string[] = [];

const okDns: DnsResolver = {
  resolveMx: async () => [{ exchange: 'mx.example', priority: 1 }],
  resolve4: async () => [],
  resolve6: async () => [],
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opensdr-enrich-'));
  dirs.push(dir);
  return dir;
}

function fixture(name: string): object {
  const dir = name.startsWith('hunter') ? 'hunter' : 'apollo';
  const file = name.replace('hunter:', '').replace('apollo:', '');
  const p = fileURLToPath(new URL(`../fixtures/${dir}/${file}`, import.meta.url));
  return JSON.parse(readFileSync(p, 'utf8')) as object;
}

interface WaterfallEnvelope {
  ok: boolean;
  data: {
    results: {
      input_index: number;
      person: { email?: string; company?: { domain?: string } } | null;
      email_check: EmailCheck | null;
      outcome: string;
    }[];
    summary: {
      found: number;
      verified: number;
      not_found: number;
      skipped: number;
      credits_used_estimate: number;
    };
  };
  meta: { demo: boolean; credits_used_estimate: number };
  warnings: string[];
}

interface ErrorBody {
  ok: false;
  error: { code: string; message: string; hint?: string };
}

describe('sdr_waterfall_enrich_person (demo)', () => {
  it('is deterministic and returns a mix of outcomes', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const people = [
        'Jane',
        'Marcus',
        'Priya',
        'Diego',
        'Amara',
        'Wei',
        'Sofia',
        'Omar',
        'Lena',
        'Noah',
      ].map((first) => ({ first_name: first, last_name: 'Tester', domain: 'northwind.example' }));
      const call = () =>
        linked.client.callTool({
          name: 'sdr_waterfall_enrich_person',
          arguments: { people, force_refresh: true },
        });
      const first = jsonOf<WaterfallEnvelope>(await call());
      const second = jsonOf<WaterfallEnvelope>(await call());

      expect(first.data.results).toEqual(second.data.results);
      const outcomes = new Set(first.data.results.map((result) => result.outcome));
      expect(outcomes.size).toBeGreaterThanOrEqual(2);
      for (const outcome of outcomes) expect(['found', 'not_found']).toContain(outcome);
      for (const result of first.data.results) {
        if (result.email_check) expect(result.email_check.email).toMatch(/\.example$/);
      }
      expect(first.meta.credits_used_estimate).toBe(0);
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_waterfall_enrich_person (live)', () => {
  it('returns a verified email and always sends reveal flags false', async () => {
    const bodies: Record<string, unknown>[] = [];
    const match = fixture('apollo:people-match.json');
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.includes('/people/match')) {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(match), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const ctx = testContext({
      config: testConfig({ APOLLO_API_KEY: 'apollo-key-1234567890', OPENSDR_DATA_DIR: tmpDir() }),
      deps: {
        http: createHttpClient({ fetchImpl, sleep: async () => undefined, random: () => 0 }),
      },
      dns: okDns,
    });
    const linked = await linkClient(ctx);
    try {
      const envelope = jsonOf<WaterfallEnvelope>(
        await linked.client.callTool({
          name: 'sdr_waterfall_enrich_person',
          arguments: {
            people: [{ first_name: 'Jordan', last_name: 'Blake', domain: 'northwind.example' }],
          },
        }),
      );
      expect(envelope.data.results[0].email_check?.status).toBe('verified');
      expect(bodies[0]).toMatchObject({
        reveal_personal_emails: false,
        reveal_phone_number: false,
      });
      expect(envelope.meta.credits_used_estimate).toBe(1);
      expect(ctx.session.creditsUsed).toBe(1);
    } finally {
      await linked.close();
    }
  });

  it('returns NOT_CONFIGURED when no email-capable provider is set and no email is given', async () => {
    const linked = await linkClient(
      testContext({
        config: testConfig({ EXA_API_KEY: 'exa-key-1234567890', OPENSDR_DATA_DIR: tmpDir() }),
      }),
    );
    try {
      const result = await linked.client.callTool({
        name: 'sdr_waterfall_enrich_person',
        arguments: { people: [{ first_name: 'A', last_name: 'B', domain: 'c.example' }] },
      });
      expect(result.isError).toBe(true);
      expect(jsonOf<ErrorBody>(result).error.code).toBe('NOT_CONFIGURED');
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_enrich_company (demo)', () => {
  it('returns .example companies', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const envelope = jsonOf<{
        ok: boolean;
        data: {
          companies: { domain: string; company: { name: string } | null; outcome: string }[];
        };
      }>(
        await linked.client.callTool({
          name: 'sdr_enrich_company',
          arguments: { domains: ['northwind.example'] },
        }),
      );
      expect(envelope.data.companies[0].outcome).toBe('found');
      expect(envelope.data.companies[0].company?.name).toBe('Northwind Labs');
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_verify_email', () => {
  it('runs local checks and caps role addresses at likely (demo)', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const envelope = jsonOf<{
        ok: boolean;
        data: { emails: EmailCheck[]; summary: Record<string, number> };
      }>(
        await linked.client.callTool({
          name: 'sdr_verify_email',
          arguments: { emails: ['jane@northwind.example', 'sales@northwind.example'] },
        }),
      );
      expect(envelope.data.emails[0].status).toBe('unknown');
      expect(envelope.data.emails[0].checks.mx).toBe(true);
      expect(envelope.data.emails[1].status).toBe('likely');
      expect(envelope.data.emails[1].checks.role_based).toBe(true);
    } finally {
      await linked.close();
    }
  });

  it('uses the Hunter verifier in live mode when asked', async () => {
    const verifier = fixture('hunter:email-verifier.json');
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('/email-verifier')) {
        return new Response(JSON.stringify(verifier), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };
    const ctx = testContext({
      config: testConfig({ HUNTER_API_KEY: 'hunter-key-1234567890', OPENSDR_DATA_DIR: tmpDir() }),
      deps: {
        http: createHttpClient({ fetchImpl, sleep: async () => undefined, random: () => 0 }),
      },
      dns: okDns,
    });
    const linked = await linkClient(ctx);
    try {
      const envelope = jsonOf<{ ok: boolean; data: { emails: EmailCheck[] } }>(
        await linked.client.callTool({
          name: 'sdr_verify_email',
          arguments: { emails: ['patrick@stripe.example'], use_provider: true },
        }),
      );
      expect(envelope.data.emails[0].status).toBe('verified');
      expect(ctx.session.creditsUsed).toBe(1);
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_waterfall_enrich_person budget and partial failure', () => {
  it('stops paid calls when the budget runs out and marks the rest skipped', async () => {
    const match = fixture('apollo:people-match.json');
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('/people/match')) {
        return new Response(JSON.stringify(match), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };
    const ctx = testContext({
      config: testConfig({ APOLLO_API_KEY: 'apollo-key-1234567890', OPENSDR_DATA_DIR: tmpDir() }),
      deps: {
        http: createHttpClient({ fetchImpl, sleep: async () => undefined, random: () => 0 }),
      },
      dns: okDns,
    });
    const linked = await linkClient(ctx);
    try {
      const envelope = jsonOf<WaterfallEnvelope>(
        await linked.client.callTool({
          name: 'sdr_waterfall_enrich_person',
          arguments: {
            people: [
              { first_name: 'Jordan', last_name: 'Blake', domain: 'northwind.example' },
              { first_name: 'Second', last_name: 'Person', domain: 'northwind.example' },
            ],
            max_credits: 1,
          },
        }),
      );
      expect(envelope.data.results[0].outcome).toBe('found');
      expect(envelope.data.results[1].outcome).toBe('skipped');
      expect(envelope.data.summary.skipped).toBe(1);
      expect(envelope.meta.credits_used_estimate).toBe(1);
    } finally {
      await linked.close();
    }
  });

  it('is ok:true with a per-item error when one person is unusable', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const envelope = jsonOf<
        WaterfallEnvelope & { data: { results: { outcome: string; error?: { code: string } }[] } }
      >(
        await linked.client.callTool({
          name: 'sdr_waterfall_enrich_person',
          arguments: {
            people: [{ first_name: 'Jordan', last_name: 'Blake', domain: 'northwind.example' }, {}],
            force_refresh: true,
          },
        }),
      );
      expect(envelope.ok).toBe(true);
      expect(envelope.data.results[1].outcome).toBe('error');
      expect(envelope.data.results[1].error?.code).toBe('BAD_INPUT');
    } finally {
      await linked.close();
    }
  });
});

describe('demo enrichment consistency', () => {
  it('enriches the same person the search returned, labelled as demo data', async () => {
    const linked = await linkClient(testContext());
    try {
      const search = jsonOf<{
        data: {
          people: {
            first_name: string;
            last_name: string;
            title: string;
            company: { domain: string; name: string };
          }[];
        };
      }>(
        await linked.client.callTool({
          name: 'sdr_search_people',
          arguments: { job_titles: ['VP Engineering'], limit: 5 },
        }),
      );
      const found = search.data.people.find(Boolean);
      expect(found).toBeDefined();
      const person = found as NonNullable<typeof found>;

      const enriched = jsonOf<{
        data: {
          results: {
            outcome: string;
            person: { title: string; company: { name: string } } | null;
            email_check: { sources: string[] } | null;
          }[];
        };
      }>(
        await linked.client.callTool({
          name: 'sdr_waterfall_enrich_person',
          arguments: {
            people: [
              {
                first_name: person.first_name,
                last_name: person.last_name,
                domain: person.company.domain,
              },
            ],
          },
        }),
      );
      const result = enriched.data.results[0];
      if (result.outcome === 'found') {
        expect(result.person?.title).toBe(person.title);
        expect(result.person?.company.name).toBe(person.company.name);
        expect(result.email_check?.sources).toEqual(['demo']);
      }
    } finally {
      await linked.close();
    }
  });
});
