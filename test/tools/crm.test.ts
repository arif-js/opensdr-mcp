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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opensdr-crm-'));
  dirs.push(dir);
  return dir;
}

interface ErrorBody {
  ok: false;
  error: { code: string; message: string };
}

type Client = Awaited<ReturnType<typeof linkClient>>['client'];

async function save(client: Client, person: Record<string, unknown>): Promise<string> {
  const result = jsonOf<{ data: { prospect_ids: string[] } }>(
    await client.callTool({
      name: 'sdr_save_prospects',
      arguments: { list: 'crm', people: [person] },
    }),
  );
  return result.data.prospect_ids[0];
}

describe('sdr_sync_hubspot (demo)', () => {
  it('previews, then records a simulated sync', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const id = await save(linked.client, {
        email: 'a@acme.example',
        first_name: 'Ada',
        title: 'VP Engineering',
        company: { name: 'Acme', domain: 'acme.example' },
      });

      const preview = jsonOf<{
        data: {
          to_create_or_update: {
            prospect_id: string;
            action: string;
            properties: Record<string, string>;
          }[];
          excluded: unknown[];
          confirmation_token: string;
        };
      }>(
        await linked.client.callTool({
          name: 'sdr_sync_hubspot',
          arguments: { prospect_ids: [id], lifecycle_stage: 'lead' },
        }),
      );
      expect(preview.data.to_create_or_update[0].action).toBe('unknown');
      expect(preview.data.to_create_or_update[0].properties).toMatchObject({
        email: 'a@acme.example',
        firstname: 'Ada',
        jobtitle: 'VP Engineering',
        company: 'Acme',
        lifecyclestage: 'lead',
      });

      const executed = jsonOf<{ data: { simulated: boolean; synced: number } }>(
        await linked.client.callTool({
          name: 'sdr_sync_hubspot',
          arguments: {
            prospect_ids: [id],
            lifecycle_stage: 'lead',
            confirm: true,
            confirmation_token: preview.data.confirmation_token,
          },
        }),
      );
      expect(executed.data.simulated).toBe(true);
      expect(executed.data.synced).toBe(1);

      const listed = jsonOf<{
        data: { prospects: { id: string; crm: { hubspot_id?: string } | null }[] };
      }>(await linked.client.callTool({ name: 'sdr_list_prospects', arguments: { list: 'crm' } }));
      expect(listed.data.prospects[0].crm?.hubspot_id).toBe(`hs_demo_${id}`);
    } finally {
      await linked.close();
    }
  });

  it('rejects the confirm when an approved contact changed after the preview', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const id = await save(linked.client, { email: 'a@acme.example', first_name: 'Ada' });
      const preview = jsonOf<{ data: { confirmation_token: string } }>(
        await linked.client.callTool({
          name: 'sdr_sync_hubspot',
          arguments: { prospect_ids: [id] },
        }),
      );
      await linked.client.callTool({
        name: 'sdr_save_prospects',
        arguments: {
          list: 'crm',
          people: [{ prospect_id: id, patch: { custom_fields: { first_line: 'x' } } }],
        },
      });
      // custom_fields are not sent to HubSpot, so this confirm must still succeed...
      const okResult = await linked.client.callTool({
        name: 'sdr_sync_hubspot',
        arguments: {
          prospect_ids: [id],
          confirm: true,
          confirmation_token: preview.data.confirmation_token,
        },
      });
      expect(okResult.isError).toBeFalsy();

      // ...but a change to a synced property after the preview must be rejected.
      const second = jsonOf<{ data: { confirmation_token: string } }>(
        await linked.client.callTool({
          name: 'sdr_sync_hubspot',
          arguments: { prospect_ids: [id], lifecycle_stage: 'lead' },
        }),
      );
      await linked.client.callTool({
        name: 'sdr_save_prospects',
        arguments: {
          list: 'crm',
          merge: 'overwrite',
          people: [{ email: 'a@acme.example', first_name: 'Grace' }],
        },
      });
      const rejected = await linked.client.callTool({
        name: 'sdr_sync_hubspot',
        arguments: {
          prospect_ids: [id],
          lifecycle_stage: 'lead',
          confirm: true,
          confirmation_token: second.data.confirmation_token,
        },
      });
      expect(rejected.isError).toBe(true);
      expect(jsonOf<ErrorBody>(rejected).error.code).toBe('CONFIRMATION_REQUIRED');
    } finally {
      await linked.close();
    }
  });

  it('requires a confirmation token to write', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const id = await save(linked.client, { email: 'a@acme.example' });
      const result = await linked.client.callTool({
        name: 'sdr_sync_hubspot',
        arguments: { prospect_ids: [id], confirm: true },
      });
      expect(result.isError).toBe(true);
      expect(jsonOf<ErrorBody>(result).error.code).toBe('CONFIRMATION_REQUIRED');
    } finally {
      await linked.close();
    }
  });

  it('blocks in read-only mode', async () => {
    const linked = await linkClient(
      testContext({ config: testConfig({ OPENSDR_READ_ONLY: '1', OPENSDR_DATA_DIR: tmpDir() }) }),
    );
    try {
      const result = await linked.client.callTool({
        name: 'sdr_sync_hubspot',
        arguments: { list: 'crm' },
      });
      expect(result.isError).toBe(true);
      expect(jsonOf<ErrorBody>(result).error.code).toBe('READ_ONLY_MODE');
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_sync_hubspot (live, mocked HubSpot)', () => {
  it('never overwrites filled properties and is idempotent', async () => {
    const upsertBodies: Record<string, unknown>[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.includes('/batch/read')) {
        return new Response(
          JSON.stringify({
            results: [
              { id: 'hs_existing', properties: { email: 'a@acme.example', jobtitle: 'Existing' } },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/batch/upsert')) {
        upsertBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ results: [{ id: 'hs_existing', properties: {} }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const linked = await linkClient(
      testContext({
        config: testConfig({
          HUBSPOT_ACCESS_TOKEN: 'hubspot-token-1234567890',
          OPENSDR_DATA_DIR: tmpDir(),
        }),
        deps: {
          http: createHttpClient({ fetchImpl, sleep: async () => undefined, random: () => 0 }),
        },
      }),
    );
    try {
      const id = await save(linked.client, {
        email: 'a@acme.example',
        first_name: 'Ada',
        title: 'VP Engineering',
        company: { name: 'Acme', domain: 'acme.example' },
      });

      const preview = jsonOf<{
        data: {
          to_create_or_update: { action: string; properties: Record<string, string> }[];
          confirmation_token: string;
        };
      }>(
        await linked.client.callTool({
          name: 'sdr_sync_hubspot',
          arguments: { prospect_ids: [id] },
        }),
      );
      expect(preview.data.to_create_or_update[0].action).toBe('update');
      expect(preview.data.to_create_or_update[0].properties).not.toHaveProperty('jobtitle');
      expect(preview.data.to_create_or_update[0].properties).toMatchObject({
        email: 'a@acme.example',
        company: 'Acme',
      });

      await linked.client.callTool({
        name: 'sdr_sync_hubspot',
        arguments: {
          prospect_ids: [id],
          confirm: true,
          confirmation_token: preview.data.confirmation_token,
        },
      });
      const inputs = upsertBodies[0].inputs as { properties: Record<string, string> }[];
      expect(inputs[0].properties).not.toHaveProperty('jobtitle');
      expect(inputs[0].properties).toMatchObject({ email: 'a@acme.example' });
    } finally {
      await linked.close();
    }
  });

  it('syncs note with first_line and signals when add_note is true', async () => {
    const noteBodies: Record<string, unknown>[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.includes('/batch/read')) {
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/batch/upsert')) {
        return new Response(JSON.stringify({ results: [{ id: 'hs_new_1', properties: {} }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/objects/notes')) {
        noteBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: 'note_123' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const linked = await linkClient(
      testContext({
        config: testConfig({
          HUBSPOT_ACCESS_TOKEN: 'hubspot-token-1234567890',
          OPENSDR_DATA_DIR: tmpDir(),
        }),
        deps: {
          http: createHttpClient({ fetchImpl, sleep: async () => undefined, random: () => 0 }),
        },
      }),
    );
    try {
      const id = await save(linked.client, {
        email: 'ada@acme.example',
        first_name: 'Ada',
      });
      await linked.client.callTool({
        name: 'sdr_save_prospects',
        arguments: {
          list: 'crm',
          people: [
            {
              prospect_id: id,
              patch: {
                custom_fields: { first_line: 'Loved your post on SDR agents' },
                signals: [
                  {
                    type: 'funding',
                    title: 'Funding Round',
                    url: 'https://news.example/funding',
                    source: 'demo',
                    published_at: new Date().toISOString(),
                    confidence: 'high',
                  },
                ],
              },
            },
          ],
        },
      });

      const preview = jsonOf<{ data: { confirmation_token: string } }>(
        await linked.client.callTool({
          name: 'sdr_sync_hubspot',
          arguments: { prospect_ids: [id], add_note: true },
        }),
      );

      const executed = jsonOf<{ data: { synced: number } }>(
        await linked.client.callTool({
          name: 'sdr_sync_hubspot',
          arguments: {
            prospect_ids: [id],
            add_note: true,
            confirm: true,
            confirmation_token: preview.data.confirmation_token,
          },
        }),
      );

      expect(executed.data.synced).toBe(1);
      expect(noteBodies).toHaveLength(1);
      const notePayload = noteBodies[0] as { properties: { hs_note_body: string } };
      expect(notePayload.properties.hs_note_body).toContain('Loved your post on SDR agents');
      expect(notePayload.properties.hs_note_body).toContain('Funding Round');
    } finally {
      await linked.close();
    }
  });
});
