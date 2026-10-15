import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpClient } from '../../src/http/client.js';
import { registerSecrets } from '../../src/logger.js';
import { APOLLO_COSTS, createApolloProvider } from '../../src/providers/apollo.js';

const fixtureDir = new URL('../fixtures/apollo/', import.meta.url);
function fixture(name: string): object {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, fixtureDir)), 'utf8')) as object;
}

const PEOPLE = fixture('people-api-search.json');
const ORGANIZATIONS = fixture('organization-search.json');
const API_KEY = 'apollo-key-1234567890';

interface Captured {
  headers: Record<string, unknown>;
  body: Record<string, unknown>;
}

let agent: MockAgent;
let original: Dispatcher;

beforeEach(() => {
  original = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  registerSecrets([]);
  setGlobalDispatcher(original);
  await agent.close();
});

function provider() {
  return createApolloProvider({
    http: createHttpClient({ sleep: async () => undefined, random: () => 0 }),
    apiKey: API_KEY,
  });
}

describe('apollo people search', () => {
  it('maps inputs to Apollo params and never returns email or phone', async () => {
    let captured: Captured | undefined;
    agent
      .get('https://api.apollo.io')
      .intercept({ path: '/api/v1/mixed_people/api_search', method: 'POST' })
      .reply((options) => {
        captured = {
          headers: options.headers as Record<string, unknown>,
          body: JSON.parse(String(options.body)) as Record<string, unknown>,
        };
        return {
          statusCode: 200,
          data: PEOPLE,
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const result = await provider().searchPeople(
      {
        titles: ['VP Engineering'],
        seniorities: ['vp'],
        company_domains: ['northwind.example'],
        organization_locations: ['california'],
        employee_ranges: ['51,200'],
        keywords: 'fintech',
      },
      { cursor: null, limit: 10 },
    );

    expect(captured?.headers['x-api-key']).toBe(API_KEY);
    expect(captured?.body).toMatchObject({
      page: 1,
      per_page: 10,
      person_titles: ['VP Engineering'],
      person_seniorities: ['vp'],
      q_organization_domains_list: ['northwind.example'],
      organization_locations: ['california'],
      organization_num_employees_ranges: ['51,200'],
      q_keywords: 'fintech',
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ first_name: 'Elena', sources: ['apollo'] });
    expect(result.items[0].provider_ids.apollo).toBe('000000000000000000000001');
    for (const person of result.items) {
      expect(person).not.toHaveProperty('email');
      expect(person).not.toHaveProperty('phone');
    }
    expect(result.next_cursor).toBe('2');
  });

  it('does not consume credits', () => {
    expect(APOLLO_COSTS.peopleSearch).toBe(0);
  });
});

describe('apollo company search', () => {
  it('maps revenue buckets to revenue_range min/max and maps companies', async () => {
    let captured: Captured | undefined;
    agent
      .get('https://api.apollo.io')
      .intercept({ path: '/api/v1/mixed_companies/search', method: 'POST' })
      .reply((options) => {
        captured = {
          headers: options.headers as Record<string, unknown>,
          body: JSON.parse(String(options.body)) as Record<string, unknown>,
        };
        return {
          statusCode: 200,
          data: ORGANIZATIONS,
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const result = await provider().searchCompanies(
      {
        industries: ['Software'],
        keywords: 'b2b',
        employee_ranges: ['51,200'],
        locations: ['california'],
        technologies: ['salesforce'],
        domains: ['northwind.example'],
        revenue_ranges: [{ min: 1000000, max: 10000000 }],
      },
      { cursor: null, limit: 5 },
    );

    expect(captured?.body).toMatchObject({
      page: 1,
      per_page: 5,
      q_organization_domains_list: ['northwind.example'],
      organization_num_employees_ranges: ['51,200'],
      organization_locations: ['california'],
      currently_using_any_of_technology_uids: ['salesforce'],
      q_organization_keyword_tags: ['Software', 'b2b'],
      'revenue_range[min]': 1000000,
      'revenue_range[max]': 10000000,
    });

    expect(result.items[0]).toMatchObject({
      name: 'Northwind Labs',
      domain: 'northwind.example',
      industry: 'Software',
      employee_count: 120,
      sources: ['apollo'],
    });
    expect(result.items[0].hq_location).toContain('San Francisco');
    expect(result.items[0].funding?.last_round_type).toBe('Series A');
  });
});

describe('apollo error mapping', () => {
  function failing(status: number, body: object, headers: Record<string, string> = {}) {
    agent
      .get('https://api.apollo.io')
      .intercept({ path: '/api/v1/mixed_people/api_search', method: 'POST' })
      .reply(status, body, { headers: { 'content-type': 'application/json', ...headers } });
  }

  function client() {
    return createApolloProvider({
      http: createHttpClient({ sleep: async () => undefined, random: () => 0, maxRetries: 0 }),
      apiKey: API_KEY,
    });
  }

  const page = { cursor: null, limit: 5 };
  const query = { titles: ['cto'] };

  it('maps 401 to AUTH_FAILED', async () => {
    failing(401, { error: 'Invalid API key' });
    await expect(client().searchPeople(query, page)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('maps a master-key 403 to PERMISSION_DENIED with a hint', async () => {
    failing(403, { error: 'Need master API key' });
    try {
      await client().searchPeople(query, page);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'PERMISSION_DENIED' });
      expect((error as { hint?: string }).hint ?? '').toContain('master');
    }
  });

  it('maps 429 to RATE_LIMITED', async () => {
    failing(429, { error: 'Too many requests' });
    await expect(client().searchPeople(query, page)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('maps 500 to PROVIDER_ERROR', async () => {
    failing(500, { error: 'Server error' });
    await expect(client().searchPeople(query, page)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('never leaks the API key in an error message', async () => {
    registerSecrets([API_KEY]);
    failing(401, { error: `key ${API_KEY} is invalid` });
    try {
      await client().searchPeople(query, page);
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as Error).message).not.toContain(API_KEY);
      expect((error as Error).message).toContain('***');
    }
  });
});
