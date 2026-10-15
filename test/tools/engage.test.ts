import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from '../../src/http/client.js';
import { testConfig, testContext } from '../helpers/context.js';
import { jsonOf, linkClient } from '../helpers/mcp.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opensdr-engage-'));
  dirs.push(dir);
  return dir;
}

interface ErrorBody {
  ok: false;
  error: { code: string; message: string };
}

type Client = Awaited<ReturnType<typeof linkClient>>['client'];

async function saveProspect(
  client: Client,
  list: string,
  person: Record<string, unknown>,
): Promise<string> {
  const result = jsonOf<{ data: { prospect_ids: string[] } }>(
    await client.callTool({
      name: 'sdr_save_prospects',
      arguments: { list, people: [person] },
    }),
  );
  return result.data.prospect_ids[0];
}

describe('sdr_prepare_outreach_brief (demo)', () => {
  it('includes rules, framework, cited facts and signals, and marks suppressed', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const id = await saveProspect(linked.client, 'vpe', {
        email: 'jane@northwind.example',
        first_name: 'Jane',
        last_name: 'Doe',
        title: 'VP Engineering',
        company: { name: 'Northwind Labs', domain: 'northwind.example' },
      });
      await linked.client.callTool({
        name: 'sdr_save_prospects',
        arguments: {
          list: 'vpe',
          people: [
            {
              prospect_id: id,
              patch: {
                signals: [
                  {
                    type: 'funding',
                    title: 'Northwind raises',
                    url: 'https://news.example/x',
                    confidence: 'high',
                    matched_rule: 'funding:raises',
                  },
                ],
              },
            },
          ],
        },
      });

      const envelope = jsonOf<{
        data: {
          seller: { source: string };
          prospects: {
            suppressed: boolean;
            facts: { fact: string; source: string }[];
            signals: unknown[];
          }[];
          sequence_framework: unknown[];
          rules: string[];
          output_contract: { save_with: string; fields: string[] };
        };
        warnings: string[];
      }>(
        await linked.client.callTool({
          name: 'sdr_prepare_outreach_brief',
          arguments: { prospect_ids: [id] },
        }),
      );

      const brief = envelope.data.prospects[0];
      expect(brief.suppressed).toBe(false);
      expect(brief.facts.some((fact) => fact.source === 'https://news.example/x')).toBe(true);
      expect(brief.signals).toHaveLength(1);
      expect(envelope.data.sequence_framework).toHaveLength(4);
      expect(envelope.data.rules.join(' ')).toContain('opt-out');
      expect(envelope.data.output_contract.save_with).toBe('sdr_save_prospects');
      expect(envelope.data.seller.source).toBe('none');
      expect(envelope.warnings.join(' ')).toContain('seller context');
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_create_campaign (demo)', () => {
  const steps = [
    { subject: 'Hi {{first_name}}', body: 'Hello. Unsubscribe any time.', delay_days: 0 },
  ];

  it('previews then confirms as draft and simulated', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const preview = jsonOf<{
        data: { confirmation_token: string; preview: { will_be_created_as: string } };
      }>(
        await linked.client.callTool({
          name: 'sdr_create_campaign',
          arguments: {
            name: 'Q1',
            steps,
            schedule: { timezone: 'UTC', days: ['mon'], start_hour: 9, end_hour: 17 },
          },
        }),
      );
      expect(preview.data.preview.will_be_created_as).toMatch(/^draft/);

      const executed = jsonOf<{ data: { status: string; simulated: boolean } }>(
        await linked.client.callTool({
          name: 'sdr_create_campaign',
          arguments: {
            name: 'Q1',
            steps,
            schedule: { timezone: 'UTC', days: ['mon'], start_hour: 9, end_hour: 17 },
            confirm: true,
            confirmation_token: preview.data.confirmation_token,
          },
        }),
      );
      expect(executed.data.status).toBe('draft');
      expect(executed.data.simulated).toBe(true);
    } finally {
      await linked.close();
    }
  });

  it('refuses a step with no opt-out', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const result = await linked.client.callTool({
        name: 'sdr_create_campaign',
        arguments: {
          name: 'Q1',
          steps: [{ subject: 'Hi', body: 'Buy our product today.', delay_days: 0 }],
          schedule: { timezone: 'UTC', days: ['mon'], start_hour: 9, end_hour: 17 },
        },
      });
      expect(result.isError).toBe(true);
      expect(jsonOf<ErrorBody>(result).error.code).toBe('BAD_INPUT');
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_push_to_campaign (demo)', () => {
  it('gates prospects and marks them queued', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const good = await saveProspect(linked.client, 'vpe', {
        email: 'a@acme.example',
        first_name: 'A',
        email_status: 'verified',
      });
      await saveProspect(linked.client, 'vpe', {
        first_name: 'No',
        last_name: 'Email',
        company: { domain: 'acme.example' },
      });
      await saveProspect(linked.client, 'vpe', {
        email: 'c@acme.example',
        email_status: 'invalid',
      });

      const preview = jsonOf<{
        data: {
          eligible: { prospect_id: string }[];
          excluded: { reason: string }[];
          confirmation_token: string;
        };
      }>(
        await linked.client.callTool({
          name: 'sdr_push_to_campaign',
          arguments: { campaign_id: 'camp_1', list: 'vpe' },
        }),
      );
      expect(preview.data.eligible).toHaveLength(1);
      const reasons = preview.data.excluded.map((entry) => entry.reason).sort();
      expect(reasons).toEqual(['invalid', 'no_email']);

      const executed = jsonOf<{ data: { simulated: boolean; added: number } }>(
        await linked.client.callTool({
          name: 'sdr_push_to_campaign',
          arguments: {
            campaign_id: 'camp_1',
            list: 'vpe',
            confirm: true,
            confirmation_token: preview.data.confirmation_token,
          },
        }),
      );
      expect(executed.data.simulated).toBe(true);
      expect(executed.data.added).toBe(1);

      const listed = jsonOf<{ data: { prospects: { id: string; status: string }[] } }>(
        await linked.client.callTool({
          name: 'sdr_list_prospects',
          arguments: { list: 'vpe', search: 'a@acme.example' },
        }),
      );
      const queued = listed.data.prospects.find((prospect) => prospect.id === good);
      expect(queued?.status).toBe('queued');

      const second = jsonOf<{ data: { eligible: unknown[]; excluded: { reason: string }[] } }>(
        await linked.client.callTool({
          name: 'sdr_push_to_campaign',
          arguments: { campaign_id: 'camp_1', list: 'vpe' },
        }),
      );
      expect(second.data.eligible).toHaveLength(0);
      expect(second.data.excluded.map((entry) => entry.reason)).toContain('already_in_campaign');
    } finally {
      await linked.close();
    }
  });

  it('proceeds and reports when the eligible set shrinks', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      await saveProspect(linked.client, 'vpe', {
        email: 'a@acme.example',
        email_status: 'verified',
      });
      await saveProspect(linked.client, 'vpe', {
        email: 'b@acme.example',
        email_status: 'verified',
      });

      const preview = jsonOf<{ data: { confirmation_token: string } }>(
        await linked.client.callTool({
          name: 'sdr_push_to_campaign',
          arguments: { campaign_id: 'camp_1', list: 'vpe' },
        }),
      );
      await linked.client.callTool({
        name: 'sdr_manage_suppression',
        arguments: { action: 'add', domains: ['acme.example'] },
      });

      const executed = jsonOf<{ ok: boolean; data: { added: number }; warnings: string[] }>(
        await linked.client.callTool({
          name: 'sdr_push_to_campaign',
          arguments: {
            campaign_id: 'camp_1',
            list: 'vpe',
            confirm: true,
            confirmation_token: preview.data.confirmation_token,
          },
        }),
      );
      expect(executed.ok).toBe(true);
      expect(executed.data.added).toBe(0);
      expect(executed.warnings.join(' ')).toContain('shrank');
    } finally {
      await linked.close();
    }
  });

  it('rejects a grown eligible set', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      await saveProspect(linked.client, 'vpe', {
        email: 'a@acme.example',
        email_status: 'verified',
      });
      const preview = jsonOf<{ data: { confirmation_token: string } }>(
        await linked.client.callTool({
          name: 'sdr_push_to_campaign',
          arguments: { campaign_id: 'camp_1', list: 'vpe' },
        }),
      );
      await saveProspect(linked.client, 'vpe', {
        email: 'b@acme.example',
        email_status: 'verified',
      });

      const result = await linked.client.callTool({
        name: 'sdr_push_to_campaign',
        arguments: {
          campaign_id: 'camp_1',
          list: 'vpe',
          confirm: true,
          confirmation_token: preview.data.confirmation_token,
        },
      });
      expect(result.isError).toBe(true);
      expect(jsonOf<ErrorBody>(result).error.code).toBe('CONFIRMATION_REQUIRED');
    } finally {
      await linked.close();
    }
  });

  it('rejects a token minted by another tool', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      await saveProspect(linked.client, 'vpe', {
        email: 'a@acme.example',
        email_status: 'verified',
      });
      const createPreview = jsonOf<{ data: { confirmation_token: string } }>(
        await linked.client.callTool({
          name: 'sdr_create_campaign',
          arguments: {
            name: 'Q1',
            steps: [{ subject: 'Hi', body: 'Unsubscribe any time.', delay_days: 0 }],
            schedule: { timezone: 'UTC', days: ['mon'], start_hour: 9, end_hour: 17 },
          },
        }),
      );
      const result = await linked.client.callTool({
        name: 'sdr_push_to_campaign',
        arguments: {
          campaign_id: 'camp_1',
          list: 'vpe',
          confirm: true,
          confirmation_token: createPreview.data.confirmation_token,
        },
      });
      expect(result.isError).toBe(true);
      expect(jsonOf<ErrorBody>(result).error.code).toBe('CONFIRMATION_REQUIRED');
    } finally {
      await linked.close();
    }
  });
});

