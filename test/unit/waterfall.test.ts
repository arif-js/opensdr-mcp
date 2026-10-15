import { describe, expect, it } from 'vitest';
import { createBudget } from '../../src/engine/budget.js';
import type { EmailValidation } from '../../src/engine/email-validator.js';
import { noopSuppression, type SuppressionChecker } from '../../src/engine/suppression.js';
import {
  type EnrichIdentity,
  type EnrichOutcome,
  enrichPerson,
  type WaterfallDeps,
} from '../../src/engine/waterfall.js';
import type { Registry } from '../../src/providers/registry.js';
import type {
  Capability,
  EmailFinding,
  PersonMatch,
  ProviderEmailVerdict,
} from '../../src/providers/types.js';
import type { EnrichmentCache } from '../../src/store/cache.js';
import type { EmailStatus, Person } from '../../src/types.js';

function person(id: string): Person {
  return { id, provider_ids: {}, sources: ['apollo'] };
}

function registryWith(providers: Partial<Record<Capability, unknown>>): Registry {
  return {
    resolve: (capability) => {
      const provider = providers[capability];
      if (!provider) return null;
      return { name: (provider as { name: string }).name, provider };
    },
    get: () => {
      throw new Error('not used');
    },
    providers: () => [],
    capabilities: () => ({}) as Record<Capability, string | null>,
  };
}

function apolloStub(result: PersonMatch | null, opts: { cost?: number; throws?: boolean } = {}) {
  return {
    name: 'apollo',
    calls: 0,
    estimateCost: () => opts.cost ?? 1,
    async matchPerson(): Promise<PersonMatch | null> {
      this.calls += 1;
      if (opts.throws) throw new Error('apollo boom');
      return result;
    },
  };
}

function finderStub(result: EmailFinding | null, cost = 1) {
  return {
    name: 'hunter',
    calls: 0,
    estimateCost: () => cost,
    async findEmail(): Promise<EmailFinding | null> {
      this.calls += 1;
      return result;
    },
  };
}

function verifierStub(result: ProviderEmailVerdict, cost = 1) {
  return {
    name: 'hunter',
    calls: 0,
    estimateCost: () => cost,
    async verifyEmail(): Promise<ProviderEmailVerdict> {
      this.calls += 1;
      return result;
    },
  };
}

function memoryCache(seed: Record<string, unknown> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get: async (key: string) => (map.has(key) ? map.get(key) : null),
    set: async (key: string, value: unknown) => {
      map.set(key, value);
    },
    prune: async () => undefined,
  } as unknown as EnrichmentCache;
}

function validatorStub(overrides: Partial<EmailValidation> = {}) {
  return {
    validate: async (): Promise<EmailValidation> => ({
      syntax: true,
      mx: 'ok',
      disposable: false,
      role_based: false,
      ...overrides,
    }),
  };
}

interface Case {
  name: string;
  input: EnrichIdentity;
  apollo?: PersonMatch | null;
  apolloThrows?: boolean;
  finder?: EmailFinding | null;
  verifier?: ProviderEmailVerdict;
  verify?: boolean;
  forceRefresh?: boolean;
  cache?: Record<string, unknown>;
  validator?: Partial<EmailValidation>;
  suppressed?: string;
  budget?: number;
  expect: {
    outcome: EnrichOutcome;
    status?: EmailStatus;
    email?: string;
    apolloCalls?: number;
    hunterCalls?: number;
    credits?: number;
  };
}

const NAME_DOMAIN: EnrichIdentity = {
  first_name: 'Jane',
  last_name: 'Doe',
  domain: 'northwind.example',
};

const VERIFIED: PersonMatch = {
  person: person('a1'),
  email: 'jane.doe@northwind.example',
  email_status: 'verified',
  confidence: 95,
};

const UNKNOWN_MATCH: PersonMatch = {
  person: person('a1'),
  email: 'jane.doe@northwind.example',
  email_status: 'unknown',
};

