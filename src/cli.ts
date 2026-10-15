#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from './config.js';
import { createHttpClient } from './http/client.js';
import { createLogger, registerSecrets } from './logger.js';
import { createRegistry } from './providers/registry.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';

const HELP = `opensdr-mcp v${VERSION}

An open-source, local-first MCP server that turns Claude into an AI SDR.

Usage:
  opensdr-mcp              Start the MCP server over STDIO
  opensdr-mcp --version    Print the version and exit
  opensdr-mcp --help       Show this help and exit

With zero provider keys, OpenSDR runs in demo mode (reserved .example data, no network calls).

Environment variables:
  APOLLO_API_KEY                 Apollo search + enrichment (some endpoints need a master key)
  HUNTER_API_KEY                 Hunter email finder and verifier
  EXA_API_KEY                    Exa web/news search for signals and research
  TAVILY_API_KEY                 Tavily search (alternative to Exa)
  INSTANTLY_API_KEY              Instantly API v2 key
  HUBSPOT_ACCESS_TOKEN           HubSpot private-app token
  OPENSDR_DATA_DIR               Local data directory (default ~/.opensdr)
  OPENSDR_DEMO                   Set to 1 to force demo mode
  OPENSDR_READ_ONLY              Set to 1 to disable every external write
  OPENSDR_MAX_CREDITS_PER_CALL   Hard cap on paid credits per call (default 25)
  OPENSDR_CACHE_TTL_DAYS         Enrichment cache lifetime in days (default 30)
  OPENSDR_SIGNALS_PROVIDER       exa | tavily (default exa)
  OPENSDR_LOG_LEVEL              error | warn | info | debug (default info)
  OPENSDR_HTTP_TIMEOUT_MS        Per-request timeout in ms (default 20000)
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`OpenSDR configuration error: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  registerSecrets(config.secrets);
  const logger = createLogger({ level: config.logLevel });
  const http = createHttpClient({
    timeoutMs: config.httpTimeoutMs,
    userAgent: `opensdr-mcp/${VERSION}`,
  });
  const registry = createRegistry(config, { http });
  const session = { creditsUsed: 0 };
  const server = createServer({ config, registry, logger, version: VERSION, session });
  const transport = new StdioServerTransport();

  await server.connect(transport);
  logger.info(
    `OpenSDR v${VERSION} ready (mode=${config.mode}, providers=[${config.configuredProviders.join(', ')}])`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down.`);
    try {
      await server.close();
    } catch {
      // ignore close errors on shutdown
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
