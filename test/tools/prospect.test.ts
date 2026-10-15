import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from '../../src/http/client.js';
import type { Company, Person } from '../../src/types.js';
import { testConfig, testContext } from '../helpers/context.js';
import { jsonOf, linkClient } from '../helpers/mcp.js';

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../fixtures/apollo/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

const PEOPLE = fixture('people-api-search.json');
const ORGANIZATIONS = fixture('organization-search.json');
const API_KEY = 'apollo-key-1234567890';

interface Envelope<T> {
  ok: boolean;
  data: T;
  meta: {
    demo: boolean;
    sources: string[];
    next_cursor: string | null;
    credits_used_estimate: number;
  };
  warnings: string[];
}

interface ErrorBody {
  ok: false;
  error: { code: string; message: string; hint?: string };
}

function liveContext(fetchImpl: FetchLike) {
  return testContext({
    config: testConfig({ APOLLO_API_KEY: API_KEY }),
    deps: { http: createHttpClient({ fetchImpl, sleep: async () => undefined, random: () => 0 }) },
  });
}

describe('sdr_lookup_filters', () => {
  it('finds "VP Engineering" for "vp eng" without a network call', async () => {
    const linked = await linkClient(testContext());
    try {
      const envelope = jsonOf<Envelope<{ items: { value: string }[] }>>(
        await linked.client.callTool({
          name: 'sdr_lookup_filters',
          arguments: { kind: 'title', query: 'vp eng' },
        }),
      );
      expect(envelope.ok).toBe(true);
      expect(envelope.data.items.map((item) => item.value)).toContain('VP Engineering');
      expect(envelope.meta.demo).toBe(true);
    } finally {
      await linked.close();
    }
  });
});

describe('demo dataset', () => {
  it('has 60 people across 15 companies, 5 industries and every seniority', async () => {
    const ctx = testContext();
    const people = await ctx.registry
      .get('peopleSearch')
      .searchPeople({}, { cursor: null, limit: 100 });
    expect(people.items.length).toBeGreaterThanOrEqual(60);
    expect(new Set(people.items.map((person) => person.company?.domain)).size).toBe(15);
    expect(new Set(people.items.map((person) => person.seniority)).size).toBe(11);
    for (const person of people.items) {
      expect(person.company?.domain ?? '').toMatch(/\.example$/);
    }
    const companies = await ctx.registry
      .get('companySearch')
      .searchCompanies({}, { cursor: null, limit: 100 });
    expect(new Set(companies.items.map((company) => company.industry)).size).toBe(5);
  });
});

