import { describe, expect, it } from 'vitest';
import { loadConfig, type ProviderKey } from '../../src/config.js';
import { createRegistry, type Registration } from '../../src/providers/registry.js';
import { CAPABILITIES } from '../../src/providers/types.js';

function peopleRegistration(name: string, key: ProviderKey): Registration {
  return {
    name,
    keys: [key],
    capabilities: ['peopleSearch'],
    create: () => ({
      name,
      peopleSearch: { name, searchPeople: async () => ({ items: [], next_cursor: null }) },
    }),
  };
}

function webRegistration(name: string, key: ProviderKey): Registration {
  return {
    name,
    keys: [key],
    capabilities: ['webSignals'],
    create: () => ({ name, webSignals: { name, search: async () => [] } }),
  };
}

describe('registry', () => {
  it('resolves every capability to demo in demo mode', () => {
    const registry = createRegistry(loadConfig({}));
    for (const capability of CAPABILITIES) {
      expect(registry.resolve(capability)?.name).toBe('demo');
    }
    expect(registry.providers()).toEqual([
      { name: 'demo', configured: true, capabilities: CAPABILITIES },
    ]);
  });

  it('resolves live providers and reports unconfigured capabilities as null', () => {
    const config = loadConfig({ APOLLO_API_KEY: 'apollo-key-1234567890' });
    const registry = createRegistry(config, {
      registrations: [peopleRegistration('apollo', 'apollo')],
    });
    expect(config.mode).toBe('live');
    expect(registry.capabilities().peopleSearch).toBe('apollo');
    expect(registry.capabilities().webSignals).toBeNull();
    expect(registry.providers()).toEqual([
      { name: 'apollo', configured: true, capabilities: ['peopleSearch'] },
    ]);
  });

  it('does not resolve a registration whose key is missing', () => {
    const config = loadConfig({ HUNTER_API_KEY: 'hunter-key-1234567890' });
    const registry = createRegistry(config, {
      registrations: [peopleRegistration('apollo', 'apollo')],
    });
    expect(registry.resolve('peopleSearch')).toBeNull();
    expect(registry.providers()[0]).toMatchObject({ configured: false });
  });

  it('throws NOT_CONFIGURED with an env hint', () => {
    const registry = createRegistry(loadConfig({ APOLLO_API_KEY: 'apollo-key-1234567890' }), {
      registrations: [peopleRegistration('apollo', 'apollo')],
    });
    try {
      registry.get('webSignals');
      throw new Error('expected get to throw');
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_CONFIGURED' });
      expect((error as { hint: string }).hint).toContain('EXA_API_KEY');
    }
  });

  it('prefers the configured signals provider', () => {
    const exa = webRegistration('exa', 'exa');
    const tavily = webRegistration('tavily', 'tavily');
    const env = { EXA_API_KEY: 'exa-key-1234567890', TAVILY_API_KEY: 'tavily-key-1234567890' };

    const defaultRegistry = createRegistry(loadConfig(env), { registrations: [tavily, exa] });
    expect(defaultRegistry.capabilities().webSignals).toBe('exa');

    const tavilyRegistry = createRegistry(
      loadConfig({ ...env, OPENSDR_SIGNALS_PROVIDER: 'tavily' }),
      {
        registrations: [exa, tavily],
      },
    );
    expect(tavilyRegistry.capabilities().webSignals).toBe('tavily');
  });

  it('creates each provider instance once', () => {
    let created = 0;
    const registration: Registration = {
      name: 'apollo',
      keys: ['apollo'],
      capabilities: ['peopleSearch'],
      create: () => {
        created += 1;
        return {
          name: 'apollo',
          peopleSearch: {
            name: 'apollo',
            searchPeople: async () => ({ items: [], next_cursor: null }),
          },
        };
      },
    };
    const registry = createRegistry(loadConfig({ APOLLO_API_KEY: 'apollo-key-1234567890' }), {
      registrations: [registration],
    });
    registry.get('peopleSearch');
    registry.get('peopleSearch');
    expect(created).toBe(1);
  });
});
