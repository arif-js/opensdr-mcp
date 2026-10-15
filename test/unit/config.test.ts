import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('defaults to demo mode with zero keys', () => {
    const config = loadConfig({});
    expect(config.mode).toBe('demo');
    expect(config.configuredProviders).toEqual([]);
    expect(config.readOnly).toBe(false);
    expect(config.maxCreditsPerCall).toBe(25);
    expect(config.cacheTtlDays).toBe(30);
    expect(config.signalsProvider).toBe('exa');
    expect(config.logLevel).toBe('info');
    expect(config.httpTimeoutMs).toBe(20000);
    expect(config.dataDir).toBe(path.join(os.homedir(), '.opensdr'));
  });

  it('is live when at least one provider key is set', () => {
    const config = loadConfig({ APOLLO_API_KEY: 'apollo-key-1234567890' });
    expect(config.mode).toBe('live');
    expect(config.configuredProviders).toEqual(['apollo']);
  });

  it('honours OPENSDR_DEMO=1 even when keys exist', () => {
    const config = loadConfig({
      APOLLO_API_KEY: 'apollo-key-1234567890',
      OPENSDR_DEMO: '1',
    });
    expect(config.mode).toBe('demo');
    expect(config.demoRequested).toBe(true);
    expect(config.configuredProviders).toEqual(['apollo']);
  });

  it('treats an empty string as unset', () => {
    const config = loadConfig({ APOLLO_API_KEY: '' });
    expect(config.mode).toBe('demo');
    expect(config.configuredProviders).toEqual([]);
  });

  it('reads overrides and coerces numbers', () => {
    const config = loadConfig({
      OPENSDR_DATA_DIR: '/tmp/opensdr-test',
      OPENSDR_MAX_CREDITS_PER_CALL: '5',
      OPENSDR_CACHE_TTL_DAYS: '7',
      OPENSDR_READ_ONLY: 'true',
      OPENSDR_SIGNALS_PROVIDER: 'tavily',
      OPENSDR_LOG_LEVEL: 'debug',
      OPENSDR_HTTP_TIMEOUT_MS: '1500',
    });
    expect(config.dataDir).toBe('/tmp/opensdr-test');
    expect(config.maxCreditsPerCall).toBe(5);
    expect(config.cacheTtlDays).toBe(7);
    expect(config.readOnly).toBe(true);
    expect(config.signalsProvider).toBe('tavily');
    expect(config.logLevel).toBe('debug');
    expect(config.httpTimeoutMs).toBe(1500);
  });

  it('fails fast on an invalid number', () => {
    expect(() => loadConfig({ OPENSDR_MAX_CREDITS_PER_CALL: '-3' })).toThrow(ConfigError);
  });

  it('fails fast on an invalid boolean', () => {
    expect(() => loadConfig({ OPENSDR_DEMO: 'yes' })).toThrow(ConfigError);
  });

  it('names the offending env var in the error', () => {
    try {
      loadConfig({ OPENSDR_SIGNALS_PROVIDER: 'bing' });
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain('OPENSDR_SIGNALS_PROVIDER');
    }
  });

  it('collects secret values of length >= 8', () => {
    const config = loadConfig({
      APOLLO_API_KEY: 'short',
      HUNTER_API_KEY: 'hunter-key-1234567890',
    });
    expect(config.secrets).toEqual(['hunter-key-1234567890']);
  });

  it('treats unfilled MCPB placeholders as unset', () => {
    // What an MCP client passes when an optional bundle setting was left empty.
    const placeholder = (key: string) => `\${user_config.${key}}`;
    const config = loadConfig({
      APOLLO_API_KEY: placeholder('apollo_api_key'),
      OPENSDR_READ_ONLY: placeholder('read_only'),
    });
    expect(config.mode).toBe('demo');
    expect(config.readOnly).toBe(false);
  });
});
