import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpClient } from '../../src/http/client.js';
import { createApolloProvider } from '../../src/providers/apollo.js';

function fixture(name: string): object {
  const path = fileURLToPath(new URL(`../fixtures/apollo/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as object;
}

const MATCH = fixture('people-match.json');
const ORG = fixture('organization-enrich.json');
const API_KEY = 'apollo-key-1234567890';

let agent: MockAgent;
let original: Dispatcher;

beforeEach(() => {
  original = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  setGlobalDispatcher(original);
  await agent.close();
});

function provider() {
  return createApolloProvider({
    http: createHttpClient({ sleep: async () => undefined, random: () => 0 }),
    apiKey: API_KEY,
  });
}

describe('apollo matchPerson', () => {
  it('always sends reveal flags false and maps the person', async () => {
    let captured: { headers: Record<string, unknown>; body: Record<string, unknown> } | undefined;
    agent
      .get('https://api.apollo.io')
      .intercept({ path: '/api/v1/people/match', method: 'POST' })
      .reply((options) => {
        captured = {
          headers: options.headers as Record<string, unknown>,
          body: JSON.parse(String(options.body)) as Record<string, unknown>,
        };
        return {
          statusCode: 200,
          data: MATCH,
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const match = await provider().matchPerson({
      apollo_id: 'apollo-abc',
      first_name: 'Jordan',
      last_name: 'Blake',
      domain: 'northwind.example',
      company_name: 'Northwind Labs',
    });

    expect(captured?.headers['x-api-key']).toBe(API_KEY);
    expect(captured?.body).toMatchObject({
      reveal_personal_emails: false,
      reveal_phone_number: false,
      id: 'apollo-abc',
      first_name: 'Jordan',
      last_name: 'Blake',
      domain: 'northwind.example',
      organization_name: 'Northwind Labs',
    });
    expect(match?.email).toBe('jordan.blake@northwind.example');
    expect(match?.email_status).toBe('verified');
    expect(match?.confidence).toBe(95);
    expect(match?.person.company?.domain).toBe('northwind.example');
  });

  it('returns null when match_confidence is none', async () => {
    agent
      .get('https://api.apollo.io')
      .intercept({ path: '/api/v1/people/match', method: 'POST' })
      .reply(
        200,
        { person: null, match_confidence: 'none' },
        {
          headers: { 'content-type': 'application/json' },
        },
      );

    await expect(
      provider().matchPerson({ first_name: 'Nobody', last_name: 'Here', domain: 'nope.example' }),
    ).resolves.toBeNull();
  });
});

describe('apollo enrichCompany', () => {
  it('requests by domain and maps the organization', async () => {
    let capturedPath = '';
    agent
      .get('https://api.apollo.io')
      .intercept({ path: /organizations\/enrich/, method: 'GET' })
      .reply((options) => {
        capturedPath = options.path;
        return {
          statusCode: 200,
          data: ORG,
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const company = await provider().enrichCompany('https://www.Northwind.example/about');

    expect(capturedPath).toContain('domain=northwind.example');
    expect(company).toMatchObject({
      name: 'Northwind Labs',
      domain: 'northwind.example',
      industry: 'Software',
      employee_count: 120,
    });
    expect(company?.funding?.last_round_type).toBe('Series A');
  });

  it('returns null when there is no organization', async () => {
    agent
      .get('https://api.apollo.io')
      .intercept({ path: /organizations\/enrich/, method: 'GET' })
      .reply(200, { organization: null }, { headers: { 'content-type': 'application/json' } });

    await expect(provider().enrichCompany('nope.example')).resolves.toBeNull();
  });
});
