import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpClient } from '../../src/http/client.js';
import { buildCreateCampaignBody, createInstantlyProvider } from '../../src/providers/instantly.js';
import type { CampaignSpec } from '../../src/providers/types.js';

const API_KEY = 'instantly-key-1234567890';
const SPEC: CampaignSpec = {
  name: 'Q1 Founders',
  steps: [
    { subject: 'Hi {{first_name}}', body: 'Opener. Unsubscribe any time.', delay_days: 0 },
    { subject: 'Following up', body: 'Value. Unsubscribe any time.', delay_days: 3 },
  ],
  schedule: {
    timezone: 'America/New_York',
    days: ['mon', 'tue', 'wed'],
    start_hour: 9,
    end_hour: 17,
  },
};

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
  return createInstantlyProvider({
    http: createHttpClient({ sleep: async () => undefined, random: () => 0, maxRetries }),
    apiKey: API_KEY,
  });
}

describe('instantly createCampaign', () => {
  it('never activates and maps the documented status code', async () => {
    let captured:
      | { headers: Record<string, unknown>; body: Record<string, unknown>; path: string }
      | undefined;
    agent
      .get('https://api.instantly.ai')
      .intercept({ path: '/api/v2/campaigns', method: 'POST' })
      .reply((options) => {
        captured = {
          headers: options.headers as Record<string, unknown>,
          body: JSON.parse(String(options.body)) as Record<string, unknown>,
          path: options.path,
        };
        return {
          statusCode: 200,
          data: { id: 'camp_1', name: 'Q1 Founders', status: 1 },
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const ref = await provider().createCampaign(SPEC);

    expect(captured?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(captured?.path).not.toContain('activate');
    expect(captured?.body).toMatchObject({ name: 'Q1 Founders' });
    expect(captured?.body).not.toHaveProperty('activate');
    expect(captured?.body).not.toHaveProperty('status');
    const sequences = captured?.body.sequences as { steps: { delay: number }[] }[];
    expect(sequences[0].steps[1].delay).toBe(3);
    expect(ref).toEqual({ id: 'camp_1', name: 'Q1 Founders', status: 'active' });
  });

  it('builds a schedule with a days map and send accounts', () => {
    const body = buildCreateCampaignBody({ ...SPEC, sending_accounts: ['a@acme.example'] });
    const schedule = body.campaign_schedule as {
      schedules: { timing: { from: string; to: string }; days: Record<string, boolean> }[];
    };
    expect(schedule.schedules[0].timing).toEqual({ from: '09:00', to: '17:00' });
    expect(schedule.schedules[0].days['1']).toBe(true);
    expect(body.email_list).toEqual(['a@acme.example']);
  });

  it('does not retry the non-idempotent create', async () => {
    let attempts = 0;
    agent
      .get('https://api.instantly.ai')
      .intercept({ path: '/api/v2/campaigns', method: 'POST' })
      .reply(() => {
        attempts += 1;
        return { statusCode: 503, data: { error: 'unavailable' } };
      });
    await expect(provider(3).createCampaign(SPEC)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
    expect(attempts).toBe(1);
  });
});

describe('instantly addLeads', () => {
  it('maps leads and the upload summary', async () => {
    let captured: Record<string, unknown> | undefined;
    agent
      .get('https://api.instantly.ai')
      .intercept({ path: '/api/v2/leads/add', method: 'POST' })
      .reply((options) => {
        captured = JSON.parse(String(options.body)) as Record<string, unknown>;
        return {
          statusCode: 200,
          data: {
            status: 'success',
            leads_uploaded: 2,
            skipped_count: 1,
            invalid_email_count: 1,
            created_leads: [{ id: 'lead_1', email: 'a@acme.example', index: 0 }],
          },
          responseOptions: { headers: { 'content-type': 'application/json' } },
        };
      });

    const result = await provider().addLeads('camp_1', [
      { email: 'a@acme.example', first_name: 'A', custom_variables: { first_line: 'Hi' } },
      { email: 'b@acme.example' },
    ]);

    expect(captured?.campaign_id).toBe('camp_1');
    const leads = captured?.leads as Record<string, unknown>[];
    expect(leads[0]).toMatchObject({
      email: 'a@acme.example',
      first_name: 'A',
      custom_variables: { first_line: 'Hi' },
    });
    expect(result).toEqual({
      added: 2,
      skipped: 2,
      failed: [],
      created_emails: ['a@acme.example'],
    });
  });
});

describe('instantly getCampaign', () => {
  it('maps the documented status code to a label', async () => {
    agent
      .get('https://api.instantly.ai')
      .intercept({ path: '/api/v2/campaigns/camp_1', method: 'GET' })
      .reply(
        200,
        { id: 'camp_1', name: 'Q1', status: 2 },
        { headers: { 'content-type': 'application/json' } },
      );
    expect(await provider().getCampaign?.('camp_1')).toEqual({
      id: 'camp_1',
      name: 'Q1',
      status: 'paused',
    });
  });

  it('returns null when the campaign is missing', async () => {
    agent
      .get('https://api.instantly.ai')
      .intercept({ path: '/api/v2/campaigns/ghost', method: 'GET' })
      .reply(
        404,
        { message: 'Resource not found' },
        { headers: { 'content-type': 'application/json' } },
      );
    expect(await provider().getCampaign?.('ghost')).toBeNull();
  });
});

describe('instantly listCampaigns', () => {
  it('reads a campaign collection defensively', async () => {
    agent
      .get('https://api.instantly.ai')
      .intercept({ path: (path) => path.startsWith('/api/v2/campaigns'), method: 'GET' })
      .reply(
        200,
        { items: [{ id: 'c1', name: 'One' }] },
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    const campaigns = await provider().listCampaigns();
    expect(campaigns).toEqual([{ id: 'c1', name: 'One', status: 'unknown' }]);
  });
});
