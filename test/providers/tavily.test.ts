import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpClient } from '../../src/http/client.js';
import { createTavilyProvider, TAVILY_COSTS } from '../../src/providers/tavily.js';

function fixture(): object {
  const path = fileURLToPath(new URL('../fixtures/tavily/search.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as object;
}

const SEARCH = fixture();
const API_KEY = 'tvly-demo-1234567890';

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
  return createTavilyProvider({
    http: createHttpClient({ sleep: async () => undefined, random: () => 0 }),
    apiKey: API_KEY,
  });
}

describe('tavily webSignals', () => {
  it('uses Bearer auth, pins basic depth and maps results', async () => {
    let captured: { headers: Record<string, unknown>; body: Record<string, unknown> } | undefined;
    agent
      .get('https://api.tavily.com')
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
      query: '"Northwind Labs" launches',
      topic: 'news',
      include_domains: ['northwind.example'],
      start_date: '2026-01-01',
      max_results: 5,
    });

    expect(captured?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(captured?.body).toMatchObject({
      query: '"Northwind Labs" launches',
      search_depth: 'basic',
      topic: 'news',
      include_published_date: true,
      max_results: 5,
      include_domains: ['northwind.example'],
      start_date: '2026-01-01',
    });
    expect(results).toHaveLength(1);
    expect(results[0].published_at).toBe('2026-05-02');
    expect(results[0].source).toBe('tavily');
    expect(results[0].score).toBe(0.93);
  });

  it('exposes 1 credit per basic search', () => {
    expect(TAVILY_COSTS).toEqual({ webSignals: 1 });
  });
});
