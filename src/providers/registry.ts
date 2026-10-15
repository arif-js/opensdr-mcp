import type { Config, ProviderKey } from '../config.js';
import { OpenSdrError } from '../errors.js';
import type { HttpClient } from '../http/client.js';
import { createApolloProvider } from './apollo.js';
import { createDemoProvider } from './demo/index.js';
import { createExaProvider } from './exa.js';
import { createHubspotProvider } from './hubspot.js';
import { createHunterProvider } from './hunter.js';
import { createInstantlyProvider } from './instantly.js';
import { createTavilyProvider } from './tavily.js';
import { CAPABILITIES, CAPABILITY_ENV, type Capability, type CapabilityMap } from './types.js';

export interface Registration {
  name: string;
  keys: ProviderKey[];
  capabilities: Capability[];
  create: (config: Config, deps: RegistryDeps) => { name: string } & Partial<CapabilityMap>;
}

export interface RegistryDeps {
  registrations?: Registration[];
  demoProvider?: CapabilityMap;
  http?: HttpClient;
}

export interface ProviderDescriptor {
  name: string;
  configured: boolean;
  capabilities: Capability[];
}

export interface ResolvedCapability {
  name: string;
  provider: unknown;
}

export interface Registry {
  resolve(capability: Capability): ResolvedCapability | null;
  get<K extends Capability>(capability: K): CapabilityMap[K];
  providers(): ProviderDescriptor[];
  capabilities(): Record<Capability, string | null>;
}

function requireHttp(deps: RegistryDeps, provider: string): HttpClient {
  if (!deps.http) {
    throw new OpenSdrError({
      code: 'INTERNAL',
      message: `The ${provider} provider requires an HTTP client.`,
    });
  }
  return deps.http;
}

export const apolloRegistration: Registration = {
  name: 'apollo',
  keys: ['apollo'],
  capabilities: ['peopleSearch', 'companySearch', 'personEnrich', 'companyEnrich'],
  create: (config, deps) => {
    const provider = createApolloProvider({
      http: requireHttp(deps, 'apollo'),
      apiKey: config.keys.apollo ?? '',
    });
    return {
      name: 'apollo',
      peopleSearch: provider,
      companySearch: provider,
      personEnrich: provider,
      companyEnrich: provider,
    };
  },
};

export const hunterRegistration: Registration = {
  name: 'hunter',
  keys: ['hunter'],
  capabilities: ['emailFinder', 'emailVerifier'],
  create: (config, deps) => {
    const provider = createHunterProvider({
      http: requireHttp(deps, 'hunter'),
      apiKey: config.keys.hunter ?? '',
    });
    return { name: 'hunter', emailFinder: provider, emailVerifier: provider };
  },
};

export const exaRegistration: Registration = {
  name: 'exa',
  keys: ['exa'],
  capabilities: ['webSignals'],
  create: (config, deps) => ({
    name: 'exa',
    webSignals: createExaProvider({
      http: requireHttp(deps, 'exa'),
      apiKey: config.keys.exa ?? '',
    }),
  }),
};

export const tavilyRegistration: Registration = {
  name: 'tavily',
  keys: ['tavily'],
  capabilities: ['webSignals'],
  create: (config, deps) => ({
    name: 'tavily',
    webSignals: createTavilyProvider({
      http: requireHttp(deps, 'tavily'),
      apiKey: config.keys.tavily ?? '',
    }),
  }),
};

export const instantlyRegistration: Registration = {
  name: 'instantly',
  keys: ['instantly'],
  capabilities: ['campaignSender'],
  create: (config, deps) => ({
    name: 'instantly',
    campaignSender: createInstantlyProvider({
      http: requireHttp(deps, 'instantly'),
      apiKey: config.keys.instantly ?? '',
    }),
  }),
};

export const hubspotRegistration: Registration = {
  name: 'hubspot',
  keys: ['hubspot'],
  capabilities: ['crm'],
  create: (config, deps) => ({
    name: 'hubspot',
    crm: createHubspotProvider({
      http: requireHttp(deps, 'hubspot'),
      apiKey: config.keys.hubspot ?? '',
    }),
  }),
};

/**
 * Live provider registrations. Resolution logic never changes when a provider
 * is added.
 */
export const defaultRegistrations: Registration[] = [
  apolloRegistration,
  hunterRegistration,
  exaRegistration,
  tavilyRegistration,
  instantlyRegistration,
  hubspotRegistration,
];

export function createRegistry(config: Config, deps: RegistryDeps = {}): Registry {
  const demo = deps.demoProvider ?? createDemoProvider();
  const registrations = deps.registrations ?? defaultRegistrations;
  const instances = new Map<Registration, { name: string } & Partial<CapabilityMap>>();

  const isConfigured = (registration: Registration): boolean =>
    registration.keys.every((key) => config.keys[key] !== undefined);

  const instanceFor = (registration: Registration): { name: string } & Partial<CapabilityMap> => {
    let instance = instances.get(registration);
    if (!instance) {
      instance = registration.create(config, deps);
      instances.set(registration, instance);
    }
    return instance;
  };

  const orderedFor = (capability: Capability): Registration[] => {
    if (capability !== 'webSignals') return registrations;
    return [...registrations].sort((a, b) => {
      const rank = (registration: Registration) =>
        registration.name === config.signalsProvider ? 0 : 1;
      return rank(a) - rank(b);
    });
  };

  const resolve = (capability: Capability): ResolvedCapability | null => {
    if (config.mode === 'demo') return { name: 'demo', provider: demo[capability] };
    for (const registration of orderedFor(capability)) {
      if (!registration.capabilities.includes(capability)) continue;
      if (!isConfigured(registration)) continue;
      return { name: registration.name, provider: instanceFor(registration)[capability] };
    }
    return null;
  };

  return {
    resolve,

    get<K extends Capability>(capability: K): CapabilityMap[K] {
      const found = resolve(capability);
      if (!found) {
        throw new OpenSdrError({
          code: 'NOT_CONFIGURED',
          message: `No provider is configured for the "${capability}" capability.`,
          hint: `Set ${CAPABILITY_ENV[capability]} to enable it.`,
        });
      }
      return found.provider as CapabilityMap[K];
    },

    providers(): ProviderDescriptor[] {
      if (config.mode === 'demo') {
        return [{ name: 'demo', configured: true, capabilities: [...CAPABILITIES] }];
      }
      return registrations.map((registration) => ({
        name: registration.name,
        configured: isConfigured(registration),
        capabilities: registration.capabilities,
      }));
    },

    capabilities(): Record<Capability, string | null> {
      const result = {} as Record<Capability, string | null>;
      for (const capability of CAPABILITIES) {
        result[capability] = resolve(capability)?.name ?? null;
      }
      return result;
    },
  };
}