const cases: Case[] = [
  {
    name: 'apollo verified wins and Hunter finder is skipped',
    input: NAME_DOMAIN,
    apollo: VERIFIED,
    finder: { email: 'other@northwind.example', score: 95, sources: [] },
    expect: {
      outcome: 'found',
      status: 'verified',
      email: 'jane.doe@northwind.example',
      hunterCalls: 0,
      credits: 1,
    },
  },
  {
    name: 'apollo unknown + Hunter 95 upgrades to likely',
    input: NAME_DOMAIN,
    apollo: UNKNOWN_MATCH,
    finder: { email: 'jane.doe@northwind.example', score: 95, sources: [] },
    expect: { outcome: 'found', status: 'likely', credits: 2 },
  },
  {
    name: 'apollo miss + Hunter 95 → likely',
    input: NAME_DOMAIN,
    apollo: null,
    finder: { email: 'jane.doe@northwind.example', score: 95, sources: [] },
    expect: { outcome: 'found', status: 'likely', credits: 2 },
  },
  {
    name: 'apollo miss + Hunter 78 → unknown',
    input: NAME_DOMAIN,
    apollo: null,
    finder: { email: 'jane.doe@northwind.example', score: 78, sources: [] },
    expect: { outcome: 'found', status: 'unknown', credits: 2 },
  },
  {
    name: 'apollo miss + Hunter 60 (below 70) → discarded, not_found',
    input: NAME_DOMAIN,
    apollo: null,
    finder: { email: 'jane.doe@northwind.example', score: 60, sources: [] },
    expect: { outcome: 'not_found', credits: 2 },
  },
  {
    name: 'apollo miss + no Hunter → not_found',
    input: NAME_DOMAIN,
    apollo: null,
    expect: { outcome: 'not_found', credits: 1 },
  },
  {
    name: 'input email only → unknown, no spend',
    input: { email: 'jane@northwind.example' },
    expect: { outcome: 'found', status: 'unknown', email: 'jane@northwind.example', credits: 0 },
  },
  {
    name: 'local syntax failure → invalid',
    input: { email: 'not-an-email' },
    validator: { syntax: false },
    expect: { outcome: 'found', status: 'invalid' },
  },
  {
    name: 'local missing MX → invalid',
    input: NAME_DOMAIN,
    apollo: VERIFIED,
    validator: { mx: 'none' },
    expect: { outcome: 'found', status: 'invalid' },
  },
  {
    name: 'local disposable domain → invalid',
    input: NAME_DOMAIN,
    apollo: { person: person('a1'), email: 'jane@mailinator.com', email_status: 'verified' },
    validator: { disposable: true },
    expect: { outcome: 'found', status: 'invalid' },
  },
  {
    name: 'role address caps verified at likely',
    input: NAME_DOMAIN,
    apollo: { person: person('a1'), email: 'sales@northwind.example', email_status: 'verified' },
    validator: { role_based: true },
    expect: { outcome: 'found', status: 'likely' },
  },
  {
    name: 'suppressed domain makes no HTTP call',
    input: { first_name: 'Jane', last_name: 'Doe', domain: 'blocked.example' },
    apollo: VERIFIED,
    finder: { email: 'x@blocked.example', score: 95, sources: [] },
    suppressed: 'manual',
    expect: { outcome: 'suppressed', apolloCalls: 0, hunterCalls: 0, credits: 0 },
  },
  {
    name: 'zero budget skips every paid tier',
    input: NAME_DOMAIN,
    apollo: VERIFIED,
    finder: { email: 'jane.doe@northwind.example', score: 95, sources: [] },
    budget: 0,
    expect: { outcome: 'not_found', apolloCalls: 0, hunterCalls: 0, credits: 0 },
  },
  {
    name: 'cache hit costs nothing and makes no call',
    input: NAME_DOMAIN,
    apollo: VERIFIED,
    cache: { 'person:name:jane doe@northwind.example': { person: null, email_check: null } },
    expect: { outcome: 'not_found', apolloCalls: 0, credits: 0 },
  },
  {
    name: 'force_refresh bypasses the cache',
    input: NAME_DOMAIN,
    apollo: VERIFIED,
    forceRefresh: true,
    cache: { 'person:name:jane doe@northwind.example': { person: null, email_check: null } },
    expect: { outcome: 'found', status: 'verified', apolloCalls: 1 },
  },
  {
    name: 'apollo not configured but Hunter is → Hunter used',
    input: NAME_DOMAIN,
    finder: { email: 'jane.doe@northwind.example', score: 95, sources: [] },
    expect: { outcome: 'found', status: 'likely', credits: 1 },
  },
  {
    name: 'Hunter skipped when name or domain is missing',
    input: { apollo_id: 'apollo-123' },
    finder: { email: 'jane.doe@northwind.example', score: 95, sources: [] },
    expect: { outcome: 'not_found', hunterCalls: 0, credits: 0 },
  },
  {
    name: 'verifier accept_all overrides a verified match',
    input: NAME_DOMAIN,
    apollo: VERIFIED,
    verify: true,
    verifier: {
      email: 'jane.doe@northwind.example',
      status: 'accept_all',
      provider_result: 'accept_all',
    },
    expect: { outcome: 'found', status: 'accept_all', credits: 2 },
  },
  {
    name: 'apollo error is caught and Hunter still runs',
    input: NAME_DOMAIN,
    apolloThrows: true,
    finder: { email: 'jane.doe@northwind.example', score: 95, sources: [] },
    expect: { outcome: 'found', status: 'likely', credits: 2 },
  },
];

