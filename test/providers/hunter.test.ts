import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpClient } from '../../src/http/client.js';
import { createHunterProvider, HUNTER_COSTS } from '../../src/providers/hunter.js';

function fixture(name: string): object {
  const path = fileURLToPath(new URL(`../fixtures/hunter/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as object;
}

const FINDER = fixture('email-finder.json');
const VERIFIER = fixture('email-verifier.json');
const API_KEY = 'hunter-key-1234567890';

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

function provider(maxRetries = 3) {
  return createHunterProvider({
    http: createHttpClient({ sleep: async () => undefined, random: () => 0, maxRetries }),
    apiKey: API_KEY,
  });
}

describe('hunter findEmail', () => {
  it('sends the X-API-KEY header and maps the finding', async () => {
    let captured: { path: string; headers: Record<string, unknown> } | undefined;
    agent
      .get('https://api.hunter.io')
      .intercept({ path: /\/v2\/email-finder/, method: 'GET' })
      .reply((options) => {
        captured = { path: options.path, headers: options.headers as Record<string, unknown> };
        return {
          statusCode: 200,
          data: FINDER,
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const finding = await provider().findEmail({
      first_name: 'Alexis',
      last_name: 'Ohanian',
      domain: 'reddit.example',
    });

    expect(captured?.headers['x-api-key']).toBe(API_KEY);
    expect(captured?.path).toContain('domain=reddit.example');
    expect(captured?.path).toContain('first_name=Alexis');
    expect(captured?.path).toContain('last_name=Ohanian');
    expect(finding).toEqual({
      email: 'alexis@reddit.example',
      score: 97,
      sources: ['https://redditblog.example/post'],
    });
  });

  it('returns null when no email is found', async () => {
    agent
      .get('https://api.hunter.io')
      .intercept({ path: /\/v2\/email-finder/, method: 'GET' })
      .reply(
        200,
        { data: { email: null, score: null } },
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    await expect(
      provider().findEmail({ first_name: 'No', last_name: 'Body', domain: 'nope.example' }),
    ).resolves.toBeNull();
  });
});

describe('hunter verifyEmail', () => {
  const statuses: [string, string][] = [
    ['valid', 'verified'],
    ['invalid', 'invalid'],
    ['accept_all', 'accept_all'],
    ['webmail', 'verified'],
    ['disposable', 'invalid'],
    ['unknown', 'unknown'],
  ];

  for (const [raw, mapped] of statuses) {
    it(`maps Hunter status "${raw}" to "${mapped}"`, async () => {
      agent
        .get('https://api.hunter.io')
        .intercept({ path: /\/v2\/email-verifier/, method: 'GET' })
        .reply(
          200,
          { data: { email: 'x@y.example', status: raw } },
          {
            headers: { 'content-type': 'application/json' },
          },
        );
      const verdict = await provider().verifyEmail('x@y.example');
      expect(verdict.status).toBe(mapped);
      expect(verdict.provider_result).toBe(raw);
    });
  }

  it('maps the documented success fixture', async () => {
    agent
      .get('https://api.hunter.io')
      .intercept({ path: /\/v2\/email-verifier/, method: 'GET' })
      .reply(200, VERIFIER, { headers: { 'content-type': 'application/json' } });
    const verdict = await provider().verifyEmail('patrick@stripe.example');
    expect(verdict.status).toBe('verified');
  });
});

describe('hunter error mapping', () => {
  it('maps a 403 rate limit to RATE_LIMITED', async () => {
    agent
      .get('https://api.hunter.io')
      .intercept({ path: /\/v2\/email-finder/, method: 'GET' })
      .reply(
        403,
        { errors: [{ id: 'rate_limit', code: 403 }] },
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    await expect(
      provider(0).findEmail({ first_name: 'A', last_name: 'B', domain: 'c.example' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('maps a 451 legal takedown to SUPPRESSED', async () => {
    agent
      .get('https://api.hunter.io')
      .intercept({ path: /\/v2\/email-verifier/, method: 'GET' })
      .reply(
        451,
        { errors: [{ id: 'claimed_email', code: 451 }] },
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    await expect(provider(0).verifyEmail('claimed@x.example')).rejects.toMatchObject({
      code: 'SUPPRESSED',
    });
  });

  it('exposes 1-credit costs', () => {
    expect(HUNTER_COSTS).toEqual({ findEmail: 1, verifyEmail: 1 });
  });
});
