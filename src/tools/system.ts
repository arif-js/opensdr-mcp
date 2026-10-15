import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../server.js';
import { defineTool, ok } from './envelope.js';

const COMPLIANCE_NOTICE =
  'You are responsible for using OpenSDR lawfully (CAN-SPAM, GDPR/UK-GDPR, CASL and each provider\u2019s ' +
  'terms of service, including limits on storing provider data). OpenSDR never sends email, never ' +
  'activates a campaign, and never automates LinkedIn. Suppressed contacts are always excluded.';

const DESCRIPTION =
  'Reports which providers are configured, the current mode (live or demo), read-only state, the data ' +
  'directory, per-capability provider resolution, session credit estimate and the active limits. ' +
  'Free and local: makes no network calls. Use it first to see what OpenSDR can do and which env vars ' +
  'are missing. Does not reveal API key values, not even partially.';

/** Shared by the `sdr_provider_status` tool and the `opensdr://providers` resource. */
export function buildProviderStatus(ctx: ServerContext): {
  data: Record<string, unknown>;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (ctx.config.demoRequested && ctx.config.configuredProviders.length > 0) {
    warnings.push(
      `OPENSDR_DEMO=1: ${ctx.config.configuredProviders.length} configured provider key(s) are present but ignored in demo mode.`,
    );
  }
  return {
    data: {
      version: ctx.version,
      mode: ctx.config.mode,
      read_only: ctx.config.readOnly,
      data_dir: ctx.config.dataDir,
      providers: ctx.registry.providers(),
      capabilities: ctx.registry.capabilities(),
      session: { credits_used_estimate: ctx.session.creditsUsed },
      limits: {
        max_credits_per_call: ctx.config.maxCreditsPerCall,
        cache_ttl_days: ctx.config.cacheTtlDays,
      },
      compliance_notice: COMPLIANCE_NOTICE,
    },
    warnings,
  };
}

export function registerSystemTools(server: McpServer, ctx: ServerContext): void {
  defineTool(server, {
    name: 'sdr_provider_status',
    title: 'Provider status',
    description: DESCRIPTION,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: () => {
      const { data, warnings } = buildProviderStatus(ctx);
      return ok(data, { demo: ctx.config.mode === 'demo' }, warnings);
    },
  });
}