describe('sdr_search_people (demo)', () => {
  it('is deterministic and returns .example data', async () => {
    const linked = await linkClient(testContext());
    try {
      const call = () =>
        linked.client.callTool({
          name: 'sdr_search_people',
          arguments: { job_titles: ['VP Engineering'] },
        });
      const first = jsonOf<Envelope<{ people: Person[] }>>(await call());
      const second = jsonOf<Envelope<{ people: Person[] }>>(await call());
      expect(first.data.people).toEqual(second.data.people);
      expect(first.data.people.length).toBeGreaterThan(0);
      for (const person of first.data.people) {
        expect(person.company?.domain ?? '').toMatch(/\.example$/);
      }
    } finally {
      await linked.close();
    }
  });

  it('requires at least one filter', async () => {
    const linked = await linkClient(testContext());
    try {
      const result = await linked.client.callTool({ name: 'sdr_search_people', arguments: {} });
      expect(result.isError).toBe(true);
      expect(jsonOf<ErrorBody>(result).error.code).toBe('BAD_INPUT');
    } finally {
      await linked.close();
    }
  });

  it('clamps an over-large limit with a warning', async () => {
    const linked = await linkClient(testContext());
    try {
      const envelope = jsonOf<Envelope<{ people: Person[] }>>(
        await linked.client.callTool({
          name: 'sdr_search_people',
          arguments: { person_seniorities: ['vp'], limit: 60 },
        }),
      );
      expect(envelope.warnings.join(' ')).toContain('clamped');
      expect(envelope.data.people.length).toBeLessThanOrEqual(50);
    } finally {
      await linked.close();
    }
  });

  it('round-trips a cursor and rejects a mismatched one', async () => {
    const linked = await linkClient(testContext());
    try {
      const args = { job_titles: ['VP Engineering'], limit: 2 };
      const first = jsonOf<Envelope<{ people: Person[] }>>(
        await linked.client.callTool({ name: 'sdr_search_people', arguments: args }),
      );
      expect(first.meta.next_cursor).toBeTruthy();

      const second = jsonOf<Envelope<{ people: Person[] }>>(
        await linked.client.callTool({
          name: 'sdr_search_people',
          arguments: { ...args, cursor: first.meta.next_cursor },
        }),
      );
      expect(second.data.people.length).toBeGreaterThan(0);
      expect(second.data.people[0].id).not.toBe(first.data.people[0].id);

      const mismatched = await linked.client.callTool({
        name: 'sdr_search_people',
        arguments: { job_titles: ['CTO'], limit: 2, cursor: first.meta.next_cursor },
      });
      expect(mismatched.isError).toBe(true);
      expect(jsonOf<ErrorBody>(mismatched).error.code).toBe('BAD_INPUT');
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_search_people (live)', () => {
  it('maps every input to the Apollo request body and strips emails', async () => {
    const bodies: unknown[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(PEOPLE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const linked = await linkClient(liveContext(fetchImpl));
    try {
      const envelope = jsonOf<Envelope<{ people: Person[] }>>(
        await linked.client.callTool({
          name: 'sdr_search_people',
          arguments: {
            job_titles: ['VP Engineering'],
            person_seniorities: ['vp'],
            person_locations: ['California, US'],
            organization_domains: ['https://www.Northwind.example/'],
            organization_locations: ['california'],
            employee_ranges: ['51,200'],
            keywords: 'fintech',
            limit: 5,
          },
        }),
      );
      expect(bodies[0]).toMatchObject({
        page: 1,
        per_page: 5,
        person_titles: ['VP Engineering'],
        person_seniorities: ['vp'],
        person_locations: ['California, US'],
        q_organization_domains_list: ['northwind.example'],
        organization_locations: ['california'],
        organization_num_employees_ranges: ['51,200'],
        q_keywords: 'fintech',
      });
      expect(envelope.meta.sources).toEqual(['apollo']);
      expect(envelope.meta.demo).toBe(false);
      for (const person of envelope.data.people) {
        expect(person).not.toHaveProperty('email');
      }
    } finally {
      await linked.close();
    }
  });

  it('returns NOT_CONFIGURED naming APOLLO_API_KEY when it is missing', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ HUNTER_API_KEY: 'hunter-key-1234567890' }) }),
    );
    try {
      const result = await linked.client.callTool({
        name: 'sdr_search_people',
        arguments: { job_titles: ['CTO'] },
      });
      expect(result.isError).toBe(true);
      const body = jsonOf<ErrorBody>(result);
      expect(body.error.code).toBe('NOT_CONFIGURED');
      expect(body.error.hint ?? '').toContain('APOLLO_API_KEY');
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_search_companies', () => {
  it('filters demo companies by revenue bucket with .example domains', async () => {
    const linked = await linkClient(testContext());
    try {
      const envelope = jsonOf<Envelope<{ companies: Company[] }>>(
        await linked.client.callTool({
          name: 'sdr_search_companies',
          arguments: { revenue_ranges: ['$10M-$50M'] },
        }),
      );
      expect(envelope.ok).toBe(true);
      expect(envelope.data.companies.length).toBeGreaterThan(0);
      for (const company of envelope.data.companies) {
        expect(company.domain ?? '').toMatch(/\.example$/);
      }
    } finally {
      await linked.close();
    }
  });

  it('rejects an unknown revenue bucket', async () => {
    const linked = await linkClient(testContext());
    try {
      const result = await linked.client.callTool({
        name: 'sdr_search_companies',
        arguments: { revenue_ranges: ['$9B'] },
      });
      expect(result.isError).toBe(true);
      expect(jsonOf<ErrorBody>(result).error.code).toBe('BAD_INPUT');
    } finally {
      await linked.close();
    }
  });

  it('charges the credit estimate in live mode', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify(ORGANIZATIONS), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const ctx = liveContext(fetchImpl);
    const linked = await linkClient(ctx);
    try {
      const envelope = jsonOf<Envelope<{ companies: Company[] }>>(
        await linked.client.callTool({
          name: 'sdr_search_companies',
          arguments: { industries: ['Software'] },
        }),
      );
      expect(envelope.meta.credits_used_estimate).toBe(1);
      expect(ctx.session.creditsUsed).toBe(1);
      expect(envelope.data.companies[0].domain).toBe('northwind.example');
    } finally {
      await linked.close();
    }
  });
});
