import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import type { DnsResolver } from './engine/email-validator.js';
import type { Logger } from './logger.js';
import { registerPrompts } from './prompts/index.js';
import type { Registry } from './providers/registry.js';
import { registerResources } from './resources/index.js';
import { registerCrmTools } from './tools/crm.js';
import { registerEngageTools } from './tools/engage.js';
import { registerEnrichTools } from './tools/enrich.js';
import { installErrorEnvelope } from './tools/envelope.js';
import { registerManageTools } from './tools/manage.js';
import { registerProspectTools } from './tools/prospect.js';
import { registerSignalsTools } from './tools/signals.js';
import { registerSystemTools } from './tools/system.js';

export interface SessionState {
  creditsUsed: number;
}

export interface ServerContext {
  config: Config;
  registry: Registry;
  logger: Logger;
  version: string;
  session: SessionState;
  dns?: DnsResolver;
}

export function createServer(ctx: ServerContext): McpServer {
  const server = new McpServer({ name: 'opensdr', version: ctx.version });
  installErrorEnvelope(server);
  registerSystemTools(server, ctx);
  registerProspectTools(server, ctx);
  registerEnrichTools(server, ctx);
  registerManageTools(server, ctx);
  registerSignalsTools(server, ctx);
  registerEngageTools(server, ctx);
  registerCrmTools(server, ctx);
  registerPrompts(server);
  registerResources(server, ctx);
  return server;
}