describe('read-only mode', () => {
  it('blocks both write tools before any other work', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_READ_ONLY: '1', OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const create = await linked.client.callTool({
        name: 'sdr_create_campaign',
        arguments: {
          name: 'Q1',
          steps: [{ subject: 'Hi', body: 'Unsubscribe any time.', delay_days: 0 }],
          schedule: { timezone: 'UTC', days: ['mon'], start_hour: 9, end_hour: 17 },
        },
      });
      expect(create.isError).toBe(true);
      expect(jsonOf<ErrorBody>(create).error.code).toBe('READ_ONLY_MODE');

      const push = await linked.client.callTool({
        name: 'sdr_push_to_campaign',
        arguments: { campaign_id: 'camp_1', list: 'vpe' },
      });
      expect(push.isError).toBe(true);
      expect(jsonOf<ErrorBody>(push).error.code).toBe('READ_ONLY_MODE');
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_push_to_campaign (live, mocked Instantly)', () => {
  // Instantly status codes: 0 draft, 1 active, 2 paused.
  function liveContext(
    bodies: Record<string, unknown>[],
    created: { email: string }[] = [],
    campaignStatus = 2,
  ) {
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.includes('/campaigns/')) {
        return new Response(JSON.stringify({ id: 'camp_1', name: 'Q1', status: campaignStatus }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/leads/add')) {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            status: 'success',
            leads_uploaded: created.length,
            created_leads: created,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    };
    return testContext({
      config: testConfig({
        INSTANTLY_API_KEY: 'instantly-key-1234567890',
        OPENSDR_DATA_DIR: tmpDir(),
      }),
      deps: {
        http: createHttpClient({ fetchImpl, sleep: async () => undefined, random: () => 0 }),
      },
    });
  }

  it('shows the campaign status and never sends suppressed or invalid prospects', async () => {
    const bodies: Record<string, unknown>[] = [];
    const linked = await linkClient(liveContext(bodies, [{ email: 'ok@acme.example' }]));
    try {
      await saveProspect(linked.client, 'vpe', {
        email: 'ok@acme.example',
        email_status: 'verified',
      });
      await saveProspect(linked.client, 'vpe', {
        email: 'bad@blocked.example',
        email_status: 'verified',
      });
      await saveProspect(linked.client, 'vpe', {
        email: 'invalid@acme.example',
        email_status: 'invalid',
      });
      await linked.client.callTool({
        name: 'sdr_manage_suppression',
        arguments: { action: 'add', domains: ['blocked.example'] },
      });

      const preview = jsonOf<{
        data: {
          confirmation_token: string;
          eligible: { email: string }[];
          campaign: { status: string } | null;
        };
      }>(
        await linked.client.callTool({
          name: 'sdr_push_to_campaign',
          arguments: { campaign_id: 'camp_1', list: 'vpe' },
        }),
      );
      expect(preview.data.eligible.map((entry) => entry.email)).toEqual(['ok@acme.example']);
      expect(preview.data.campaign?.status).toBe('paused');

      await linked.client.callTool({
        name: 'sdr_push_to_campaign',
        arguments: {
          campaign_id: 'camp_1',
          list: 'vpe',
          confirm: true,
          confirmation_token: preview.data.confirmation_token,
        },
      });

      const sent = (bodies[0].leads as { email: string }[]).map((lead) => lead.email);
      expect(sent).toEqual(['ok@acme.example']);
    } finally {
      await linked.close();
    }
  });

  it.each([
    [1, 'active'],
    [4, 'running_subsequences'],
    [-2, 'bounce_protect'],
  ])('refuses to push into a campaign with status %i (%s)', async (code, label) => {
    const bodies: Record<string, unknown>[] = [];
    const linked = await linkClient(liveContext(bodies, [], code));
    try {
      await saveProspect(linked.client, 'vpe', {
        email: 'ok@acme.example',
        email_status: 'verified',
      });
      const result = await linked.client.callTool({
        name: 'sdr_push_to_campaign',
        arguments: { campaign_id: 'camp_1', list: 'vpe' },
      });
      expect(result.isError).toBe(true);
      const body = jsonOf<ErrorBody>(result);
      expect(body.error.code).toBe('BAD_INPUT');
      expect(body.error.message).toContain(label);
      expect(bodies).toHaveLength(0);
    } finally {
      await linked.close();
    }
  });

  it('accepts a draft campaign', async () => {
    const bodies: Record<string, unknown>[] = [];
    const linked = await linkClient(liveContext(bodies, [{ email: 'ok@acme.example' }], 0));
    try {
      await saveProspect(linked.client, 'vpe', {
        email: 'ok@acme.example',
        email_status: 'verified',
      });
      const preview = jsonOf<{
        data: { confirmation_token: string; campaign: { status: string } };
      }>(
        await linked.client.callTool({
          name: 'sdr_push_to_campaign',
          arguments: { campaign_id: 'camp_1', list: 'vpe' },
        }),
      );
      expect(preview.data.campaign.status).toBe('draft');
      const result = await linked.client.callTool({
        name: 'sdr_push_to_campaign',
        arguments: {
          campaign_id: 'camp_1',
          list: 'vpe',
          confirm: true,
          confirmation_token: preview.data.confirmation_token,
        },
      });
      expect(result.isError).toBeFalsy();
      expect(bodies).toHaveLength(1);
    } finally {
      await linked.close();
    }
  });

  it('rejects the confirm when an approved lead changed after the preview', async () => {
    const bodies: Record<string, unknown>[] = [];
    const linked = await linkClient(liveContext(bodies, [{ email: 'ok@acme.example' }]));
    try {
      const id = await saveProspect(linked.client, 'vpe', {
        email: 'ok@acme.example',
        email_status: 'verified',
      });
      const preview = jsonOf<{ data: { confirmation_token: string } }>(
        await linked.client.callTool({
          name: 'sdr_push_to_campaign',
          arguments: { campaign_id: 'camp_1', list: 'vpe' },
        }),
      );
      await linked.client.callTool({
        name: 'sdr_save_prospects',
        arguments: {
          list: 'vpe',
          people: [{ prospect_id: id, patch: { custom_fields: { first_line: 'Swapped copy' } } }],
        },
      });
      const result = await linked.client.callTool({
        name: 'sdr_push_to_campaign',
        arguments: {
          campaign_id: 'camp_1',
          list: 'vpe',
          confirm: true,
          confirmation_token: preview.data.confirmation_token,
        },
      });
      expect(result.isError).toBe(true);
      expect(jsonOf<ErrorBody>(result).error.code).toBe('CONFIRMATION_REQUIRED');
      expect(bodies).toHaveLength(0);
    } finally {
      await linked.close();
    }
  });

  it('sends a duplicated prospect id only once', async () => {
    const bodies: Record<string, unknown>[] = [];
    const linked = await linkClient(liveContext(bodies, [{ email: 'ok@acme.example' }]));
    try {
      const id = await saveProspect(linked.client, 'vpe', {
        email: 'ok@acme.example',
        email_status: 'verified',
      });
      const args = { campaign_id: 'camp_1', prospect_ids: [id, id] };
      const preview = jsonOf<{ data: { confirmation_token: string; eligible: unknown[] } }>(
        await linked.client.callTool({ name: 'sdr_push_to_campaign', arguments: args }),
      );
      expect(preview.data.eligible).toHaveLength(1);
      await linked.client.callTool({
        name: 'sdr_push_to_campaign',
        arguments: { ...args, confirm: true, confirmation_token: preview.data.confirmation_token },
      });
      expect(bodies[0].leads as unknown[]).toHaveLength(1);
    } finally {
      await linked.close();
    }
  });

  it('marks only the leads Instantly actually created as queued', async () => {
    const bodies: Record<string, unknown>[] = [];
    const linked = await linkClient(liveContext(bodies, [{ email: 'a@acme.example' }]));
    try {
      await saveProspect(linked.client, 'vpe', {
        email: 'a@acme.example',
        email_status: 'verified',
      });
      await saveProspect(linked.client, 'vpe', {
        email: 'b@acme.example',
        email_status: 'verified',
      });
      const preview = jsonOf<{ data: { confirmation_token: string } }>(
        await linked.client.callTool({
          name: 'sdr_push_to_campaign',
          arguments: { campaign_id: 'camp_1', list: 'vpe' },
        }),
      );
      await linked.client.callTool({
        name: 'sdr_push_to_campaign',
        arguments: {
          campaign_id: 'camp_1',
          list: 'vpe',
          confirm: true,
          confirmation_token: preview.data.confirmation_token,
        },
      });

      const listed = jsonOf<{ data: { prospects: { email: string; status: string }[] } }>(
        await linked.client.callTool({
          name: 'sdr_list_prospects',
          arguments: { list: 'vpe' },
        }),
      );
      const byEmail = new Map(listed.data.prospects.map((p) => [p.email, p.status]));
      expect(byEmail.get('a@acme.example')).toBe('queued');
      expect(byEmail.get('b@acme.example')).not.toBe('queued');
    } finally {
      await linked.close();
    }
  });
});
