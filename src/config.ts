import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { LogLevel } from './logger.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type ProviderKey = 'apollo' | 'hunter' | 'exa' | 'tavily' | 'instantly' | 'hubspot';

export const PROVIDER_ENV: Record<ProviderKey, string> = {
  apollo: 'APOLLO_API_KEY',
  hunter: 'HUNTER_API_KEY',
  exa: 'EXA_API_KEY',
  tavily: 'TAVILY_API_KEY',
  instantly: 'INSTANTLY_API_KEY',
  hubspot: 'HUBSPOT_ACCESS_TOKEN',
};

export type RunMode = 'demo' | 'live';

export interface Config {
  mode: RunMode;
  demoRequested: boolean;
  readOnly: boolean;
  dataDir: string;
  maxCreditsPerCall: number;
  cacheTtlDays: number;
  signalsProvider: 'exa' | 'tavily';
  logLevel: LogLevel;
  httpTimeoutMs: number;
  keys: Record<ProviderKey, string | undefined>;
  configuredProviders: ProviderKey[];
  secrets: string[];
}

const boolFromEnv = z.preprocess((value) => {
  if (value === undefined) return undefined;
  const text = String(value).toLowerCase();
  if (text === '1' || text === 'true') return true;
  if (text === '0' || text === 'false') return false;
  return value;
}, z.boolean());

const schema = z.object({
  demo: boolFromEnv.optional(),
  readOnly: boolFromEnv.optional(),
  maxCreditsPerCall: z.coerce.number().int().min(1).optional(),
  cacheTtlDays: z.coerce.number().int().min(1).optional(),
  httpTimeoutMs: z.coerce.number().int().min(1).optional(),
  signalsProvider: z.enum(['exa', 'tavily']).optional(),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).optional(),
  dataDir: z.string().min(1).optional(),
  apolloApiKey: z.string().min(1).optional(),
  hunterApiKey: z.string().min(1).optional(),
  exaApiKey: z.string().min(1).optional(),
  tavilyApiKey: z.string().min(1).optional(),
  instantlyApiKey: z.string().min(1).optional(),
  hubspotAccessToken: z.string().min(1).optional(),
});

const FIELD_ENV: Record<string, string> = {
  demo: 'OPENSDR_DEMO',
  readOnly: 'OPENSDR_READ_ONLY',
  maxCreditsPerCall: 'OPENSDR_MAX_CREDITS_PER_CALL',
  cacheTtlDays: 'OPENSDR_CACHE_TTL_DAYS',
  httpTimeoutMs: 'OPENSDR_HTTP_TIMEOUT_MS',
  signalsProvider: 'OPENSDR_SIGNALS_PROVIDER',
  logLevel: 'OPENSDR_LOG_LEVEL',
  dataDir: 'OPENSDR_DATA_DIR',
  apolloApiKey: 'APOLLO_API_KEY',
  hunterApiKey: 'HUNTER_API_KEY',
  exaApiKey: 'EXA_API_KEY',
  tavilyApiKey: 'TAVILY_API_KEY',
  instantlyApiKey: 'INSTANTLY_API_KEY',
  hubspotAccessToken: 'HUBSPOT_ACCESS_TOKEN',
};

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = {
    demo: read(env, 'OPENSDR_DEMO'),
    readOnly: read(env, 'OPENSDR_READ_ONLY'),
    maxCreditsPerCall: read(env, 'OPENSDR_MAX_CREDITS_PER_CALL'),
    cacheTtlDays: read(env, 'OPENSDR_CACHE_TTL_DAYS'),
    httpTimeoutMs: read(env, 'OPENSDR_HTTP_TIMEOUT_MS'),
    signalsProvider: read(env, 'OPENSDR_SIGNALS_PROVIDER'),
    logLevel: read(env, 'OPENSDR_LOG_LEVEL'),
    dataDir: read(env, 'OPENSDR_DATA_DIR'),
    apolloApiKey: read(env, 'APOLLO_API_KEY'),
    hunterApiKey: read(env, 'HUNTER_API_KEY'),
    exaApiKey: read(env, 'EXA_API_KEY'),
    tavilyApiKey: read(env, 'TAVILY_API_KEY'),
    instantlyApiKey: read(env, 'INSTANTLY_API_KEY'),
    hubspotAccessToken: read(env, 'HUBSPOT_ACCESS_TOKEN'),
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = String(issue.path[0] ?? 'config');
      return `${FIELD_ENV[field] ?? field}: ${issue.message}`;
    });
    throw new ConfigError(`Invalid OpenSDR configuration: ${issues.join('; ')}`);
  }

  const data = parsed.data;
  const keys: Record<ProviderKey, string | undefined> = {
    apollo: data.apolloApiKey,
    hunter: data.hunterApiKey,
    exa: data.exaApiKey,
    tavily: data.tavilyApiKey,
    instantly: data.instantlyApiKey,
    hubspot: data.hubspotAccessToken,
  };

  const configuredProviders = (Object.keys(keys) as ProviderKey[]).filter(
    (provider) => keys[provider] !== undefined,
  );

  const demoRequested = data.demo ?? false;
  const mode: RunMode = demoRequested || configuredProviders.length === 0 ? 'demo' : 'live';
  const secrets = configuredProviders
    .map((provider) => keys[provider])
    .filter((value): value is string => typeof value === 'string' && value.length >= 8);

  return {
    mode,
    demoRequested,
    readOnly: data.readOnly ?? false,
    dataDir: data.dataDir ?? path.join(os.homedir(), '.opensdr'),
    maxCreditsPerCall: data.maxCreditsPerCall ?? 25,
    cacheTtlDays: data.cacheTtlDays ?? 30,
    signalsProvider: data.signalsProvider ?? 'exa',
    logLevel: (data.logLevel ?? 'info') as LogLevel,
    httpTimeoutMs: data.httpTimeoutMs ?? 20000,
    keys,
    configuredProviders,
    secrets,
  };
}