describe('waterfall enrichPerson (table)', () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      const apollo =
        testCase.apollo === undefined && !testCase.apolloThrows
          ? null
          : apolloStub(testCase.apollo ?? null, { throws: testCase.apolloThrows });
      const finder = testCase.finder === undefined ? null : finderStub(testCase.finder);
      const verifier = testCase.verifier === undefined ? null : verifierStub(testCase.verifier);
      const budget = createBudget(testCase.budget ?? 10);
      const suppression: SuppressionChecker = testCase.suppressed
        ? { isSuppressed: () => ({ suppressed: true, reason: testCase.suppressed }) }
        : noopSuppression;

      const deps: WaterfallDeps = {
        registry: registryWith({
          ...(apollo ? { personEnrich: apollo } : {}),
          ...(finder ? { emailFinder: finder } : {}),
          ...(verifier ? { emailVerifier: verifier } : {}),
        }),
        cache: memoryCache(testCase.cache),
        suppression,
        budget,
        validator: validatorStub(testCase.validator),
      };

      const result = await enrichPerson(testCase.input, deps, {
        verifyWithHunter: testCase.verify,
        forceRefresh: testCase.forceRefresh,
      });

      expect(result.outcome).toBe(testCase.expect.outcome);
      if (testCase.expect.status) expect(result.email_check?.status).toBe(testCase.expect.status);
      if (testCase.expect.email) expect(result.email_check?.email).toBe(testCase.expect.email);
      if (testCase.expect.apolloCalls !== undefined)
        expect(apollo?.calls ?? 0).toBe(testCase.expect.apolloCalls);
      if (testCase.expect.hunterCalls !== undefined)
        expect(finder?.calls ?? 0).toBe(testCase.expect.hunterCalls);
      if (testCase.expect.credits !== undefined) expect(budget.used).toBe(testCase.expect.credits);
    });
  }

  it('rejects an identity with too little information', async () => {
    const result = await enrichPerson(
      {},
      {
        registry: registryWith({}),
        cache: memoryCache(),
        suppression: noopSuppression,
        budget: createBudget(5),
        validator: validatorStub(),
      },
    );
    expect(result.outcome).toBe('error');
    expect(result.error?.code).toBe('BAD_INPUT');
  });
});
