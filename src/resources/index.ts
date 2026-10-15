import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ServerContext } from '../server.js';
import { ProspectStore } from '../store/prospects.js';
import { buildProviderStatus } from '../tools/system.js';

/** MCP spec error code for "resource not found". */
const RESOURCE_NOT_FOUND = -32002;
export const MAX_LIST_RESOURCE_PROSPECTS = 200;

const PROFILE_TEMPLATE = `# Seller profile (not set up yet)

OpenSDR uses this file to ground outreach briefs. Create it at:

    {{path}}

Suggested contents:

## Product
One or two sentences on what you sell and for whom.

## Ideal customer
Industries, company size, titles you sell to, and the problem you solve for them.

## Proof points
Customer results, metrics or logos you are allowed to mention. Only real, verifiable claims.

## Sender
Your name, role and company, as they should appear in emails.
`;

function json(uri: URL, value: unknown): ReadResourceResult {
  return {
    contents: [
      { uri: uri.href, mimeType: 'application/json', text: `${JSON.stringify(value, null, 2)}\n` },
    ],
  };
}

/**
 * Read-only views of local state. Resources never call providers: everything here comes from
 * config and the local store.
 */
export function registerResources(server: McpServer, ctx: ServerContext): void {
  const prospects = new ProspectStore({
    path: path.join(ctx.config.dataDir, 'prospects.json'),
    warn: (message) => ctx.logger.warn(message),
  });

  server.registerResource(
    'providers',
    'opensdr://providers',
    {
      title: 'Provider status',
      description: 'Mode, configured providers, capabilities, limits and session credits.',
      mimeType: 'application/json',
    },
    (uri) => {
      const { data, warnings } = buildProviderStatus(ctx);
      return json(uri, { ...data, warnings });
    },
  );

  server.registerResource(
    'lists',
    'opensdr://lists',
    {
      title: 'Prospect lists',
      description: 'Every saved prospect list with counts by email and pipeline status.',
      mimeType: 'application/json',
    },
    async (uri) => json(uri, { lists: await prospects.listsSummary() }),
  );

  server.registerResource(
    'list',
    new ResourceTemplate('opensdr://lists/{name}', {
      list: async () => ({
        resources: (await prospects.listsSummary()).map((list) => ({
          uri: `opensdr://lists/${encodeURIComponent(list.name)}`,
          name: list.name,
          description: `${list.count} prospect(s), ${list.with_email} with email`,
          mimeType: 'application/json',
        })),
      }),
      complete: {
        name: async (value) =>
          (await prospects.listsSummary())
            .map((list) => list.name)
            .filter((name) => name.startsWith(value)),
      },
    }),
    {
      title: 'Prospect list',
      description: `Prospects in one list (first ${MAX_LIST_RESOURCE_PROSPECTS}).`,
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const raw = Array.isArray(variables.name) ? variables.name[0] : variables.name;
      const name = decodeURIComponent(raw ?? '');
      const summary = (await prospects.listsSummary()).find((list) => list.name === name);
      if (!summary) {
        throw new McpError(RESOURCE_NOT_FOUND, `Prospect list "${name}" not found.`, {
          uri: uri.href,
        });
      }
      const result = await prospects.query({ list: name, limit: MAX_LIST_RESOURCE_PROSPECTS });
      const truncated = result.total > result.prospects.length;
      return json(uri, {
        list: summary,
        prospects: result.prospects,
        truncated,
        ...(truncated
          ? {
              note: `Showing ${result.prospects.length} of ${result.total}. Use the sdr_list_prospects tool with a cursor to page through the rest.`,
            }
          : {}),
      });
    },
  );

  server.registerResource(
    'profile',
    'opensdr://profile',
    {
      title: 'Seller profile',
      description:
        'Your product, ideal customer and proof points (profile.md), used by outreach briefs.',
      mimeType: 'text/markdown',
    },
    (uri) => {
      const file = path.join(ctx.config.dataDir, 'profile.md');
      const text = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: text === '' ? PROFILE_TEMPLATE.replace('{{path}}', file) : `${text}\n`,
          },
        ],
      };
    },
  );
}
