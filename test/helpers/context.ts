import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Config, loadConfig } from '../../src/config.js';
import type { DnsResolver } from '../../src/engine/email-validator.js';
import { createLogger } from '../../src/logger.js';
import { createRegistry, type RegistryDeps } from '../../src/providers/registry.js';
import type { ServerContext } from '../../src/server.js';

/** Never let a test touch the real ~/.opensdr: default to a fresh temp data dir. */
export function testConfig(env: NodeJS.ProcessEnv = {}): Config {
  return loadConfig({
    OPENSDR_DATA_DIR: mkdtempSync(path.join(os.tmpdir(), 'opensdr-test-')),
    ...env,
  });
}

export interface TestContextOptions {
  config?: Config;
  deps?: RegistryDeps;
  creditsUsed?: number;
  dns?: DnsResolver;
}

export function testContext(options: TestContextOptions = {}): ServerContext {
  const config = options.config ?? testConfig();
  return {
    config,
    registry: createRegistry(config, options.deps),
    logger: createLogger({ level: 'error', write: () => undefined }),
    version: '0.0.0-test',
    session: { creditsUsed: options.creditsUsed ?? 0 },
    ...(options.dns ? { dns: options.dns } : {}),
  };
}
