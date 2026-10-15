import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testConfig, testContext } from '../helpers/context.js';
import { jsonOf, linkClient } from '../helpers/mcp.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opensdr-manage-'));
  dirs.push(dir);
  return dir;
}

interface ErrorBody {
  ok: false;
  error: { code: string; message: string };
}

function client(dir: string) {
  return linkClient(testContext({ config: testConfig({ OPENSDR_DATA_DIR: dir }) }));
}

describe('sdr_save_prospects and sdr_list_prospects', () => {
  it('saves, dedupes and lists with a summary', async () => {
    const dir = tmpDir();
    const linked = await client(dir);
    try {
      const saved = jsonOf<{ data: { created: number; prospect_ids: string[] } }>(
        await linked.client.callTool({
          name: 'sdr_save_prospects',
          arguments: {
            list: 'vpe',
            people: [
              {
                linkedin_url: 'https://www.linkedin.com/in/jane-doe',
                first_name: 'Jane',
                last_name: 'Doe',
              },
            ],
          },
        }),
      );
      expect(saved.data.created).toBe(1);
      const id = saved.data.prospect_ids[0];

      await linked.client.callTool({
        name: 'sdr_save_prospects',
        arguments: {
          list: 'vpe',
          people: [
            {
              linkedin_url: 'https://www.linkedin.com/in/jane-doe',
              email: 'jane@acme.example',
              email_status: 'verified',
            },
          ],
        },
      });

      const listed = jsonOf<{
        data: {
          prospects: { id: string; email: string; email_status: string }[];
          lists_summary: { name: string; count: number; verified: number }[];
        };
      }>(
        await linked.client.callTool({
          name: 'sdr_list_prospects',
          arguments: { list: 'vpe', include_lists_summary: true },
        }),
      );
      expect(listed.data.prospects).toHaveLength(1);
      expect(listed.data.prospects[0].id).toBe(id);
      expect(listed.data.prospects[0].email).toBe('jane@acme.example');
      expect(listed.data.lists_summary[0]).toMatchObject({ name: 'vpe', count: 1, verified: 1 });
    } finally {
      await linked.close();
    }
  });

  it('rejects an invalid list name with a suggested slug', async () => {
    const linked = await client(tmpDir());
    try {
      const result = await linked.client.callTool({
        name: 'sdr_save_prospects',
        arguments: { list: 'My List!', people: [{ email: 'a@b.example' }] },
      });
      expect(result.isError).toBe(true);
      expect(jsonOf<ErrorBody>(result).error.code).toBe('BAD_INPUT');
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_export_csv', () => {
  it('writes a guarded CSV under the data dir', async () => {
    const dir = tmpDir();
    const linked = await client(dir);
    try {
      const saved = jsonOf<{ data: { prospect_ids: string[] } }>(
        await linked.client.callTool({
          name: 'sdr_save_prospects',
          arguments: {
            list: 'vpe',
            people: [
              {
                email: 'jane@acme.example',
                first_name: 'Jane',
                last_name: 'Doe',
                email_status: 'verified',
              },
            ],
          },
        }),
      );
      await linked.client.callTool({
        name: 'sdr_save_prospects',
        arguments: {
          list: 'vpe',
          people: [
            {
              prospect_id: saved.data.prospect_ids[0],
              patch: { custom_fields: { first_line: '=HYPERLINK("http://evil")' } },
            },
          ],
        },
      });

      const exported = jsonOf<{ data: { path: string; rows: number; columns: string[] } }>(
        await linked.client.callTool({
          name: 'sdr_export_csv',
          arguments: { list: 'vpe' },
        }),
      );
      expect(exported.data.rows).toBe(1);
      expect(exported.data.path.startsWith(path.join(dir, 'exports'))).toBe(true);
      const content = readFileSync(exported.data.path, 'utf8');
      expect(content.startsWith('\uFEFF')).toBe(true);
      expect(content).toContain("'=HYPERLINK");
    } finally {
      await linked.close();
    }
  });

  it('refuses a relative path and refuses to overwrite', async () => {
    const dir = tmpDir();
    const linked = await client(dir);
    try {
      await linked.client.callTool({
        name: 'sdr_save_prospects',
        arguments: { list: 'vpe', people: [{ email: 'jane@acme.example' }] },
      });

      const relative = await linked.client.callTool({
        name: 'sdr_export_csv',
        arguments: { list: 'vpe', path: 'out.csv' },
      });
      expect(relative.isError).toBe(true);
      expect(jsonOf<ErrorBody>(relative).error.code).toBe('BAD_INPUT');

      const target = path.join(dir, 'out.csv');
      await linked.client.callTool({
        name: 'sdr_export_csv',
        arguments: { list: 'vpe', path: target },
      });
      expect(existsSync(target)).toBe(true);

      const second = await linked.client.callTool({
        name: 'sdr_export_csv',
        arguments: { list: 'vpe', path: target },
      });
      expect(second.isError).toBe(true);
      expect(jsonOf<ErrorBody>(second).error.code).toBe('BAD_INPUT');
    } finally {
      await linked.close();
    }
  });

  it('excludes suppressed prospects by default', async () => {
    const dir = tmpDir();
    const linked = await client(dir);
    try {
      await linked.client.callTool({
        name: 'sdr_save_prospects',
        arguments: {
          list: 'vpe',
          people: [{ email: 'jane@acme.example', company: { domain: 'acme.example' } }],
        },
      });
      await linked.client.callTool({
        name: 'sdr_manage_suppression',
        arguments: { action: 'add', domains: ['acme.example'] },
      });

      const excluded = jsonOf<{
        data: { rows: number; path: string | null; excluded_suppressed: number };
      }>(await linked.client.callTool({ name: 'sdr_export_csv', arguments: { list: 'vpe' } }));
      expect(excluded.data.rows).toBe(0);
      expect(excluded.data.path).toBeNull();
      expect(excluded.data.excluded_suppressed).toBe(1);

      const included = jsonOf<{ data: { rows: number; path: string; columns: string[] } }>(
        await linked.client.callTool({
          name: 'sdr_export_csv',
          arguments: { list: 'vpe', include_suppressed: true },
        }),
      );
      expect(included.data.rows).toBe(1);
      expect(included.data.columns).toContain('suppressed');
    } finally {
      await linked.close();
    }
  });
});

describe('sdr_manage_suppression', () => {
  it('adds, checks and lists', async () => {
    const linked = await client(tmpDir());
    try {
      await linked.client.callTool({
        name: 'sdr_manage_suppression',
        arguments: { action: 'add', domains: ['acme.example'], reason: 'opt-out' },
      });
      const checked = jsonOf<{ data: { results: { value: string; suppressed: boolean }[] } }>(
        await linked.client.callTool({
          name: 'sdr_manage_suppression',
          arguments: { action: 'check', emails: ['x@eu.acme.example'], domains: ['loud.example'] },
        }),
      );
      expect(checked.data.results[0].suppressed).toBe(true);
      expect(checked.data.results[1].suppressed).toBe(false);

      const listed = jsonOf<{ data: { entries: { value: string; type: string }[] } }>(
        await linked.client.callTool({
          name: 'sdr_manage_suppression',
          arguments: { action: 'list' },
        }),
      );
      expect(listed.data.entries[0].value).toBe('acme.example');
    } finally {
      await linked.close();
    }
  });
});
