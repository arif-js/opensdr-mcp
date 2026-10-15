import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpClient } from '../../src/http/client.js';
import { createExaProvider, EXA_COSTS } from '../../src/providers/exa.js';

function fixture(): object {
  const path = fileURLToPath(new URL('../fixtures/exa/search.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as object;
}

const SEARCH = fixture();
const API_KEY = 'exa-key-1234567890';

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
  return createExaProvider({
    http: createHttpClient({ sleep: async () => undefined, random: () => 0 }),
    apiKey: API_KEY,
  });
}

describe('exa webSignals', () => {
  it('maps the query to Exa fields and the response to WebResult', async () => {
    let captured: { headers: Record<string, unknown>; body: Record<string, unknown> } | undefined;
    agent
      .get('https://api.exa.ai')
      .intercept({ path: '/search', method: 'POST' })
      .reply((options) => {
        captured = {
          headers: options.headers as Record<string, unknown>,
          body: JSON.parse(String(options.body)) as Record<string, unknown>,
        };
        return {
          statusCode: 200,
          data: SEARCH,
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const results = await provider().search({
      query: '"Northwind Labs" raises',
      include_domains: ['northwind.example'],
      start_date: '2026-01-01',
      topic: 'news',
      max_results: 5,
    });

    expect(captured?.headers['x-api-key']).toBe(API_KEY);
    expect(captured?.body).toMatchObject({
      query: '"Northwind Labs" raises',
      type: 'auto',
      numResults: 5,
      includeDomains: ['northwind.example'],
      startPublishedDate: '2026-01-01',
      category: 'news',
    });
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://news.example/northwind/series-b');
    expect(results[0].published_at).toBe('2026-05-01T00:00:00.000Z');
    expect(results[0].source).toBe('exa');
    expect(results[0].excerpt).not.toContain('<');
    expect(results[0].excerpt).toContain('raised');
  });

  it('exposes a nominal 1-unit cost', () => {
    expect(EXA_COSTS).toEqual({ webSignals: 1 });
  });
});
