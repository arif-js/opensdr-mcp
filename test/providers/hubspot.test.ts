import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpClient } from '../../src/http/client.js';
import { createHubspotProvider } from '../../src/providers/hubspot.js';

const API_KEY = 'hubspot-token-1234567890';

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

function provider(maxRetries = 0) {
  return createHubspotProvider({
    http: createHttpClient({ sleep: async () => undefined, random: () => 0, maxRetries }),
    apiKey: API_KEY,
  });
}

describe('hubspot upsertContacts', () => {
  it('chunks over 100 contacts into multiple requests', async () => {
    let requests = 0;
    let totalInputs = 0;
    agent
      .get('https://api.hubapi.com')
      .intercept({ path: '/crm/v3/objects/contacts/batch/upsert', method: 'POST' })
      .reply((options) => {
        requests += 1;
        const body = JSON.parse(String(options.body)) as { inputs: { id: string }[] };
        totalInputs += body.inputs.length;
        return {
          statusCode: 200,
          data: {
            results: body.inputs.map((input, index) => ({
              id: `hs_${index}`,
              properties: { email: input.id },
            })),
          },
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      })
      .persist();

    const contacts = Array.from({ length: 150 }, (_, index) => ({
      email: `p${index}@acme.example`,
    }));
    const result = await provider().upsertContacts(contacts);

    expect(requests).toBe(2);
    expect(totalInputs).toBe(150);
    expect(result.upserted).toBe(150);
  });

  it('sends idProperty email and maps per-contact results', async () => {
    let captured:
      | { inputs: { id: string; idProperty: string; properties: Record<string, string> }[] }
      | undefined;
    agent
      .get('https://api.hubapi.com')
      .intercept({ path: '/crm/v3/objects/contacts/batch/upsert', method: 'POST' })
      .reply((options) => {
        captured = JSON.parse(String(options.body));
        return {
          statusCode: 200,
          data: { results: [{ id: 'hs_1', properties: { email: 'a@acme.example' } }] },
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const result = await provider().upsertContacts([
      {
        email: 'a@acme.example',
        first_name: 'A',
        company: 'Acme',
        properties: { lifecyclestage: 'lead' },
      },
    ]);

    expect(captured?.inputs[0]).toMatchObject({
      id: 'a@acme.example',
      idProperty: 'email',
      properties: {
        email: 'a@acme.example',
        firstname: 'A',
        company: 'Acme',
        lifecyclestage: 'lead',
      },
    });
    expect(result.results[0]).toEqual({ email: 'a@acme.example', id: 'hs_1', action: 'updated' });
  });

  it('matches batch results by email, not by position', async () => {
    agent
      .get('https://api.hubapi.com')
      .intercept({ path: '/crm/v3/objects/contacts/batch/upsert', method: 'POST' })
      .reply(() => ({
        statusCode: 200,
        data: {
          results: [
            { id: 'hs_b', properties: { email: 'b@acme.example' } },
            { id: 'hs_a', properties: { email: 'a@acme.example' } },
          ],
        },
        responseOptions: { headers: { 'content-type': 'application/json' } },
      }));

    const result = await provider().upsertContacts([
      { email: 'a@acme.example' },
      { email: 'b@acme.example' },
    ]);
    const byEmail = new Map(result.results.map((entry) => [entry.email, entry.id]));
    expect(byEmail.get('a@acme.example')).toBe('hs_a');
    expect(byEmail.get('b@acme.example')).toBe('hs_b');
  });

  it('marks contacts failed instead of guessing when results lack emails and counts differ', async () => {
    agent
      .get('https://api.hubapi.com')
      .intercept({ path: '/crm/v3/objects/contacts/batch/upsert', method: 'POST' })
      .reply(() => ({
        statusCode: 200,
        data: { results: [{ id: 'hs_only' }] },
        responseOptions: { headers: { 'content-type': 'application/json' } },
      }));

    const result = await provider().upsertContacts([
      { email: 'a@acme.example' },
      { email: 'b@acme.example' },
    ]);
    expect(result.results).toHaveLength(0);
    expect(result.failed.map((entry) => entry.email)).toEqual(['a@acme.example', 'b@acme.example']);
  });

  it('maps a 403 to PERMISSION_DENIED with a scope hint', async () => {
    agent
      .get('https://api.hubapi.com')
      .intercept({ path: '/crm/v3/objects/contacts/batch/upsert', method: 'POST' })
      .reply(
        403,
        { message: 'missing scopes', category: 'MISSING_SCOPES' },
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    try {
      await provider().upsertContacts([{ email: 'a@acme.example' }]);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'PERMISSION_DENIED' });
      expect((error as { hint?: string }).hint ?? '').toContain('crm.objects.contacts.write');
    }
  });
});

describe('hubspot readContacts', () => {
  it('reads by email with idProperty', async () => {
    let captured: { idProperty: string; inputs: { id: string }[] } | undefined;
    agent
      .get('https://api.hubapi.com')
      .intercept({ path: '/crm/v3/objects/contacts/batch/read', method: 'POST' })
      .reply((options) => {
        captured = JSON.parse(String(options.body));
        return {
          statusCode: 200,
          data: {
            results: [
              { id: 'hs_1', properties: { email: 'a@acme.example', jobtitle: 'Existing' } },
            ],
          },
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const found = await provider().readContacts(['a@acme.example']);
    expect(captured?.idProperty).toBe('email');
    expect(found.get('a@acme.example')).toMatchObject({ jobtitle: 'Existing' });
  });
});

describe('hubspot createNote', () => {
  it('creates a note and associates it with the contact', async () => {
    let noteBody: unknown;
    let associationPath = '';
    agent
      .get('https://api.hubapi.com')
      .intercept({ path: '/crm/v3/objects/notes', method: 'POST' })
      .reply((options) => {
        noteBody = JSON.parse(String(options.body));
        return {
          statusCode: 201,
          data: { id: 'note_1' },
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });
    agent
      .get('https://api.hubapi.com')
      .intercept({ path: (path) => path.includes('/associations/notes/'), method: 'PUT' })
      .reply((options) => {
        associationPath = options.path;
        return {
          statusCode: 200,
          data: {},
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const note = await provider().createNote('hs_1', 'hello');
    expect(note).toEqual({ id: 'note_1' });
    expect((noteBody as { properties: { hs_note_body: string } }).properties.hs_note_body).toBe(
      'hello',
    );
    expect(associationPath).toContain(
      '/crm/v3/objects/contacts/hs_1/associations/notes/note_1/202',
    );
  });

  it('does not retry the non-idempotent note create', async () => {
    let attempts = 0;
    agent
      .get('https://api.hubapi.com')
      .intercept({ path: '/crm/v3/objects/notes', method: 'POST' })
      .reply(() => {
        attempts += 1;
        return { statusCode: 503, data: { message: 'unavailable' } };
      });
    await expect(provider(3).createNote('hs_1', 'hi')).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
    expect(attempts).toBe(1);
  });
});
